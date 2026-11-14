import { randomUUID, createHash } from 'node:crypto';
import {
  cleanMessageText,
  cleanName,
  cleanDeviceType,
  isAllowedReaction,
  isAllowedFloatingReaction,
  normalizeFloatingReaction,
  isValidCode,
  normalizeCode
} from './rooms.js';
import {
  MAX_MESSAGE_LENGTH,
  MAX_NAME_LENGTH,
  MAX_PARTICIPANTS,
  MAX_UPLOAD_BYTES,
  MAX_MESSAGES_PER_10S,
  MIN_MESSAGE_INTERVAL_MS,
  SPAM_MUTE_MS,
  MAX_SOCKETS_PER_IP,
  MAX_PARTICIPANTS_PER_IP_PER_ROOM,
  MAX_JOINS_PER_IP_PER_MIN,
  BAN_DEFAULT_MINUTES,
  SOUNDBOARD_SET,
  SOUNDBOARD_MAX_PER_5S
} from './constants.js';
import { hashValue, cleanDeviceId, stripInvisible, spamScore, activeBans } from './security.js';
import { isValidServerId, isValidChannelId } from './servers.js';

const RATE_WINDOW_MS = 5000;
const RATE_MAX = 12;
const REACTION_RATE_MAX = 24;
const TYPING_RATE_MAX = 40;
const PRESENCE_RATE_MAX = 60;

const channelFor = (code) => `room:${code}`;

function safeAck(ack, payload) {
  if (typeof ack === 'function') ack(payload);
}

function asBoolean(value) {
  return value === true;
}

function publicParticipant(participant) {
  const { ipHash, deviceHash, ...rest } = participant;
  return { ...rest };
}

function uniqueName(room, requested) {
  const taken = new Set(
    [...room.participants.values()].map((participant) => participant.name.toLowerCase())
  );
  if (!taken.has(requested.toLowerCase())) return requested;

  const stem = requested.replace(/\s+\(\d+\)$/, '').slice(0, MAX_NAME_LENGTH - 6).trim();
  for (let index = 2; index < 100; index += 1) {
    const candidate = `${stem} (${index})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${requested.slice(0, MAX_NAME_LENGTH - 3)} ${Math.floor(10 + Math.random() * 90)}`;
}

function cleanAttachment(raw, code) {
  if (!raw || typeof raw !== 'object') return null;
  const url = String(raw.url ?? '');
  const prefix = `/uploads/${code}/`;
  if (!url.startsWith(prefix) || url.includes('..') || url.includes('\\')) return null;

  const name = String(raw.name ?? 'File')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 120) || 'File';
  const size = Number(raw.size);
  if (!Number.isFinite(size) || size < 0 || size > MAX_UPLOAD_BYTES) return null;

  return {
    url,
    name,
    size,
    mime: String(raw.mime ?? 'application/octet-stream').slice(0, 100)
  };
}

function allowRateFor(socket, bucket, max) {
  const now = Date.now();
  const hits = socket.data[bucket] ?? [];
  while (hits.length && now - hits[0] > RATE_WINDOW_MS) hits.shift();
  if (hits.length >= max) {
    socket.data[bucket] = hits;
    return false;
  }
  hits.push(now);
  socket.data[bucket] = hits;
  return true;
}

function allowRate(socket) {
  return allowRateFor(socket, 'chatRate', RATE_MAX);
}

function clientIp(socket) {
  // H3: prefer the real socket address. Only trust X-Forwarded-For when we
  // are explicitly behind a proxy (HUSH_TRUST_PROXY=1), otherwise any client
  // can rotate XFF and defeat every IP rate limit / ban.
  if (process.env.HUSH_TRUST_PROXY === '1') {
    const forwarded = String(socket.handshake.headers?.['x-forwarded-for'] || '')
      .split(',')[0].trim();
    if (forwarded) return forwarded;
  }
  return socket.handshake.address || 'unknown';
}

