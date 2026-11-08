/**
 * NoiseGate + Clipper + Agc — ev1 DSP blocks.
 * All are pure helpers with no allocation inside the hot loop.
 */
export class NoiseGate {
  constructor(ctx, cfg) {
    this.cfg = cfg;
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this._closed = false;
    this._lastOpen = 0;
    this._gain = 1;
    // Gate gain is smoothed through this node to avoid clicks.
    this._gateGain = ctx.createGain();
    this._gateGain.gain.value = 1;
    this.input.connect(this._gateGain);
    this._gateGain.connect(this.output);
  }

  #target(closed) { return closed ? 0 : 1; }

  setClosed(closed) {
    this._closed = closed;
    const now = performance.now();
    if (!closed) this._lastOpen = now;
    this._gateGain.gain.setTargetAtTime(this._target(closed), this.ctx?.currentTime ?? 0, 0.005);
  }

  isClosed() { return this._closed; }
  // Called by the enhancer's meter loop with a fresh strength estimate.
  update(levelRms) {
    const db = levelRms <= 0 ? -80 : 20 * Math.log10(levelRms);
    const shouldClose = db < (this.cfg.gateThresholdDb ?? -42);
    if (shouldClose && performance.now() - this._lastOpen > (this.cfg.gateHoldMs ?? 200)) {
      if (!this._closed) this.setClosed(true);
    } else if (!shouldClose && this._closed) {
      this.setClosed(false);
    }
  }
  dispose() {
    try { this.input.disconnect(); } catch { /* ignore */ }
    try { this.output.disconnect(); } catch { /* ignore */ }
    try { this._gateGain.disconnect(); } catch { /* ignore */ }
  }
}

export class Clipper {
  constructor(ctx, cfg) {
    this.cfg = cfg;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this._shaper = ctx.createWaveShaper();
    this._curve = new Float32Array(256);
    this.#buildCurve();
    this.input.connect(this._shaper);
    this._shaper.connect(this.output);
  }

  #buildCurve() {
    const limit = this.cfg.clipDb ?? 0.85;
    for (let i = 0; i < 256; i += 1) {
      const x = (i / 128) - 1;
      this._curve[i] = Math.tanh(limit * x) / Math.tanh(limit);
    }
    this._shaper.curve = this._curve;
  }
}

export class Agc {
  constructor(cfg) {
    this.cfg = cfg;
    this._gainDb = 0;
    this._rmsSmooth = 0.01;
  }

  calcGainDb() { return this._gainDb; }

  update(rms) {
    this._rmsSmooth = 0.8 * this._rmsSmooth + 0.2 * Math.max(0.0001, rms);
    const currentDb = 20 * Math.log10(this._rmsSmooth);
    const targetDb = this.cfg.agcTargetDb ?? -14;
    const maxGain = this.cfg.agcMaxGainDb ?? 12;
    // Raise weak voices only (never push loud ones above target).
    let needed = targetDb - currentDb;
    needed = Math.max(0, Math.min(maxGain, needed));
    this._gainDb += (needed - this._gainDb) * 0.15;
    // Cap the actual linear gain defensively.
    const maxLin = this.cfg.agcMaxGainFold ?? 3;
    const lin = Math.pow(10, this._gainDb / 20);
    return Math.min(lin, maxLin);
  }
}
