/**
 * Hush mic ev2 — pure STFT noise-suppression DSP (zero deps, zero allocation
 * in the hot loop).
 *
 * This file is the actual signal processing behind
 * `noise-suppress-processor.js` (AudioWorklet). It is kept as a normal ES
 * module so it can be unit-tested in Node without a browser:
 *
 *   import { Fft, StftNoiseSuppressor } from './mic-dsp.js';
 *
 * Pipeline per 128-sample audio quantum (hop = 128, frame = 512):
 *   1. 75%-overlap Hann analysis (periodic window, COLA-safe)
 *   2. radix-2 FFT
 *   3. per-bin adaptive noise floor (fast while silent, slow while speech)
 *   4. spectral subtraction + Wiener blend (over-subtraction by strength)
 *   5. 3-tap frequency smoothing + attack/release time smoothing
 *   6. inverse FFT, Hann synthesis, overlap-add
 *
 * Design choices for maximum quality at low CPU:
 * - 512-point FFT (not 1024+) gives ~10ms latency at 48kHz while still
 *   resolving voice harmonics; 128 hop keeps the processing granular.
 * - the noise floor only rises slowly while speech is present, so a voice
 *   cannot teach the suppressor that it is noise.
 * - a gain floor (minGain) removes residual "musical noise" instead of
 *   leaving random isolated bins at full volume.
 * - all buffers are allocated once in the constructor; `process()` only
 *   writes into existing typed arrays.
 *
 * No DOM, no network, no timers.
 */

export const MIC_DSP_VERSION = '2.0.1';

const TAU = Math.PI * 2;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

/** Iterative radix-2 complex FFT with precomputed bit-reversal + twiddles. */
export class Fft {
  constructor(size) {
    if (!Number.isInteger(size) || size < 2 || (size & (size - 1)) !== 0) {
      throw new Error('Fft size must be a power of two >= 2');
    }
    this.size = size;
    this.levels = Math.round(Math.log2(size));
    this.cos = new Float32Array(size >> 1);
    this.sin = new Float32Array(size >> 1);
    for (let i = 0; i < size >> 1; i += 1) {
      this.cos[i] = Math.cos((TAU * i) / size);
      this.sin[i] = Math.sin((TAU * i) / size);
    }
    this.rev = new Uint32Array(size);
    for (let i = 0; i < size; i += 1) {
      let x = i;
      let r = 0;
      for (let j = 0; j < this.levels; j += 1) {
        r = (r << 1) | (x & 1);
        x >>= 1;
      }
      this.rev[i] = r;
    }
  }

  transform(re, im) {
    const n = this.size;
    const rev = this.rev;
    for (let i = 0; i < n; i += 1) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    const cos = this.cos;
    const sin = this.sin;
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + half; j += 1, k += step) {
          const l = j + half;
          const tre = re[l] * cos[k] + im[l] * sin[k];
          const tim = -re[l] * sin[k] + im[l] * cos[k];
          re[l] = re[j] - tre;
          im[l] = im[j] - tim;
          re[j] += tre;
          im[j] += tim;
        }
      }
    }
  }

  inverse(re, im) {
    const n = this.size;
    for (let i = 0; i < n; i += 1) im[i] = -im[i];
    this.transform(re, im);
    const scale = 1 / n;
    for (let i = 0; i < n; i += 1) {
      re[i] *= scale;
      im[i] = -im[i] * scale;
    }
  }
}

/**
 * Stateful STFT suppressor. Feed exactly `hopSize` samples per call.
 * `process(input, output)` writes `hopSize` samples into `output`.
 */