export function attachRealtime(io, { rooms, servers, sessions = null, maxParticipants = MAX_PARTICIPANTS } = {}) {
  if (!rooms) throw new Error('attachRealtime requires a RoomManager');
  // servers is OPTIONAL: standalone rooms work without it. When provided,
  // the server system is fully separate (its own chat + voice channels).

  // Per-server connection tracking for IP limits. Kept inside this closure
  // (not module globals) so multiple servers in one process — e.g. tests —
  // never share counters, and ipJoins is swept so it cannot grow forever.
  const ipSockets = new Map(); // ipHash -> Set<socketId>
  const ipJoins = new Map(); // ipHash -> number[] timestamps
  let lastJoinSweep = Date.now();

  function trackIpSocket(ipHash, socketId) {
    if (!ipSockets.has(ipHash)) ipSockets.set(ipHash, new Set());
    ipSockets.get(ipHash).add(socketId);
  }
  function untrackIpSocket(ipHash, socketId) {
    const set = ipSockets.get(ipHash);
    if (!set) return;
    set.delete(socketId);
    if (!set.size) ipSockets.delete(ipHash);
  }
  function ipSocketCount(ipHash) {
    return ipSockets.get(ipHash)?.size ?? 0;
  }
  function allowIpJoin(ipHash) {
    const now = Date.now();
    if (now - lastJoinSweep > 60_000) {
      lastJoinSweep = now;
      for (const [key, hits] of ipJoins) {
        const fresh = hits.filter((t) => now - t < 60_000);
        if (fresh.length) ipJoins.set(key, fresh); else ipJoins.delete(key);
      }
    }
    const hits = (ipJoins.get(ipHash) ?? []).filter((t) => now - t < 60_000);
    if (hits.length >= MAX_JOINS_PER_IP_PER_MIN) { ipJoins.set(ipHash, hits); return false; }
    hits.push(now); ipJoins.set(ipHash, hits); return true;
  }

  // Per-server online presence: socket ids currently inside each server.
  const serverOnline = new Map(); // serverId -> Map<socketId, {id,name,deviceId}>

  function trackServerOnline(serverId, socketId, info) {
    if (!serverOnline.has(serverId)) serverOnline.set(serverId, new Map());
    serverOnline.get(serverId).set(socketId, info);
  }
  function untrackServerOnline(serverId, socketId) {
    const map = serverOnline.get(serverId);
    if (!map) return;
    map.delete(socketId);
    if (!map.size) serverOnline.delete(serverId);
  }
  function serverOnlineList(serverId, viewerDeviceId) {
    // Socket ids are required for realtime signaling. Return a device id only
    // for the viewer's own socket; member ids identify everyone else.
    return [...(serverOnline.get(serverId)?.values() ?? [])].map((p) => ({
      id: p.id,
      name: p.name,
      memberId: p.memberId,
      ...(p.deviceId === viewerDeviceId ? { deviceId: p.deviceId } : {})
    }));
  }
  // Internal only: full records including deviceId for duplicate-device /
  // eviction logic. Never sent to clients.
  function serverOnlineRaw(serverId) {
    return [...(serverOnline.get(serverId)?.values() ?? [])];
  }

  // Voice occupancy: who is inside which voice channel / temp room.
  // serverId -> Map<channelId|roomId, Map<socketId, {id,name}>>
  const voiceOccupancy = new Map();
  const tempOccupancy = new Map();

  function trackVoice(serverId, channelId, socketId, info) {
    if (!channelId) return;
    if (!voiceOccupancy.has(serverId)) voiceOccupancy.set(serverId, new Map());
    const channels = voiceOccupancy.get(serverId);
    if (!channels.has(channelId)) channels.set(channelId, new Map());
    channels.get(channelId).set(socketId, info);
  }
  function untrackVoice(serverId, channelId, socketId) {
    if (!channelId) return;
    const channels = voiceOccupancy.get(serverId);
    if (!channels) return;
    const members = channels.get(channelId);
    if (members) { members.delete(socketId); if (!members.size) channels.delete(channelId); }
    if (!channels.size) voiceOccupancy.delete(serverId);
  }
  function trackTemp(serverId, roomId, socketId, info) {
    if (!roomId) return;
    if (!tempOccupancy.has(serverId)) tempOccupancy.set(serverId, new Map());
    const rooms = tempOccupancy.get(serverId);
    if (!rooms.has(roomId)) rooms.set(roomId, new Map());
    rooms.get(roomId).set(socketId, info);
  }
  function untrackTemp(serverId, roomId, socketId) {
    if (!roomId) return;
    const rooms = tempOccupancy.get(serverId);
    if (!rooms) return;
    const members = rooms.get(roomId);
    if (members) { members.delete(socketId); if (!members.size) rooms.delete(roomId); }
    if (!rooms.size) tempOccupancy.delete(serverId);
  }
  function voiceOccupancySnapshot(serverId) {
    const out = {};
    for (const [channelId, members] of voiceOccupancy.get(serverId) ?? []) {
      if (members.size) out[channelId] = [...members.values()].map((p) => ({ id: p.id, name: p.name }));
    }
    return out;
  }
  function tempOccupancySnapshot(serverId) {
    const out = {};
    for (const [roomId, members] of tempOccupancy.get(serverId) ?? []) {
      if (members.size) out[roomId] = [...members.values()].map((p) => ({ id: p.id, name: p.name }));
    }
    return out;
  }
  function emitVoiceOccupancy(serverId) {
    try {
      io.to(`server:${serverId}`).emit('server:voice:occupancy', {
        voiceOccupancy: voiceOccupancySnapshot(serverId),
        tempOccupancy: tempOccupancySnapshot(serverId)
      });
    } catch { /* ignore */ }
  }

  // Ephemeral voice sub-rooms inside a server ("Create Room Voice").
  // Never persisted: the room vanishes when its last person leaves.
  // Only the creatorDeviceId may rename (or close) it.
  const tempRooms = new Map(); // serverId -> Map<roomId, {id,name,creatorDeviceId,creatorName,createdAt, members:Set<socketId>}>
  const tempChannelFor = (serverId, roomId) => `server:${serverId}:temp:${roomId}`;
  const MAX_TEMP_ROOMS = 10;

  function listTempRooms(serverId) {
    const map = tempRooms.get(serverId);
    if (!map) return [];
    return [...map.values()].map((r) => {
      const occupants = tempOccupancy.get(serverId)?.get(r.id);
      return {
        id: r.id, name: r.name,
        creatorName: r.creatorName,
        memberCount: r.members.size, createdAt: r.createdAt,
        // Names inside so the channel list can show who is there.
        members: occupants ? [...occupants.values()].map((p) => ({ id: p.id, name: p.name })) : []
      };
    });
  }
  function emitTempRooms(serverId) {
    io.to(`server:${serverId}`).emit('server:tempRooms:updated', { tempRooms: listTempRooms(serverId) });
  }

  function clearServerRuntime(serverId) {
    // M4: server delete must clear tempRooms + presence too, not just data.
    try { tempRooms.delete(serverId); } catch { /* ignore */ }
    try { serverOnline.delete(serverId); } catch { /* ignore */ }
    try { voiceOccupancy.delete(serverId); } catch { /* ignore */ }
    try { tempOccupancy.delete(serverId); } catch { /* ignore */ }
    try { io.to(`server:${serverId}`).emit('server:tempRooms:updated', { tempRooms: [] }); } catch { /* ignore */ }
    try { io.to(`server:${serverId}`).emit('server:voice:occupancy', { voiceOccupancy: {}, tempOccupancy: {} }); } catch { /* ignore */ }
  }

  io.on('connection', (socket) => {
    const ipHash = hashValue(clientIp(socket), 'ip');
    socket.data.ipHash = ipHash;

    if (ipSocketCount(ipHash) >= MAX_SOCKETS_PER_IP) {
      socket.emit('room:error', { error: 'too-many-connections' });
      socket.disconnect(true);
      return;
    }
    trackIpSocket(ipHash, socket.id);

    let membership = null;
    let serverMembership = null; // { server, participant, deviceId, voiceChannelId, tempRoomId }
    const serverChannelFor = (id) => `server:${id}`;
    const voiceChannelFor = (id, channelId) => `server:${id}:voice:${channelId}`;

    function isHost() {
      return membership && membership.room.hostId === socket.id;
    }

    function leaveServer() {
      if (!serverMembership) return;
      const { server, participant, voiceChannelId, tempRoomId } = serverMembership;
      serverMembership = null;
      socket.data.serverId = null;
      socket.data.serverVoiceChannelId = null;
      socket.data.serverTempRoomId = null;
      socket.data.serverDeviceId = null;
      untrackServerOnline(server.id, socket.id);
      if (voiceChannelId) {
        untrackVoice(server.id, voiceChannelId, socket.id);
        socket.to(voiceChannelFor(server.id, voiceChannelId)).emit('server:peer:left', { id: participant.id, name: participant.name });
        socket.leave(voiceChannelFor(server.id, voiceChannelId));
      }
      if (tempRoomId) {
        untrackTemp(server.id, tempRoomId, socket.id);
        const peerRoom = tempRooms.get(server.id)?.get(tempRoomId);
        if (peerRoom) {
          socket.to(tempChannelFor(server.id, tempRoomId)).emit('server:peer:left', { id: participant.id, name: participant.name });
          socket.leave(tempChannelFor(server.id, tempRoomId));
          peerRoom.members.delete(socket.id);
          if (peerRoom.members.size === 0) {
            tempRooms.get(server.id)?.delete(tempRoomId);
            if (!tempRooms.get(server.id)?.size) tempRooms.delete(server.id);
          }
        }
      }
      socket.to(serverChannelFor(server.id)).emit('server:peer:left', { id: participant.id, name: participant.name });
      socket.leave(serverChannelFor(server.id));
      emitTempRooms(server.id);
      emitVoiceOccupancy(server.id);
    }

    function leaveServerVoice() {
      if (!serverMembership?.voiceChannelId) return;
      const { server, participant, voiceChannelId } = serverMembership;
      serverMembership.voiceChannelId = null;
      socket.data.serverVoiceChannelId = null;
      untrackVoice(server.id, voiceChannelId, socket.id);
      socket.to(voiceChannelFor(server.id, voiceChannelId)).emit('server:peer:left', { id: participant.id, name: participant.name });
      socket.leave(voiceChannelFor(server.id, voiceChannelId));
      emitVoiceOccupancy(server.id);
    }

    function leaveServerTempRoom() {
      if (!serverMembership?.tempRoomId) return false;
      const { server, participant, tempRoomId } = serverMembership;
      serverMembership.tempRoomId = null;
      socket.data.serverTempRoomId = null;
      untrackTemp(server.id, tempRoomId, socket.id);
      const room = tempRooms.get(server.id)?.get(tempRoomId);
      socket.to(tempChannelFor(server.id, tempRoomId)).emit('server:peer:left', { id: participant.id, name: participant.name });
      socket.leave(tempChannelFor(server.id, tempRoomId));
      if (room) {
        room.members.delete(socket.id);
        if (room.members.size === 0) {
          tempRooms.get(server.id)?.delete(tempRoomId);
          if (!tempRooms.get(server.id)?.size) tempRooms.delete(server.id);
        }
      }
      emitTempRooms(server.id);
      emitVoiceOccupancy(server.id);
      return true;
    }

    function leave() {
      if (!membership) return;
      const { room, participant } = membership;
      membership = null;
      socket.data.roomCode = null;
      room.participants.delete(participant.id);
      rooms.touch(room);
      // Custom soundboard is per-session: the last person leaving
      // deletes the room's custom sounds completely (files + metadata).
      if (room.participants.size === 0 && (room.customSounds || []).length) {
        rooms.purgeCustomSounds(room).catch(() => {});
      }
      // Host transfer: oldest remaining participant becomes host
      if (room.hostId === participant.id) {
        const next = [...room.participants.values()].sort((a, b) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0))[0];
        room.hostId = next ? next.id : null;
        if (next) {
          io.to(channelFor(room.code)).emit('admin:host', { hostId: next.id, hostName: next.name });
          // Host is in-memory only (no disk write on leave) to avoid save races on shutdown.
        }
      }
      socket.to(channelFor(room.code)).emit('peer:left', {
        id: participant.id,
        name: participant.name
      });
      socket.leave(channelFor(room.code));
    }

    socket.on('room:join', async (payload = {}, ack) => {
      try {
        if (!allowRateFor(socket, 'joinRate', 10)) {
          return safeAck(ack, { ok: false, error: 'rate-limited' });
        }
        if (!allowIpJoin(ipHash)) {
          return safeAck(ack, { ok: false, error: 'rate-limited' });
        }
        // Validate BEFORE leaving the current room (a failed join must not
        // eject you — same pattern as server:join).
        const code = normalizeCode(payload.code);
        if (!isValidCode(code)) {
          return safeAck(ack, { ok: false, error: 'invalid-code' });
        }

        const room = await rooms.getOrCreate(code);

        // Ban check (device + ip). deviceId is expected (real clients always
        // send it); falling back to socket.id keeps old clients/tests working
        // but those joins get a fresh identity — IP ban still applies.
        const rawDevice = cleanDeviceId(payload.deviceId);
        const deviceHash = rawDevice ? hashValue(rawDevice, 'device') : hashValue(socket.id, 'device');
        socket.data.deviceHash = deviceHash;
        const bans = activeBans(room.banned);
        const banned = bans.find((b) => b.deviceHash === deviceHash || b.ipHash === ipHash);
        if (banned) {
          return safeAck(ack, { ok: false, error: 'banned', until: banned.until ?? null, reason: banned.reason || '' });
        }

        // Password gate (v15): rooms may carry a scrypt password hash. The
        // client sends the password (or the one it remembered for this room)
        // in the join payload; wrong/missing -> error and NO membership, NO
        // history, NO participant list. Attempts are throttled per socket
        // (scrypt is deliberately expensive — see passwordRate bucket).
        if (rooms.hasPassword(room)) {
          if (!allowRateFor(socket, 'passwordRate', 6)) {
            return safeAck(ack, { ok: false, error: 'rate-limited' });
          }
          const supplied = String(payload.password ?? '');
          const ok = await rooms.verifyPassword(room, supplied);
          if (!ok) {
            // 'wrong-password' lets the UI keep the typed value; a client
            // that sent nothing gets 'password-required' to show the gate.
            return safeAck(ack, {
              ok: false,
              error: supplied ? 'wrong-password' : 'password-required',
              passwordRequired: true
            });
          }
        }

        if (room.participants.size >= maxParticipants) {
          return safeAck(ack, { ok: false, error: 'room-full' });
        }

        // Validated: now leave the previous room.
        leave();

        // Anti multi-account from same device: one slot per device per room.
        // If same device already in room on another socket, disconnect the old one.
        for (const p of room.participants.values()) {
          if (p.deviceHash === deviceHash && p.id !== socket.id) {
            const oldSocket = io.sockets.sockets.get(p.id);
            if (oldSocket) {
              oldSocket.emit('room:error', { error: 'duplicate-device' });
              oldSocket.disconnect(true);
            }
            room.participants.delete(p.id);
          }
        }

        // Per-IP per-room cap
        const sameIp = [...room.participants.values()].filter((p) => p.ipHash === ipHash).length;
        if (sameIp >= MAX_PARTICIPANTS_PER_IP_PER_ROOM) {
          return safeAck(ack, { ok: false, error: 'too-many-from-device' });
        }

        const requestedName = cleanName(stripInvisible(payload.name));
        const participant = {
          id: socket.id,
          name: uniqueName(room, requestedName),
          micOn: false,
          cameraOn: false,
          screenOn: false,
          handRaised: false,
          joinedAt: Date.now(),
          // Client-declared device class ('phone' | 'pc' | 'tablet', '').
          deviceType: cleanDeviceType(payload.deviceType),
          deviceHash,
          ipHash
        };

        const isFirst = room.participants.size === 0;
        room.participants.set(socket.id, participant);
        if (isFirst || !room.hostId || !room.participants.has(room.hostId)) {
          room.hostId = socket.id;
        }
        rooms.touch(room);
        membership = { room, participant };
        socket.data.roomCode = code;
        socket.data.chatHistory = [];
        socket.data.lastChatAt = 0;
        socket.data.spamStrikes = 0;
        socket.data.mutedUntil = 0;

        socket.join(channelFor(code));
        socket.to(channelFor(code)).emit('peer:joined', {
          participant: publicParticipant(participant)
        });

        safeAck(ack, {
          ok: true,
          self: { id: participant.id, name: participant.name, isHost: room.hostId === socket.id },
          hostId: room.hostId,
          isHost: room.hostId === socket.id,
          room: {
            code,
            name: room.name ?? '',
            hasPassword: rooms.hasPassword(room),
            participants: [...room.participants.values()].map(publicParticipant),
            messages: room.messages,
            pinnedMessageId: room.pinnedMessageId ?? null,
            customSounds: room.customSounds ?? []
          }
        });
      } catch (error) {
        console.error('room:join failed', error);
        safeAck(ack, { ok: false, error: 'join-failed' });
      }
    });

    // PING OP v1.0 owns `ping:request` (attached in src/app.js via
    // PING OP/src/server.js). Kept as a no-op comment so old clients keep
    // working — the library handler echoes { t, seq, serverTime, op, version }.
    socket.on('room:leave', () => leave());
    socket.on('server:leave', () => leaveServer());
    socket.on('disconnect', () => { leave(); leaveServer(); untrackIpSocket(ipHash, socket.id); });

    /* -------- Admin: kick / ban / unban / disconnect / transfer / deleteAny -------- */
    function requireHost(targetId, ack) {
      if (!membership) { safeAck(ack, { ok: false, error: 'not-in-room' }); return null; }
      if (!isHost()) { safeAck(ack, { ok: false, error: 'not-admin' }); return null; }
      const target = membership.room.participants.get(targetId);
      if (!target) { safeAck(ack, { ok: false, error: 'user-not-found' }); return null; }
      if (targetId === socket.id) { safeAck(ack, { ok: false, error: 'cannot-target-self' }); return null; }
      return target;
    }

    socket.on('admin:kick', (payload = {}, ack) => {
      if (!allowRateFor(socket, 'adminRate', 10)) return safeAck(ack, { ok: false, error: 'rate-limited' });
      const target = requireHost(String(payload.targetId || ''), ack);
      if (!target) return;
      const { room } = membership;
      const targetSocket = io.sockets.sockets.get(target.id);
      io.to(channelFor(room.code)).emit('admin:action', { type: 'kick', targetId: target.id, targetName: target.name, by: membership.participant.name });
      if (targetSocket) { targetSocket.emit('admin:removed', { reason: 'kicked', by: membership.participant.name }); targetSocket.disconnect(true); }
      safeAck(ack, { ok: true });
    });

    socket.on('admin:disconnect', (payload = {}, ack) => {
      if (!allowRateFor(socket, 'adminRate', 10)) return safeAck(ack, { ok: false, error: 'rate-limited' });
      const target = requireHost(String(payload.targetId || ''), ack);
      if (!target) return;
      const { room } = membership;
      const targetSocket = io.sockets.sockets.get(target.id);
      io.to(channelFor(room.code)).emit('admin:action', { type: 'disconnect', targetId: target.id, targetName: target.name, by: membership.participant.name });
      if (targetSocket) { targetSocket.emit('admin:removed', { reason: 'disconnected', by: membership.participant.name }); targetSocket.disconnect(true); }
      safeAck(ack, { ok: true });
    });

    socket.on('admin:ban', async (payload = {}, ack) => {
      if (!allowRateFor(socket, 'adminRate', 10)) return safeAck(ack, { ok: false, error: 'rate-limited' });
      const target = requireHost(String(payload.targetId || ''), ack);
      if (!target) return;
      const { room } = membership;
      const minutes = Math.min(10080, Math.max(1, Number(payload.minutes) || BAN_DEFAULT_MINUTES));
      const ban = {
        deviceHash: target.deviceHash,
        ipHash: target.ipHash,
        name: target.name,
        until: Date.now() + minutes * 60_000,
        reason: String(payload.reason || '').slice(0, 120)
      };
      await rooms.addBan(room, ban);
      const targetSocket = io.sockets.sockets.get(target.id);
      io.to(channelFor(room.code)).emit('admin:action', { type: 'ban', targetId: target.id, targetName: target.name, by: membership.participant.name, minutes });
      if (targetSocket) { targetSocket.emit('admin:removed', { reason: 'banned', by: membership.participant.name, minutes }); targetSocket.disconnect(true); }
      safeAck(ack, { ok: true, ban });
    });

    socket.on('admin:unban', async (payload = {}, ack) => {
      if (!membership) return safeAck(ack, { ok: false, error: 'not-in-room' });
      if (!isHost()) return safeAck(ack, { ok: false, error: 'not-admin' });
      if (!allowRateFor(socket, 'adminRate', 10)) return safeAck(ack, { ok: false, error: 'rate-limited' });
      const removed = await rooms.removeBan(membership.room, {
        deviceHash: String(payload.deviceHash || ''),
        ipHash: String(payload.ipHash || '')
      });
      io.to(channelFor(membership.room.code)).emit('admin:action', { type: 'unban', by: membership.participant.name });
      safeAck(ack, { ok: true, removed });
    });

    socket.on('admin:transfer', (payload = {}, ack) => {
      if (!allowRateFor(socket, 'adminRate', 10)) return safeAck(ack, { ok: false, error: 'rate-limited' });
      const target = requireHost(String(payload.targetId || ''), ack);
      if (!target) return;
      membership.room.hostId = target.id;
      rooms.setHost(membership.room, target.id).catch(() => {});
      io.to(channelFor(membership.room.code)).emit('admin:host', { hostId: target.id, hostName: target.name });
      safeAck(ack, { ok: true });
    });

    /* -------- Room settings (v15): host renames / manages the password -------- */
    socket.on('room:rename', async (payload = {}, ack) => {
      try {
        if (!membership) return safeAck(ack, { ok: false, error: 'not-in-room' });
        if (!isHost()) return safeAck(ack, { ok: false, error: 'not-admin' });
        if (!allowRateFor(socket, 'roomSettingsRate', 10)) return safeAck(ack, { ok: false, error: 'rate-limited' });
        const name = await rooms.setRoomName(membership.room, payload.name);
        // Instant for everyone: header + tab title update live.
        io.to(channelFor(membership.room.code)).emit('room:renamed', { name, by: membership.participant.name });
        safeAck(ack, { ok: true, name });
      } catch (error) {
        console.error('room:rename failed', error);
        safeAck(ack, { ok: false, error: 'rename-failed' });
      }
    });

    socket.on('room:password', async (payload = {}, ack) => {
      try {
        if (!membership) return safeAck(ack, { ok: false, error: 'not-in-room' });
        if (!isHost()) return safeAck(ack, { ok: false, error: 'not-admin' });
        if (!allowRateFor(socket, 'roomSettingsRate', 5)) return safeAck(ack, { ok: false, error: 'rate-limited' });
        if (payload.password === undefined) return safeAck(ack, { ok: false, error: 'invalid-room-password' });
        if (payload.password === '' || payload.password === null) {
          await rooms.removePassword(membership.room);
        } else {
          await rooms.setPassword(membership.room, payload.password);
        }
        // Never broadcast the password itself — only that protection changed.
        // People already inside stay inside; NEW joins follow the new rule.
        io.to(channelFor(membership.room.code)).emit('room:password-changed', {
          hasPassword: rooms.hasPassword(membership.room),
          by: membership.participant.name
        });
        safeAck(ack, { ok: true, hasPassword: rooms.hasPassword(membership.room) });
      } catch (error) {
        if (error?.message === 'invalid-room-password') {
          return safeAck(ack, { ok: false, error: 'invalid-room-password' });
        }
        console.error('room:password failed', error);
        safeAck(ack, { ok: false, error: 'password-failed' });
      }
    });

    socket.on('admin:mute', (payload = {}, ack) => {
      if (!allowRateFor(socket, 'adminRate', 10)) return safeAck(ack, { ok: false, error: 'rate-limited' });
      const target = requireHost(String(payload.targetId || ''), ack);
      if (!target) return;
      const targetSocket = io.sockets.sockets.get(target.id);
      if (targetSocket) targetSocket.data.mutedUntil = Date.now() + 60_000;
      io.to(channelFor(membership.room.code)).emit('admin:action', { type: 'mute', targetId: target.id, targetName: target.name, by: membership.participant.name });
      if (targetSocket) targetSocket.emit('admin:muted', { by: membership.participant.name });
      safeAck(ack, { ok: true });
    });

    socket.on('chat:delete-any', async (payload = {}, ack) => {
      if (!membership) return safeAck(ack, { ok: false, error: 'not-in-room' });
      if (!isHost()) return safeAck(ack, { ok: false, error: 'not-admin' });
      if (!allowRateFor(socket, 'deleteRate', RATE_MAX)) return safeAck(ack, { ok: false, error: 'rate-limited' });
      const messageId = String(payload?.messageId ?? '');
      if (!messageId) return safeAck(ack, { ok: false, error: 'message-not-found' });
      const removed = await rooms.deleteMessageAsAdmin(membership.room, messageId);
      if (!removed) return safeAck(ack, { ok: false, error: 'message-not-found' });
      io.to(channelFor(membership.room.code)).emit('chat:deleted', { messageId });
      safeAck(ack, { ok: true });
    });

    socket.on('chat:send', async (payload = {}, ack) => {
      if (!membership) return safeAck(ack, { ok: false, error: 'not-in-room' });
      // Mute penalty box
      if (socket.data.mutedUntil && Date.now() < socket.data.mutedUntil) {
        return safeAck(ack, { ok: false, error: 'muted', until: socket.data.mutedUntil });
      }
      if (!allowRate(socket)) return safeAck(ack, { ok: false, error: 'rate-limited' });

      const { room, participant } = membership;
      const text = cleanMessageText(stripInvisible(payload.text));
      const attachment = cleanAttachment(payload.attachment, room.code);
      if (!text && !attachment) return safeAck(ack, { ok: false, error: 'empty-message' });
      if (text.length > MAX_MESSAGE_LENGTH) {
        return safeAck(ack, { ok: false, error: 'message-too-long' });
      }

      // Burst + interval anti-spam
      const now = Date.now();
      const history = socket.data.chatHistory ?? [];
      const recent = history.filter((t) => now - t < 10_000);
      if (recent.length >= MAX_MESSAGES_PER_10S) {
        socket.data.spamStrikes = (socket.data.spamStrikes || 0) + 1;
        if (socket.data.spamStrikes >= 2) socket.data.mutedUntil = now + SPAM_MUTE_MS;
        return safeAck(ack, { ok: false, error: 'spam' });
      }
      if (now - (socket.data.lastChatAt || 0) < MIN_MESSAGE_INTERVAL_MS) {
        return safeAck(ack, { ok: false, error: 'spam' });
      }

      // Content spam scoring
      if (text) {
        const scored = spamScore(text, (socket.data.textHistory || []).slice(-5));
        if (!scored.ok) {
          socket.data.spamStrikes = (socket.data.spamStrikes || 0) + 1;
          if (socket.data.spamStrikes >= 2) socket.data.mutedUntil = now + SPAM_MUTE_MS;
          return safeAck(ack, { ok: false, error: 'spam' });
        }
      }

      socket.data.lastChatAt = now;
      socket.data.chatHistory = [...recent, now];
      if (text) {
        socket.data.textHistory = [...(socket.data.textHistory || []).slice(-9), { text: text.toLowerCase().replace(/\s+/g, ' '), at: now }];
      }

      const message = {
        id: randomUUID(),
        type: 'text',
        text,
        attachment,
        authorId: participant.id,
        authorName: participant.name,
        // Device icon next to the name in chat (kept in history so icons
        // still render for authors who already left).
        authorDeviceType: participant.deviceType || '',
        createdAt: Date.now(),
        reactions: {}
      };

      try {
        await rooms.addMessage(room, message);
        io.to(channelFor(room.code)).emit('chat:message', message);
        safeAck(ack, { ok: true, id: message.id, createdAt: message.createdAt });
      } catch (error) {
        console.error('chat:send failed', error);
        safeAck(ack, { ok: false, error: 'send-failed' });
      }
    });

    socket.on('chat:edit', async (payload = {}, ack) => {
      try {
        if (!membership) return safeAck(ack, { ok: false, error: 'not-in-room' });
        if (!allowRateFor(socket, 'editRate', RATE_MAX)) {
          return safeAck(ack, { ok: false, error: 'rate-limited' });
        }
        const messageId = String(payload?.messageId ?? '');
        const text = cleanMessageText(stripInvisible(payload?.text));
        if (!messageId || !text) return safeAck(ack, { ok: false, error: 'empty-message' });
        if (text.length > MAX_MESSAGE_LENGTH) {
          return safeAck(ack, { ok: false, error: 'message-too-long' });
        }
        const updated = await rooms.editMessage(
          membership.room,
          messageId,
          socket.id,
          text
        );
        if (!updated) return safeAck(ack, { ok: false, error: 'message-not-found' });
        io.to(channelFor(membership.room.code)).emit('chat:edited', {
          messageId,
          text: updated.text,
          editedAt: updated.editedAt
        });
        safeAck(ack, { ok: true });
      } catch (error) {
        console.error('chat:edit failed', error);
        safeAck(ack, { ok: false, error: 'edit-failed' });
      }
    });

    socket.on('chat:delete', async (payload = {}, ack) => {
      try {
        if (!membership) return safeAck(ack, { ok: false, error: 'not-in-room' });
        if (!allowRateFor(socket, 'deleteRate', RATE_MAX)) {
          return safeAck(ack, { ok: false, error: 'rate-limited' });
        }
        const messageId = String(payload?.messageId ?? '');
        if (!messageId) return safeAck(ack, { ok: false, error: 'message-not-found' });
        const removed = await rooms.deleteMessage(membership.room, messageId, socket.id);
        if (!removed) return safeAck(ack, { ok: false, error: 'message-not-found' });
        io.to(channelFor(membership.room.code)).emit('chat:deleted', { messageId });
        safeAck(ack, { ok: true });
      } catch (error) {
        console.error('chat:delete failed', error);
        safeAck(ack, { ok: false, error: 'delete-failed' });
      }
    });

    socket.on('chat:pin', async (payload = {}, ack) => {
      try {
        if (!membership) return safeAck(ack, { ok: false, error: 'not-in-room' });
        if (!allowRateFor(socket, 'pinRate', RATE_MAX)) {
          return safeAck(ack, { ok: false, error: 'rate-limited' });
        }
        const messageId = String(payload?.messageId ?? '');
        if (!messageId) {
          await rooms.unpinMessage(membership.room);
          io.to(channelFor(membership.room.code)).emit('chat:pinned', { pinnedMessageId: null });
          return safeAck(ack, { ok: true });
        }
        const pinned = await rooms.pinMessage(membership.room, messageId);
        if (!pinned) return safeAck(ack, { ok: false, error: 'message-not-found' });
        io.to(channelFor(membership.room.code)).emit('chat:pinned', { pinnedMessageId: messageId });
        safeAck(ack, { ok: true });
      } catch (error) {
        console.error('chat:pin failed', error);
        safeAck(ack, { ok: false, error: 'pin-failed' });
      }
    });

    socket.on('chat:typing', (payload = {}) => {
      if (!membership) return;
      if (!allowRateFor(socket, 'typingRate', TYPING_RATE_MAX)) return;
      socket.to(channelFor(membership.room.code)).emit('chat:typing', {
        id: socket.id,
        name: membership.participant.name,
        typing: asBoolean(payload.typing)
      });
    });

    socket.on('chat:react', async (payload = {}, ack) => {
      if (!membership) return safeAck(ack, { ok: false, error: 'not-in-room' });
      if (!allowRateFor(socket, 'reactRate', REACTION_RATE_MAX)) {
        return safeAck(ack, { ok: false, error: 'rate-limited' });
      }
      const emoji = String(payload.emoji ?? '');
      const messageId = String(payload.messageId ?? '');
      if (!isAllowedReaction(emoji) || !messageId) {
        return safeAck(ack, { ok: false, error: 'invalid-reaction' });
      }

      try {
        const reactions = await rooms.toggleReaction(
          membership.room,
          messageId,
          emoji,
          socket.id
        );
        if (!reactions) return safeAck(ack, { ok: false, error: 'message-not-found' });
        io.to(channelFor(membership.room.code)).emit('chat:reaction', {
          messageId,
          reactions
        });
        safeAck(ack, { ok: true, reactions });
      } catch (error) {
        console.error('chat:react failed', error);
        safeAck(ack, { ok: false, error: 'reaction-failed' });
      }
    });

    socket.on('soundboard:play', (payload = {}, ack) => {
      if (!membership) return safeAck(ack, { ok: false, error: 'not-in-room' });
      if (!allowRateFor(socket, 'boardRate', SOUNDBOARD_MAX_PER_5S)) {
        return safeAck(ack, { ok: false, error: 'rate-limited' });
      }
      const id = String(payload?.id ?? '');
      // Built-in synth sound?
      if (SOUNDBOARD_SET.has(id)) {
        io.to(channelFor(membership.room.code)).emit('soundboard:play', {
          id, custom: false,
          from: socket.id,
          name: membership.participant.name
        });
        return safeAck(ack, { ok: true });
      }
      // Or this room's custom sound (uuid in room.customSounds)?
      const custom = (membership.room.customSounds || []).find((s) => s.id === id);
      if (!custom) return safeAck(ack, { ok: false, error: 'invalid-sound' });
      io.to(channelFor(membership.room.code)).emit('soundboard:play', {
        id: custom.id, custom: true, url: custom.url, imageUrl: custom.imageUrl || '', emojiId: custom.emojiId, soundName: custom.name,
        from: socket.id,
        name: membership.participant.name
      });
      safeAck(ack, { ok: true });
    });

    socket.on('soundboard:deleteCustom', async (payload = {}, ack) => {
      if (!membership) return safeAck(ack, { ok: false, error: 'not-in-room' });
      if (!allowRateFor(socket, 'boardRate', SOUNDBOARD_MAX_PER_5S)) return safeAck(ack, { ok: false, error: 'rate-limited' });
      const id = String(payload?.id ?? '');
      const room = membership.room;
      const target = (room.customSounds || []).find((s) => s.id === id);
      if (!target) return safeAck(ack, { ok: false, error: 'invalid-sound' });
      // Only the person who added it, or the host, may delete it.
      if (target.addedById !== socket.id && !isHost()) return safeAck(ack, { ok: false, error: 'not-admin' });
      const removed = await rooms.removeCustomSound(room, id);
      if (!removed) return safeAck(ack, { ok: false, error: 'invalid-sound' });
      io.to(channelFor(room.code)).emit('soundboard:deleted', { id });
      safeAck(ack, { ok: true });
    });

    socket.on('soundboard:clearCustom', async (payload = {}, ack) => {
      if (!membership) return safeAck(ack, { ok: false, error: 'not-in-room' });
      if (!isHost()) return safeAck(ack, { ok: false, error: 'not-admin' });
      if (!allowRateFor(socket, 'boardRate', SOUNDBOARD_MAX_PER_5S)) return safeAck(ack, { ok: false, error: 'rate-limited' });
      await rooms.clearCustomSounds(membership.room);
      io.to(channelFor(membership.room.code)).emit('soundboard:cleared', {});
      safeAck(ack, { ok: true });
    });

    socket.on('reaction:send', (payload = {}) => {
      if (!membership) return;
      if (!allowRateFor(socket, 'floatRate', REACTION_RATE_MAX)) return;
      const raw = String(payload.emoji ?? '');
      if (!isAllowedFloatingReaction(raw)) return;
      io.to(channelFor(membership.room.code)).emit('reaction:receive', {
        id: socket.id,
        name: membership.participant.name,
        emoji: normalizeFloatingReaction(raw)
      });
    });

    socket.on('presence:update', (payload = {}) => {
      if (!membership) return;
      if (!allowRateFor(socket, 'presenceRate', PRESENCE_RATE_MAX)) return;
      const participant = membership.participant;
      participant.micOn = asBoolean(payload.micOn);
      participant.cameraOn = asBoolean(payload.cameraOn);
      participant.screenOn = asBoolean(payload.screenOn);
      participant.handRaised = asBoolean(payload.handRaised);
      participant.deafened = asBoolean(payload.deafened);
      rooms.touch(membership.room);
      io.to(channelFor(membership.room.code)).emit('peer:updated', publicParticipant(participant));
    });

    /* -------- Servers: independent from rooms (own chat + voice) -------- */
    function cleanServerAttachment(raw, serverId, channelId) {
      if (!raw || typeof raw !== 'object') return null;
      const url = String(raw.url ?? '');
      const prefix = `/uploads/server-${serverId}/${channelId}/`;
      if (!url.startsWith(prefix) || url.includes('..') || url.includes('\\')) return null;
      const name = String(raw.name ?? 'File').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120) || 'File';
      const size = Number(raw.size);
      if (!Number.isFinite(size) || size < 0 || size > MAX_UPLOAD_BYTES) return null;
      return { url, name, size, mime: String(raw.mime ?? 'application/octet-stream').slice(0, 100) };
    }

    socket.on('server:join', async (payload = {}, ack) => {
      if (!servers) return safeAck(ack, { ok: false, error: 'server-unavailable' });
      if (!allowRateFor(socket, 'serverJoinRate', 10)) return safeAck(ack, { ok: false, error: 'rate-limited' });
      const serverId = String(payload.serverId || '');
      const server = servers.get(serverId);
      if (!server) return safeAck(ack, { ok: false, error: 'server-not-found' });
      const deviceId = cleanDeviceId(payload.deviceId) || '';
      const banned = deviceId ? servers.isBanned(server, deviceId) : null;
      if (banned) return safeAck(ack, { ok: false, error: 'banned', until: banned.until ?? null });
      const joined = await servers.join(serverId, {
        deviceId: payload.deviceId, name: payload.name, inviteCode: payload.inviteCode
      });
      if (!joined) {
        const exists = servers.get(serverId);
        if (!exists) return safeAck(ack, { ok: false, error: 'server-not-found' });
        if (servers.isBanned(exists, deviceId)) return safeAck(ack, { ok: false, error: 'banned' });
        return safeAck(ack, { ok: false, error: 'invite-required' });
      }
      // Validated: only now leave the previous server membership, so a
      // failed join never drops you out of the server you were in.
      leaveServer();
      // One socket per device per server: close the old tab's socket so
      // presence and voice do not flood with clones.
      if (deviceId) {
        for (const p of serverOnlineRaw(serverId)) {
          if (p.deviceId === deviceId && p.id !== socket.id) {
            const oldSocket = io.sockets.sockets.get(p.id);
            if (oldSocket) {
              oldSocket.emit('room:error', { error: 'duplicate-device' });
              oldSocket.disconnect(true);
            }
            untrackServerOnline(serverId, p.id);
          }
        }
      }
      // Load history BEFORE joining the channel, so a history failure
      // never leaves a ghost membership behind.
      const requested = String(payload.channelId || '');
      const requestedChannel = requested ? server.channels.find((c) => c.id === requested) : null;
      const firstText = requestedChannel && requestedChannel.type === 'text'
        ? requestedChannel
        : server.channels.find((c) => c.type === 'text') || server.channels[0];
      let messages = [];
      try {
        messages = firstText ? await servers.loadMessages(serverId, firstText.id) : [];
      } catch (error) {
        console.error('server:join loadMessages failed', error);
        return safeAck(ack, { ok: false, error: 'history-failed' });
      }
      const participant = {
        id: socket.id,
        name: cleanName(stripInvisible(payload.name)),
        micOn: false,
        cameraOn: false,
        screenOn: false,
        joinedAt: Date.now()
      };
      serverMembership = { server, participant, deviceId: deviceId || socket.id, voiceChannelId: null, tempRoomId: null };
      socket.data.serverId = serverId;
      socket.data.serverDeviceId = deviceId || '';
      socket.data.serverVoiceChannelId = null;
      socket.data.serverTempRoomId = null;
      trackServerOnline(serverId, socket.id, { id: socket.id, name: participant.name, deviceId: deviceId || '', memberId: servers.memberIdFor(deviceId || '') });
      socket.join(serverChannelFor(serverId));
      socket.to(serverChannelFor(serverId)).emit('server:peer:joined', { participant: { id: participant.id, name: participant.name, memberId: servers.memberIdFor(deviceId || '') } });
      // A1: issue a session token bound to this device+server for REST calls.
      const sessionToken = sessions && deviceId ? sessions.issue(deviceId, serverId) : '';
      safeAck(ack, {
        ok: true,
        self: { id: socket.id, name: participant.name, deviceId: deviceId || '', memberId: servers.memberIdFor(deviceId || '') },
        server: servers.publicSummary(server, deviceId || null),
        membersOnline: serverOnlineList(serverId, deviceId),
        tempRooms: listTempRooms(serverId),
        voiceOccupancy: voiceOccupancySnapshot(serverId),
        tempOccupancy: tempOccupancySnapshot(serverId),
        messages: messages.map((message) => servers.publicMessage(message, deviceId)),
        channelId: firstText?.id ?? null,
        sessionToken
      });
    });

    socket.on('server:history', async (payload = {}, ack) => {
      try {
        if (!servers || !serverMembership) return safeAck(ack, { ok: false, error: 'not-in-server' });
        if (!allowRateFor(socket, 'historyRate', 20)) return safeAck(ack, { ok: false, error: 'rate-limited' });
        const fresh = servers.get(serverMembership.server.id);
        if (!fresh) return safeAck(ack, { ok: false, error: 'server-not-found' });
        serverMembership.server = fresh;
        if (!servers.isMember(fresh, serverMembership.deviceId)) return safeAck(ack, { ok: false, error: 'not-member' });
        if (servers.isBanned(fresh, serverMembership.deviceId)) return safeAck(ack, { ok: false, error: 'banned' });
        const channelId = String(payload.channelId || '');
        if (!isValidChannelId(channelId)) return safeAck(ack, { ok: false, error: 'channel-not-found' });
        const channel = fresh.channels.find((c) => c.id === channelId);
        if (!channel || channel.type !== 'text') return safeAck(ack, { ok: false, error: 'channel-not-found' });
        const messages = await servers.loadMessages(fresh.id, channelId);
        safeAck(ack, {
          ok: true,
          messages: messages.map((message) => servers.publicMessage(message, serverMembership.deviceId))
        });
      } catch (error) {
        console.error('server:history failed', error);
        safeAck(ack, { ok: false, error: 'history-failed' });
      }
    });

    socket.on('server:chat:send', async (payload = {}, ack) => {
      if (!servers || !serverMembership) return safeAck(ack, { ok: false, error: 'not-in-server' });
      if (socket.data.mutedUntil && Date.now() < socket.data.mutedUntil) return safeAck(ack, { ok: false, error: 'muted' });
      if (!allowRate(socket)) return safeAck(ack, { ok: false, error: 'rate-limited' });
      const { server, participant, deviceId } = serverMembership;
      // The server object may be stale after a REST rename/kick: refresh.
      const freshServer = servers.get(server.id);
      if (!freshServer) return safeAck(ack, { ok: false, error: 'server-not-found' });
      serverMembership.server = freshServer;
      if (!servers.isMember(freshServer, deviceId)) return safeAck(ack, { ok: false, error: 'not-member' });
      if (servers.isBanned(freshServer, deviceId)) return safeAck(ack, { ok: false, error: 'banned' });
      const channelId = String(payload.channelId || '');
      const channel = freshServer.channels.find((c) => c.id === channelId && c.type === 'text');
      if (!channel) return safeAck(ack, { ok: false, error: 'channel-not-found' });
      const text = cleanMessageText(stripInvisible(payload.text));
      const attachment = cleanServerAttachment(payload.attachment, server.id, channelId);
      let replyTo = null;
      if (payload.replyToId) {
        let source;
        try {
          source = await servers.findMessage(server.id, channelId, String(payload.replyToId));
        } catch (error) {
          console.error('server:chat:reply lookup failed', error);
          return safeAck(ack, { ok: false, error: 'send-failed' });
        }
        if (!source) return safeAck(ack, { ok: false, error: 'message-not-found' });
        replyTo = {
          messageId: source.id,
          authorName: source.authorName,
          text: String(source.forwardedFrom?.text ?? source.text).slice(0, 240)
        };
      }
      if (!text && !attachment) return safeAck(ack, { ok: false, error: 'empty-message' });
      if (text.length > MAX_MESSAGE_LENGTH) return safeAck(ack, { ok: false, error: 'message-too-long' });
      const now = Date.now();
      const recent = (socket.data.chatHistory ?? []).filter((t) => now - t < 10_000);
      if (recent.length >= MAX_MESSAGES_PER_10S) {
        socket.data.spamStrikes = (socket.data.spamStrikes || 0) + 1;
        if (socket.data.spamStrikes >= 2) socket.data.mutedUntil = now + SPAM_MUTE_MS;
        return safeAck(ack, { ok: false, error: 'spam' });
      }
      if (now - (socket.data.lastChatAt || 0) < MIN_MESSAGE_INTERVAL_MS) {
        return safeAck(ack, { ok: false, error: 'spam' });
      }
      if (text) {
        const scored = spamScore(text, (socket.data.textHistory || []).slice(-5));
        if (!scored.ok) {
          socket.data.spamStrikes = (socket.data.spamStrikes || 0) + 1;
          if (socket.data.spamStrikes >= 2) socket.data.mutedUntil = now + SPAM_MUTE_MS;
          return safeAck(ack, { ok: false, error: 'spam' });
        }
      }
      socket.data.lastChatAt = now;
      socket.data.chatHistory = [...recent, now];
      if (text) {
        socket.data.textHistory = [...(socket.data.textHistory || []).slice(-9), { text: text.toLowerCase().replace(/\s+/g, ' '), at: now }];
      }
      const message = {
        id: randomUUID(), type: 'text', text, attachment,
        authorId: participant.id, authorDeviceId: deviceId, authorName: participant.name,
        createdAt: Date.now(), reactions: {}, channelId, replyTo
      };
      try {
        await servers.addMessage(server.id, channelId, message);
        const room = serverChannelFor(server.id);
        io.to(room).except(socket.id).emit('server:chat:message', servers.publicMessage(message, ''));
        socket.emit('server:chat:message', servers.publicMessage(message, deviceId));
        safeAck(ack, { ok: true, id: message.id });
      } catch (error) {
        console.error('server:chat:send failed', error);
        safeAck(ack, { ok: false, error: 'send-failed' });
      }
    });

    socket.on('server:chat:forward', async (payload = {}, ack) => {
      try {
        if (!servers || !serverMembership) return safeAck(ack, { ok: false, error: 'not-in-server' });
        if (socket.data.mutedUntil && Date.now() < socket.data.mutedUntil) return safeAck(ack, { ok: false, error: 'muted' });
        if (!allowRateFor(socket, 'forwardRate', 8)) return safeAck(ack, { ok: false, error: 'rate-limited' });
        const fresh = servers.get(serverMembership.server.id);
        if (!fresh) return safeAck(ack, { ok: false, error: 'server-not-found' });
        serverMembership.server = fresh;
        const { deviceId, participant } = serverMembership;
        if (!servers.isMember(fresh, deviceId) || servers.isBanned(fresh, deviceId)) {
          return safeAck(ack, { ok: false, error: 'not-member' });
        }
        const sourceChannelId = String(payload.sourceChannelId ?? '');
        const targetChannelId = String(payload.targetChannelId ?? '');
        const sourceChannel = fresh.channels.find((channel) => channel.id === sourceChannelId && channel.type === 'text');
        const targetChannel = fresh.channels.find((channel) => channel.id === targetChannelId && channel.type === 'text');
        if (!sourceChannel || !targetChannel) return safeAck(ack, { ok: false, error: 'channel-not-found' });
        const source = await servers.findMessage(fresh.id, sourceChannelId, String(payload.messageId ?? ''));
        if (!source) return safeAck(ack, { ok: false, error: 'message-not-found' });
        const origin = source.forwardedFrom || {
          authorName: source.authorName,
          channelName: sourceChannel.name,
          text: source.text,
          attachment: source.attachment
        };
        const message = {
          id: randomUUID(), type: 'text', text: '', attachment: null,
          authorId: participant.id, authorDeviceId: deviceId, authorName: participant.name,
          createdAt: Date.now(), editedAt: undefined, reactions: {}, channelId: targetChannelId,
          forwardedFrom: {
            sourceChannelId: source.forwardedFrom?.sourceChannelId || sourceChannelId,
            authorName: String(origin.authorName || 'Guest').slice(0, 32),
            channelName: String(origin.channelName || sourceChannel.name).slice(0, 32),
            text: String(origin.text || '').slice(0, 1000),
            attachment: origin.attachment || null
          }
        };
        const stored = await servers.addMessage(fresh.id, targetChannelId, message);
        if (!stored) return safeAck(ack, { ok: false, error: 'send-failed' });
        const room = serverChannelFor(fresh.id);
        io.to(room).except(socket.id).emit('server:chat:message', servers.publicMessage(message, ''));
        socket.emit('server:chat:message', servers.publicMessage(message, deviceId));
        safeAck(ack, { ok: true, id: message.id });
      } catch (error) {
        console.error('server:chat:forward failed', error);
        safeAck(ack, { ok: false, error: 'send-failed' });
      }
    });

    socket.on('server:chat:edit', async (payload = {}, ack) => {
      try {
        if (!servers || !serverMembership) return safeAck(ack, { ok: false, error: 'not-in-server' });
        if (!allowRateFor(socket, 'editRate', RATE_MAX)) return safeAck(ack, { ok: false, error: 'rate-limited' });
        const fresh = servers.get(serverMembership.server.id);
        if (!fresh) return safeAck(ack, { ok: false, error: 'server-not-found' });
        serverMembership.server = fresh;
        if (!servers.isMember(fresh, serverMembership.deviceId) || servers.isBanned(fresh, serverMembership.deviceId)) return safeAck(ack, { ok: false, error: 'not-member' });
        const channelId = String(payload.channelId || '');
        if (!isValidChannelId(channelId)) return safeAck(ack, { ok: false, error: 'channel-not-found' });
        const messageId = String(payload.messageId || '');
        const text = cleanMessageText(stripInvisible(payload.text));
        if (!messageId || !text || !channelId) return safeAck(ack, { ok: false, error: 'empty-message' });
        if (text.length > MAX_MESSAGE_LENGTH) return safeAck(ack, { ok: false, error: 'message-too-long' });
        const scored = spamScore(text);
        if (!scored.ok) return safeAck(ack, { ok: false, error: 'spam' });
        const updated = await servers.editMessage(fresh.id, channelId, messageId, serverMembership.deviceId, text);
        if (!updated) return safeAck(ack, { ok: false, error: 'message-not-found' });
        io.to(serverChannelFor(fresh.id)).emit('server:chat:edited', { channelId, messageId, text: updated.text, editedAt: updated.editedAt });
        safeAck(ack, { ok: true });
      } catch (error) {
        console.error('server:chat:edit failed', error);
        safeAck(ack, { ok: false, error: 'edit-failed' });
      }
    });

    socket.on('server:chat:delete', async (payload = {}, ack) => {
      try {
        if (!servers || !serverMembership) return safeAck(ack, { ok: false, error: 'not-in-server' });
        if (!allowRateFor(socket, 'deleteRate', RATE_MAX)) return safeAck(ack, { ok: false, error: 'rate-limited' });
        const fresh = servers.get(serverMembership.server.id);
        if (!fresh) return safeAck(ack, { ok: false, error: 'server-not-found' });
        serverMembership.server = fresh;
        if (!servers.isMember(fresh, serverMembership.deviceId) || servers.isBanned(fresh, serverMembership.deviceId)) return safeAck(ack, { ok: false, error: 'not-member' });
        const channelId = String(payload.channelId || '');
        if (!isValidChannelId(channelId)) return safeAck(ack, { ok: false, error: 'channel-not-found' });
        const messageId = String(payload.messageId || '');
        const removed = await servers.deleteMessage(fresh.id, channelId, messageId, serverMembership.deviceId);
        if (!removed) return safeAck(ack, { ok: false, error: 'message-not-found' });
        io.to(serverChannelFor(fresh.id)).emit('server:chat:deleted', { channelId, messageId });
        safeAck(ack, { ok: true });
      } catch (error) {
        console.error('server:chat:delete failed', error);
        safeAck(ack, { ok: false, error: 'delete-failed' });
      }
    });

    socket.on('server:chat:deleteAny', async (payload = {}, ack) => {
      try {
        if (!servers || !serverMembership) return safeAck(ack, { ok: false, error: 'not-in-server' });
        if (!allowRateFor(socket, 'deleteRate', RATE_MAX)) return safeAck(ack, { ok: false, error: 'rate-limited' });
        const fresh = servers.get(serverMembership.server.id);
        if (!fresh) return safeAck(ack, { ok: false, error: 'server-not-found' });
        serverMembership.server = fresh;
        if (!servers.isMember(fresh, serverMembership.deviceId) || servers.isBanned(fresh, serverMembership.deviceId)) return safeAck(ack, { ok: false, error: 'not-member' });
        const { deviceId } = serverMembership;
        if (!servers.hasPermission(fresh, deviceId, 'manage_messages')) return safeAck(ack, { ok: false, error: 'not-admin' });
        const channelId = String(payload.channelId || '');
        if (!isValidChannelId(channelId)) return safeAck(ack, { ok: false, error: 'channel-not-found' });
        const messageId = String(payload.messageId || '');
        const removed = await servers.deleteMessageAsAdmin(fresh.id, channelId, messageId);
        if (!removed) return safeAck(ack, { ok: false, error: 'message-not-found' });
        io.to(serverChannelFor(fresh.id)).emit('server:chat:deleted', { channelId, messageId });
        safeAck(ack, { ok: true });
      } catch (error) {
        console.error('server:chat:deleteAny failed', error);
        safeAck(ack, { ok: false, error: 'delete-failed' });
      }
    });

    socket.on('server:chat:react', async (payload = {}, ack) => {
      try {
        if (!servers || !serverMembership) return safeAck(ack, { ok: false, error: 'not-in-server' });
        if (!allowRateFor(socket, 'reactRate', REACTION_RATE_MAX)) return safeAck(ack, { ok: false, error: 'rate-limited' });
        const fresh = servers.get(serverMembership.server.id);
        if (!fresh) return safeAck(ack, { ok: false, error: 'server-not-found' });
        serverMembership.server = fresh;
        if (!servers.isMember(fresh, serverMembership.deviceId) || servers.isBanned(fresh, serverMembership.deviceId)) return safeAck(ack, { ok: false, error: 'not-member' });
        const emoji = String(payload.emoji ?? '');
        const messageId = String(payload.messageId ?? '');
        const channelId = String(payload.channelId ?? '');
        if (!isAllowedReaction(emoji) || !messageId || !isValidChannelId(channelId)) return safeAck(ack, { ok: false, error: 'invalid-reaction' });
        const reactions = await servers.toggleReaction(fresh.id, channelId, messageId, emoji, serverMembership.deviceId);
        if (!reactions) return safeAck(ack, { ok: false, error: 'message-not-found' });
        const publicReactions = Object.fromEntries(
          Object.entries(reactions).map(([key, deviceIds]) => [
            key, deviceIds.map((id) => servers.memberIdFor(id)).filter(Boolean)
          ]).filter(([, memberIds]) => memberIds.length)
        );
        io.to(serverChannelFor(fresh.id)).emit('server:chat:reaction', { channelId, messageId, reactions: publicReactions });
        safeAck(ack, { ok: true, reactions: publicReactions });
      } catch (error) {
        console.error('server:chat:react failed', error);
        safeAck(ack, { ok: false, error: 'react-failed' });
      }
    });

    socket.on('server:kick', async (payload = {}, ack) => {
      try {
        if (!servers || !serverMembership) return safeAck(ack, { ok: false, error: 'not-in-server' });
        if (!allowRateFor(socket, 'adminRate', 10)) return safeAck(ack, { ok: false, error: 'rate-limited' });
        const fresh = servers.get(serverMembership.server.id);
        if (!fresh) return safeAck(ack, { ok: false, error: 'server-not-found' });
        serverMembership.server = fresh;
        const { deviceId } = serverMembership;
        if (!servers.isMember(fresh, deviceId) || servers.isBanned(fresh, deviceId)) return safeAck(ack, { ok: false, error: 'not-member' });
        if (!servers.hasPermission(fresh, deviceId, 'moderate_members')) return safeAck(ack, { ok: false, error: 'not-admin' });
        // Accept either deviceId (owner UI) or memberId pseudonym (redacted view).
        let targetDeviceId = cleanDeviceId(payload.deviceId);
        if (!targetDeviceId && payload.memberId) {
          const want = String(payload.memberId);
          const m = fresh.members.find((x) => {
            const h = createHash('sha256').update(x.deviceId).digest('base64url').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12);
            return `m_${h}` === want;
          });
          if (m) targetDeviceId = m.deviceId;
        }
        const ok = await servers.kick(fresh.id, deviceId, targetDeviceId);
        if (!ok) return safeAck(ack, { ok: false, error: 'user-not-found' });
        try { sessions?.revokeAllForDevice(targetDeviceId, fresh.id); } catch { /* ignore */ }
        // Disconnect the target's socket(s) right away.
        for (const p of serverOnlineRaw(fresh.id)) {
          if (p.deviceId === targetDeviceId) {
            const targetSocket = io.sockets.sockets.get(p.id);
            if (targetSocket) { targetSocket.emit('server:kicked', { by: serverMembership.participant.name }); targetSocket.disconnect(true); }
          }
        }
        io.to(serverChannelFor(fresh.id)).emit('server:members:updated', { server: servers.broadcastSummary(fresh) });
        safeAck(ack, { ok: true });
      } catch (error) {
        console.error('server:kick failed', error);
        safeAck(ack, { ok: false, error: 'kick-failed' });
      }
    });

    socket.on('server:channel:rename', async (payload = {}, ack) => {
      try {
        if (!servers || !serverMembership) return safeAck(ack, { ok: false, error: 'not-in-server' });
        if (!allowRateFor(socket, 'channelRate', 20)) return safeAck(ack, { ok: false, error: 'rate-limited' });
        const fresh = servers.get(serverMembership.server.id);
        if (!fresh) return safeAck(ack, { ok: false, error: 'server-not-found' });
        serverMembership.server = fresh;
        if (!servers.isMember(fresh, serverMembership.deviceId) || servers.isBanned(fresh, serverMembership.deviceId)) return safeAck(ack, { ok: false, error: 'not-member' });
        if (!isValidChannelId(String(payload.channelId || ''))) return safeAck(ack, { ok: false, error: 'channel-not-found' });
        const channel = await servers.renameChannel(fresh.id, String(payload.channelId || ''), payload.name, serverMembership.deviceId);
        if (!channel) return safeAck(ack, { ok: false, error: 'channel-failed' });
        io.to(serverChannelFor(fresh.id)).emit('server:channels:updated', { server: servers.broadcastSummary(fresh) });
        safeAck(ack, { ok: true, channel });
      } catch (error) {
        console.error('server:channel:rename failed', error);
        safeAck(ack, { ok: false, error: 'channel-failed' });
      }
    });

    socket.on('server:voice:leave', (payload = {}, ack) => {
      if (!servers || !serverMembership) return safeAck(ack, { ok: false, error: 'not-in-server' });
      leaveServerVoice();
      safeAck(ack, { ok: true });
    });

    /* -------- Ephemeral voice rooms ("Create Room Voice") -------- */

    function cleanTempRoomName(value, fallback) {
      const name = String(value ?? '').replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 32);
      return name || fallback;
    }

    socket.on('server:tempRoom:create', async (payload = {}, ack) => {
      try {
        if (!servers || !serverMembership) return safeAck(ack, { ok: false, error: 'not-in-server' });
        if (!allowRateFor(socket, 'tempRoomRate', 10)) return safeAck(ack, { ok: false, error: 'rate-limited' });
        const { server, participant, deviceId } = serverMembership;
        const fresh = servers.get(server.id);
        if (!fresh) return safeAck(ack, { ok: false, error: 'server-not-found' });
        serverMembership.server = fresh;
        // Any member may create a temporary voice room.
        if (!servers.isMember(fresh, deviceId)) return safeAck(ack, { ok: false, error: 'not-member' });
        if (servers.isBanned(fresh, deviceId)) return safeAck(ack, { ok: false, error: 'banned' });
        if (!tempRooms.has(fresh.id)) tempRooms.set(fresh.id, new Map());
        const map = tempRooms.get(fresh.id);
        if (map.size >= MAX_TEMP_ROOMS) return safeAck(ack, { ok: false, error: 'room-limit' });
        // Prevent double-create ghosts: if this socket already created a room
        // and is still alone in it, reuse it instead of stacking new ones.
        for (const existing of map.values()) {
          if (existing.creatorDeviceId === deviceId && existing.members.size === 1 && existing.members.has(socket.id)) {
            return safeAck(ack, { ok: true, room: { id: existing.id, name: existing.name, creatorName: existing.creatorName, memberCount: 1 }, tempRooms: listTempRooms(fresh.id) });
          }
        }
        const fallback = `Room of ${participant.name}`;
        const name = cleanTempRoomName(payload.name, fallback);
        const id = randomUUID();
        const room = {
          id, name,
          creatorDeviceId: deviceId, creatorName: participant.name,
          createdAt: Date.now(), members: new Set([socket.id])
        };
        // M3: leave previous temp room too — otherwise creator ghosts in 2 rooms.
        leaveServerTempRoom();
        leaveServerVoice();
        map.set(id, room);
        // The creator auto-joins (leave any permanent voice channel first).
        serverMembership.tempRoomId = id;
        socket.data.serverTempRoomId = id;
        socket.data.serverVoiceChannelId = null;
        trackTemp(fresh.id, id, socket.id, { id: socket.id, name: participant.name });
        socket.join(tempChannelFor(fresh.id, id));
        emitTempRooms(fresh.id);
        emitVoiceOccupancy(fresh.id);
        io.to(serverChannelFor(fresh.id)).emit('server:tempRoom:joined', { roomId: id, name });
        safeAck(ack, { ok: true, room: { id, name, creatorName: participant.name, memberCount: 1, members: [{ id: socket.id, name: participant.name }] }, tempRooms: listTempRooms(fresh.id) });
      } catch (error) {
        console.error('server:tempRoom:create failed', error);
        safeAck(ack, { ok: false, error: 'room-failed' });
      }
    });

    socket.on('server:tempRoom:join', async (payload = {}, ack) => {
      try {
        if (!servers || !serverMembership) return safeAck(ack, { ok: false, error: 'not-in-server' });
        if (!allowRateFor(socket, 'tempRoomRate', 10)) return safeAck(ack, { ok: false, error: 'rate-limited' });
        const fresh = servers.get(serverMembership.server.id);
        if (!fresh) return safeAck(ack, { ok: false, error: 'server-not-found' });
        serverMembership.server = fresh;
        if (!servers.isMember(fresh, serverMembership.deviceId) || servers.isBanned(fresh, serverMembership.deviceId)) return safeAck(ack, { ok: false, error: 'not-member' });
        const roomId = String(payload.roomId || '');
        const room = tempRooms.get(fresh.id)?.get(roomId);
        if (!room) return safeAck(ack, { ok: false, error: 'room-not-found' });
        if (serverMembership.tempRoomId === roomId) {
          return safeAck(ack, { ok: true, roomId, name: room.name });
        }
        leaveServerTempRoom();
        leaveServerVoice();
        room.members.add(socket.id);
        serverMembership.tempRoomId = roomId;
        socket.data.serverTempRoomId = roomId;
        socket.data.serverVoiceChannelId = null;
        trackTemp(fresh.id, roomId, socket.id, { id: socket.id, name: serverMembership.participant.name });
        socket.join(tempChannelFor(fresh.id, roomId));
        socket.to(tempChannelFor(fresh.id, roomId)).emit('server:peer:joined', { participant: { id: socket.id, name: serverMembership.participant.name } });
        socket.to(tempChannelFor(fresh.id, roomId)).emit('server:voice:connect', { id: socket.id, name: serverMembership.participant.name });
        emitTempRooms(fresh.id);
        emitVoiceOccupancy(fresh.id);
        safeAck(ack, { ok: true, roomId, name: room.name });
      } catch (error) {
        console.error('server:tempRoom:join failed', error);
        safeAck(ack, { ok: false, error: 'room-failed' });
      }
    });

    socket.on('server:tempRoom:leave', (payload = {}, ack) => {
      if (!servers || !serverMembership) return safeAck(ack, { ok: false, error: 'not-in-server' });
      leaveServerTempRoom();
      safeAck(ack, { ok: true });
    });

    socket.on('server:tempRoom:rename', async (payload = {}, ack) => {
      try {
        if (!servers || !serverMembership) return safeAck(ack, { ok: false, error: 'not-in-server' });
        if (!allowRateFor(socket, 'tempRoomRate', 10)) return safeAck(ack, { ok: false, error: 'rate-limited' });
        const fresh = servers.get(serverMembership.server.id);
        if (!fresh) return safeAck(ack, { ok: false, error: 'server-not-found' });
        serverMembership.server = fresh;
        if (!servers.isMember(fresh, serverMembership.deviceId) || servers.isBanned(fresh, serverMembership.deviceId)) return safeAck(ack, { ok: false, error: 'not-member' });
        const roomId = String(payload.roomId || '');
        const room = tempRooms.get(fresh.id)?.get(roomId);
        if (!room) return safeAck(ack, { ok: false, error: 'room-not-found' });
        // Only the person who created the room may rename it.
        if (room.creatorDeviceId !== serverMembership.deviceId) return safeAck(ack, { ok: false, error: 'not-creator' });
        room.name = cleanTempRoomName(payload.name, room.name);
        emitTempRooms(fresh.id);
        io.to(serverChannelFor(fresh.id)).emit('server:tempRoom:renamed', { roomId, name: room.name });
        safeAck(ack, { ok: true, name: room.name });
      } catch (error) {
        console.error('server:tempRoom:rename failed', error);
        safeAck(ack, { ok: false, error: 'room-failed' });
      }
    });

    socket.on('server:tempRoom:delete', async (payload = {}, ack) => {
      try {
        if (!servers || !serverMembership) return safeAck(ack, { ok: false, error: 'not-in-server' });
        if (!allowRateFor(socket, 'tempRoomRate', 10)) return safeAck(ack, { ok: false, error: 'rate-limited' });
        const fresh = servers.get(serverMembership.server.id);
        if (!fresh) return safeAck(ack, { ok: false, error: 'server-not-found' });
        serverMembership.server = fresh;
        const roomId = String(payload.roomId || '');
        const serverId = fresh.id;
        const room = tempRooms.get(serverId)?.get(roomId);
        if (!room) return safeAck(ack, { ok: false, error: 'room-not-found' });
        if (room.creatorDeviceId !== serverMembership.deviceId && !servers.hasPermission(fresh, serverMembership.deviceId, 'moderate_members')) {
          return safeAck(ack, { ok: false, error: 'not-creator' });
        }
        // Evict everyone else in the room, then drop it even if non-empty:
        // the creator closing the room ends it for everyone.
        const members = [...room.members];
        tempRooms.get(serverId)?.delete(roomId);
        if (!tempRooms.get(serverId)?.size) tempRooms.delete(serverId);
        for (const mid of members) {
          const target = io.sockets.sockets.get(mid);
          if (target && target.data.serverTempRoomId === roomId) {
            target.data.serverTempRoomId = null;
            untrackTemp(serverId, roomId, mid);
            const info = serverOnlineRaw(serverId).find((p) => p.id === mid);
            try { target.emit('server:tempRoom:deleted', { roomId }); } catch { /* ignore */ }
            if (target.id !== socket.id) {
              try { target.leave(tempChannelFor(serverId, roomId)); } catch { /* ignore */ }
              try { target.emit('server:peer:left', { id: mid, name: info?.name || '' }); } catch { /* ignore */ }
            }
          }
        }
        try { socket.leave(tempChannelFor(serverId, roomId)); } catch { /* ignore */ }
        if (serverMembership.tempRoomId === roomId) serverMembership.tempRoomId = null;
        socket.data.serverTempRoomId = null;
        // Creator also leaves occupancy even if socket not in members list.
        untrackTemp(serverId, roomId, socket.id);
        emitTempRooms(serverId);
        emitVoiceOccupancy(serverId);
        io.to(serverChannelFor(serverId)).emit('server:tempRoom:deleted', { roomId });
        safeAck(ack, { ok: true });
      } catch (error) {
        console.error('server:tempRoom:delete failed', error);
        safeAck(ack, { ok: false, error: 'room-failed' });
      }
    });

    socket.on('server:voice:join', async (payload = {}, ack) => {
      try {
        if (!servers || !serverMembership) return safeAck(ack, { ok: false, error: 'not-in-server' });
        if (!allowRateFor(socket, 'serverVoiceRate', 10)) return safeAck(ack, { ok: false, error: 'rate-limited' });
        const fresh = servers.get(serverMembership.server.id);
        if (!fresh) return safeAck(ack, { ok: false, error: 'server-not-found' });
        serverMembership.server = fresh;
        if (!servers.isMember(fresh, serverMembership.deviceId)) return safeAck(ack, { ok: false, error: 'not-member' });
        if (servers.isBanned(fresh, serverMembership.deviceId)) return safeAck(ack, { ok: false, error: 'banned' });
        const channelId = String(payload.channelId || '');
        if (!isValidChannelId(channelId)) return safeAck(ack, { ok: false, error: 'channel-not-found' });
        const channel = fresh.channels.find((c) => c.id === channelId && c.type === 'voice');
        if (!channel) return safeAck(ack, { ok: false, error: 'channel-not-found' });
        if (serverMembership.voiceChannelId === channelId) {
          return safeAck(ack, { ok: true, channelId });
        }
        leaveServerTempRoom();
        // M10: emit peer:left on the old channel on switch (was silent leave).
        if (serverMembership.voiceChannelId) {
          const oldId = serverMembership.voiceChannelId;
          untrackVoice(fresh.id, oldId, socket.id);
          socket.to(voiceChannelFor(fresh.id, oldId)).emit('server:peer:left', { id: socket.id, name: serverMembership.participant.name });
          socket.leave(voiceChannelFor(fresh.id, oldId));
          emitVoiceOccupancy(fresh.id);
        }
        serverMembership.voiceChannelId = channelId;
        socket.data.serverVoiceChannelId = channelId;
        socket.data.serverTempRoomId = null;
        trackVoice(fresh.id, channelId, socket.id, { id: socket.id, name: serverMembership.participant.name });
        socket.join(voiceChannelFor(fresh.id, channelId));
        socket.to(voiceChannelFor(fresh.id, channelId)).emit('server:peer:joined', {
          participant: { id: socket.id, name: serverMembership.participant.name }
        });
        // Tell existing voice members to connect to the newcomer (P2P: the
        // server only relays signaling, media goes browser-to-browser).
        socket.to(voiceChannelFor(fresh.id, channelId)).emit('server:voice:connect', { id: socket.id, name: serverMembership.participant.name });
        emitVoiceOccupancy(fresh.id);
        safeAck(ack, { ok: true, channelId });
      } catch (error) {
        console.error('server:voice:join failed', error);
        safeAck(ack, { ok: false, error: 'voice-failed' });
      }
    });

    socket.on('server:presence', (payload = {}) => {
      if (!serverMembership) return;
      if (!allowRateFor(socket, 'presenceRate', PRESENCE_RATE_MAX)) return;
      const participant = serverMembership.participant;
      participant.micOn = asBoolean(payload.micOn);
      participant.cameraOn = asBoolean(payload.cameraOn);
      participant.screenOn = asBoolean(payload.screenOn);
      participant.deafened = asBoolean(payload.deafened);
      let room = serverChannelFor(serverMembership.server.id);
      if (serverMembership.tempRoomId) room = tempChannelFor(serverMembership.server.id, serverMembership.tempRoomId);
      else if (serverMembership.voiceChannelId) room = voiceChannelFor(serverMembership.server.id, serverMembership.voiceChannelId);
      io.to(room).emit('server:peer:updated', { id: participant.id, name: participant.name, micOn: participant.micOn, cameraOn: participant.cameraOn, screenOn: participant.screenOn, deafened: participant.deafened, memberId: servers.memberIdFor(serverMembership.deviceId) });
    });

    socket.on('server:soundboard:play', (payload = {}, ack) => {
      if (!servers || !serverMembership) return safeAck(ack, { ok: false, error: 'not-in-server' });
      if (!allowRateFor(socket, 'boardRate', SOUNDBOARD_MAX_PER_5S)) return safeAck(ack, { ok: false, error: 'rate-limited' });
      const id = String(payload?.id ?? '');
      if (SOUNDBOARD_SET.has(id)) {
        io.to(serverChannelFor(serverMembership.server.id)).emit('server:soundboard:play', {
          id, from: socket.id, name: serverMembership.participant.name
        });
        return safeAck(ack, { ok: true });
      }
      // Permanent server custom sound (uploaded via POST /:id/soundboard).
      const fresh = servers.get(serverMembership.server.id);
      const custom = fresh?.customSounds?.find((s) => s.id === id);
      if (!custom) return safeAck(ack, { ok: false, error: 'invalid-sound' });
      io.to(serverChannelFor(serverMembership.server.id)).emit('server:soundboard:play', {
        id: custom.id, custom: true, url: custom.url, imageUrl: custom.imageUrl || '',
        emojiId: custom.emojiId, name: serverMembership.participant.name,
        from: socket.id
      });
      safeAck(ack, { ok: true });
    });

    socket.on('server:soundboard:deleteCustom', async (payload = {}, ack) => {
      if (!servers || !serverMembership) return safeAck(ack, { ok: false, error: 'not-in-server' });
      if (!allowRateFor(socket, 'boardRate', SOUNDBOARD_MAX_PER_5S)) return safeAck(ack, { ok: false, error: 'rate-limited' });
      const fresh = servers.get(serverMembership.server.id);
      if (!fresh) return safeAck(ack, { ok: false, error: 'server-not-found' });
      const target = fresh.customSounds?.find((s) => s.id === String(payload?.id ?? ''));
      if (!target) return safeAck(ack, { ok: false, error: 'invalid-sound' });
      const canManageBoard = servers.hasPermission(fresh, serverMembership.deviceId, 'manage_settings');
      if (target.addedById !== serverMembership.deviceId && !canManageBoard) return safeAck(ack, { ok: false, error: 'not-admin' });
      const removed = await servers.removeCustomSound(fresh.id, target.id);
      if (!removed) return safeAck(ack, { ok: false, error: 'invalid-sound' });
      // Delete the files (board dir holds audio + optional cover image).
      try {
        const { promises: fsp } = await import('node:fs');
        const base = servers.uploadsDir || 'uploads';
        for (const u of [removed.url, removed.imageUrl]) {
          const file = String(u || '').split('/').pop();
          if (file && !file.includes('..') && !file.includes('\\') && !file.includes('/')) {
            try { await fsp.unlink(`${base}/server-${fresh.id}/board/${file}`); } catch { /* already gone */ }
          }
        }
      } catch { /* best effort */ }
      io.to(serverChannelFor(fresh.id)).emit('server:soundboard:deleted', { id: target.id });
      safeAck(ack, { ok: true });
    });

    socket.on('server:reaction:send', (payload = {}) => {
      if (!serverMembership) return;
      if (!allowRateFor(socket, 'floatRate', REACTION_RATE_MAX)) return;
      const raw = String(payload.emoji ?? '');
      if (!isAllowedFloatingReaction(raw)) return;
      io.to(serverChannelFor(serverMembership.server.id)).emit('server:reaction:receive', {
        id: socket.id, name: serverMembership.participant.name, emoji: normalizeFloatingReaction(raw)
      });
    });

    socket.on('server:typing', (payload = {}) => {
      if (!serverMembership) return;
      if (!allowRateFor(socket, 'typingRate', TYPING_RATE_MAX)) return;
      socket.to(serverChannelFor(serverMembership.server.id)).emit('server:typing', {
        id: socket.id, name: serverMembership.participant.name, typing: asBoolean(payload.typing)
      });
    });

    // WebRTC signaling is relayed peer-to-peer. Each pair of participants uses
    // two "channels": media (mic + camera) and screen (screen share).
    // Works for standalone rooms AND server voice channels (separate systems,
    // one relay rule each).
    for (const eventName of ['webrtc:offer', 'webrtc:answer', 'webrtc:ice']) {
      socket.on(eventName, (payload = {}) => {
        const inRoom = membership && membership.room.participants.has(String(payload.to ?? ''));
        const inServerVoice = serverMembership && (serverMembership.voiceChannelId || serverMembership.tempRoomId) && (() => {
          const target = io.sockets.sockets.get(String(payload.to ?? ''));
          if (!target) return false;
          if (!target.data.serverId || target.data.serverId !== serverMembership.server.id) return false;
          if (serverMembership.voiceChannelId && target.data.serverVoiceChannelId === serverMembership.voiceChannelId) return true;
          if (serverMembership.tempRoomId && target.data.serverTempRoomId === serverMembership.tempRoomId) return true;
          return false;
        })();
        if (!inRoom && !inServerVoice) return;
        const bucket = eventName === 'webrtc:ice' ? 'iceRate' : 'signalRate';
        if (!allowRateFor(socket, bucket, eventName === 'webrtc:ice' ? 200 : 40)) return;
        const to = String(payload.to ?? '');
        if (!to) return;

        const channel = payload.channel;
        if (channel !== 'media' && channel !== 'screen') return;

        const message = { from: socket.id, to, channel };

        if (eventName === 'webrtc:ice') {
          if (!payload.candidate || typeof payload.candidate !== 'object') return;
          message.candidate = payload.candidate;
        } else {
          const sdp = payload.sdp;
          if (
            !sdp ||
            typeof sdp !== 'object' ||
            typeof sdp.type !== 'string' ||
            typeof sdp.sdp !== 'string' ||
            sdp.sdp.length > 65536
          ) {
            return;
          }
          message.sdp = { type: sdp.type, sdp: sdp.sdp };
        }

        io.to(to).emit(eventName, message);
      });
    }
  });
}
