/**
 * Mic Enhancer (browser runtime) — mic_ev1.2 (live in ev1 entrypoint).
 * Canonical implementation lives in `mic/mic_ev1/` at the repo root; this
 * self-contained copy is what the browser actually loads
 * (public/js/room/media.js → ./mic-enhancer.js) because the server does not
 * serve /mic at runtime. Keep the two in sync when bumping mic versions.
 * No external dependencies; AudioWorklet optional with full fallback.
 *
 * ev1.2 improvements over ev1.1:
 * - Smoothed RMS + peak-hold: the meter no longer jumps sample-to-sample,
 *   so the gate/AGC stop pumping on single transients.
 * - Gate hangover: the gate only closes after gateHoldMs of silence
 *   (was instant), so word endings are not clipped.
 * - Live API: getLevel()/getConfig()/setBypass()/setGateThresholdDb() —
 *   settings can change without rebuilding the graph or the call.
 * - CPU estimate from the meter tick itself; dispose() is idempotent.
 */

export const MIC_VERSION = 'ev1.2';
export const DEFAULT_CONFIG = Object.freeze({
  strength: 0.8,
  hpHz: 80,
  lpHz: 10000,
  gateThresholdDb: -42,
  gateAttackMs: 4,
  gateReleaseMs: 120,
  gateHoldMs: 200,
  fftSize: 256,
  noiseFloorSmoothing: 0.02,
  maxAttenuationDb: 18,
  agcTargetDb: -14,
  agcMaxGainDb: 12,
  clipDb: 0.85,
  bypass: false
});

