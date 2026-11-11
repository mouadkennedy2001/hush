/**
 * Mic Enhancer (browser runtime) — mic_ev2.0 (live).
 * Canonical implementation lives in `mic/mic_ev2/` at the repo root; this
 * self-contained copy is what the browser actually loads
 * (public/js/room/media.js → ./mic-enhancer.js) because the server does not
 * serve /mic at runtime. Keep the two in sync when bumping mic versions.
 * No external dependencies; AudioWorklet with a full main-thread fallback.
 *
 * ev2 is a real quality jump over ev1:
 * - the AudioWorklet is now IN the signal chain (ev1 connected it as a muted
 *   tap, so spectral suppression never reached the call)
 * - 512-point STFT suppressor: adaptive per-bin noise floor, spectral
 *   subtraction + Wiener blend, 3-tap frequency smoothing, attack/release
 *   smoothing and a gain floor against musical noise (see ./mic-dsp.js)
 * - one shared AudioContext with MicFx/MediaMesh when the caller passes one
 * - post-suppression analyser → smarter gate + AGC, limiter after gain
 * - fail-safe: if the worklet or its module fails, the same graph runs with
 *   EQ + gate + limiter (never a broken/quiet mic)
 * - live API: setStrength / setBypass / setGateThresholdDb without a rebuild
 */

import { MIC_DSP_VERSION } from './mic-dsp.js';

export const MIC_VERSION = 'ev2.0';
export const DEFAULT_CONFIG = Object.freeze({
  // 0..1 — higher = more suppression (but may thin the voice)
  strength: 0.85,
  hpHz: 80,
  lpHz: 10000,
  // gate
  gate: true,
  gateThresholdDb: -42,
  gateAttackMs: 4,
  gateReleaseMs: 120,
  gateHoldMs: 220,
  // STFT suppressor
  fftSize: 512,
  hopSize: 128,
  maxAttenuationDb: 30,
  // agc / clipper / limiter
  agcTargetDb: -14,
  agcMaxGainDb: 12,
  agcMaxGainFold: 3,
  clipDb: 0.85,
  bypass: false,
  mode: 'voice'
});

const MODES = new Set(['voice', 'music', 'strong']);

function sanitizeConfig(raw = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...raw };
  cfg.strength = Math.max(0, Math.min(1, Number(cfg.strength) || 0));
  cfg.hpHz = Math.max(20, Math.min(400, Number(cfg.hpHz) || 80));
  cfg.lpHz = Math.max(2000, Math.min(16000, Number(cfg.lpHz) || 10000));
  cfg.clipDb = Math.max(0.1, Math.min(1, Number(cfg.clipDb) || 0.85));
  cfg.agcTargetDb = Math.max(-30, Math.min(-6, Number(cfg.agcTargetDb) || -14));
  cfg.agcMaxGainDb = Math.max(0, Math.min(24, Number(cfg.agcMaxGainDb) || 12));
  cfg.gateThresholdDb = Math.max(-60, Math.min(-20, Number(cfg.gateThresholdDb) || -42));
  cfg.gate = cfg.gate !== false;
  cfg.fftSize = [256, 512, 1024].includes(Number(cfg.fftSize)) ? Number(cfg.fftSize) : 512;
  cfg.mode = MODES.has(cfg.mode) ? cfg.mode : 'voice';
  cfg.bypass = cfg.bypass === true;
  return cfg;
}

