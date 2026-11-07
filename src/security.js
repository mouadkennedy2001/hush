import { createHash, randomUUID } from 'node:crypto';

/**
 * Security + anti-spam helpers.
 * - Device fingerprint hashing (never store raw device ids in the clear beyond hashing)
 * - Message spam scoring (duplicate, flood, repeated chars, emoji/link flood)
 * - Sanitization of bidi / zero-width tricks
 */

export function hashValue(value, salt = 'hush') {
  return createHash('sha256').update(`${salt}:${String(value ?? '')}`).digest('hex').slice(0, 32);
}

export function newDeviceId() {
  return randomUUID();
}

export function cleanDeviceId(value) {
  const raw = String(value ?? '').trim();
  if (!/^[a-zA-Z0-9-]{8,64}$/.test(raw)) return null;
  return raw;
}

const BIDI_RE = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

export function stripInvisible(value) {
  return String(value ?? '').replace(BIDI_RE, '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

/**
 * Score a message for spam. Returns { ok, reason, score }
 * score 0 = clean. Higher = more spammy. >=3 should be rejected/muted.
 */
export function spamScore(text, history = []) {
  const clean = stripInvisible(text).trim();
  if (!clean) return { ok: false, reason: 'empty', score: 0 };
  let score = 0;
  const reasons = [];

  // Repeated same character run: aaaaaaaa
  if (/(.)\1{7,}/.test(clean)) { score += 3; reasons.push('repeat-chars'); }

  // Emoji flood
  const emojiCount = (clean.match(/\p{Extended_Pictographic}/gu) || []).length;
  if (emojiCount > 10) { score += 2; reasons.push('emoji-flood'); }
  else if (emojiCount > 6 && clean.length < emojiCount * 3) { score += 1; reasons.push('emoji-heavy'); }

  // Link flood
  const links = clean.match(/https?:\/\/\S+/gi) || [];
  if (links.length > 3) { score += 3; reasons.push('link-flood'); }
  else if (links.length > 1 && clean.length < 60) { score += 1; reasons.push('link-heavy'); }

  // Duplicate of recent message (same normalized text within history)
  const normalized = clean.toLowerCase().replace(/\s+/g, ' ');
  const now = Date.now();
  const dup = history.some((h) => h.text === normalized && now - h.at < 15000);
  if (dup) { score += 3; reasons.push('duplicate'); }

  // ALL CAPS shouting (latin only, length > 20, >80% caps)
  const letters = clean.replace(/[^A-Za-z]/g, '');
  if (letters.length > 20) {
    const caps = letters.replace(/[^A-Z]/g, '').length;
    if (caps / letters.length > 0.85) { score += 1; reasons.push('caps'); }
  }

  // Very short repeated filler
  if (clean.length <= 2 && history.length && history[history.length - 1]?.text === normalized) {
    score += 1; reasons.push('filler-repeat');
  }

  return { ok: score < 3, reason: reasons.join('+') || null, score, reasons };
}

export function isBanned(bannedList, { deviceHash, ipHash }) {
  const now = Date.now();
  return (bannedList || []).find((b) =>
    (deviceHash && b.deviceHash === deviceHash) || (ipHash && b.ipHash === ipHash)
  ) && ((bannedList || []).find((b) => (deviceHash && b.deviceHash === deviceHash) || (ipHash && b.ipHash === ipHash))?.until ?? Infinity) > now;
}

export function activeBans(bannedList) {
  const now = Date.now();
  return (bannedList || []).filter((b) => (b.until ?? Infinity) > now);
}