export class StftNoiseSuppressor {
  constructor({
    sampleRate = 48000,
    fftSize = 512,
    hopSize = 128,
    strength = 0.85,
    minGain = null,
    enabled = true
  } = {}) {
    const requestedSize = Number(fftSize);
    const boundedSize = Number.isFinite(requestedSize)
      ? clamp(requestedSize, 128, 1024)
      : 512;
    const size = 2 ** Math.floor(Math.log2(boundedSize));
    const requestedHop = Number(hopSize);
    const hop = Math.round(Number.isFinite(requestedHop)
      ? clamp(requestedHop, 32, size / 2)
      : size / 4);
    this.sampleRate = Number(sampleRate) || 48000;
    this.fftSize = size;
    this.hop = hop;
    this.bins = size >> 1;
    this.fft = new Fft(size);
    this.re = new Float32Array(size);
    this.im = new Float32Array(size);
    this.window = new Float32Array(size);
    // Periodic Hann: w[n] = 0.5 - 0.5 cos(2πn/N).
    for (let i = 0; i < size; i += 1) {
      this.window[i] = 0.5 - 0.5 * Math.cos((TAU * i) / size);
    }
    this.olaNorm = new Float32Array(hop);
    for (let phase = 0; phase < hop; phase += 1) {
      let weight = 0;
      for (let i = phase; i < size; i += hop) weight += this.window[i] * this.window[i];
      this.olaNorm[phase] = weight > 1e-8 ? 1 / weight : 0;
    }
    this.inRing = new Float32Array(size);
    this.ola = new Float32Array(size);
    this.mag = new Float32Array(this.bins + 1);
    this.noise = new Float32Array(this.bins + 1);
    this.prevGain = new Float32Array(this.bins + 1).fill(1);
    this.rawGain = new Float32Array(this.bins + 1);
    this.smoothGain = new Float32Array(this.bins + 1);
    this.noise.fill(1e-5);
    this.noiseRms = 0.004;
    this.level = 0;
    this.noiseLevel = 0;
    this.reductionDb = 0;
    this.speech = false;
    this.strength = clamp(strength, 0, 1);
    this.minGain = minGain == null
      ? 0.03 + (1 - this.strength) * 0.12
      : clamp(minGain, 0.005, 0.5);
    this.overSub = 1.35 + this.strength * 1.65;
    this.mix = enabled ? 1 : 0;
    this.mixTarget = this.mix;
    this._reductionSmooth = 0;
  }

  setParams({ strength, enabled, minGain } = {}) {
    if (strength != null && Number.isFinite(Number(strength))) {
      this.strength = clamp(strength, 0, 1);
      this.overSub = 1.35 + this.strength * 1.65;
      if (minGain == null) this.minGain = 0.03 + (1 - this.strength) * 0.12;
    }
    if (minGain != null && Number.isFinite(Number(minGain))) {
      this.minGain = clamp(minGain, 0.005, 0.5);
    }
    if (enabled != null) this.mixTarget = enabled ? 1 : 0;
  }

  reset() {
    this.inRing.fill(0);
    this.ola.fill(0);
    this.re.fill(0);
    this.im.fill(0);
    this.mag.fill(0);
    this.noise.fill(1e-5);
    this.prevGain.fill(1);
    this.rawGain.fill(0);
    this.smoothGain.fill(0);
    this.noiseRms = 0.004;
    this.level = 0;
    this.noiseLevel = 0;
    this.reductionDb = 0;
    this._reductionSmooth = 0;
    this.mix = this.mixTarget;
  }

