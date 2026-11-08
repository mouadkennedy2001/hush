/**
 * AudioWorkletProcessor — hush-noise-suppress (mic_ev1 browser runtime).
 * Canonical source: mic/mic_ev1/worklet/noise-suppress-processor.js
 *
 * Real zero-allocation spectral-follow attenuator:
 * - per-sample noise-floor estimate adapts toward |x| slowly (0.02)
 * - gain = clamp(1 - strength * (floor / mag), minGain, 1) smoothed
 *   with attack/release so transients (speech onsets) stay intact
 * - strength is set via port message { type:'set', strength }
 * - stats { level, cpu } posted every 3rd frame for the UI meter
 * No allocations inside process() — all buffers preallocated.
 */
const FRAME = 128; // AudioWorklet standard quantum
const MIN_GAIN = 0.08;

class HushNoiseSuppressProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._floor = 0.01;
    this._gain = 1;
    this._strength = 0.8;
    this._level = 0;
    this._count = 0;
    this._cpu = 0;
    this.port.onmessage = (e) => {
      const d = e?.data;
      if (d && d.type === 'set' && Number.isFinite(d.strength)) {
        this._strength = Math.max(0, Math.min(1, d.strength));
      }
    };
  }

  process(inputs, outputs) {
    const started = currentTime;
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!input || !output) return true;
    let energy = 0;
    const strength = this._strength;
    let gain = this._gain;
    for (let i = 0; i < input.length; i += 1) {
      const s = input[i] ?? 0;
      const mag = Math.abs(s);
      // Track floor toward observed magnitude.
      this._floor += (mag - this._floor) * 0.02;
      // Desired gain: quiet (mag ≈ floor) -> deep cut; loud -> 1.
      const ratio = this._floor / Math.max(mag, 0.0001);
      let target = 1 - strength * Math.min(ratio, 1);
      if (target < MIN_GAIN) target = MIN_GAIN;
      // Smoothing: attack (opening) fast, release (closing) slower.
      const coeff = target < gain ? 0.12 : 0.04;
      gain += (target - gain) * coeff;
      output[i] = s * gain;
      energy += s * s;
    }
    this._gain = gain;
    const rms = Math.sqrt(energy / Math.max(1, input.length));
    this._level = 0.9 * this._level + 0.1 * rms;
    this._count += 1;
    if (this._count % 3 === 0) {
      try {
        this._cpu = currentTime - started;
        this.port.postMessage({ type: 'stats', level: this._level, cpu: this._cpu });
      } catch { /* ignore */ }
    }
    return true;
  }
}

registerProcessor('hush-noise-suppress', HushNoiseSuppressProcessor);
