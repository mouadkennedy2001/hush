import { randomUUID, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { CUSTOM_EMOJI_SET, MAX_CUSTOM_SOUNDS_PER_SERVER, MAX_BOARD_AUDIO_BYTES } from './constants.js';

export const MAX_SERVERS = 100;
export const MAX_SERVERS_PER_DEVICE = 10; // N2: per-user cap instead of only global 100 (A16)
export const MAX_CHANNELS_PER_SERVER = 20;
export const MAX_SERVER_NAME = 40;
export const MAX_CHANNEL_NAME = 32;
export const MAX_SERVER_MESSAGES = 500;
export const MAX_TEMP_ROOMS_PER_SERVER = 10;
export const MAX_INVITE_LENGTH = 10; // A5: 6 -> 10 chars (~50 bits) with crypto RNG
export const MAX_CUSTOM_SERVER_ROLES = 20;
export const MAX_SERVER_MEMBER_ROLES = 10;
export const SERVER_ROLE_PERMISSIONS = Object.freeze([
  'manage_settings',
  'manage_channels',
  'moderate_members',
  'manage_messages'
]);

const BUILTIN_SERVER_ROLES = Object.freeze([
  Object.freeze({ id: 'host', name: 'Host', color: '#f59e0b', position: 300, builtIn: true, permissions: Object.freeze(['manage_settings', 'manage_channels', 'moderate_members', 'manage_messages']) }),
  Object.freeze({ id: 'assistant', name: 'Assistant', color: '#38bdf8', position: 200, builtIn: true, permissions: Object.freeze(['moderate_members', 'manage_messages']) }),
  Object.freeze({ id: 'member', name: 'Member', color: '#94a3b8', position: 100, builtIn: true, permissions: Object.freeze([]) })
]);

// Back-compat export shape used by existing imports/tests.
export { MAX_SERVERS_PER_DEVICE as MAX_SERVERS_PER_USER };

const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CHANNEL_ID_RE = /^[a-z0-9-]{8,64}$/i; // UUID or our uuids; rejects ../.. and separators
const SERVER_ID_RE = /^srv_[a-z0-9]{6,20}$/i;

export function isValidChannelId(value) {
  return typeof value === 'string' && CHANNEL_ID_RE.test(value);
}
export function isValidServerId(value) {
  return typeof value === 'string' && SERVER_ID_RE.test(value);
}

export function cleanServerName(value) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_SERVER_NAME);
}
export function cleanChannelName(value) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_CHANNEL_NAME);
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
export function cleanDescription(value) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e]/g, '').trim().replace(/\s+/g, ' ').slice(0, 140);
}
export function cleanIconUrl(value, serverId = '') {
  const url = String(value ?? '').trim();
  if (!url) return '';
  // Only our own uploaded icon path is valid — never arbitrary URLs.
  const prefix = serverId ? `/uploads/server-${serverId}/icon` : '/uploads/server-';
  if (!url.startsWith(prefix) || url.includes('..') || url.includes('\\')) return '';
  return /\.(png|jpe?g|webp|gif|avif)$/i.test(url) ? url : '';
}
export function cleanImageUrl(value, prefix) {
  const url = String(value ?? '').trim();
  if (!url) return '';
  if (!url.startsWith(prefix) || url.includes('..') || url.includes('\\')) return '';
  return /\.(png|jpe?g|webp|gif|avif)$/i.test(url) ? url : '';
}
export function normalizeServerCustomSound(raw, serverId) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') return null;
  const url = String(raw.url ?? '');
  const prefix = `/uploads/server-${serverId}/board/`;
  if (!url.startsWith(prefix) || url.includes('..') || url.includes('\\')) return null;
  const size = Number(raw.size);
  if (!Number.isFinite(size) || size < 0 || size > MAX_BOARD_AUDIO_BYTES) return null;
  return {
    id: raw.id,
    name: String(raw.name ?? 'Sound').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40) || 'Sound',
    emojiId: cleanEmojiId(raw.emojiId),
    url,
    imageUrl: cleanImageUrl(raw.imageUrl, prefix),
    size,
    mime: String(raw.mime ?? 'audio/mpeg').slice(0, 60),
    addedById: typeof raw.addedById === 'string' ? raw.addedById : '',
    addedBy: typeof raw.addedBy === 'string' ? raw.addedBy.slice(0, 32) : '',
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now()
  };
}
export function cleanDisplayName(value) {
  return String(value ?? 'Guest').replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e]/g, '').trim().slice(0, 32) || 'Guest';
}

function cleanRoleName(value) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 24);
}

function normalizeServerRoles(raw) {
  const roles = BUILTIN_SERVER_ROLES.map((role) => ({ ...role, permissions: [...role.permissions] }));
  const ids = new Set(roles.map((role) => role.id));
  const names = new Set(roles.map((role) => role.name.toLowerCase()));
  let customRoleCount = 0;
  for (const role of Array.isArray(raw) ? raw : []) {
    if (customRoleCount >= MAX_CUSTOM_SERVER_ROLES) break;
    if (!role || typeof role !== 'object' || role.builtIn) continue;
    const id = String(role.id ?? '');
    const name = cleanRoleName(role.name);
    if (!/^role_[a-z0-9-]{8,64}$/i.test(id) || ids.has(id) || !name || names.has(name.toLowerCase())) continue;
    const color = /^#[0-9a-f]{6}$/i.test(String(role.color ?? '')) ? String(role.color).toLowerCase() : '#64748b';
    const permissions = [...new Set((Array.isArray(role.permissions) ? role.permissions : [])
      .filter((permission) => SERVER_ROLE_PERMISSIONS.includes(permission)))];
    roles.push({
      id,
      name,
      color,
      position: Number.isFinite(role.position) ? Math.min(199, Math.max(101, Math.trunc(role.position))) : 150,
      builtIn: false,
      permissions
    });
    ids.add(id);
    names.add(name.toLowerCase());
    customRoleCount += 1;
  }
  return roles;
}

