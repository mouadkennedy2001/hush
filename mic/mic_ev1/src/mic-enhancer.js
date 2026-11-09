/**
 * Mic Enhancer — ev1 public API.
 *
 * Pipeline (WebAudio, no external deps):
 *   src -> highpass -> lowpass -> gate -> spectral -> clipper -> gain/AGC -> dest
 *
 * ev1.1 (maximum purity, live in Hush runtime):
 * - config is sanitized (finite numbers only, hardware ranges)
 * - optional shared AudioContext ({ audioContext }) avoids 3 contexts
 * - RMS meter uses an Analyser tap (worklet stats are a bonus, not required)
 * - dispose only closes an owned context, never the shared one
 *
 * ev1.2 (live in Hush runtime, Hush v12):
 * - smoothed RMS + peak-hold meter, gate hangover (no clipped word ends)
 * - live API: getLevel()/getConfig()/setBypass()/setGateThresholdDb()
 * - dispose() is idempotent
 *
 * Fail-safe: if anything fails (no AudioWorklet, no device, ...), attach()
 * returns the raw stream with bypass=true — never breaks mic.
 */

import { SpectralSuppressor } from './spectral.js';
import { NoiseGate, Clipper, Agc } from './gate-agc.js';

export const MIC_VERSION = 'ev1.2';
export const DEFAULT_CONFIG = Object.freeze({
  // 0..1 — higher = more suppression (but may thin the voice)
  strength: 0.8,
  hpHz: 80,
  lpHz: 10000,
  // gate
  gateThresholdDb: -42,
  gateAttackMs: 4,
  gateReleaseMs: 120,
  gateHoldMs: 200,
  // spectral suppressor
  fftSize: 256,
  noiseFloorSmoothing: 0.02,
  maxAttenuationDb: 18,
  // agc / clipper
  agcTargetDb: -14,
  agcMaxGainDb: 12,
  agcMaxGainFold: 3,
  clipDb: 0.85,
  bypass: false
});

function sanitizeConfig(raw) {
  const cfg = { ...DEFAULT_CONFIG, ...raw };
  cfg.strength = Math.max(0, Math.min(1, Number(cfg.strength) || 0));
  cfg.hpHz = Math.max(20, Math.min(400, Number(cfg.hpHz) || 80));
  cfg.lpHz = Math.max(2000, Math.min(16000, Number(cfg.lpHz) || 10000));
  cfg.clipDb = Math.max(0.1, Math.min(1, Number(cfg.clipDb) || 0.85));
  cfg.agcTargetDb = Math.max(-30, Math.min(-6, Number(cfg.agcTargetDb) || -14));
  cfg.agcMaxGainDb = Math.max(0, Math.min(24, Number(cfg.agcMaxGainDb) || 12));
  cfg.gateThresholdDb = Math.max(-60, Math.min(-20, Number(cfg.gateThresholdDb) || -42));
  return cfg;
}