export function createMicEnhancer(config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  // Sanitize: strength 0..1, frequencies in audible range, finite numbers only.
  cfg.strength = Math.max(0, Math.min(1, Number(cfg.strength) || 0));
  cfg.hpHz = Math.max(20, Math.min(400, Number(cfg.hpHz) || 80));
  cfg.lpHz = Math.max(2000, Math.min(16000, Number(cfg.lpHz) || 10000));
  cfg.clipDb = Math.max(0.1, Math.min(1, Number(cfg.clipDb) || 0.85));
  cfg.agcTargetDb = Math.max(-30, Math.min(-6, Number(cfg.agcTargetDb) || -14));
  cfg.agcMaxGainDb = Math.max(0, Math.min(24, Number(cfg.agcMaxGainDb) || 12));
  cfg.gateThresholdDb = Math.max(-60, Math.min(-20, Number(cfg.gateThresholdDb) || -42));
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
  let workletNode = null;
  let tapNode = null;
  let analyser = null;
  let analyserData = null;
  let levels = { level: 0, peak: 0, gated: false, cpu: 0 };
  let timer = null;
  let audioCtxRef = null;
  let lastOpenAt = 0;
  let disposed = false;
  let smoothedLevel = 0;

  async function attach(stream) {
    if (!stream) return { stream, bypass: true, enhanced: false, error: 'no-stream' };
    const rawTrack = stream.getAudioTracks?.()[0];
    if (!rawTrack) return { stream, bypass: true, enhanced: false, error: 'no-audio-track' };
    if (cfg.bypass) return { stream, bypass: true, enhanced: false, error: 'bypassed' };
    try {
      // Share the AudioContext with MicFx/media when the caller passes one:
      // three separate contexts cost ~3x CPU and add latency.
      if (config.audioContext && typeof config.audioContext.createMediaStreamSource === 'function') {
        ctx = config.audioContext;
        ownedCtx = false;
      } else {
        ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
        ownedCtx = true;
      }
      audioCtxRef = ctx;
      if (ctx.state === 'suspended') { try { await ctx.resume(); } catch { /* ignore */ } }
      source = ctx.createMediaStreamSource(new MediaStream([rawTrack]));
      dest = ctx.createMediaStreamDestination();
      // Analyser tap: real RMS even when AudioWorklet is unavailable.
      // Without it, level stayed 0 and the gate closed the mic shut.
      try {
        analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.5;
        source.connect(analyser);
        analyserData = new Uint8Array(analyser.fftSize);
      } catch { analyser = null; }
      highpass = ctx.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = cfg.hpHz;
      lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = cfg.lpHz;
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
      gain = ctx.createGain();
      gain.gain.value = 1;
      // Optional Worklet probe (ev1 accelerator) — main-thread graph below is
      // the source of truth; failure here just keeps the JS path.
      try {
        if (typeof ctx.audioWorklet?.addModule === 'function') {
          const modUrl = new URL('./noise-suppress-processor.js', import.meta.url);
          await ctx.audioWorklet.addModule(modUrl);
          workletNode = new AudioWorkletNode(ctx, 'hush-noise-suppress', { numberOfInputs: 1, numberOfOutputs: 1 });
          workletNode.port.onmessage = (e) => {
            if (e?.data?.type === 'stats') levels = { level: e.data.level ?? 0, gated: levels.gated, cpu: e.data.cpu ?? 0 };
          };
        }
      } catch { workletNode = null; }
      source.connect(highpass);
      highpass.connect(lowpass);
      lowpass.connect(gateIn);
      gateIn.connect(gateGain);
      gateGain.connect(shaper);
      shaper.connect(gain);
      gain.connect(dest);
      if (workletNode) {
        tapNode = ctx.createGain();
        tapNode.gain.value = 0;
        source.connect(workletNode);
        workletNode.connect(tapNode);
        tapNode.connect(ctx.destination);
      }
      // Simple level/CPU meter: analyser RMS (works with or without Worklet).
      // ev1.2: EWMA-smoothed RMS + peak-hold so gate/AGC don't pump on
      // single transients; gate closes only after gateHoldMs of silence.
      timer = setInterval(() => {
        const tickStart = performance.now();
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
        // Peak-hold with decay (1s) + smoothing.
        levels.peak = Math.max(level, (levels.peak || 0) * 0.92);
        smoothedLevel = smoothedLevel * 0.7 + level * 0.3;
        levels.level = smoothedLevel;
        level = smoothedLevel;
        // AGC: nudge gain toward target when weak (never push loud voices louder).
        // Strength trims the gain slightly (stronger suppression = a touch
        // softer) — applied AFTER the AGC calc so the timer can't clobber it.
        const targetDb = cfg.agcTargetDb ?? -14;
        const curDb = level <= 0 ? -80 : 20 * Math.log10(level);
        const need = Math.max(0, Math.min(cfg.agcMaxGainDb ?? 12, targetDb - curDb));
        const agcGain = Math.min(3, Math.pow(10, need / 20) * 0.5 + 0.5);
        const strengthTrim = 1 - cfg.strength * 0.15;
        gain.gain.setTargetAtTime(agcGain * strengthTrim, ctx.currentTime, 0.05);
        // Gate with hangover: track last-open time; close only after hold.
        const now = performance.now();
        if (curDb > (cfg.gateThresholdDb ?? -42)) {
          lastOpenAt = now;
          if (levels.gated) {
            levels.gated = false;
            gateGain.gain.setTargetAtTime(1, ctx.currentTime, 0.005);
          }
        } else if (!levels.gated && now - lastOpenAt > (cfg.gateHoldMs ?? 200)) {
          levels.gated = true;
          gateGain.gain.setTargetAtTime(cfg.bypass ? 1 : 0, ctx.currentTime, 0.005);
        }
        const tickMs = performance.now() - tickStart;
        levels.cpu = levels.cpu * 0.8 + tickMs * 0.2;
      }, 100);
      return { stream: dest.stream, bypass: false, enhanced: true, ctx, version: MIC_VERSION };
    } catch (error) {
      return { stream, bypass: true, enhanced: false, error: String(error?.message || error) };
    }
  }

  function setEnabled(on) {
    cfg.bypass = !on;
    if (cfg.bypass && timer) { clearInterval(timer); timer = null; }
    if (gateGain && ctx) gateGain.gain.setTargetAtTime(cfg.bypass ? 1 : levels.gated ? 0 : 1, ctx.currentTime, 0.005);
  }

  // ev1.2 live API — no graph rebuild needed.
  function setBypass(on) { setEnabled(!on); }
  function setGateThresholdDb(db) {
    const n = Number(db);
    if (Number.isFinite(n)) cfg.gateThresholdDb = Math.max(-60, Math.min(-20, n));
  }
  function getLevel() { return levels.level || 0; }
  function getConfig() {
    return { strength: cfg.strength, hpHz: cfg.hpHz, lpHz: cfg.lpHz, agcTargetDb: cfg.agcTargetDb, gateThresholdDb: cfg.gateThresholdDb, bypass: cfg.bypass, version: MIC_VERSION };
  }

  function setStrength(v) {
    cfg.strength = Math.max(0, Math.min(1, Number(v) || 0));
    // Strength is applied by the meter loop (agcGain * strengthTrim) —
    // do not write gain.gain directly here or the next tick clobbers it.
  }

  function getStats() {
    return {
      version: MIC_VERSION,
      level: levels.level,
      peak: levels.peak || 0,
      gated: levels.gated,
      cpu: levels.cpu,
      enabled: !cfg.bypass,
      cfg: getConfig()
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (timer) clearInterval(timer);
    timer = null;
    try { if (workletNode?.port) workletNode.port.onmessage = null; } catch { /* ignore */ }
    for (const n of [source, highpass, lowpass, gateIn, gateGain, shaper, gain, workletNode, tapNode, analyser, dest]) {
      try { n?.disconnect?.(); } catch { /* ignore */ }
    }
    // Only close a context we created — never the shared one from media.js.
    if (ownedCtx) { try { audioCtxRef?.close?.().catch(() => {}); } catch { /* ignore */ } }
    source = highpass = lowpass = gateIn = gateGain = shaper = gain = workletNode = tapNode = analyser = dest = null;
  }

  return { attach, setEnabled, setBypass, setStrength, setGateThresholdDb, getLevel, getConfig, getStats, dispose, version: MIC_VERSION };
}

export default { createMicEnhancer, DEFAULT_CONFIG, MIC_VERSION };