export function createMicEnhancer(config = {}) {
  const cfg = sanitizeConfig(config);
  let ctx = null;
  let ownedCtx = true;
  let source = null;
  let dest = null;
  let highpass = null;
  let lowpass = null;
  let gateIn = null;
  let gateGain = null;
  let shaper = null;
  let gain = null;
  let limiter = null;
  let workletNode = null;
  let analyser = null;
  let analyserData = null;
  let timer = null;
  let disposed = false;
  let lastOpenAt = 0;
  let smoothedLevel = 0;
  const levels = { level: 0, peak: 0, gated: false, cpu: 0, reductionDb: 0, noise: 0 };

  const enabled = () => !cfg.bypass;

  function buildFallbackChain() {
    // No worklet: still give the call EQ + gate + soft clip + AGC + limiter.
    // Never leave the user with a raw or silent mic.
    highpass.connect(lowpass);
  }

  function startMetering() {
    if (timer) return;
    timer = setInterval(() => {
      const tickStart = performance.now();
      // Analyser is tapped after the suppressor, so the gate reacts to what
      // the other side will actually hear (not to the raw fan noise).
      let level = levels.level || 0;
      if (analyser && analyserData) {
        try {
          analyser.getByteTimeDomainData(analyserData);
          let sum = 0;
          for (let i = 0; i < analyserData.length; i += 1) {
            const v = (analyserData[i] - 128) / 128;
            sum += v * v;
          }
          level = Math.sqrt(sum / analyserData.length);
        } catch { /* keep previous */ }
      }
      levels.peak = Math.max(level, (levels.peak || 0) * 0.92);
      smoothedLevel = smoothedLevel * 0.7 + level * 0.3;
      levels.level = smoothedLevel;
      level = smoothedLevel;
      const curDb = level <= 0 ? -80 : 20 * Math.log10(level);

      // AGC: only lift quiet voices, never push loud ones further up.
      const need = Math.max(0, Math.min(cfg.agcMaxGainDb, cfg.agcTargetDb - curDb));
      const agcGain = Math.min(cfg.agcMaxGainFold, Math.pow(10, need / 20));
      try { gain.gain.setTargetAtTime(agcGain, ctx.currentTime, 0.05); } catch { /* ignore */ }

      // Gate with hangover: closing only after gateHoldMs of silence keeps
      // word endings intact. The gate opens fast so first syllables survive.
      const now = performance.now();
      if (!cfg.gate) {
        if (levels.gated) {
          levels.gated = false;
          try { gateGain.gain.setTargetAtTime(1, ctx.currentTime, 0.01); } catch { /* ignore */ }
        }
      } else if (curDb > cfg.gateThresholdDb) {
        lastOpenAt = now;
        if (levels.gated) {
          levels.gated = false;
          try { gateGain.gain.setTargetAtTime(1, ctx.currentTime, 0.004); } catch { /* ignore */ }
        }
      } else if (!levels.gated && now - lastOpenAt > cfg.gateHoldMs) {
        levels.gated = true;
        try { gateGain.gain.setTargetAtTime(0, ctx.currentTime, 0.03); } catch { /* ignore */ }
      }

      levels.cpu = levels.cpu * 0.8 + (performance.now() - tickStart) * 0.2;
    }, 100);
  }

  async function attach(stream) {
    if (!stream) return { stream, bypass: true, enhanced: false, error: 'no-stream' };
    const rawTrack = stream.getAudioTracks?.()[0];
    if (!rawTrack) return { stream, bypass: true, enhanced: false, error: 'no-audio-track' };
    if (cfg.bypass) return { stream, bypass: true, enhanced: false, error: 'bypassed' };
    try {
      // One shared AudioContext with MicFx/MediaMesh when possible: three
      // contexts cost ~3x CPU and add latency.
      if (config.audioContext && typeof config.audioContext.createMediaStreamSource === 'function') {
        ctx = config.audioContext;
        ownedCtx = false;
      } else {
        ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
        ownedCtx = true;
      }
      if (ctx.state === 'suspended') { try { await ctx.resume(); } catch { /* ignore */ } }

      source = ctx.createMediaStreamSource(new MediaStream([rawTrack]));
      dest = ctx.createMediaStreamDestination();
      highpass = ctx.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = cfg.hpHz;
      highpass.Q.value = 0.7;
      lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = cfg.lpHz;
      lowpass.Q.value = 0.7;

      // Optional STFT stage (the quality jump). If it fails for any reason we
      // still build the fallback chain below.
      try {
        if (typeof ctx.audioWorklet?.addModule === 'function') {
          const modUrl = new URL('./noise-suppress-processor.js', import.meta.url);
          await ctx.audioWorklet.addModule(modUrl);
          workletNode = new AudioWorkletNode(ctx, 'hush-noise-suppress', {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            channelCount: 1,
            channelCountMode: 'explicit',
            channelInterpretation: 'speakers',
            processorOptions: {
              sampleRate: ctx.sampleRate,
              fftSize: cfg.fftSize,
              hopSize: cfg.hopSize,
              strength: cfg.strength,
              enabled: true
            }
          });
          workletNode.port.onmessage = (event) => {
            const data = event?.data;
            if (!data || data.type !== 'stats') return;
            levels.reductionDb = Number(data.reductionDb) || 0;
            levels.noise = Number(data.noise) || 0;
            levels.cpu = Number(data.cpu) || levels.cpu;
          };
        }
      } catch { workletNode = null; }

      gateIn = ctx.createGain();
      gateGain = ctx.createGain();
      gateGain.gain.value = 1;
      shaper = ctx.createWaveShaper();
      const curve = new Float32Array(256);
      const lim = cfg.clipDb ?? 0.85;
      for (let i = 0; i < 256; i += 1) {
        const x = (i / 128) - 1;
        curve[i] = Math.tanh(lim * x) / Math.tanh(lim);
      }
      shaper.curve = curve;
      shaper.oversample = '2x';
      gain = ctx.createGain();
      gain.gain.value = 1;
      limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -3;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.12;

      source.connect(highpass);
      if (workletNode) {
        highpass.connect(workletNode);
        workletNode.connect(lowpass);
      } else {
        buildFallbackChain();
      }
      lowpass.connect(gateIn);
      gateIn.connect(gateGain);
      gateGain.connect(shaper);
      shaper.connect(gain);
      gain.connect(limiter);
      limiter.connect(dest);

      // Analyser tap for the meter/gate — stats only, never to destination.
      try {
        analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.5;
        lowpass.connect(analyser);
        analyserData = new Uint8Array(analyser.fftSize);
      } catch { analyser = null; }

      startMetering();
      return {
        stream: dest.stream,
        bypass: false,
        enhanced: true,
        ctx,
        worklet: Boolean(workletNode),
        version: MIC_VERSION,
        dspVersion: MIC_DSP_VERSION
      };
    } catch (error) {
      return { stream, bypass: true, enhanced: false, error: String(error?.message || error) };
    }
  }

  function setEnabled(on) {
    cfg.bypass = !on;
    try { workletNode?.port?.postMessage({ type: 'set', enabled: !cfg.bypass }); } catch { /* ignore */ }
    if (cfg.bypass && gateGain && ctx) {
      try { gateGain.gain.setTargetAtTime(1, ctx.currentTime, 0.01); } catch { /* ignore */ }
    }
    if (!cfg.bypass) startMetering();
  }

  function setBypass(on) { setEnabled(!on); }
  function setGateThresholdDb(db) {
    const n = Number(db);
    if (Number.isFinite(n)) cfg.gateThresholdDb = Math.max(-60, Math.min(-20, n));
  }
  function setGate(on) {
    cfg.gate = on !== false;
    if (!cfg.gate && gateGain && ctx) {
      levels.gated = false;
      try { gateGain.gain.setTargetAtTime(1, ctx.currentTime, 0.01); } catch { /* ignore */ }
    }
  }
  function setStrength(value) {
    cfg.strength = Math.max(0, Math.min(1, Number(value) || 0));
    try { workletNode?.port?.postMessage({ type: 'set', strength: cfg.strength }); } catch { /* ignore */ }
  }
  function setMode(mode) {
    if (MODES.has(mode)) cfg.mode = mode;
  }
  function getLevel() { return levels.level || 0; }
  function getConfig() {
    return {
      strength: cfg.strength,
      hpHz: cfg.hpHz,
      lpHz: cfg.lpHz,
      agcTargetDb: cfg.agcTargetDb,
      gate: cfg.gate,
      gateThresholdDb: cfg.gateThresholdDb,
      mode: cfg.mode,
      bypass: cfg.bypass,
      version: MIC_VERSION
    };
  }
  function getStats() {
    return {
      version: MIC_VERSION,
      dspVersion: MIC_DSP_VERSION,
      level: levels.level,
      peak: levels.peak || 0,
      gated: levels.gated,
      cpu: levels.cpu,
      reductionDb: levels.reductionDb,
      noise: levels.noise,
      worklet: Boolean(workletNode),
      enabled: enabled(),
      cfg: getConfig()
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (timer) clearInterval(timer);
    timer = null;
    try { if (workletNode?.port) workletNode.port.onmessage = null; } catch { /* ignore */ }
    for (const node of [source, highpass, lowpass, gateIn, gateGain, shaper, gain, limiter, workletNode, analyser, dest]) {
      try { node?.disconnect?.(); } catch { /* ignore */ }
    }
    // Only close a context we created — never the shared one from media.js.
    if (ownedCtx) {
      try {
        const closing = ctx?.close?.();
        closing?.catch?.(() => {});
      } catch { /* ignore */ }
    }
    source = highpass = lowpass = gateIn = gateGain = shaper = gain = limiter = workletNode = analyser = dest = null;
    ctx = null;
  }

  return {
    attach,
    setEnabled,
    setBypass,
    setStrength,
    setMode,
    setGate,
    setGateThresholdDb,
    getLevel,
    getConfig,
    getStats,
    dispose,
    version: MIC_VERSION
  };
}

export default { createMicEnhancer, DEFAULT_CONFIG, MIC_VERSION, MIC_DSP_VERSION };
