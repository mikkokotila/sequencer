import { emit } from '../events';

// ── Engine-level processing nodes ──
// These are REAL Web Audio API native nodes, owned by the engine alone.
// They sit after the extension chain and before ctx.destination.
let engineFilter: BiquadFilterNode | null = null; // lowpass filter (cutoff + resonance)
let engineSaturation: WaveShaperNode | null = null; // soft clipping
let engineCompressor: DynamicsCompressorNode | null = null; // dynamics control

// Engine control values (0–1 normalized)
let engineCutoff = 1.0; // 1.0 = 20kHz (fully open, identity)
let engineResonance = 0.0; // 0.0 = Q=0.707 (flat, identity)
let engineSatAmount = 0.0; // 0.0 = no distortion (identity)
let engineCompAmount = 0.0; // 0.0 = threshold=0dB (no compression, identity)

/**
 * Generate a tanh-based soft-clipping curve for the WaveShaperNode.
 * amount=0 returns null (identity). amount=1 returns heavy clipping.
 */
export function makeSaturationCurve(amount: number): Float32Array<ArrayBuffer> | null {
  if (amount < 0.001) return null; // identity
  const samples = 8192;
  const curve = new Float32Array(new ArrayBuffer(samples * 4));
  const k = 1 + amount * 9; // 1 (gentle) to 10 (heavy)
  const norm = Math.tanh(k); // normalize so output stays in [-1, 1]
  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 2 - 1; // -1 to +1
    curve[i] = Math.tanh(k * x) / norm;
  }
  return curve;
}

/**
 * Map a 0–1 cutoff slider value to a frequency in Hz.
 * Exponential mapping: 0→200Hz, 0.5→~2kHz, 1→20000Hz.
 */
export function cutoffToFreq(v: number): number {
  // Exponential: 200 * (100^v) → 200 at v=0, 20000 at v=1
  return 200 * Math.pow(100, v);
}

/**
 * Map a 0–1 resonance slider value to BiquadFilter Q.
 * 0→0.707 (flat), 1→15 (sharp resonant peak).
 */
export function resonanceToQ(v: number): number {
  return 0.707 + v * 14.293; // 0.707 to 15
}

/**
 * Map a 0–1 compression slider value to DynamicsCompressor threshold in dB.
 * 0→0dB (no compression), 1→-60dB (heavy compression).
 */
export function compToThreshold(v: number): number {
  return -v * 60; // 0 to -60
}

/** Apply current engine control values to the real audio nodes. */
function applyEngineParams(): void {
  if (engineFilter) {
    engineFilter.frequency.value = cutoffToFreq(engineCutoff);
    engineFilter.Q.value = resonanceToQ(engineResonance);
  }
  if (engineSaturation) {
    engineSaturation.curve = makeSaturationCurve(engineSatAmount);
  }
  if (engineCompressor) {
    engineCompressor.threshold.value = compToThreshold(engineCompAmount);
  }
}

import type { EngineSettings } from '../types';
export type { EngineSettings } from '../types';

export function getEngineSettings(): EngineSettings {
  return {
    cutoff: engineCutoff,
    resonance: engineResonance,
    saturation: engineSatAmount,
    compression: engineCompAmount,
  };
}

export function setEngineSettings(settings: EngineSettings): void {
  engineCutoff = settings.cutoff;
  engineResonance = settings.resonance;
  engineSatAmount = settings.saturation;
  engineCompAmount = settings.compression;
  applyEngineParams();
  emit('engine:settingsRestored', {});
}

export function bindEngineNodes(
  filter: BiquadFilterNode,
  saturation: WaveShaperNode,
  compressor: DynamicsCompressorNode,
): void {
  engineFilter = filter;
  engineSaturation = saturation;
  engineCompressor = compressor;
  applyEngineParams();
}
