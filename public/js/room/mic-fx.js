/**
 * MicFx — local microphone voice processing chain.
 *
 * Load is deliberately split across layers so the UI thread stays free:
 *  1. Browser-native processing (echoCancellation / noiseSuppression /
 *     autoGainControl) runs in the browser's native DSP, which is
 *     hardware-accelerated (GPU/DSP) where the platform offers it.
 *  2. This WebAudio chain runs on the dedicated audio thread, isolated
 *     from the main/UI thread: high-pass, preamp (amplification),
 *     compression, soft-clipping (de-distortion), noise gate, limiter.
 *  3. The gate/meter polling is adaptive: "performance" quality polls
 *     less often and softens the shaper, "quality" polls more often.
 *     "auto" picks from the CPU core count.
 *
 * If anything in the chain fails, the raw track is returned untouched —
 * the call must never break because of an audio effect.
 */

export const MIC_SETTINGS_KEY = 'hush:mic-settings';

export const DEFAULT_MIC_SETTINGS = Object.freeze({
  enabled: true,
  // Native (browser / hardware) layer — applied via getUserMedia constraints.
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  // WebAudio layer.
  gate: true,
  gateThresholdDb: -42, // -60 .. -20
  amplificationDb: 6, // 0 .. 24 dB preamp
  deDistort: 25, // 0 .. 100 % soft-clip drive
  monitor: false, // hear yourself through speakers (feedback risk)
  quality: 'auto', // auto | performance | quality
  deviceId: '',
  preset: 'voice',
  // mic_ev1 second stage (mic/mic_ev1 spectral suppressor) — mic folder plan.
  enhance: true,
  enhanceStrength: 0.8, // 0..1
  micVersion: 'ev1'
});

export const MIC_PRESETS = Object.freeze({
  off: { enabled: false, gate: false, amplificationDb: 0, deDistort: 0, autoGainControl: true },
  voice: { enabled: true, gate: true, gateThresholdDb: -42, amplificationDb: 6, deDistort: 25, autoGainControl: true, echoCancellation: true, noiseSuppression: true },
  podcast: { enabled: true, gate: true, gateThresholdDb: -46, amplificationDb: 10, deDistort: 35, autoGainControl: false, echoCancellation: true, noiseSuppression: true },
  gaming: { enabled: true, gate: true, gateThresholdDb: -38, amplificationDb: 12, deDistort: 45, autoGainControl: false, echoCancellation: true, noiseSuppression: true },
  quiet: { enabled: true, gate: true, gateThresholdDb: -34, amplificationDb: 4, deDistort: 15, autoGainControl: true, echoCancellation: true, noiseSuppression: true }
});

import { sanitizeMicSettings } from './mic-settings.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const dbToLinear = (db) => Math.pow(10, clamp(db, 0, 24) / 20);

export function loadMicSettings() {
  try {
    const raw = localStorage.getItem(MIC_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_MIC_SETTINGS };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_MIC_SETTINGS };
    // Security: never trust stored numbers/ids — clamp + whitelist every field.
    return sanitizeMicSettings({ ...DEFAULT_MIC_SETTINGS, ...parsed });
  } catch {
    return { ...DEFAULT_MIC_SETTINGS };
  }
}

export function saveMicSettings(settings) {
  try {
    localStorage.setItem(MIC_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Private mode etc. — settings still apply for this session.
  }
}

function makeSoftClipCurve(drivePercent) {
  const drive = 1 + clamp(drivePercent, 0, 100) * 0.12; // 1x .. 13x
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const x = (i / (n - 1)) * 2 - 1;
    // tanh soft clipper: smooth, no hard digital clipping distortion
    curve[i] = Math.tanh(drive * x) / Math.tanh(drive);
  }
  return curve;
}

export class MicFx {
  constructor(settings) {
    this.settings = sanitizeMicSettings(settings, DEFAULT_MIC_SETTINGS);
    this.context = null;
    this.nodes = null;
    this.processedTrack = null;
    this.rawTrack = null;
    this.gateTimer = null;
    this.gateOpen = true;
    this.holdUntil = 0;
    this.level = { rms: 0, db: -60 };
    this._buffer = null;
  }

  get enabled() {
    return Boolean(this.settings.enabled);
  }

  /** Resume the processing context (autoplay policy needs a gesture). */
  resume() {
    try { this.context?.resume?.().catch(() => {}); } catch { /* ignore */ }
  }

  /** Returns the track to send to peers (processed, or raw as fallback). */
  async process(rawTrack) {
    this.rawTrack = rawTrack;
    if (!this.enabled) return rawTrack;

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx || !rawTrack) return rawTrack;

