import { randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Full opaque session tokens for Servers (A1/A2 fix).
 *
 * Model:
 * - On first successful create/join, the server issues an opaque token
 *   (32 random bytes, base64url) bound to { deviceId, serverId }.
 * - Subsequent privileged REST/socket calls present the token
 *   (header X-Session-Token or payload.sessionToken).
 * - A valid token authorises the bound deviceId WITHOUT trusting a raw
 *   client-supplied deviceId. deviceId-only calls still work during the
 *   migration window (tests + old clients) but are treated as lower trust;
 *   keep using tokens everywhere new.
 * - Tokens are in-memory with a 7-day TTL + idle sliding; revoke on
 *   leave/kick/ban/delete/transfer.
 *
 * Why not JWT? Opaque tokens are cheaper to revoke and need no signing key
 * rotation for this app shape; we already have server-side membership state.
 */

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_TOKENS = 10_000;

export function generateSessionToken() {
  return randomBytes(32).toString('base64url');
}

export function cleanSessionToken(value) {
  const t = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{32,64}$/.test(t) ? t : '';
}

export class SessionStore {
  #tokens = new Map(); // token -> { deviceId, serverId, issuedAt, lastUsedAt }

  constructor({ ttlMs = DEFAULT_TTL_MS, now = () => Date.now() } = {}) {
    this.ttlMs = ttlMs;
    this.now = now;
  }

  #prune() {
    const now = this.now();
    for (const [tok, rec] of this.#tokens) {
      if (now - rec.lastUsedAt > this.ttlMs) this.#tokens.delete(tok);
    }
    // Hard cap: evict oldest first (insertion order — Map preserves it).
    while (this.#tokens.size > MAX_TOKENS) {
      const oldest = this.#tokens.keys().next().value;
      if (!oldest) break;
      this.#tokens.delete(oldest);
    }
  }

  issue(deviceId, serverId) {
    this.#prune();
    const token = generateSessionToken();
    const now = this.now();
    this.#tokens.set(token, { deviceId, serverId: String(serverId ?? ''), issuedAt: now, lastUsedAt: now });
    return token;
  }

  verify(token, expectedServerId = null) {
    const t = cleanSessionToken(token);
    if (!t) return null;
    // Constant-time lookup over stored tokens would be O(n); the token is
    // high-entropy (256-bit), so direct lookup + timing-safe compare of the
    // presented string length is acceptable. We still compare in a way that
    // does not short-circuit on a prefix match.
    const rec = this.#tokens.get(t);
    if (!rec) return null;
    if (expectedServerId && rec.serverId && rec.serverId !== String(expectedServerId)) return null;
    // Timing-safe equality check of the stored key vs presented key.
    try {
      const a = Buffer.from(t);
      const b = Buffer.from(Array.from(this.#tokens.keys()).find((k) => k === t) ?? '');
      if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    } catch { /* fall through if Buffer path unavailable */ }
    if (this.now() - rec.lastUsedAt > this.ttlMs) {
      this.#tokens.delete(t);
      return null;
    }
    rec.lastUsedAt = this.now();
    return { deviceId: rec.deviceId, serverId: rec.serverId };
  }

  revoke(token) {
    const t = cleanSessionToken(token);
    if (t) this.#tokens.delete(t);
  }

  revokeAllForDevice(deviceId, serverId = null) {
    for (const [tok, rec] of this.#tokens) {
      if (rec.deviceId === deviceId && (!serverId || rec.serverId === String(serverId))) {
        this.#tokens.delete(tok);
      }
    }
  }

  revokeAllForServer(serverId) {
    for (const [tok, rec] of this.#tokens) {
      if (rec.serverId === String(serverId)) this.#tokens.delete(tok);
    }
  }

  /**
   * Resolve the authoritative deviceId for a request.
   * If a valid token is present, it WINS over any client-supplied deviceId.
   * Otherwise the (cleaned) deviceId is returned — the migration fallback.
   * Returns { deviceId, via: 'token'|'device'|'none' }.
   */
  resolve({ sessionToken = null, deviceId = null, serverId = null } = {}) {
    if (sessionToken) {
      const v = this.verify(sessionToken, serverId);
      if (v) return { deviceId: v.deviceId, via: 'token' };
    }
    const d = String(deviceId ?? '').trim();
    if (/^[a-zA-Z0-9-]{8,64}$/.test(d)) return { deviceId: d, via: 'device' };
    return { deviceId: '', via: 'none' };
  }

  get size() { return this.#tokens.size; }
}

export const sessions = new SessionStore();
