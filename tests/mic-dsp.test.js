import test from 'node:test';
import assert from 'node:assert/strict';

import { Fft, StftNoiseSuppressor, MIC_DSP_VERSION } from '../public/js/room/mic-dsp.js';
import { sanitizeMicSettings, MIC_SETTINGS_RANGES } from '../public/js/room/mic-settings.js';

// Deterministic PRNG so the DSP assertions never flake.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rms(samples) {
  let sum = 0;
  for (const s of samples) sum += s * s;
  return Math.sqrt(sum / samples.length);
}

test('mic DSP: FFT round-trip reconstructs the input', () => {
  const size = 64;
  const fft = new Fft(size);
  const original = new Float32Array(size);
  for (let i = 0; i < size; i += 1) {
    original[i] = Math.sin((i / size) * Math.PI * 4) * 0.6 + (i % 3) * 0.01;
  }
  const re = Float32Array.from(original);
  const im = new Float32Array(size);
  fft.transform(re, im);
  fft.inverse(re, im);
  for (let i = 0; i < size; i += 1) {
    assert.ok(Math.abs(re[i] - original[i]) < 1e-4, `sample ${i} reconstructed`);
  }
});

test('mic DSP: stationary noise is suppressed, speech is preserved', () => {
  const hop = 128;
  const noise = new StftNoiseSuppressor({ fftSize: 512, hopSize: hop, strength: 0.85 });
  const speech = new StftNoiseSuppressor({ fftSize: 512, hopSize: hop, strength: 0.85 });
  const random = mulberry32(1234);

  const noiseIn = [];
  const noiseOut = [];
  const speechIn = [];
  const speechOut = [];
  const input = new Float32Array(hop);
  const output = new Float32Array(hop);

  for (let frame = 0; frame < 400; frame += 1) {
    for (let i = 0; i < hop; i += 1) {
      // Realistic room/fan noise: loud enough to measure, below a voice.
      input[i] = (random() * 2 - 1) * 0.02;
    }
    noise.process(input, output);
    if (frame >= 200) {
      noiseIn.push(...input);
      noiseOut.push(...output);
    }
  }

  let phase = 0;
  for (let frame = 0; frame < 400; frame += 1) {
    for (let i = 0; i < hop; i += 1) {
      input[i] = Math.sin(phase) * 0.25;
      phase += (2 * Math.PI * 220) / 48000;
    }
    speech.process(input, output);
    if (frame >= 200) {
      speechIn.push(...input);
      speechOut.push(...output);
    }
  }

  const noiseRatio = rms(noiseOut) / rms(noiseIn);
  const speechRatio = rms(speechOut) / rms(speechIn);
  assert.ok(noiseRatio < 0.6, `noise reduced (ratio ${noiseRatio.toFixed(3)})`);
  assert.ok(speechRatio > 0.75, `speech kept (ratio ${speechRatio.toFixed(3)})`);
  assert.equal(MIC_DSP_VERSION, '2.0.1');
});

test('mic DSP: invalid FFT sizes and hop settings stay valid and normalized', () => {
  const suppressor = new StftNoiseSuppressor({ fftSize: 300, hopSize: 100 });
  assert.equal(suppressor.fftSize, 256, 'FFT size is normalized to a power of two');
  assert.equal(suppressor.hop, 100, 'valid bounded hops remain configurable');

  const input = new Float32Array(suppressor.hop).fill(0.1);
  const output = new Float32Array(suppressor.hop);
  for (let frame = 0; frame < 20; frame += 1) suppressor.process(input, output);
  assert.ok(output.every(Number.isFinite), 'processing does not produce invalid samples');
  assert.ok(suppressor.olaNorm instanceof Float32Array);
  assert.equal(suppressor.olaNorm.length, suppressor.hop);
});

test('mic settings: untrusted values are clamped and whitelisted', () => {
  assert.deepEqual(MIC_SETTINGS_RANGES.enhanceStrength, [0, 1]);
  const clean = sanitizeMicSettings({
    enhanceStrength: 9,
    gateThresholdDb: -900,
    amplificationDb: 'loud',
    micVersion: 'evil',
    deviceId: '"><script>',
    enhance: true
  }, { enhanceStrength: 0.85, gateThresholdDb: -42, amplificationDb: 6, micVersion: 'ev2.0' });
  assert.equal(clean.enhanceStrength, 1, 'strength clamped to 1');
  assert.equal(clean.gateThresholdDb, -60, 'gate clamped to floor');
  assert.equal(clean.amplificationDb, 6, 'bad number falls back');
  assert.equal(clean.micVersion, 'ev2.0', 'unknown micVersion rejected');
  assert.equal(clean.deviceId, '', 'injected deviceId rejected');
  assert.equal(clean.enhance, true);
  assert.equal(sanitizeMicSettings({ micVersion: 'ev2' }).micVersion, 'ev2');
});
