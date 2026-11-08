import { randomUUID, randomInt } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  MAX_MESSAGE_LENGTH,
  MAX_NAME_LENGTH,
  MAX_ROOM_MESSAGES,
  REACTION_EMOJIS,
  CUSTOM_EMOJI_SET,
  MAX_CUSTOM_SOUNDS_PER_ROOM,
  MAX_BOARD_AUDIO_BYTES
} from './constants.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_RE = /^[A-Z0-9]{4,12}$/;

export function normalizeCode(value) {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isValidCode(code) {
  return CODE_RE.test(code);
}

export function formatCode(code) {
  return code.length === 6 ? `${code.slice(0, 3)}-${code.slice(3)}` : code;
}

export function generateCode(length = 6, random) {
  let code = '';
  if (typeof random === 'function') {
    for (let i = 0; i < length; i += 1) {
      code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
    }
    return code;
  }
  for (let i = 0; i < length; i += 1) {
    code += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
  }
  return code;
}

export function cleanName(value) {
  const name = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME_LENGTH)
    .trim();
  return name || 'Guest';
}

export function cleanMessageText(value) {
  const text = String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .trim();
  return text.slice(0, MAX_MESSAGE_LENGTH);
}

export function isAllowedReaction(emoji) {
  return REACTION_EMOJIS.includes(String(emoji));
}

// Floating reactions are custom site emoji ids too. The legacy
// "custom:<id>" form is normalized; Unicode emojis are never allowed.
export function normalizeFloatingReaction(emoji) {
  const value = String(emoji ?? '');
  return value.startsWith('custom:') ? value.slice(7) : value;
}
export function isAllowedFloatingReaction(emoji) {
  return CUSTOM_EMOJI_SET.has(normalizeFloatingReaction(emoji));
}

export function normalizeCustomSound(raw, code) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') return null;
  const url = String(raw.url ?? '');
  const prefix = `/uploads/${code}/board/`;
  if (!url.startsWith(prefix) || url.includes('..') || url.includes('\\')) return null;
  const emojiId = CUSTOM_EMOJI_SET.has(String(raw.emojiId)) ? String(raw.emojiId) : 'star';
  const size = Number(raw.size);
  if (!Number.isFinite(size) || size < 0 || size > MAX_BOARD_AUDIO_BYTES) return null;
  return {
    id: raw.id,
    name: String(raw.name ?? 'Sound').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40) || 'Sound',
    emojiId,
    url,
    size,
    mime: String(raw.mime ?? 'audio/mpeg').slice(0, 60),
    addedById: typeof raw.addedById === 'string' ? raw.addedById : '',
    addedBy: typeof raw.addedBy === 'string' ? raw.addedBy.slice(0, MAX_NAME_LENGTH) : '',
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now()
  };
}

function normalizeStoredMessage(raw, code) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') return null;
  const reactions = {};
  if (raw.reactions && typeof raw.reactions === 'object') {
    for (const [emoji, ids] of Object.entries(raw.reactions)) {
      if (isAllowedReaction(emoji) && Array.isArray(ids)) {
        const cleanIds = ids.filter((id) => typeof id === 'string').slice(0, 50);
        if (cleanIds.length) reactions[emoji] = [...new Set(cleanIds)];
      }
    }
  }
  // Validate stored attachments like new sends (no arbitrary URLs).
  let attachment = null;
  if (raw.attachment && typeof raw.attachment === 'object' && code) {
    const url = String(raw.attachment.url ?? '');
    const prefix = `/uploads/${code}/`;
    const size = Number(raw.attachment.size);
    if (url.startsWith(prefix) && !url.includes('..') && !url.includes('\\') && Number.isFinite(size) && size >= 0 && size <= 8 * 1024 * 1024) {
      attachment = {
        url,
        name: String(raw.attachment.name ?? 'File').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 120) || 'File',
        size,
        mime: String(raw.attachment.mime ?? 'application/octet-stream').slice(0, 100)
      };
    }
  } else if (raw.attachment && typeof raw.attachment.url === 'string' && !code) {
    attachment = raw.attachment;
  }
  return {
    id: raw.id,
    type: 'text',
    text: typeof raw.text === 'string' ? raw.text.slice(0, MAX_MESSAGE_LENGTH) : '',
    attachment,
    authorId: typeof raw.authorId === 'string' ? raw.authorId : '',
    authorName: typeof raw.authorName === 'string' ? raw.authorName.slice(0, MAX_NAME_LENGTH) : 'Guest',
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
    editedAt: Number.isFinite(raw.editedAt) ? raw.editedAt : undefined,
    reactions
  };
}

