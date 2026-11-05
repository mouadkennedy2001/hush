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
  MAX_UPLOAD_BYTES
} from './constants.js';

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
  return { ...participant };
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

export function attachRealtime(io, { rooms, maxParticipants = MAX_PARTICIPANTS } = {}) {
  if (!rooms) throw new Error('attachRealtime requires a RoomManager');

  io.on('connection', (socket) => {
    let membership = null;

    function leave() {
      if (!membership) return;
      const { room, participant } = membership;
      membership = null;
      room.participants.delete(participant.id);
      rooms.touch(room);
      socket.to(channelFor(room.code)).emit('peer:left', {
        id: participant.id,
        name: participant.name
      });
      socket.leave(channelFor(room.code));
    }

    socket.on('room:join', async (payload = {}, ack) => {
      try {
        leave();

        const code = normalizeCode(payload.code);
        if (!isValidCode(code)) {
          return safeAck(ack, { ok: false, error: 'invalid-code' });
        }

        const room = await rooms.getOrCreate(code);
        if (room.participants.size >= maxParticipants) {
          return safeAck(ack, { ok: false, error: 'room-full' });
        }

        const requestedName = cleanName(payload.name);
        const participant = {
          id: socket.id,
          name: uniqueName(room, requestedName),
          micOn: false,
          cameraOn: false,
          screenOn: false,
          handRaised: false,
          joinedAt: Date.now()
        };

        room.participants.set(socket.id, participant);
        rooms.touch(room);
        membership = { room, participant };
        socket.data.roomCode = code;

        socket.join(channelFor(code));
        socket.to(channelFor(code)).emit('peer:joined', {
          participant: publicParticipant(participant)
        });

        safeAck(ack, {
          ok: true,
          self: { id: participant.id, name: participant.name },
          room: {
            code,
            participants: [...room.participants.values()].map(publicParticipant),
            messages: room.messages
          }
        });
      } catch (error) {
        console.error('room:join failed', error);
        safeAck(ack, { ok: false, error: 'join-failed' });
      }
    });

    socket.on('room:leave', () => leave());
    socket.on('disconnect', () => leave());

    socket.on('chat:send', async (payload = {}, ack) => {
      if (!membership) return safeAck(ack, { ok: false, error: 'not-in-room' });
      if (!allowRate(socket)) return safeAck(ack, { ok: false, error: 'rate-limited' });

      const { room, participant } = membership;
      const text = cleanMessageText(payload.text);
      const attachment = cleanAttachment(payload.attachment, room.code);
      if (!text && !attachment) return safeAck(ack, { ok: false, error: 'empty-message' });
      if (text.length > MAX_MESSAGE_LENGTH) {
        return safeAck(ack, { ok: false, error: 'message-too-long' });
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
            typeof sdp.sdp !== 'string'
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