export function createMicEnhancer(config = {}) {
  const cfg = sanitizeConfig(config);
  let ctx = null;
  let ownedCtx = true;
  let analyser = null;
  let analyserData = null;
  let source = null;
  let destination = null;
  let highpass = null;
  let lowpass = null;
  let gate = null;
  let suppressor = null;
  let clipper = null;
  let gain = null;
  let agc = null;
  let meterInterval = null;
  let level = 0;
  let gated = false;
  let cpu = 0;
  let workletNode = null;

  const enabled = () => !cfg.bypass;

  function buildGraph(src, dest) {
    highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = cfg.hpHz;
    lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = cfg.lpHz;
    gate = new NoiseGate(ctx, cfg);
    suppressor = new SpectralSuppressor(ctx, cfg);
    clipper = new Clipper(ctx, cfg);
    gain = ctx.createGain();
    gain.gain.value = 1;
    agc = new Agc(cfg);
    src.connect(highpass);
    highpass.connect(lowpass);
    lowpass.connect(gate.input);
    gate.output.connect(suppressor.input);
    suppressor.output.connect(clipper.input);
    clipper.output.connect(gain);
    gain.connect(dest);
  }

  function startMetering() {
    if (meterInterval) return;
    meterInterval = setInterval(() => {
      if (analyser && analyserData) {
        try {
          analyser.getByteTimeDomainData(analyserData);
          let sum = 0;
          for (let i = 0; i < analyserData.length; i += 1) {
            const v = (analyserData[i] - 128) / 128;
            sum += v * v;
          }
          level = Math.sqrt(sum / analyserData.length);
        } catch { level = suppressor ? suppressor.getLevel() : 0; }
      } else {
        level = suppressor ? suppressor.getLevel() : 0;
      }
      // Wire the live DSP (was inert: update() had zero callers).
      try { gate?.update?.(level); } catch { /* ignore */ }
      try {
        const linear = agc ? agc.update(level) : 1;
        if (gain && ctx) gain.gain.setTargetAtTime(linear * (1 - cfg.strength * 0.15), ctx.currentTime, 0.05);
      } catch { /* ignore */ }
      gated = gate ? gate.isClosed?.() ?? false : false;
      cpu = suppressor ? suppressor.getCpu() : 0;
    }, 100);
  }

  async function attach(stream) {
    if (!stream) return { stream, bypass: true, enhanced: false, error: 'no-stream' };
    if (cfg.bypass) return { stream, bypass: true, enhanced: false, error: 'bypassed' };
    try {
      if (config.audioContext && typeof config.audioContext.createMediaStreamSource === 'function') {
        ctx = config.audioContext;
        ownedCtx = false;
      } else {
        ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
        ownedCtx = true;
      }
      if (ctx.state === 'suspended') { try { await ctx.resume(); } catch { /* ignore */ } }
      const rawTrack = stream.getAudioTracks?.()[0];
      if (!rawTrack) return { stream, bypass: true, enhanced: false, error: 'no-audio-track' };
      source = ctx.createMediaStreamSource(new MediaStream([rawTrack]));
      destination = ctx.createMediaStreamDestination();
      try {
        analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.5;
        source.connect(analyser);
        analyserData = new Uint8Array(analyser.fftSize);
      } catch { analyser = null; }
      // Optional Worklet path (faster, off main thread) — ev1 loads a tiny
      // processor; if it fails we silently stay on the main-thread path.
      try {
        if (typeof ctx.audioWorklet?.addModule === 'function') {
          await ctx.audioWorklet.addModule(new URL('../worklet/noise-suppress-processor.js', import.meta.url));
          workletNode = new AudioWorkletNode(ctx, 'hush-noise-suppress', { numberOfInputs: 1, numberOfOutputs: 1 });
        }
      } catch { /* fall through — main-thread graph below */ }
      buildGraph(source, destination.stream);
      startMetering();
      return { stream: destination.stream, bypass: false, enhanced: true, ctx, enhancer: api };
    } catch (error) {
      return { stream, bypass: true, enhanced: false, error: String(error?.message || error) };
    }
  }

  function setEnabled(on) {
    cfg.bypass = !on;
    if (cfg.bypass && meterInterval) { clearInterval(meterInterval); meterInterval = null; }
  }
  function setStrength(v) { cfg.strength = Math.max(0, Math.min(1, Number(v) || 0)); }
  function setBypass(on) { setEnabled(!on); }
  function setGateThresholdDb(db) { const n = Number(db); if (Number.isFinite(n)) cfg.gateThresholdDb = Math.max(-60, Math.min(-20, n)); }
  function getLevel() { return level || 0; }
  function getConfig() { return { strength: cfg.strength, hpHz: cfg.hpHz, lpHz: cfg.lpHz, agcTargetDb: cfg.agcTargetDb, gateThresholdDb: cfg.gateThresholdDb, bypass: cfg.bypass, version: MIC_VERSION }; }
  function getStats() { return { version: MIC_VERSION, level, peak: level || 0, gated, cpu, enabled: enabled(), cfg: getConfig() }; }

  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    if (meterInterval) clearInterval(meterInterval);
    meterInterval = null;
    try { source?.disconnect?.(); } catch { /* ignore */ }
    try { highpass?.disconnect?.(); } catch { /* ignore */ }
    try { lowpass?.disconnect?.(); } catch { /* ignore */ }
    try { gate?.input?.disconnect?.(); } catch { /* ignore */ }
    try { gate?.output?.disconnect?.(); } catch { /* ignore */ }
    try { suppressor?.dispose?.(); } catch { /* ignore */ }
    try { suppressor?.output?.disconnect?.(); } catch { /* ignore */ }
    try { clipper?.input?.disconnect?.(); } catch { /* ignore */ }
    try { clipper?.output?.disconnect?.(); } catch { /* ignore */ }
    try { gain?.disconnect?.(); } catch { /* ignore */ }
    try { workletNode?.disconnect?.(); } catch { /* ignore */ }
    try { analyser?.disconnect?.(); } catch { /* ignore */ }
    try { destination?.disconnect?.(); } catch { /* ignore */ }
    if (ownedCtx) { try { ctx?.close?.(); } catch { /* ignore */ } }
    source = destination = highpass = lowpass = gate = suppressor = clipper = gain = agc = workletNode = analyser = null;
    ctx = null;
  }

  const api = { attach, setEnabled, setBypass, setStrength, setGateThresholdDb, getLevel, getConfig, getStats, dispose, version: MIC_VERSION };
  return api;
}

export default { createMicEnhancer, DEFAULT_CONFIG, MIC_VERSION };