/**
 * In-memory rooms with a small JSON file per room for chat history.
 * Voice/video media never touches the server; it is peer-to-peer WebRTC.
 */
export class RoomManager {
  #rooms = new Map();
  #saveTimer = null;
  #protectedCodes = new Set();

  constructor({
    dataDir,
    uploadsDir = null,
    maxMessages = MAX_ROOM_MESSAGES,
    idleTtlMs = 30 * 60 * 1000,
    historyTtlMs = 7 * 24 * 60 * 60 * 1000,
    now = () => Date.now(),
    log = console
  } = {}) {
    if (!dataDir) throw new Error('RoomManager requires a dataDir');
    this.dataDir = dataDir;
    this.uploadsDir = uploadsDir;
    this.maxMessages = maxMessages;
    this.idleTtlMs = idleTtlMs;
    this.historyTtlMs = historyTtlMs;
    this.now = now;
    this.log = log;
  }

  async init() {
    await fs.mkdir(this.dataDir, { recursive: true });
  }

  async currentRoomCount() {
    return this.#rooms.size;
  }

  // Server channels are permanent: their history must never be purged
  // by the 7-day idle-history cleanup.
  protectCode(code) {
    const c = normalizeCode(code);
    if (isValidCode(c)) this.#protectedCodes.add(c);
  }

  unprotectCodes(codes = []) {
    for (const code of codes) this.#protectedCodes.delete(normalizeCode(code));
  }

  isProtected(code) {
    return this.#protectedCodes.has(normalizeCode(code));
  }

  async getOrCreate(rawCode) {
    const code = normalizeCode(rawCode);
    if (!isValidCode(code)) throw new Error('invalid-room-code');

    let room = this.#rooms.get(code);
    if (!room) {
      room = {
        code,
        createdAt: this.now(),
        lastActivity: this.now(),
        participants: new Map(),
        messages: [],
        customSounds: [],
        pinnedMessageId: null,
        hostId: null,
        banned: [],
        loaded: false,
        saveChain: Promise.resolve()
      };
      room.loading = this.#load(room)
        .catch((error) => {
          this.log.warn?.(`Could not load room ${code}:`, error.message);
        })
        .finally(() => {
          room.loaded = true;
        });
      this.#rooms.set(code, room);
    }

    await room.loading;
    room.lastActivity = this.now();
    return room;
  }

  async codeExists(code) {
    if (this.#rooms.has(code)) return true;
    try {
      await fs.access(this.#file(code));
      return true;
    } catch {
      return false;
    }
  }

  async generateUniqueCode(length = 6) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const code = generateCode(length);
      if (!(await this.codeExists(code))) return code;
    }
    return generateCode(length + 2);
  }

  touch(room) {
    room.lastActivity = this.now();
  }

  async addMessage(room, message) {
    room.messages.push(message);
    if (room.messages.length > this.maxMessages) {
      room.messages.splice(0, room.messages.length - this.maxMessages);
    }
    room.lastActivity = this.now();
    await this.#queueSave(room);
    return message;
  }

  async pinMessage(room, messageId) {
    const message = room.messages.find((item) => item.id === messageId);
    if (!message) return null;
    room.pinnedMessageId = messageId;
    room.lastActivity = this.now();
    await this.#queueSave(room);
    return message;
  }

  async unpinMessage(room) {
    room.pinnedMessageId = null;
    room.lastActivity = this.now();
    await this.#queueSave(room);
    return true;
  }

  async editMessage(room, messageId, authorId, text) {
    const message = room.messages.find((item) => item.id === messageId);
    if (!message || message.authorId !== authorId) return null;
    message.text = text;
    message.editedAt = this.now();
    room.lastActivity = this.now();
    await this.#queueSave(room);
    return message;
  }

