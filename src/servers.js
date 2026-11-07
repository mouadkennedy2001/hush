import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { CUSTOM_EMOJI_SET } from './constants.js';

export const MAX_SERVERS = 100;
export const MAX_CHANNELS_PER_SERVER = 20;
export const MAX_SERVER_NAME = 40;
export const MAX_CHANNEL_NAME = 32;
export const MAX_SERVER_MESSAGES = 200;

const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function cleanServerName(value) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_SERVER_NAME);
}
export function cleanChannelName(value) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_CHANNEL_NAME);
}
export function cleanDeviceId(value) {
  const id = String(value ?? '').trim();
  return /^[a-zA-Z0-9-]{8,64}$/.test(id) ? id : '';
}
export function cleanChannelType(value) {
  return value === 'voice' ? 'voice' : 'text';
}
export function cleanEmojiId(value) {
  return CUSTOM_EMOJI_SET.has(String(value)) ? String(value) : 'star';
}
export function cleanInviteCode(value) {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
}
export function generateServerId() {
  return `srv_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
}
export function generateInviteCode(random = Math.random) {
  let code = '';
  for (let i = 0; i < 6; i += 1) code += INVITE_ALPHABET[Math.floor(random() * INVITE_ALPHABET.length)];
  return code;
}

function cleanMember(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') {
    const deviceId = cleanDeviceId(raw);
    return deviceId ? { deviceId, name: 'Guest', joinedAt: 0 } : null;
  }
  if (typeof raw === 'object') {
    const deviceId = cleanDeviceId(raw.deviceId);
    if (!deviceId) return null;
    return {
      deviceId,
      name: String(raw.name ?? 'Guest').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 32) || 'Guest',
      joinedAt: Number.isFinite(raw.joinedAt) ? raw.joinedAt : 0
    };
  }
  return null;
}

function normalizeServer(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') return null;
  if (!/^srv_[a-z0-9]{6,20}$/i.test(raw.id)) return null;
  const name = cleanServerName(raw.name);
  if (!name) return null;
  const channels = [];
  for (const ch of Array.isArray(raw.channels) ? raw.channels : []) {
    if (!ch || typeof ch !== 'object' || typeof ch.id !== 'string') continue;
    // Servers are INDEPENDENT from rooms: channels carry no room code.
    channels.push({
      id: ch.id,
      name: cleanChannelName(ch.name) || 'general',
      type: cleanChannelType(ch.type),
      createdAt: Number.isFinite(ch.createdAt) ? ch.createdAt : Date.now()
    });
  }
  if (!channels.length) return null;
  const seen = new Set();
  const members = [];
  for (const m of (Array.isArray(raw.members) ? raw.members : []).map(cleanMember).filter(Boolean)) {
    if (!seen.has(m.deviceId)) { seen.add(m.deviceId); members.push(m); }
  }
  const ownerDeviceId = cleanDeviceId(raw.ownerDeviceId);
  return {
    id: raw.id,
    name,
    description: String(raw.description ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 140),
    iconEmojiId: cleanEmojiId(raw.iconEmojiId),
    ownerName: String(raw.ownerName ?? 'Guest').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 32) || 'Guest',
    ownerDeviceId,
    inviteCode: cleanInviteCode(raw.inviteCode) || generateInviteCode(),
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
    channels: channels.slice(0, MAX_CHANNELS_PER_SERVER),
    members: members.slice(0, 200)
  };
}

/**
 * Totally separate from RoomManager (standalone rooms).
 * Server metadata lives in data/servers.json; each channel's chat lives in
 * data/server-chats/<serverId>/<channelId>.json and is permanent.
 */
export class ServerManager {
  #servers = new Map();
  #saveChain = Promise.resolve();
  #messages = new Map(); // `${serverId}/${channelId}` -> message[]

  constructor({ dataDir, uploadsDir = null, now = () => Date.now(), log = console } = {}) {
    if (!dataDir) throw new Error('ServerManager requires a dataDir');
    this.dataDir = dataDir;
    this.uploadsDir = uploadsDir;
    this.now = now;
    this.log = log;
  }

  #file() { return path.join(this.dataDir, 'servers.json'); }
  #chatDir(serverId, channelId) { return path.join(this.dataDir, 'server-chats', serverId, channelId); }
  #chatFile(serverId, channelId) { return path.join(this.#chatDir(serverId, channelId), 'messages.json'); }

  async init() {
    await fs.mkdir(this.dataDir, { recursive: true });
    await fs.mkdir(path.join(this.dataDir, 'server-chats'), { recursive: true });
    try {
      const raw = await fs.readFile(this.#file(), 'utf8');
      const data = JSON.parse(raw);
      const list = Array.isArray(data) ? data : data?.servers;
      if (Array.isArray(list)) {
        for (const item of list) {
          const server = normalizeServer(item);
          if (server) this.#servers.set(server.id, server);
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  async #queueSave() {
    this.#saveChain = this.#saveChain.then(() => this.#write()).catch((error) => {
      this.log.warn?.('Could not persist servers:', error.message);
    });
    return this.#saveChain;
  }

  async #write() {
    const payload = JSON.stringify({ servers: [...this.#servers.values()] }, null, 2);
    const file = this.#file();
    const temp = `${file}.${randomUUID()}.tmp`;
    await fs.writeFile(temp, payload, 'utf8');
    await fs.rename(temp, file);
  }

  list() { return [...this.#servers.values()].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)); }
  get(id) { return this.#servers.get(String(id)) ?? null; }

  publicSummary(server) {
    return {
      id: server.id,
      name: server.name,
      description: server.description,
      iconEmojiId: server.iconEmojiId,
      ownerName: server.ownerName,
      inviteCode: server.inviteCode,
      createdAt: server.createdAt,
      channels: server.channels,
      members: server.members,
      memberCount: server.members.length + 1
    };
  }

  findByInvite(code) {
    const c = cleanInviteCode(code);
    if (!c) return null;
    for (const server of this.#servers.values()) {
      if (server.inviteCode === c) return server;
    }
    return null;
  }

  isOwner(server, deviceId) {
    return Boolean(server && cleanDeviceId(deviceId) && server.ownerDeviceId === cleanDeviceId(deviceId));
  }

  isMember(server, deviceId) {
    const d = cleanDeviceId(deviceId);
    return Boolean(server && d && (server.ownerDeviceId === d || server.members.some((m) => m.deviceId === d)));
  }

  canAccess(server, deviceId) { return this.isMember(server, deviceId); }

  async create({ name, ownerName, ownerDeviceId, iconEmojiId, description }) {
    const cleanName = cleanServerName(name);
    if (!cleanName) return null;
    if (this.#servers.size >= MAX_SERVERS) return null;
    const owner = cleanDeviceId(ownerDeviceId);
    if (!owner) return null;
    let id = generateServerId();
    while (this.#servers.has(id)) id = generateServerId();
    let inviteCode = generateInviteCode();
    while ([...this.#servers.values()].some((s) => s.inviteCode === inviteCode)) inviteCode = generateInviteCode();
    const server = {
      id,
      name: cleanName,
      description: String(description ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 140),
      iconEmojiId: cleanEmojiId(iconEmojiId),
      ownerName: String(ownerName ?? 'Guest').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 32) || 'Guest',
      ownerDeviceId: owner,
      inviteCode,
      createdAt: this.now(),
      channels: [
        { id: randomUUID(), name: 'general', type: 'text', createdAt: this.now() },
        { id: randomUUID(), name: 'voice-lounge', type: 'voice', createdAt: this.now() }
      ],
      members: [{ deviceId: owner, name: String(ownerName ?? 'Guest').slice(0, 32) || 'Guest', joinedAt: this.now() }]
    };
    this.#servers.set(id, server);
    await this.#queueSave();
    return server;
  }

  async join(id, { deviceId, name, inviteCode } = {}) {
    const server = this.get(id);
    if (!server) return null;
    const device = cleanDeviceId(deviceId);
    if (!device) return server;
    if (server.ownerDeviceId === device) return server;
    if (!this.isMember(server, device)) {
      // Joining a server you are not a member of requires the invite code.
      if (cleanInviteCode(inviteCode) !== server.inviteCode) return null;
      server.members.push({
        deviceId: device,
        name: String(name ?? 'Guest').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 32) || 'Guest',
        joinedAt: this.now()
      });
      await this.#queueSave();
    }
    return server;
  }

  async leave(id, deviceId) {
    const server = this.get(id);
    const device = cleanDeviceId(deviceId);
    if (!server || !device || server.ownerDeviceId === device) return false;
    const before = server.members.length;
    server.members = server.members.filter((m) => m.deviceId !== device);
    if (server.members.length !== before) await this.#queueSave();
    return true;
  }

  async regenerateInvite(id, deviceId) {
    const server = this.get(id);
    if (!server || !this.isOwner(server, deviceId)) return null;
    let inviteCode = generateInviteCode();
    while ([...this.#servers.values()].some((s) => s.inviteCode === inviteCode)) inviteCode = generateInviteCode();
    server.inviteCode = inviteCode;
    await this.#queueSave();
    return server;
  }

  async addChannel(id, { name, type }, deviceId) {
    const server = this.get(id);
    if (!server) return null;
    if (!this.isMember(server, deviceId)) return null;
    if (server.channels.length >= MAX_CHANNELS_PER_SERVER) return null;
    const cleanName = cleanChannelName(name);
    if (!cleanName) return null;
    const channel = { id: randomUUID(), name: cleanName, type: cleanChannelType(type), createdAt: this.now() };
    server.channels.push(channel);
    await this.#queueSave();
    return channel;
  }

  async deleteChannel(id, channelId, deviceId) {
    const server = this.get(id);
    if (!server || !this.isOwner(server, deviceId)) return null;
    const index = server.channels.findIndex((c) => c.id === channelId);
    if (index === -1 || server.channels.length <= 1) return null;
    const [removed] = server.channels.splice(index, 1);
    await this.#queueSave();
    await this.#deleteChannelData(id, channelId);
    return removed;
  }

  async deleteServer(id, deviceId) {
    const server = this.get(id);
    if (!server || !this.isOwner(server, deviceId)) return null;
    this.#servers.delete(id);
    await this.#queueSave();
    // Permanent means permanent until the owner deletes it — then everything goes.
    try { await fs.rm(path.join(this.dataDir, 'server-chats', id), { recursive: true, force: true }); } catch { /* ignore */ }
    return server;
  }

  async #deleteChannelData(serverId, channelId) {
    try { await fs.rm(this.#chatDir(serverId, channelId), { recursive: true, force: true }); } catch { /* ignore */ }
    this.#messages.delete(`${serverId}/${channelId}`);
  }

  /* -------- Server channel chat (independent from room chat) -------- */

  async loadMessages(serverId, channelId) {
    const key = `${serverId}/${channelId}`;
    if (this.#messages.has(key)) return this.#messages.get(key);
    let messages = [];
    try {
      const raw = await fs.readFile(this.#chatFile(serverId, channelId), 'utf8');
      const data = JSON.parse(raw);
      if (Array.isArray(data)) messages = data.filter((m) => m && typeof m.id === 'string').slice(-MAX_SERVER_MESSAGES);
    } catch { messages = []; }
    this.#messages.set(key, messages);
    return messages;
  }

  async addMessage(serverId, channelId, message) {
    const messages = await this.loadMessages(serverId, channelId);
    messages.push(message);
    if (messages.length > MAX_SERVER_MESSAGES) messages.splice(0, messages.length - MAX_SERVER_MESSAGES);
    const file = this.#chatFile(serverId, channelId);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.${randomUUID()}.tmp`;
    await fs.writeFile(temp, JSON.stringify(messages), 'utf8');
    await fs.rename(temp, file);
    return message;
  }

  async editMessage(serverId, channelId, messageId, authorId, text) {
    const messages = await this.loadMessages(serverId, channelId);
    const message = messages.find((m) => m.id === messageId);
    if (!message || message.authorId !== authorId) return null;
    message.text = text;
    message.editedAt = this.now();
    const file = this.#chatFile(serverId, channelId);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(messages), 'utf8');
    return message;
  }

  async deleteMessage(serverId, channelId, messageId, authorId) {
    const messages = await this.loadMessages(serverId, channelId);
    const index = messages.findIndex((m) => m.id === messageId);
    if (index === -1 || messages[index].authorId !== authorId) return false;
    messages.splice(index, 1);
    const file = this.#chatFile(serverId, channelId);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(messages), 'utf8');
    return true;
  }
}
