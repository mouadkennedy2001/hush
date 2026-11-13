// Servers — a system SEPARATE from standalone rooms.
// Permanent server + saved channel chat; invite link (/s/<id>?invite=CODE).

import { emojiUrl } from './emoji.js';

const DEVICE_KEY = 'hush:device';

export function getDeviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id || !/^[a-zA-Z0-9-]{8,64}$/.test(id)) {
      id = window.crypto?.randomUUID?.() || `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

export async function fetchServers() {
  const deviceId = getDeviceId();
  const res = await fetch(`/api/servers?deviceId=${encodeURIComponent(deviceId)}`, { cache: 'no-store' });
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({}));
  return Array.isArray(data.servers) ? data.servers : [];
}

export async function createServer({ name, iconEmojiId, ownerName }) {
  const res = await fetch('/api/servers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, iconEmojiId, ownerName: ownerName || 'Guest', ownerDeviceId: getDeviceId() })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'create-failed');
  // A1: persist the opaque session token issued for this server.
  try {
    if (data.sessionToken && data.server?.id) {
      sessionStorage.setItem(`hush:session:${data.server.id}`, data.sessionToken);
    }
  } catch { /* ignore */ }
  return data.server;
}

export async function lookupInvite(code) {
  const res = await fetch(`/api/servers/invite/${encodeURIComponent(code)}`, { cache: 'no-store' });
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  return data.server || null;
}

export function serverIconUrl(server) {
  // A custom uploaded image wins over the emoji icon.
  if (server?.iconUrl && typeof server.iconUrl === 'string' && server.iconUrl.startsWith('/uploads/') && !server.iconUrl.includes('..')) {
    return server.iconUrl;
  }
  return emojiUrl(server?.iconEmojiId || 'star');
}

export async function uploadServerIcon(serverId, file, deviceId) {
  const form = new FormData();
  form.append('file', file);
  const token = (() => { try { return sessionStorage.getItem(`hush:session:${serverId}`) || ''; } catch { return ''; } })();
  const res = await fetch(`/api/servers/${encodeURIComponent(serverId)}/icon?deviceId=${encodeURIComponent(deviceId || getDeviceId())}`, {
    method: 'POST', body: form, headers: token ? { 'X-Session-Token': token } : {}
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'icon-failed');
  return data.server;
}

export function firstTextChannel(server) {
  return server?.channels?.find((c) => c.type === 'text') || server?.channels?.[0] || null;
}

export function serverUrl(server) {
  return `/s/${server.id}`;
}

export function inviteUrl(server) {
  return `${window.location.origin}/s/${server.id}?invite=${server.inviteCode || ''}`;
}
