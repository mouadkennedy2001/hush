/**
 * Mic settings sanitizer — security boundary for mic_ev1.
 *
 * localStorage and user input are untrusted: every numeric field is
 * clamped to the documented range, deviceId is shape-checked (it is
 * passed to getUserMedia as { exact } — an attacker-controlled string
 * must never reach it), and enums are whitelisted.
 *
 * mic_ev1 (public/js/room/mic-fx.js + mic-enhancer.js) uses this for
 * loadMicSettings(), constructor settings, and hot updates.
 */

export const MIC_SETTINGS_RANGES = Object.freeze({
  gateThresholdDb: [-60, -20],
  amplificationDb: [0, 24],
  deDistort: [0, 100],
  enhanceStrength: [0, 1]
});

const QUALITIES = new Set(['auto', 'performance', 'quality']);
const PRESETS = new Set(['off', 'voice', 'podcast', 'gaming', 'quiet']);
const DEVICE_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function sanitizeMicSettings(raw = {}, fallback = {}) {
  const base = { ...fallback };
  if (!raw || typeof raw !== 'object') return base;
  const out = { ...base };

  if ('enabled' in raw) out.enabled = raw.enabled === true;
  if ('echoCancellation' in raw) out.echoCancellation = raw.echoCancellation === true;
  if ('noiseSuppression' in raw) out.noiseSuppression = raw.noiseSuppression === true;
  if ('autoGainControl' in raw) out.autoGainControl = raw.autoGainControl === true;
  if ('gate' in raw) out.gate = raw.gate === true;
  if ('monitor' in raw) out.monitor = raw.monitor === true;
  if ('enhance' in raw) out.enhance = raw.enhance === true;

  if ('gateThresholdDb' in raw) out.gateThresholdDb = clampNumber(raw.gateThresholdDb, -60, -20, base.gateThresholdDb ?? -42);
  if ('amplificationDb' in raw) out.amplificationDb = clampNumber(raw.amplificationDb, 0, 24, base.amplificationDb ?? 6);
  if ('deDistort' in raw) out.deDistort = clampNumber(raw.deDistort, 0, 100, base.deDistort ?? 25);
  if ('enhanceStrength' in raw) out.enhanceStrength = clampNumber(raw.enhanceStrength, 0, 1, base.enhanceStrength ?? 0.8);

  if ('quality' in raw) out.quality = QUALITIES.has(raw.quality) ? raw.quality : (base.quality ?? 'auto');
  if ('preset' in raw) out.preset = PRESETS.has(raw.preset) ? raw.preset : (base.preset ?? 'voice');
  if ('micVersion' in raw) out.micVersion = raw.micVersion === 'ev1' ? 'ev1' : (base.micVersion ?? 'ev1');

  // deviceId goes into getUserMedia as { exact } — shape-check strictly.
  if ('deviceId' in raw) {
    const id = String(raw.deviceId ?? '').trim();
    out.deviceId = DEVICE_ID_RE.test(id) ? id : '';
  }

  return out;
}

export default { sanitizeMicSettings, MIC_SETTINGS_RANGES };
