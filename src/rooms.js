import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  MAX_MESSAGE_LENGTH,
  MAX_NAME_LENGTH,
  MAX_ROOM_MESSAGES,
  REACTION_EMOJIS
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

export function generateCode(length = 6, random = Math.random) {
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
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

function normalizeStoredMessage(raw) {
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
  return {
    id: raw.id,
    type: 'text',
    text: typeof raw.text === 'string' ? raw.text.slice(0, MAX_MESSAGE_LENGTH) : '',
    attachment: raw.attachment && typeof raw.attachment.url === 'string' ? raw.attachment : null,
    authorId: typeof raw.authorId === 'string' ? raw.authorId : '',
    authorName: typeof raw.authorName === 'string' ? raw.authorName.slice(0, MAX_NAME_LENGTH) : 'Guest',
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
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

  constructor({
    dataDir,
    maxMessages = MAX_ROOM_MESSAGES,
    idleTtlMs = 30 * 60 * 1000,
    historyTtlMs = 7 * 24 * 60 * 60 * 1000,
    now = () => Date.now(),
    log = console
  } = {}) {
    if (!dataDir) throw new Error('RoomManager requires a dataDir');
    this.dataDir = dataDir;
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

  async toggleReaction(room, messageId, emoji, participantId) {
    const message = room.messages.find((item) => item.id === messageId);
    if (!message) return null;

    message.reactions ||= {};
    const ids = new Set(message.reactions[emoji] || []);
    if (ids.has(participantId)) ids.delete(participantId);
    else ids.add(participantId);

    if (ids.size) message.reactions[emoji] = [...ids];
    else delete message.reactions[emoji];

    room.lastActivity = this.now();
    await this.#queueSave(room);
    return message.reactions;
  }

  async cleanup() {
    const now = this.now();
    for (const [code, room] of this.#rooms) {
      if (room.participants.size === 0 && now - room.lastActivity > this.idleTtlMs) {
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
      if (Array.isArray(data.messages)) {
        room.messages = data.messages
          .map(normalizeStoredMessage)
          .filter(Boolean)
          .slice(-this.maxMessages);
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
      messages: room.messages
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
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const file = path.join(this.dataDir, entry.name);
      try {
        const stat = await fs.stat(file);
        if (now - stat.mtimeMs > this.historyTtlMs) await fs.unlink(file);
      } catch {
        // A file can disappear between readdir and stat; ignore it.
      }
    }
  }
}