  async deleteMessage(room, messageId, authorId) {
    const index = room.messages.findIndex((item) => item.id === messageId);
    if (index === -1 || room.messages[index].authorId !== authorId) return false;
    room.messages.splice(index, 1);
    if (room.pinnedMessageId === messageId) room.pinnedMessageId = null;
    room.lastActivity = this.now();
    await this.#queueSave(room);
    return true;
  }

  async deleteMessageAsAdmin(room, messageId) {
    const index = room.messages.findIndex((item) => item.id === messageId);
    if (index === -1) return false;
    room.messages.splice(index, 1);
    if (room.pinnedMessageId === messageId) room.pinnedMessageId = null;
    room.lastActivity = this.now();
    await this.#queueSave(room);
    return true;
  }

  async addBan(room, ban) {
    const now = this.now();
    const filtered = (room.banned || []).filter((b) => {
      if (!b) return false;
      const same = (ban.deviceHash && b.deviceHash === ban.deviceHash) || (ban.ipHash && b.ipHash === ban.ipHash);
      if (same) return false;
      return (b.until ?? Infinity) > now;
    });
    room.banned = [...filtered, ban].slice(-200);
    room.lastActivity = now;
    await this.#queueSave(room);
    return ban;
  }

  async removeBan(room, { deviceHash, ipHash } = {}) {
    const before = (room.banned || []).length;
    room.banned = (room.banned || []).filter(
      (b) => !((deviceHash && b.deviceHash === deviceHash) || (ipHash && b.ipHash === ipHash))
    );
    if (room.banned.length !== before) await this.#queueSave(room);
    return before - room.banned.length;
  }

  async setHost(room, hostId) {
    room.hostId = hostId;
    await this.#queueSave(room);
  }

  async toggleReaction(room, messageId, emoji, participantId) {
    const message = room.messages.find((item) => item.id === messageId);
    if (!message) return null;

    message.reactions ||= {};
    const ids = new Set(message.reactions[emoji] || []);
    if (ids.has(participantId)) ids.delete(participantId);
    else if (ids.size < 50) ids.add(participantId);
    else return message.reactions;

    if (ids.size) message.reactions[emoji] = [...ids];
    else delete message.reactions[emoji];

    room.lastActivity = this.now();
    await this.#queueSave(room);
    return message.reactions;
  }

  async addCustomSound(room, sound) {
    room.customSounds ||= [];
    if (room.customSounds.length >= MAX_CUSTOM_SOUNDS_PER_ROOM) return null;
    room.customSounds.push(sound);
    room.lastActivity = this.now();
    await this.#queueSave(room);
    return sound;
  }

  async removeCustomSound(room, soundId) {
    room.customSounds ||= [];
    const index = room.customSounds.findIndex((s) => s.id === soundId);
    if (index === -1) return null;
    const [removed] = room.customSounds.splice(index, 1);
    room.lastActivity = this.now();
    await this.#queueSave(room);
    await this.#deleteSoundFile(room.code, removed);
    return removed;
  }

  async clearCustomSounds(room) {
    room.customSounds ||= [];
    const removed = [...room.customSounds];
    room.customSounds = [];
    room.lastActivity = this.now();
    await this.#queueSave(room);
    for (const sound of removed) await this.#deleteSoundFile(room.code, sound);
    return removed;
  }

  // Custom sounds are ephemeral per room session: when the last person
  // leaves (or the idle room is cleaned up), delete files + metadata
  // completely so nothing lingers on disk.
  async purgeCustomSounds(room) {
    if (!room) return;
    const removed = [...(room.customSounds || [])];
    room.customSounds = [];
    for (const sound of removed) await this.#deleteSoundFile(room.code, sound);
    // Remove the whole board folder even if metadata was already cleared.
    if (this.uploadsDir) {
      try { await fs.rm(path.join(this.uploadsDir, room.code, 'board'), { recursive: true, force: true }); } catch { /* ignore */ }
    }
    if (removed.length) await this.#queueSave(room);
  }