function cleanMember(raw, validRoleIds = new Set(['member'])) {
  if (!raw) return null;
  if (typeof raw === 'string') {
    const deviceId = cleanDeviceId(raw);
    return deviceId ? { deviceId, name: 'Guest', joinedAt: 0, roleIds: ['member'] } : null;
  }
  if (typeof raw === 'object') {
    const deviceId = cleanDeviceId(raw.deviceId);
    if (!deviceId) return null;
    const roleIds = [...new Set((Array.isArray(raw.roleIds) ? raw.roleIds : [])
      .filter((roleId) => typeof roleId === 'string' && validRoleIds.has(roleId)))].slice(0, MAX_SERVER_MEMBER_ROLES);
    return {
      deviceId,
      name: cleanDisplayName(raw.name),
      joinedAt: Number.isFinite(raw.joinedAt) ? raw.joinedAt : 0,
      roleIds: roleIds.length ? roleIds : ['member']
    };
  }
  return null;
}
export function generateServerId() {
  return `srv_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
}
export function generateInviteCode(random) {
  // A5/C5: crypto RNG (was Math.random, predictable). Keep optional `random`
  // param for back-compat with tests that inject a stub, but default to
  // crypto with 10-char codes (~50 bits) instead of 6 chars (~30 bits).
  if (typeof random === 'function') {
    let code = '';
    for (let i = 0; i < MAX_INVITE_LENGTH; i += 1) code += INVITE_ALPHABET[Math.floor(random() * INVITE_ALPHABET.length)];
    return code;
  }
  const bytes = randomBytes(MAX_INVITE_LENGTH);
  let code = '';
  for (let i = 0; i < bytes.length; i += 1) code += INVITE_ALPHABET[bytes[i] % INVITE_ALPHABET.length];
  return code;
}

export function inviteCodesEqual(a, b) {
  // Constant-time compare to avoid timing side-channels on invite checks.
  const x = Buffer.from(cleanInviteCode(a));
  const y = Buffer.from(cleanInviteCode(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

function normalizeServer(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') return null;
  if (!/^srv_[a-z0-9]{6,20}$/i.test(raw.id)) return null;
  const name = cleanServerName(raw.name);
  if (!name) return null;
  const channels = [];
  for (const ch of Array.isArray(raw.channels) ? raw.channels : []) {
    if (!ch || typeof ch !== 'object') continue;
    // A12: reject traversal-ish ids; never bind a channel under ../../ path.
    // H7: normalize validates channelId format before any FS touch later.
    const chId = isValidChannelId(ch.id) ? ch.id : randomUUID();
    // Servers are INDEPENDENT from rooms: channels carry no room code.
    channels.push({
      id: chId,
      name: cleanChannelName(ch.name) || 'general',
      type: cleanChannelType(ch.type),
      createdAt: Number.isFinite(ch.createdAt) ? ch.createdAt : Date.now()
    });
  }
  if (!channels.length) {
    channels.push({ id: randomUUID(), name: 'general', type: 'text', createdAt: Date.now() });
    channels.push({ id: randomUUID(), name: 'voice-lounge', type: 'voice', createdAt: Date.now() });
  }
  const roles = normalizeServerRoles(raw.roles);
  const validRoleIds = new Set(roles.map((role) => role.id));
  const seen = new Set();
  const members = [];
  for (const m of (Array.isArray(raw.members) ? raw.members : []).map((member) => cleanMember(member, validRoleIds)).filter(Boolean)) {
    if (!seen.has(m.deviceId)) { seen.add(m.deviceId); members.push(m); }
  }
  const ownerDeviceId = cleanDeviceId(raw.ownerDeviceId);
  // Ensure the owner is always a member, so memberCount is exact.
  if (ownerDeviceId && !members.some((m) => m.deviceId === ownerDeviceId)) {
    members.unshift({ deviceId: ownerDeviceId, name: cleanDisplayName(raw.ownerName), joinedAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(), roleIds: ['member'] });
  }
  const banned = [];
  if (Array.isArray(raw.banned)) {
    const now = Date.now();
    for (const b of raw.banned.slice(0, 200)) {
      if (!b || typeof b !== 'object') continue;
      const deviceId = cleanDeviceId(b.deviceId);
      if (!deviceId) continue;
      const until = Number.isFinite(b.until) ? b.until : 0;
      if (until && until < now) continue;
      const roleIds = [...new Set((Array.isArray(b.roleIds) ? b.roleIds : [])
        .filter((roleId) => typeof roleId === 'string' && validRoleIds.has(roleId)))];
      banned.push({ deviceId, name: cleanDisplayName(b.name), until: until || null, reason: String(b.reason ?? '').slice(0, 120), roleIds: roleIds.length ? roleIds : ['member'] });
    }
  }
  const customSounds = [];
  if (Array.isArray(raw.customSounds)) {
    for (const s of raw.customSounds.slice(0, MAX_CUSTOM_SOUNDS_PER_SERVER)) {
      const clean = normalizeServerCustomSound(s, raw.id);
      if (clean) customSounds.push(clean);
    }
  }
  return {
    id: raw.id,
    name,
    description: cleanDescription(raw.description),
    iconEmojiId: cleanEmojiId(raw.iconEmojiId),
    iconUrl: cleanIconUrl(raw.iconUrl, raw.id),
    customSounds,
    ownerName: cleanDisplayName(raw.ownerName),
    ownerDeviceId,
    inviteCode: cleanInviteCode(raw.inviteCode) || generateInviteCode(),
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
    channels: channels.slice(0, MAX_CHANNELS_PER_SERVER),
    members: members.slice(0, 200),
    roles,
    banned,
    pinned: {}
  };
}

/**
 * Totally separate from RoomManager (standalone rooms).
 * Server metadata lives in data/servers.json; each channel's chat lives in
 * data/server-chats/<serverId>/<channelId>.json and is permanent.
 *
 * Server messages carry BOTH:
 *  - authorId: the socket id that sent the message (legacy/internal only)
 *  - authorDeviceId: the stable device id (edit/delete ownership survives
 *    reconnects and new tabs). Neither identifier is exposed in public chat
 *    payloads; the server computes a viewer-specific isOwn flag instead.
 */
export class ServerManager {
  #servers = new Map();
  #saveChain = Promise.resolve();
  #messages = new Map(); // `${serverId}/${channelId}` -> message[]
  #messageChains = new Map(); // per-channel write queue
  #messageLoads = new Map(); // single-flight load promises (C3) — one load per key at a time
  #channelTombstones = new Set(); // deleted keys: pending writes must not resurrect dirs (H5)

  constructor({ dataDir, uploadsDir = null, now = () => Date.now(), log = console, serverStore = null } = {}) {
    if (!dataDir) throw new Error('ServerManager requires a dataDir');
    this.dataDir = dataDir;
    this.uploadsDir = uploadsDir;
    this.now = now;
    this.log = log;
    this.serverStore = serverStore;
  }

  #file() { return path.join(this.dataDir, 'servers.json'); }
  #chatDir(serverId, channelId) { return path.join(this.dataDir, 'server-chats', serverId, channelId); }
  #chatFile(serverId, channelId) { return path.join(this.#chatDir(serverId, channelId), 'messages.json'); }

  async init() {
    await fs.mkdir(this.dataDir, { recursive: true });
    await fs.mkdir(path.join(this.dataDir, 'server-chats'), { recursive: true });
    // M7/A18: sweep orphan .tmp files left by interrupted atomic writes.
    try {
      const walk = async (dir) => {
        let ents = [];
        try { ents = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
        for (const e of ents) {
          const p = path.join(dir, e.name);
          if (e.isDirectory()) await walk(p);
          else if (e.name.endsWith('.tmp')) { try { await fs.unlink(p); } catch { /* ignore */ } }
        }
      };
      await walk(path.join(this.dataDir, 'server-chats'));
    } catch { /* ignore */ }
    try {
      const raw = await fs.readFile(this.#file(), 'utf8');
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        // A19: corrupt JSON must not silently reset — quarantine + backup.
        const bad = `${this.#file()}.corrupt-${Date.now()}.json`;
        try { await fs.writeFile(bad, raw, 'utf8'); } catch { /* ignore */ }
        const bak = `${this.#file()}.bak`;
        try { await fs.copyFile(this.#file(), bak); } catch { /* ignore */ }
        throw Object.assign(new Error('servers.json corrupt — quarantined, refusing to overwrite'), { code: 'CORRUPT' });
      }
      const list = Array.isArray(data) ? data : data?.servers;
      if (Array.isArray(list)) {
        const seenInvites = new Set();
        for (const item of list) {
          const server = normalizeServer(item);
          if (!server) continue;
          // L4: duplicate invite codes (hand-edited file) must not be ambiguous.
          if (seenInvites.has(server.inviteCode)) server.inviteCode = generateInviteCode();
          while (seenInvites.has(server.inviteCode)) server.inviteCode = generateInviteCode();
          seenInvites.add(server.inviteCode);
          this.#servers.set(server.id, server);
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (this.serverStore) {
      const remoteServers = await this.serverStore.loadServers();
      if (remoteServers === null) {
        const localServers = [...this.#servers.values()];
        if (localServers.length) await this.serverStore.saveServers(localServers);
      } else {
        if (!Array.isArray(remoteServers)) throw new Error('Supabase server state must be an array');
        this.#servers.clear();
        const seenInvites = new Set();
        for (const item of remoteServers) {
          const server = normalizeServer(item);
          if (!server) continue;
          if (seenInvites.has(server.inviteCode)) server.inviteCode = generateInviteCode();
          while (seenInvites.has(server.inviteCode)) server.inviteCode = generateInviteCode();
          seenInvites.add(server.inviteCode);
          this.#servers.set(server.id, server);
        }
        await this.#write();
      }
    }
  }

  async #queueSave() {
    const write = this.#saveChain.then(() => this.#write());
    this.#saveChain = write.catch((error) => {
      this.log.warn?.('Could not persist servers:', error.message);
    });
    return write;
  }

  async #write() {
    const payload = JSON.stringify({ servers: [...this.#servers.values()] }, null, 2);
    if (this.serverStore) await this.serverStore.saveServers([...this.#servers.values()]);
    const file = this.#file();
    const temp = `${file}.${randomUUID()}.tmp`;
    await fs.writeFile(temp, payload, 'utf8');
    // A18/M5: fsync file + dir before rename so crash loses nothing committed.
    try {
      const fh = await fs.open(temp, 'r');
      try { await fh.sync(); } finally { await fh.close(); }
    } catch { /* best-effort on platforms without fsync */ }
    // Keep a rolling .bak of the last good file before replacing it (A18).
    try { await fs.copyFile(file, `${file}.bak`); } catch { /* none yet */ }
    await fs.rename(temp, file);
    try {
      const dh = await fs.open(this.dataDir, 'r');
      try { await dh.sync(); } finally { await dh.close(); }
    } catch { /* best-effort */ }
  }

  #queueChannelWrite(key, job) {
    const prev = this.#messageChains.get(key) ?? Promise.resolve();
    const run = prev.then(() => job()).then(
      () => { if (this.#messageChains.get(key) === run) this.#messageChains.delete(key); },
      (error) => {
        if (this.#messageChains.get(key) === run) this.#messageChains.delete(key);
        throw error;
      }
    );
    this.#messageChains.set(key, run);
    return run;
  }

  async #writeMessagesFile(serverId, channelId, messages) {
    if (this.serverStore) await this.serverStore.saveMessages(serverId, channelId, messages);
    const file = this.#chatFile(serverId, channelId);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.${randomUUID()}.tmp`;
    await fs.writeFile(temp, JSON.stringify(messages), 'utf8');
    await fs.rename(temp, file);
  }

  list() { return [...this.#servers.values()].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)); }
  /**
   * Servers visible in the UI: when a viewer device id is given, only the
   * servers that device created or joined (its own added servers). Without
   * a viewer, return everything (back-compat for diagnostics/tests).
   */
  listFor(viewerDeviceId) {
    const all = this.list();
    const viewer = cleanDeviceId(viewerDeviceId);
    // A4/C4: no viewer -> NO enumeration of all servers' members. Callers
    // must not treat the raw list() as public; publicSummary redacts details
    // per viewer. listFor keeps back-compat length for diagnostics/tests but
    // the REST layer now requires membership (see app.js list route).
    if (!viewer) return all;
    return all.filter((s) => this.isMember(s, viewer) && !this.isBanned(s, viewer));
  }
  get(id) { return this.#servers.get(String(id)) ?? null; }

  /**
   * publicSummary(server, viewerDeviceId)
   * - inviteCode is only exposed to members (pass their deviceId as viewer).
   *   The public list (no viewer / non-member) never leaks invite codes,
   *   ownerDeviceId, or the member deviceId list (A2/C2/C4).
   * - Members see: ownerDeviceId redacted to isOwner flag; member list with
   *   pseudonym memberId (first 12 of sha256(deviceId)) — deviceId itself is
   *   visible ONLY to the owner (needed for kick/ban) or to self (isYou view).
   * - memberCount is the real unique-member count (owner included once).
   * Backward compat: `deviceId` field remains on member entries for owners
   * so the existing admin UI keeps working; non-owners get memberId only.
   */
  publicSummary(server, viewerDeviceId = null, options = {}) {
    if (!server) return null;
    const memberIds = new Set([server.ownerDeviceId, ...server.members.map((m) => m.deviceId)].filter(Boolean));
    const viewer = cleanDeviceId(viewerDeviceId);
    const isMember = Boolean(viewer && this.isMember(server, viewer));
    const isOwnerViewer = Boolean(viewer && this.isOwner(server, viewer));
    const canModerateMembers = Boolean(viewer && this.hasPermission(server, viewer, 'moderate_members'));
    const showInvite = Boolean(isMember && !options.omitInvite);
    // Pseudonym helper: stable per-device hash (not reversible base64).
    const pseudo = (d) => this.memberIdFor(d);
    let members = [];
    if (isMember) {
      members = server.members.map((m) => {
        const isSelf = m.deviceId === viewer;
        // Moderators need stable ids for member actions; broadcasts always redact them.
        const exposeDevice = !options.redactDeviceIds && Boolean(canModerateMembers || isSelf);
        return {
          memberId: pseudo(m.deviceId),
          name: m.name,
          joinedAt: m.joinedAt,
          isOwner: m.deviceId === server.ownerDeviceId,
          isYou: isSelf,
          roleIds: [...(m.roleIds || ['member'])],
          ...(exposeDevice ? { deviceId: m.deviceId } : {})
        };
      });
    }
    return {
      id: server.id,
      name: server.name,
      description: server.description,
      iconEmojiId: server.iconEmojiId,
      iconUrl: server.iconUrl || '',
      customSounds: isMember ? (server.customSounds || []) : [],
      roles: (server.roles || normalizeServerRoles([])).map((role) => ({
        id: role.id,
        name: role.name,
        color: role.color,
        position: role.position,
        builtIn: role.builtIn,
        permissions: [...role.permissions]
      })),
      ownerName: server.ownerName,
      // A2/C2: never broadcast raw ownerDeviceId to non-owners/members.
      ownerDeviceId: isOwnerViewer ? server.ownerDeviceId : null,
      inviteCode: showInvite ? server.inviteCode : null,
      isOwner: isOwnerViewer,
      isMember,
      createdAt: server.createdAt,
      channels: isMember ? server.channels.map((c) => ({ id: c.id, name: c.name, type: c.type, createdAt: c.createdAt })) : [],
      members,
      memberCount: memberIds.size
    };
  }

  /**
   * Broadcast-safe view for socket fan-out to all members of a server.
   * Members need channels + redacted member list, but must NOT receive the
   * invite code (H8) or raw ownerDeviceId (A2). Invite stays available only
   * via the direct REST/socket ack for that specific viewer.
   */
  broadcastSummary(server) {
    if (!server) return null;
    // Redacted broadcast: never leak raw deviceIds (or invite) to everyone.
    // Viewers who are members but NOT owner get memberId pseudonyms only.
    // The owner fetches full ids via the private REST summary when moderating.
    const nonOwner = server.members.find((m) => m.deviceId !== server.ownerDeviceId);
    const viewer = nonOwner ? nonOwner.deviceId : server.ownerDeviceId;
    const view = this.publicSummary(server, viewer, { omitInvite: true, redactDeviceIds: true });
    // isYou is per-viewer; strip it from the shared broadcast (clients
    // recompute it from their own memberId after the join ack).
    const members = (view.members || []).map((m) => ({ ...m, isYou: false }));
    return { ...view, ownerDeviceId: null, isOwner: false, members };
  }

  memberIdFor(deviceId) {
    const d = cleanDeviceId(deviceId);
    if (!d) return null;
    try {
      const h = createHash('sha256').update(d).digest('base64url').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12);
      return `m_${h || d.slice(0, 12)}`;
    } catch { return `m_${d.slice(0, 12)}`; }
  }

  findByInvite(code) {
    const c = cleanInviteCode(code);
    if (!c) return null;
    for (const server of this.#servers.values()) {
      if (inviteCodesEqual(server.inviteCode, c)) return server;
    }
    return null;
  }

  isOwner(server, deviceId) {
    return Boolean(server && cleanDeviceId(deviceId) && server.ownerDeviceId === cleanDeviceId(deviceId));
  }

  hasPermission(server, deviceId, permission) {
    const device = cleanDeviceId(deviceId);
    if (!server || !device) return false;
    if (this.isOwner(server, device)) return true;
    if (!SERVER_ROLE_PERMISSIONS.includes(permission)) return false;
    const member = server.members.find((entry) => entry.deviceId === device);
    if (!member) return false;
    const roleIds = new Set(member.roleIds || ['member']);
    return (server.roles || []).some((role) => roleIds.has(role.id) && role.permissions.includes(permission));
  }

  canModerateMember(server, actorDeviceId, targetDeviceId) {
    const actor = cleanDeviceId(actorDeviceId);
    const target = cleanDeviceId(targetDeviceId);
    if (!server || !actor || !target || target === server.ownerDeviceId
      || !this.hasPermission(server, actor, 'moderate_members')) return false;
    const targetMember = server.members.find((entry) => entry.deviceId === target);
    const targetBan = (server.banned || []).find((entry) => entry.deviceId === target);
    if (!targetMember && !targetBan) return this.isOwner(server, actor);
    const rank = (member) => Math.max(0, ...(server.roles || [])
      .filter((role) => new Set(member?.roleIds || ['member']).has(role.id))
      .map((role) => role.position));
    const actorRank = this.isOwner(server, actor)
      ? Number.POSITIVE_INFINITY
      : rank(server.members.find((entry) => entry.deviceId === actor));
    return actorRank > rank(targetMember || targetBan);
  }

  isMember(server, deviceId) {
    const d = cleanDeviceId(deviceId);
    return Boolean(server && d && (server.ownerDeviceId === d || server.members.some((m) => m.deviceId === d)));
  }

  isBanned(server, deviceId) {
    const d = cleanDeviceId(deviceId);
    if (!server || !d) return null;
    const now = this.now();
    return (server.banned || []).find((b) => b.deviceId === d && (!b.until || b.until > now)) ?? null;
  }

  canAccess(server, deviceId) { return this.isMember(server, deviceId) && !this.isBanned(server, deviceId); }

  async createRole(id, actorDeviceId, { name, color, permissions } = {}) {
    const server = this.get(id);
    if (!server || !this.isOwner(server, actorDeviceId)) return null;
    const roleName = cleanRoleName(name);
    const roleColor = /^#[0-9a-f]{6}$/i.test(String(color ?? '')) ? String(color).toLowerCase() : '';
    if (!roleName || !roleColor || !Array.isArray(permissions)
      || permissions.some((permission) => !SERVER_ROLE_PERMISSIONS.includes(permission))
      || (server.roles || []).some((role) => role.name.toLowerCase() === roleName.toLowerCase())) return null;
    const customCount = (server.roles || []).filter((role) => !role.builtIn).length;
    if (customCount >= MAX_CUSTOM_SERVER_ROLES) return null;
    const role = {
      id: `role_${randomUUID().replace(/-/g, '')}`,
      name: roleName,
      color: roleColor,
      position: 150,
      builtIn: false,
      permissions: [...new Set(permissions)]
    };
    server.roles.push(role);
    await this.#queueSave();
    return role;
  }

  async updateRole(id, actorDeviceId, roleId, updates = {}) {
    const server = this.get(id);
    if (!server || !this.isOwner(server, actorDeviceId)) return null;
    const role = server.roles.find((entry) => entry.id === String(roleId) && !entry.builtIn);
    if (!role) return null;
    let name = role.name;
    let color = role.color;
    let permissions = role.permissions;
    if (updates.name !== undefined) {
      name = cleanRoleName(updates.name);
      if (!name || server.roles.some((entry) => entry.id !== role.id && entry.name.toLowerCase() === name.toLowerCase())) return null;
    }
    if (updates.color !== undefined) {
      if (!/^#[0-9a-f]{6}$/i.test(String(updates.color))) return null;
      color = String(updates.color).toLowerCase();
    }
    if (updates.permissions !== undefined) {
      if (!Array.isArray(updates.permissions)
        || updates.permissions.some((permission) => !SERVER_ROLE_PERMISSIONS.includes(permission))) return null;
      permissions = [...new Set(updates.permissions)];
    }
    role.name = name;
    role.color = color;
    role.permissions = permissions;
    await this.#queueSave();
    return role;
  }

  async deleteRole(id, actorDeviceId, roleId) {
    const server = this.get(id);
    if (!server || !this.isOwner(server, actorDeviceId)) return null;
    const index = server.roles.findIndex((entry) => entry.id === String(roleId) && !entry.builtIn);
    if (index === -1) return null;
    const [role] = server.roles.splice(index, 1);
    for (const member of server.members) {
      member.roleIds = (member.roleIds || []).filter((assignedRoleId) => assignedRoleId !== role.id);
      if (!member.roleIds.length) member.roleIds = ['member'];
    }
    for (const ban of server.banned || []) {
      ban.roleIds = (ban.roleIds || []).filter((assignedRoleId) => assignedRoleId !== role.id);
      if (!ban.roleIds.length) ban.roleIds = ['member'];
    }
    await this.#queueSave();
    return server;
  }

  async assignMemberRoles(id, actorDeviceId, targetMemberId, roleIds) {
    const server = this.get(id);
    if (!server || !this.isOwner(server, actorDeviceId) || !Array.isArray(roleIds)
      || roleIds.length > MAX_SERVER_MEMBER_ROLES) return null;
    const target = server.members.find((member) => member.deviceId === cleanDeviceId(targetMemberId)
      || this.memberIdFor(member.deviceId) === String(targetMemberId));
    if (!target || target.deviceId === server.ownerDeviceId) return null;
    const ids = [...new Set(roleIds)];
    if (ids.some((roleId) => typeof roleId !== 'string' || !server.roles.some((role) => role.id === roleId))) return null;
    target.roleIds = ids.length ? ids : ['member'];
    await this.#queueSave();
    return server;
  }

  async create({ name, ownerName, ownerDeviceId, iconEmojiId, description }) {
    const cleanName = cleanServerName(name);
    if (!cleanName) return null;
    if (this.#servers.size >= MAX_SERVERS) return null;
    const owner = cleanDeviceId(ownerDeviceId);
    if (!owner) return null;
    // N2/A16: per-user cap in addition to global 100 — one device cannot
    // starve the whole instance by creating 100 servers.
    const ownedByThisDevice = [...this.#servers.values()].filter((s) => s.ownerDeviceId === owner).length;
    if (ownedByThisDevice >= MAX_SERVERS_PER_DEVICE) return null;
    let id = generateServerId();
    while (this.#servers.has(id)) id = generateServerId();
    let inviteCode = generateInviteCode();
    while ([...this.#servers.values()].some((s) => inviteCodesEqual(s.inviteCode, inviteCode))) inviteCode = generateInviteCode();
    const server = {
      id,
      name: cleanName,
      description: cleanDescription(description),
      iconEmojiId: cleanEmojiId(iconEmojiId),
      iconUrl: '',
      customSounds: [],
      ownerName: cleanDisplayName(ownerName),
      ownerDeviceId: owner,
      inviteCode,
      createdAt: this.now(),
      roles: normalizeServerRoles([]),
      channels: [
        { id: randomUUID(), name: 'general', type: 'text', createdAt: this.now() },
        { id: randomUUID(), name: 'voice-lounge', type: 'voice', createdAt: this.now() }
      ],
      members: [{ deviceId: owner, name: cleanDisplayName(ownerName), joinedAt: this.now(), roleIds: ['member'] }],
      banned: [],
      pinned: {}
    };
    this.#servers.set(id, server);
    await this.#queueSave();
    return server;
  }

  async join(id, { deviceId, name, inviteCode } = {}) {
    const server = this.get(id);
    if (!server) return null;
    const device = cleanDeviceId(deviceId);
    if (!device) return null;
    if (this.isBanned(server, device)) return null;
    if (server.ownerDeviceId === device) return server;
    const existing = server.members.find((m) => m.deviceId === device);
    if (existing) {
      const cleanName = cleanDisplayName(name);
      if (name && cleanName !== existing.name) {
        existing.name = cleanName;
        existing.joinedAt = existing.joinedAt || this.now();
        await this.#queueSave();
      }
      return server;
    }
    // Joining a server you are not a member of requires the invite code.
    if (!inviteCodesEqual(inviteCode, server.inviteCode)) return null;
    const memberIds = new Set([server.ownerDeviceId, ...server.members.map((m) => m.deviceId)].filter(Boolean));
    if (memberIds.size >= 200) return null;
    server.members.push({
      deviceId: device,
      name: cleanDisplayName(name),
      joinedAt: this.now(),
      roleIds: ['member']
    });
    await this.#queueSave();
    return server;
  }

  async leave(id, deviceId) {
    const server = this.get(id);
    const device = cleanDeviceId(deviceId);
    if (!server || !device || server.ownerDeviceId === device) return false;
    const before = server.members.length;
    server.members = server.members.filter((m) => m.deviceId !== device);
    if (server.members.length !== before) await this.#queueSave();
    return server.members.length !== before;
  }

  async kick(id, ownerDeviceId, targetDeviceId) {
    const server = this.get(id);
    const actor = cleanDeviceId(ownerDeviceId);
    const target = cleanDeviceId(targetDeviceId);
    if (!server || !actor || !target) return false;
    if (!server.members.some((member) => member.deviceId === target)
      || !this.canModerateMember(server, actor, target)) return false;
    const before = server.members.length;
    server.members = server.members.filter((m) => m.deviceId !== target);
    if (server.members.length === before) return false;
    await this.#queueSave();
    return true;
  }

  async ban(id, ownerDeviceId, targetDeviceId, targetName, minutes) {
    const server = this.get(id);
    const target = cleanDeviceId(targetDeviceId);
    if (!server || !target || target === server.ownerDeviceId
      || !this.canModerateMember(server, ownerDeviceId, target)) return null;
    const mins = Math.min(10080, Math.max(1, Number(minutes) || 60));
    const existing = server.members.find((m) => m.deviceId === target);
    const previousBan = (server.banned || []).find((ban) => ban.deviceId === target);
    const ban = {
      deviceId: target,
      name: cleanDisplayName(targetName || existing?.name),
      until: this.now() + mins * 60_000,
      reason: '',
      roleIds: [...(existing?.roleIds || previousBan?.roleIds || ['member'])]
    };
    server.banned = [...(server.banned || []).filter((b) => b.deviceId !== target), ban].slice(-200);
    server.members = server.members.filter((m) => m.deviceId !== target);
    await this.#queueSave();
    return ban;
  }

  async unban(id, ownerDeviceId, targetDeviceId) {
    const server = this.get(id);
    const target = cleanDeviceId(targetDeviceId);
    if (!server || !target || !this.canModerateMember(server, ownerDeviceId, target)) return false;
    const before = (server.banned || []).length;
    server.banned = (server.banned || []).filter((b) => b.deviceId !== target);
    if (server.banned.length !== before) await this.#queueSave();
    return server.banned.length !== before;
  }

  async regenerateInvite(id, deviceId) {
    const server = this.get(id);
    if (!server || !this.hasPermission(server, deviceId, 'manage_settings')) return null;
    let inviteCode = generateInviteCode();
    while ([...this.#servers.values()].some((s) => inviteCodesEqual(s.inviteCode, inviteCode))) inviteCode = generateInviteCode();
    server.inviteCode = inviteCode;
    await this.#queueSave();
    return server;
  }

  /**
   * N1/A16: ownership transfer — the only escape for orphaned servers whose
   * owner device is lost. Current owner transfers to any existing member.
   */
  async transferOwnership(id, fromDeviceId, toDeviceId) {
    const server = this.get(id);
    if (!server || !this.isOwner(server, fromDeviceId)) return null;
    const target = cleanDeviceId(toDeviceId);
    if (!target || target === server.ownerDeviceId) return null;
    if (!this.isMember(server, target)) return null;
    const from = server.ownerDeviceId;
    server.ownerDeviceId = target;
    const member = server.members.find((m) => m.deviceId === target);
    server.ownerName = member?.name ?? server.ownerName;
    // Ensure both stay members (owner is forced into members anyway).
    if (!server.members.some((m) => m.deviceId === from)) {
      server.members.push({ deviceId: from, name: server.ownerName, joinedAt: this.now() });
    }
    await this.#queueSave();
    return server;
  }

  async updateSettings(id, deviceId, { name, description, iconEmojiId, iconUrl } = {}) {
    const server = this.get(id);
    if (!server || !this.hasPermission(server, deviceId, 'manage_settings')) return null;
    if (name !== undefined) {
      const cleanName = cleanServerName(name);
      if (!cleanName) return null;
      server.name = cleanName;
    }
    if (description !== undefined) server.description = cleanDescription(description);
    if (iconEmojiId !== undefined) server.iconEmojiId = cleanEmojiId(iconEmojiId);
    // Empty string clears the image; a non-empty value must be our own
    // uploaded icon path (set via POST /:id/icon, which saves the file).
    if (iconUrl !== undefined) server.iconUrl = iconUrl === '' ? '' : cleanIconUrl(iconUrl, server.id);
    await this.#queueSave();
    return server;
  }

  async addCustomSound(id, sound) {
    const server = this.get(id);
    if (!server) return null;
    server.customSounds ||= [];
    if (server.customSounds.length >= MAX_CUSTOM_SOUNDS_PER_SERVER) return null;
    const clean = normalizeServerCustomSound(sound, id);
    if (!clean) return null;
    server.customSounds.push(clean);
    await this.#queueSave();
    return clean;
  }

  async removeCustomSound(id, soundId) {
    const server = this.get(id);
    if (!server) return null;
    server.customSounds ||= [];
    const index = server.customSounds.findIndex((s) => s.id === soundId);
    if (index === -1) return null;
    const [removed] = server.customSounds.splice(index, 1);
    await this.#queueSave();
    return removed;
  }

  async addChannel(id, { name, type } = {}, deviceId) {
    const server = this.get(id);
    if (!server) return null;
    if (!this.hasPermission(server, deviceId, 'manage_channels')) return null;
    if (server.channels.length >= MAX_CHANNELS_PER_SERVER) return null;
    const cleanName = cleanChannelName(name);
    if (!cleanName) return null;
    const duplicate = server.channels.some((c) => c.name.toLowerCase() === cleanName.toLowerCase());
    if (duplicate) return null;
    const channel = { id: randomUUID(), name: cleanName, type: cleanChannelType(type), createdAt: this.now() };
    server.channels.push(channel);
    await this.#queueSave();
    return channel;
  }

  async renameChannel(id, channelId, newName, deviceId) {
    const server = this.get(id);
    if (!server || !this.hasPermission(server, deviceId, 'manage_channels')) return null;
    const channel = server.channels.find((c) => c.id === channelId);
    if (!channel) return null;
    const cleanName = cleanChannelName(newName);
    if (!cleanName) return null;
    const duplicate = server.channels.some((c) => c.id !== channelId && c.name.toLowerCase() === cleanName.toLowerCase());
    if (duplicate) return null;
    channel.name = cleanName;
    await this.#queueSave();
    return channel;
  }

  async deleteChannel(id, channelId, deviceId) {
    const server = this.get(id);
    if (!server || !this.hasPermission(server, deviceId, 'manage_channels')) return null;
    const index = server.channels.findIndex((c) => c.id === channelId);
    if (index === -1 || server.channels.length <= 1) return null;
    if (server.channels[index].type === 'text' && server.channels.filter((c) => c.type === 'text').length <= 1) return null;
    const [removed] = server.channels.splice(index, 1);
    await this.#queueSave();
    // A10/H5: drain any pending channel writes BEFORE removing dirs, and
    // install a tombstone so in-flight addMessage cannot resurrect them.
    const key = `${id}/${channelId}`;
    this.#channelTombstones?.add(key);
    const pending = this.#messageChains.get(key);
    if (pending) { try { await pending; } catch { /* ignore */ } }
    await this.#deleteChannelData(id, channelId);
    return removed;
  }

  async deleteServer(id, deviceId) {
    const server = this.get(id);
    if (!server || !this.isOwner(server, deviceId)) return null;
    this.#servers.delete(id);
    // A10/H5: drain pending writes for all channels first, then remove data.
    const keys = [...this.#messageChains.keys()].filter((k) => k.startsWith(`${id}/`));
    for (const k of keys) this.#channelTombstones?.add(k);
    for (const k of keys) { const p = this.#messageChains.get(k); if (p) { try { await p; } catch { /* ignore */ } } }
    // Drop cached channel history so it never leaks across a re-created id.
    for (const key of [...this.#messages.keys()]) {
      if (key.startsWith(`${id}/`)) this.#messages.delete(key);
    }
    for (const key of [...this.#messageChains.keys()]) {
      if (key.startsWith(`${id}/`)) this.#messageChains.delete(key);
    }
    await this.#queueSave();
    // Permanent means permanent until the owner deletes it — then everything goes.
    try { await fs.rm(path.join(this.dataDir, 'server-chats', id), { recursive: true, force: true }); } catch { /* ignore */ }
    try { await fs.rm(path.join(this.uploadsDir ?? path.join(this.dataDir, '..', 'uploads'), `server-${id}`), { recursive: true, force: true }); } catch { /* ignore */ }
    if (this.serverStore) await this.serverStore.deleteServerMessages(id);
    return server;
  }

  async #deleteChannelData(serverId, channelId) {
    if (this.serverStore) await this.serverStore.deleteMessages(serverId, channelId);
    try { await fs.rm(this.#chatDir(serverId, channelId), { recursive: true, force: true }); } catch { /* ignore */ }
    try { await fs.rm(path.join(this.uploadsDir ?? path.join(this.dataDir, '..', 'uploads'), `server-${serverId}`, channelId), { recursive: true, force: true }); } catch { /* ignore */ }
    this.#messages.delete(`${serverId}/${channelId}`);
  }

  /* -------- Server channel chat (independent from room chat) -------- */

  /**
   * C3/H6 fix: loadMessages is single-flight per key — concurrent callers
   * share one read, so first-message writes cannot be lost by last-writer-wins.
   * Load-path attachments/reactions are re-validated like new sends (H6):
   * arbitrary URLs / oversized reactions in tampered files are dropped.
   * Corrupt files are quarantined (A19), not silently reset to [].
   */
  async loadMessages(serverId, channelId) {
    // A12/H7: channel traversal guard — no FS work for invalid ids.
    if (!isValidServerId(serverId) || !isValidChannelId(channelId)) return [];
    const key = `${serverId}/${channelId}`;
    if (this.#messages.has(key)) return this.#messages.get(key);
    if (this.#messageLoads.has(key)) return this.#messageLoads.get(key);
    const load = (async () => {
      let messages = [];
      let data = this.serverStore ? await this.serverStore.loadMessages(serverId, channelId) : null;
      const remoteMissing = Boolean(this.serverStore && data === null);
      if (data === null) {
        let raw;
        try {
          raw = await fs.readFile(this.#chatFile(serverId, channelId), 'utf8');
        } catch (error) {
          if (error?.code === 'ENOENT') {
            this.#messages.set(key, messages);
            return messages;
          }
          throw error;
        }
        try {
          data = JSON.parse(raw);
        } catch {
          const bad = `${this.#chatFile(serverId, channelId)}.corrupt-${this.now()}.json`;
          try { await fs.mkdir(path.dirname(bad), { recursive: true }); await fs.writeFile(bad, raw, 'utf8'); } catch { /* ignore */ }
          this.log?.warn?.(`messages.json corrupt — quarantined to ${bad}`);
          messages = [];
          this.#messages.set(key, messages);
          return messages;
        }
      }
      if (Array.isArray(data)) {
        const server = this.get(serverId);
        messages = data
          .filter((m) => m && typeof m.id === 'string' && typeof m.text === 'string')
          .map((m) => {
            const sourceChannelId = String(m.forwardedFrom?.sourceChannelId ?? '');
            const sourceChannel = server?.channels.find((channel) =>
              channel.id === sourceChannelId && channel.type === 'text');
            const forwardedFrom = m.forwardedFrom && isValidChannelId(sourceChannelId) ? {
              authorName: String(m.forwardedFrom.authorName ?? 'Guest').slice(0, 32),
              channelName: sourceChannel?.name || String(m.forwardedFrom.channelName ?? 'channel').slice(0, 32),
              text: String(m.forwardedFrom.text ?? '').slice(0, 1000),
              attachment: this.#cleanStoredAttachment(
                m.forwardedFrom.attachment, serverId, sourceChannelId
              )
            } : null;
            const replyTo = m.replyTo && typeof m.replyTo === 'object' ? {
              messageId: String(m.replyTo.messageId ?? '').slice(0, 80),
              authorName: String(m.replyTo.authorName ?? 'Guest').slice(0, 32),
              text: String(m.replyTo.text ?? '').slice(0, 240)
            } : null;
            return {
              id: m.id,
              type: 'text',
              text: String(m.text).slice(0, 2000),
              attachment: this.#cleanStoredAttachment(m.attachment, serverId, channelId),
              forwardedFrom,
              replyTo,
              authorId: typeof m.authorId === 'string' ? m.authorId : '',
              authorDeviceId: typeof m.authorDeviceId === 'string' ? m.authorDeviceId : '',
              authorName: typeof m.authorName === 'string' ? String(m.authorName).slice(0, 32) : 'Guest',
              createdAt: Number.isFinite(m.createdAt) ? m.createdAt : this.now(),
              editedAt: Number.isFinite(m.editedAt) ? m.editedAt : undefined,
              reactions: this.#cleanStoredReactions(m.reactions),
              channelId: typeof m.channelId === 'string' ? m.channelId : channelId
            };
          })
          .slice(-MAX_SERVER_MESSAGES);
      } else {
        throw new Error(`Supabase channel history must be an array (${serverId}/${channelId})`);
      }
      if (remoteMissing && messages.length) {
        await this.serverStore.saveMessages(serverId, channelId, messages);
      }
      this.#messages.set(key, messages);
      return messages;
    })();
    this.#messageLoads.set(key, load);
    try {
      return await load;
    } finally {
      if (this.#messageLoads.get(key) === load) this.#messageLoads.delete(key);
    }
  }

  #cleanStoredAttachment(att, serverId, channelId) {
    if (!att || typeof att !== 'object') return null;
    const url = String(att.url ?? '');
    const prefix = `/uploads/server-${serverId}/${channelId}/`;
    if (!url.startsWith(prefix) || url.includes('..') || url.includes('\\')) return null;
    const size = Number(att.size);
    if (!Number.isFinite(size) || size < 0 || size > 8 * 1024 * 1024) return null;
    return {
      url,
      name: String(att.name ?? 'File').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 120) || 'File',
      size,
      mime: String(att.mime ?? 'application/octet-stream').slice(0, 100)
    };
  }

  #cleanStoredReactions(reactions) {
    if (!reactions || typeof reactions !== 'object' || Array.isArray(reactions)) return {};
    const out = {};
    for (const [k, v] of Object.entries(reactions)) {
      const key = String(k).slice(0, 32);
      if (!key || !Array.isArray(v)) continue;
      out[key] = v.filter((x) => typeof x === 'string' && x.length <= 64).slice(0, 50);
      if (!out[key].length) delete out[key];
    }
    return out;
  }

  async addMessage(serverId, channelId, message) {
    if (!isValidServerId(serverId) || !isValidChannelId(channelId)) return null;
    const key = `${serverId}/${channelId}`;
    // H5: never resurrect deleted dirs — drop the write if this key was deleted.
    if (this.#channelTombstones.has(key)) return null;
    // Serialize load+mutate+write under the per-channel chain (C3).
    let result = null;
    await this.#queueChannelWrite(key, async () => {
      if (this.#channelTombstones.has(key)) return;
      const messages = await this.loadMessages(serverId, channelId);
      messages.push(message);
      if (messages.length > MAX_SERVER_MESSAGES) messages.splice(0, messages.length - MAX_SERVER_MESSAGES);
      result = message;
      await this.#writeMessagesFile(serverId, channelId, messages);
    });
    return result;
  }

  #isAuthor(message, authorId) {
    if (!message) return false;
    const a = String(authorId ?? '');
    return message.authorDeviceId === a || message.authorId === a;
  }

  async findMessage(serverId, channelId, messageId) {
    if (!isValidServerId(serverId) || !isValidChannelId(channelId)
      || typeof messageId !== 'string' || !messageId) return null;
    const message = (await this.loadMessages(serverId, channelId))
      .find((item) => item.id === messageId);
    return message || null;
  }

  publicMessage(message, viewerDeviceId) {
    const { authorId, authorDeviceId, reactions = {}, ...publicMessage } = message;
    const publicReactions = Object.fromEntries(
      Object.entries(reactions).map(([emoji, deviceIds]) => [
        emoji,
        deviceIds.map((deviceId) => this.memberIdFor(deviceId)).filter(Boolean)
      ]).filter(([, memberIds]) => memberIds.length)
    );
    return {
      ...publicMessage,
      isOwn: Boolean(viewerDeviceId && authorDeviceId === viewerDeviceId),
      reactions: publicReactions
    };
  }

  async editMessage(serverId, channelId, messageId, authorId, text) {
    if (!isValidServerId(serverId) || !isValidChannelId(channelId)) return null;
    const key = `${serverId}/${channelId}`;
    if (this.#channelTombstones.has(key)) return null;
    let result = null;
    await this.#queueChannelWrite(key, async () => {
      if (this.#channelTombstones.has(key)) return;
      const messages = await this.loadMessages(serverId, channelId);
      const message = messages.find((m) => m.id === messageId);
      if (!this.#isAuthor(message, authorId)) return;
      message.text = text;
      message.editedAt = this.now();
      result = message;
      await this.#writeMessagesFile(serverId, channelId, messages);
    });
    return result;
  }

  async deleteMessage(serverId, channelId, messageId, authorId) {
    if (!isValidServerId(serverId) || !isValidChannelId(channelId)) return false;
    const key = `${serverId}/${channelId}`;
    if (this.#channelTombstones.has(key)) return false;
    let ok = false;
    await this.#queueChannelWrite(key, async () => {
      if (this.#channelTombstones.has(key)) return;
      const messages = await this.loadMessages(serverId, channelId);
      const index = messages.findIndex((m) => m.id === messageId);
      if (index === -1 || !this.#isAuthor(messages[index], authorId)) return;
      messages.splice(index, 1);
      ok = true;
      await this.#writeMessagesFile(serverId, channelId, messages);
    });
    return ok;
  }

  async deleteMessageAsAdmin(serverId, channelId, messageId) {
    if (!isValidServerId(serverId) || !isValidChannelId(channelId)) return false;
    const key = `${serverId}/${channelId}`;
    if (this.#channelTombstones.has(key)) return false;
    let ok = false;
    await this.#queueChannelWrite(key, async () => {
      if (this.#channelTombstones.has(key)) return;
      const messages = await this.loadMessages(serverId, channelId);
      const index = messages.findIndex((m) => m.id === messageId);
      if (index === -1) return;
      messages.splice(index, 1);
      ok = true;
      await this.#writeMessagesFile(serverId, channelId, messages);
    });
    return ok;
  }

  async toggleReaction(serverId, channelId, messageId, emoji, participantId) {
    if (!isValidServerId(serverId) || !isValidChannelId(channelId)) return null;
    const key = `${serverId}/${channelId}`;
    if (this.#channelTombstones.has(key)) return null;
    let result = null;
    await this.#queueChannelWrite(key, async () => {
      if (this.#channelTombstones.has(key)) return;
      const messages = await this.loadMessages(serverId, channelId);
      const message = messages.find((m) => m.id === messageId);
      if (!message) return;
      message.reactions ||= {};
      const ids = new Set(message.reactions[emoji] || []);
      if (ids.has(participantId)) ids.delete(participantId);
      else if (ids.size < 50) ids.add(participantId);
      if (ids.size) message.reactions[emoji] = [...ids];
      else delete message.reactions[emoji];
      result = message.reactions;
      await this.#writeMessagesFile(serverId, channelId, messages);
    });
    return result;
  }
}
