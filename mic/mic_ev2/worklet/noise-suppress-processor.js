/**
 * AudioWorkletProcessor — hush-noise-suppress (mic ev2 browser runtime).
 * Canonical source: mic/mic_ev2/worklet/noise-suppress-processor.js
 *
 * This is the real processing stage (ev1 accidentally loaded the worklet as
 * a muted tap, so the main graph only had EQ + gate). It runs a 512-point
 * STFT suppressor (see src/mic-dsp.js) on the audio thread:
 *
 *   input -> Hann analysis -> FFT -> adaptive noise floor ->
 *   spectral subtraction + Wiener blend -> smooth gains ->
 *   IFFT -> Hann synthesis -> overlap-add -> output
 *
 * Messages:
 *   { type: 'set', strength?: 0..1, enabled?: boolean, minGain?: number }
 *   { type: 'reset' }
 * Stats are posted every 12 quanta (~35ms at 48kHz) for the UI meter:
 *   { type: 'stats', level, noise, reductionDb, cpu, version }
 *
 * No allocations inside process() — the DSP module owns every buffer.
 *
 * Canonical layout note: here the DSP lives in ../src/mic-dsp.js. The browser
 * runtime copy in public/js/room/ is colocated with mic-dsp.js, so it imports
 * './mic-dsp.js' instead — keep the two files otherwise identical.
 */
import { StftNoiseSuppressor, MIC_DSP_VERSION } from '../src/mic-dsp.js';

const STATS_EVERY = 12;

class HushNoiseSuppressProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = options?.processorOptions || {};
    const fftSize = [256, 512, 1024].includes(Number(opts.fftSize)) ? Number(opts.fftSize) : 512;
    this.dsp = new StftNoiseSuppressor({
      sampleRate: opts.sampleRate || (typeof sampleRate !== 'undefined' ? sampleRate : 48000),
      fftSize,
      hopSize: 128,
      strength: opts.strength ?? 0.85,
      minGain: opts.minGain ?? null,
      enabled: opts.enabled !== false
    });
    this._count = 0;
    this._cpu = 0;
    this.port.onmessage = (event) => {
      const data = event?.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'set') this.dsp.setParams(data);
      else if (data.type === 'reset') this.dsp.reset();
    };
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!input || !output) return true;

    const canTime = typeof performance !== 'undefined' && typeof performance.now === 'function';
    const started = canTime ? performance.now() : 0;
    this.dsp.process(input, output);
    if (canTime) this._cpu = performance.now() - started;

    this._count += 1;
    if (this._count % STATS_EVERY === 0) {
      try {
        this.port.postMessage({
          type: 'stats',
          level: this.dsp.level,
          noise: this.dsp.noiseLevel,
          reductionDb: this.dsp.reductionDb,
          cpu: this._cpu,
          version: MIC_DSP_VERSION
        });
      } catch { /* port closed */ }
    }
    return true;
  }
}

registerProcessor('hush-noise-suppress', HushNoiseSuppressProcessor);