  async #deleteSoundFile(code, sound) {
    if (!this.uploadsDir || !sound?.url) return;
    const file = String(sound.url).split('/').pop();
    if (!file || file.includes('..') || file.includes('\\') || file.includes('/')) return;
    try { await fs.unlink(path.join(this.uploadsDir, code, 'board', file)); } catch { /* already gone */ }
  }

  async cleanup() {
    const now = this.now();
    for (const [code, room] of this.#rooms) {
      if (room.participants.size === 0 && now - room.lastActivity > this.idleTtlMs) {
        await this.purgeCustomSounds(room);
        this.#rooms.delete(code);
      }
    }
    await this.#purgeOldHistory(now);
  }

  startCleanup(intervalMs = 5 * 60 * 1000) {
    if (this.#saveTimer) return;
    this.#saveTimer = setInterval(() => {
      this.cleanup().catch((error) => this.log.warn?.('Room cleanup failed:', error.message));
    }, intervalMs);
    this.#saveTimer.unref?.();
  }

  stopCleanup() {
    if (this.#saveTimer) clearInterval(this.#saveTimer);
    this.#saveTimer = null;
  }

  async #load(room) {
    try {
      const raw = await fs.readFile(this.#file(room.code), 'utf8');
      const data = JSON.parse(raw);
      if (Number.isFinite(data.createdAt)) room.createdAt = data.createdAt;
      if (typeof data.pinnedMessageId === 'string') room.pinnedMessageId = data.pinnedMessageId;
      if (typeof data.hostId === 'string') room.hostId = data.hostId;
      if (Array.isArray(data.banned)) {
        const now = Date.now();
        room.banned = data.banned
          .filter((b) => b && (b.deviceHash || b.ipHash) && ((b.until ?? Infinity) > now))
          .slice(-200);
      }
      if (Array.isArray(data.messages)) {
        room.messages = data.messages
          .map((m) => normalizeStoredMessage(m, room.code))
          .filter(Boolean)
          .slice(-this.maxMessages);
      }
      if (Array.isArray(data.customSounds)) {
        room.customSounds = data.customSounds
          .map((s) => normalizeCustomSound(s, room.code))
          .filter(Boolean)
          .slice(0, MAX_CUSTOM_SOUNDS_PER_ROOM);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  async #queueSave(room) {
    room.saveChain = room.saveChain
      .then(() => this.#write(room))
      .catch((error) => {
        this.log.warn?.(`Could not persist room ${room.code}:`, error.message);
      });
    return room.saveChain;
  }

  async #write(room) {
    const payload = JSON.stringify({
      code: room.code,
      createdAt: room.createdAt,
      updatedAt: this.now(),
      pinnedMessageId: room.pinnedMessageId ?? null,
      hostId: room.hostId ?? null,
      banned: room.banned ?? [],
      messages: room.messages,
      customSounds: room.customSounds ?? []
    });
    const file = this.#file(room.code);
    const temp = `${file}.${randomUUID()}.tmp`;
    await fs.writeFile(temp, payload, 'utf8');
    await fs.rename(temp, file);
  }

  #file(code) {
    return path.join(this.dataDir, `${code}.json`);
  }

  async #purgeOldHistory(now = this.now()) {
    let entries;
    try {
      entries = await fs.readdir(this.dataDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const isHistory = entry.name.endsWith('.json');
      const isTemp = entry.name.includes('.tmp');
      // servers.json holds permanent server metadata — never purge it.
      if (entry.name === 'servers.json') continue;
      if (!isHistory && !isTemp) continue;
      // Server channel rooms are permanent and keep their history.
      if (isHistory && this.#protectedCodes.has(entry.name.replace(/\.json$/, ''))) continue;
      const file = path.join(this.dataDir, entry.name);
      try {
        const stat = await fs.stat(file);
        const maxAge = isTemp ? 60 * 60 * 1000 : this.historyTtlMs;
        if (now - stat.mtimeMs > maxAge) {
          await fs.unlink(file);
          // The room itself is gone — its custom board must go with it.
          if (this.uploadsDir && isHistory && !isTemp) {
            const code = entry.name.replace(/\.json$/, '');
            try { await fs.rm(path.join(this.uploadsDir, code, 'board'), { recursive: true, force: true }); } catch { /* ignore */ }
          }
        }
      } catch {
        // A file can disappear between readdir and stat; ignore it.
      }
    }
  }
}
