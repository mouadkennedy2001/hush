import { randomUUID } from 'node:crypto';
import {
  cleanMessageText,
  cleanName,
  isAllowedReaction,
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
  BAN_DEFAULT_MINUTES
} from './constants.js';
import { hashValue, cleanDeviceId, stripInvisible, spamScore, activeBans } from './security.js';

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

// Global (per-server) connection tracking for IP limits
const ipSockets = new Map(); // ipHash -> Set<socketId>
const ipJoins = new Map(); // ipHash -> number[] timestamps

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
  const hits = (ipJoins.get(ipHash) ?? []).filter((t) => now - t < 60_000);
  if (hits.length >= MAX_JOINS_PER_IP_PER_MIN) { ipJoins.set(ipHash, hits); return false; }
  hits.push(now); ipJoins.set(ipHash, hits); return true;
}

export function attachRealtime(io, { rooms, maxParticipants = MAX_PARTICIPANTS } = {}) {
  if (!rooms) throw new Error('attachRealtime requires a RoomManager');

  io.on('connection', (socket) => {
    const ipHash = hashValue(socket.handshake.address || 'unknown', 'ip');
    socket.data.ipHash = ipHash;

    if (ipSocketCount(ipHash) >= MAX_SOCKETS_PER_IP) {
      socket.emit('room:error', { error: 'too-many-connections' });
      socket.disconnect(true);
      return;
    }
    trackIpSocket(ipHash, socket.id);

    let membership = null;

    function isHost() {
      return membership && membership.room.hostId === socket.id;
    }

    function leave() {
      if (!membership) return;
      const { room, participant } = membership;
      membership = null;
      socket.data.roomCode = null;
      room.participants.delete(participant.id);
      rooms.touch(room);
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
        leave();

        const code = normalizeCode(payload.code);
        if (!isValidCode(code)) {
          return safeAck(ack, { ok: false, error: 'invalid-code' });
        }

        const room = await rooms.getOrCreate(code);

        // Ban check (device + ip)
        const rawDevice = cleanDeviceId(payload.deviceId);
        const deviceHash = rawDevice ? hashValue(rawDevice, 'device') : hashValue(payload.deviceId || socket.id, 'device');
        socket.data.deviceHash = deviceHash;
        const bans = activeBans(room.banned);
        const banned = bans.find((b) => b.deviceHash === deviceHash || b.ipHash === ipHash);
        if (banned) {
          return safeAck(ack, { ok: false, error: 'banned', until: banned.until ?? null, reason: banned.reason || '' });
        }

        if (room.participants.size >= maxParticipants) {
          return safeAck(ack, { ok: false, error: 'room-full' });
        }

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
            participants: [...room.participants.values()].map(publicParticipant),
            messages: room.messages,
            pinnedMessageId: room.pinnedMessageId ?? null
          }
        });
      } catch (error) {
        console.error('room:join failed', error);
        safeAck(ack, { ok: false, error: 'join-failed' });
      }
    });

    socket.on('ping:request', (payload = {}, ack) => {
      if (!allowRateFor(socket, 'pingRate', 60)) {
        return safeAck(ack, { ok: false, error: 'rate-limited' });
      }
      const clientTime = Number(payload?.t);
      // Echo client clock + server clock so client can compute RTT + offset.
      // Use seq to match responses and drop stale ones.
      safeAck(ack, {
        ok: true,
        t: Number.isFinite(clientTime) ? clientTime : Date.now(),
        seq: Number(payload?.seq) || 0,
        serverTime: Date.now()
      });
    });

    socket.on('room:leave', () => leave());
    socket.on('disconnect', () => { leave(); untrackIpSocket(ipHash, socket.id); });

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

    socket.on('reaction:send', (payload = {}) => {
      if (!membership) return;
      if (!allowRateFor(socket, 'floatRate', REACTION_RATE_MAX)) return;
      const emoji = String(payload.emoji ?? '');
      if (!isAllowedReaction(emoji)) return;
      io.to(channelFor(membership.room.code)).emit('reaction:receive', {
        id: socket.id,
        name: membership.participant.name,
        emoji
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
      rooms.touch(membership.room);
      io.to(channelFor(membership.room.code)).emit('peer:updated', publicParticipant(participant));
    });

    // WebRTC signaling is relayed peer-to-peer. Each pair of participants uses
    // two "channels": media (mic + camera) and screen (screen share).
    for (const eventName of ['webrtc:offer', 'webrtc:answer', 'webrtc:ice']) {
      socket.on(eventName, (payload = {}) => {
        if (!membership) return;
        const bucket = eventName === 'webrtc:ice' ? 'iceRate' : 'signalRate';
        if (!allowRateFor(socket, bucket, eventName === 'webrtc:ice' ? 200 : 40)) return;
        const to = String(payload.to ?? '');
        if (!to || !membership.room.participants.has(to)) return;

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