    try {
      this.context = new AudioCtx({ latencyHint: 'interactive' });
      await this.context.resume().catch(() => {});

      const ctx = this.context;
      const source = ctx.createMediaStreamSource(new MediaStream([rawTrack]));

      const inputAnalyser = ctx.createAnalyser();
      inputAnalyser.fftSize = 1024;
      inputAnalyser.smoothingTimeConstant = 0.4;
      source.connect(inputAnalyser);

      const highpass = ctx.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = 80; // rumble / handling noise
      highpass.Q.value = 0.7;

      const preamp = ctx.createGain();
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.knee.value = 20;
      compressor.ratio.value = 3;
      compressor.attack.value = 0.004;
      compressor.release.value = 0.18;

      const shaper = ctx.createWaveShaper();
      shaper.oversample = '2x';

      const gateGain = ctx.createGain();
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -6;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.12;

      const monitorGain = ctx.createGain();
      monitorGain.gain.value = 0;

      const destination = ctx.createMediaStreamDestination();
      const chain = [source, highpass, preamp, compressor, shaper, gateGain, limiter, destination];
      for (let i = 0; i < chain.length - 1; i += 1) chain[i].connect(chain[i + 1]);
      limiter.connect(monitorGain);
      monitorGain.connect(ctx.destination);

      this.nodes = { source, inputAnalyser, highpass, preamp, compressor, shaper, gateGain, limiter, monitorGain, destination };
      this._buffer = new Uint8Array(inputAnalyser.fftSize);
      this.processedTrack = destination.stream.getAudioTracks()[0] ?? rawTrack;
      this.applySettings();
      this.#startGate();
      return this.processedTrack;
    } catch (error) {
      console.warn('MicFx fallback to raw mic', error);
      this.teardown(false);
      return rawTrack;
    }
  }

  /** Live-apply new settings without renegotiation. */
  applySettings() {
    this.settings = sanitizeMicSettings(this.settings, DEFAULT_MIC_SETTINGS);
    if (!this.nodes || !this.context) return;
    const { preamp, compressor, shaper, gateGain, monitorGain } = this.nodes;
    const performance = this.#isPerformance();

    preamp.gain.setTargetAtTime(dbToLinear(this.settings.amplificationDb), this.context.currentTime, 0.03);
    compressor.ratio.setTargetAtTime(performance ? 1 : 3, this.context.currentTime, 0.03);
    shaper.curve = makeSoftClipCurve(performance ? this.settings.deDistort * 0.5 : this.settings.deDistort);
    // Security: monitor is capped at 0.4 (was 0.9) — full-gain monitor
    // through speakers fed the mic and caused feedback howling.
    monitorGain.gain.setTargetAtTime(this.settings.monitor ? 0.4 : 0, this.context.currentTime, 0.03);

    if (this.settings.gate) this.#startGate();
    else this.#stopGate();
  }

  update(settings) {
    this.settings = sanitizeMicSettings({ ...this.settings, ...settings }, DEFAULT_MIC_SETTINGS);
    this.applySettings();
  }

  getLevel() {
    return { ...this.level, gateOpen: this.gateOpen };
  }

  teardown(stopRaw = true) {
    this.#stopGate();
    if (this.nodes) {
      for (const node of Object.values(this.nodes)) {
        try { node.disconnect(); } catch { /* already disconnected */ }
      }
      this.nodes = null;
    }
    if (this.context) {
      this.context.close().catch(() => {});
      this.context = null;
    }
    if (stopRaw && this.rawTrack && this.rawTrack !== this.processedTrack) {
      try { this.rawTrack.stop(); } catch { /* ignore */ }
    }
    this.processedTrack = null;
    this.rawTrack = null;
  }

  #isPerformance() {
    if (this.settings.quality === 'performance') return true;
    if (this.settings.quality === 'quality') return false;
    const cores = navigator.hardwareConcurrency || 4;
    return cores < 6;
  }

  #startGate() {
    if (this.gateTimer || !this.nodes) return;
    const interval = this.#isPerformance() ? 100 : 40;
    const holdMs = this.#isPerformance() ? 250 : 180;

    this.gateTimer = setInterval(() => {
      if (!this.nodes || !this.context) return;
      const { inputAnalyser, gateGain } = this.nodes;
      inputAnalyser.getByteTimeDomainData(this._buffer);
      let sum = 0;
      for (let i = 0; i < this._buffer.length; i += 1) {
        const v = (this._buffer[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / this._buffer.length);
      const db = rms > 0.0001 ? 20 * Math.log10(rms) : -60;
      this.level = { rms, db: Math.max(-60, db) };

      const now = performance.now();
      if (db >= this.settings.gateThresholdDb) {
        this.holdUntil = now + holdMs;
        if (!this.gateOpen) {
          this.gateOpen = true;
          gateGain.gain.setTargetAtTime(1, this.context.currentTime, 0.008);
        }
      } else if (this.gateOpen && now > this.holdUntil) {
        this.gateOpen = false;
        gateGain.gain.setTargetAtTime(0, this.context.currentTime, 0.04);
      }
    }, interval);
  }

  #stopGate() {
    if (this.gateTimer) {
      clearInterval(this.gateTimer);
      this.gateTimer = null;
    }
    if (this.nodes && this.context) {
      this.gateOpen = true;
      this.nodes.gateGain.gain.setTargetAtTime(1, this.context.currentTime, 0.02);
    }
  }
}