  process(input, output) {
    const n = this.fftSize;
    const hop = this.hop;
    const bins = this.bins;
    const re = this.re;
    const im = this.im;
    const win = this.window;
    const inRing = this.inRing;
    const ola = this.ola;
    const mag = this.mag;
    const noise = this.noise;
    const rawGain = this.rawGain;
    const smoothGain = this.smoothGain;
    const prevGain = this.prevGain;

    // 1) Slide the analysis window by one hop and append the new samples.
    inRing.copyWithin(0, hop);
    for (let i = 0; i < hop; i += 1) inRing[n - hop + i] = input[i] || 0;

    // Time-domain RMS (used by the voice-activity detector).
    let frameEnergy = 0;
    for (let i = 0; i < hop; i += 1) {
      const s = input[i] || 0;
      frameEnergy += s * s;
    }
    const frameRms = Math.sqrt(frameEnergy / hop);
    const speech = frameRms > Math.max(0.0045, this.noiseRms * 2.4);
    this.speech = speech;
    if (speech) {
      // Very slow rise while speech is present: the voice must not teach the
      // floor that it is noise, but a slightly louder room still adapts.
      this.noiseRms += (Math.min(frameRms, this.noiseRms * 1.3) - this.noiseRms) * 0.002;
    } else {
      this.noiseRms += (frameRms - this.noiseRms) * 0.07;
    }
    this.noiseRms = clamp(this.noiseRms, 1e-5, 0.5);

    // 2) Window + FFT.
    for (let i = 0; i < n; i += 1) {
      re[i] = inRing[i] * win[i];
      im[i] = 0;
    }
    this.fft.transform(re, im);

    // 3) Per-bin noise floor + 4) gain.
    const nAlpha = speech ? 0.0015 : 0.07;
    for (let k = 0; k <= bins; k += 1) {
      const m = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      mag[k] = m;
      let nf = noise[k];
      if (speech) nf += (Math.min(m, nf * 1.25) - nf) * nAlpha;
      else nf += (m - nf) * nAlpha;
      nf = Math.max(nf, 1e-6);
      noise[k] = nf;
      // Posterior SNR -> Wiener gain, blended with over-subtraction. The
      // blend keeps voice harmonics (high SNR) near unity while cutting
      // stationary noise hard (low SNR).
      const snr = (m * m) / (nf * nf + 1e-12);
      const wiener = snr / (1 + snr);
      const wienerWeight = 0.55 + 0.45 * Math.min(1, snr / 8);
      const sub = Math.max(0, m - this.overSub * nf) / (m + 1e-9);
      let g = Math.max(sub, wiener * wienerWeight);
      if (g < this.minGain) g = this.minGain;
      else if (g > 1) g = 1;
      rawGain[k] = g;
    }

    // 5) Smooth across frequency (3-tap) then over time. Opening is faster
    // than closing so word onsets survive; closing slowly avoids musical
    // noise from isolated bins flickering on/off.
    let gainSum = 0;
    for (let k = 0; k <= bins; k += 1) {
      const a = rawGain[k > 0 ? k - 1 : k];
      const b = rawGain[k];
      const c = rawGain[k < bins ? k + 1 : k];
      let g = (a + 2 * b + c) * 0.25;
      const prev = prevGain[k];
      const coeff = g > prev ? 0.55 : 0.32;
      g = prev + (g - prev) * coeff;
      if (g < this.minGain) g = this.minGain;
      else if (g > 1) g = 1;
      smoothGain[k] = g;
      prevGain[k] = g;
      gainSum += g;
    }

    // Apply the gain symmetrically (real signal -> conjugate spectrum).
    for (let k = 0; k <= bins; k += 1) {
      const g = smoothGain[k];
      re[k] *= g;
      im[k] *= g;
      if (k > 0 && k < bins) {
        const mirror = n - k;
        re[mirror] *= g;
        im[mirror] *= g;
      }
    }
    const avgGain = gainSum / (bins + 1);
    const reduction = -20 * Math.log10(Math.max(1e-4, avgGain));
    this._reductionSmooth = this._reductionSmooth * 0.8 + reduction * 0.2;
    this.reductionDb = Math.max(0, this._reductionSmooth);

    // 6) Inverse FFT + Hann synthesis + overlap-add.
    this.fft.inverse(re, im);
    for (let i = 0; i < n; i += 1) ola[i] += re[i] * win[i];

    // 7) Dry/wet ramp for click-free enable/disable, then emit one hop.
    const target = this.mixTarget;
    const mixStep = (target - this.mix) / hop;
    let mix = this.mix;
    let outEnergy = 0;
    for (let i = 0; i < hop; i += 1) {
      mix += mixStep;
      const wet = ola[i] * this.olaNorm[i];
      const dry = input[i] || 0;
      const value = dry + (wet - dry) * mix;
      output[i] = value;
      outEnergy += value * value;
    }
    this.mix = target;

    // Slide the OLA buffer: the tail is needed by the next 3 frames.
    ola.copyWithin(0, hop);
    ola.fill(0, n - hop);

    const outRms = Math.sqrt(outEnergy / hop);
    this.level = this.level * 0.85 + outRms * 0.15;
    this.noiseLevel = this.noiseLevel * 0.9 + this.noiseRms * 0.1;
    return output;
  }
}

export default { Fft, StftNoiseSuppressor, MIC_DSP_VERSION };
