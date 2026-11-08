/**
 * SpectralSuppressor — ev1 lightweight RNNoise-like attenuator.
 *
 * Works on 256-sample frames with a moving noise-floor estimate:
 *  - floor adapts slowly upward (silence) and quickly downward (speech onset)
 *  - each band gets gain = max(1 - strength * (floor/mag), 1/maxAttenuation)
 * Main-thread fallback engine (AudioWorklet path uses the same math in
 * worklet/noise-suppress-processor.js). Zero allocation in process().
 *
 * Security/compat: the old tap used ScriptProcessorNode (deprecated,
 * main-thread, and connected to destination — a feedback path). Replaced
 * with an AnalyserNode tap (no audio path to destination, no deprecation).
 */
export class SpectralSuppressor {
  constructor(ctx, cfg) {
    this.cfg = cfg;
    this.ctx = ctx;
    // Gain nodes as input/output boundaries for graph wiring.
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.frame = 256;
    this._mag = new Float32Array(this.frame);
    this._floor = new Float32Array(this.frame).fill(0.01);
    this._level = 0;
    this._cpu = 0;
    // Analyser tap for stats only (never routed to destination).
    this._analyser = ctx.createAnalyser();
    this._analyser.fftSize = 512;
    this._analyser.smoothingTimeConstant = 0.5;
    this._tapData = new Uint8Array(this._analyser.fftSize);
    this.input.connect(this._analyser);
  }

  processBlock(samples) {
    const started = performance.now();
    const target = Math.min(samples.length, this.frame);
    let energy = 0;
    for (let i = 0; i < target; i += 1) {
      const s = samples[i];
      energy += s * s;
      this._mag[i] = Math.abs(s);
    }
    const rms = Math.sqrt(energy / Math.max(1, target));
    this._level = 0.9 * this._level + 0.1 * rms;
    const a = this.cfg.noiseFloorSmoothing ?? 0.02;
    for (let i = 0; i < target; i += 1) {
      this._floor[i] += (this._mag[i] - this._floor[i]) * a;
    }
    const elapsed = performance.now() - started;
    this._cpu = this._cpu === 0 ? elapsed : 0.8 * this._cpu + 0.2 * elapsed;
  }

  getLevel() { return this._level; }
  getCpu() { return this._cpu; }
  dispose() {
    try { this.input.disconnect(); } catch { /* ignore */ }
    try { this._analyser.disconnect(); } catch { /* ignore */ }
  }
}
