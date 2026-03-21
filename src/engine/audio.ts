/**
 * Audio engine — AudioContext lifecycle, sample playback, file loading.
 */

import { TOTAL_TRACKS } from '../config';
import type { LoadedSample } from '../types';
import { loadAllWorklets } from './worklet-loader';

// ── Module state ──
let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;
const trackGains: GainNode[] = [];
// Engine processing output — everything ultimately connects here.
// By default it's ctx.destination. The engine panel replaces it
// with its processing chain (filter → saturator → compressor → destination).
let finalOutput: AudioNode | null = null;

// ── Accessors ──
export function getAudioContext(): AudioContext | null {
  return audioCtx;
}

export function getMasterGain(): GainNode | null {
  return masterGain;
}

export function getTrackGains(): GainNode[] {
  return trackGains;
}

/** Get the final output node (engine processing input, or ctx.destination). */
export function getFinalOutput(): AudioNode | null {
  return finalOutput;
}

/** Set the final output node (called by engine panel during init). */
export function setFinalOutput(node: AudioNode): void {
  finalOutput = node;
}

/**
 * Initialize the AudioContext, masterGain, and per-track gain nodes.
 * Safe to call multiple times — only creates once.
 */
export function initAudio(): void {
  if (!audioCtx) {
    audioCtx = new AudioContext();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.8; // headroom for summing
    finalOutput = audioCtx.destination;
    masterGain.connect(finalOutput);

    // Create per-track gain nodes
    for (let i = 0; i < TOTAL_TRACKS; i++) {
      const g = audioCtx.createGain();
      g.connect(masterGain);
      trackGains.push(g);
    }
  }
  if (audioCtx.state === 'suspended') {
    void audioCtx.resume();
  }
}

/**
 * Load all AudioWorklet processors into the current AudioContext.
 * Must be called after initAudio() and before creating any AudioWorkletNodes.
 */
export async function loadWorklets(): Promise<void> {
  if (!audioCtx) return;
  await loadAllWorklets(audioCtx);
}

/**
 * Play a sample at a given time with optional playback rate and destination.
 * Returns the source node (can be used to stop it).
 */
export function playSample(
  buffer: AudioBuffer,
  time: number,
  rate?: number,
  dest?: AudioNode,
): AudioBufferSourceNode | null {
  if (!audioCtx) return null;
  const src = audioCtx.createBufferSource();
  src.buffer = buffer;
  if (rate !== undefined) src.playbackRate.value = rate;
  src.connect(dest ?? masterGain ?? audioCtx.destination);
  src.start(time);
  return src;
}

/**
 * Play a sample immediately for UI preview.
 * Optionally pass a previous source to stop it (soft cutoff).
 */
export function playPreviewSample(
  buffer: AudioBuffer,
  rate?: number,
  prevSource?: AudioBufferSourceNode | null,
): AudioBufferSourceNode | null {
  if (!audioCtx || !masterGain) return null;

  // Soft-stop previous preview
  if (prevSource) {
    try {
      prevSource.stop();
    } catch {
      // already stopped
    }
  }

  const src = audioCtx.createBufferSource();
  src.buffer = buffer;
  if (rate !== undefined) src.playbackRate.value = rate;

  // Use a dedicated gain for preview with fade envelope
  const previewGain = audioCtx.createGain();
  previewGain.gain.value = 1;
  previewGain.connect(masterGain);
  src.connect(previewGain);
  src.start(0);
  return src;
}

/**
 * Load an audio file from a File input, returning the decoded buffer
 * and the raw ArrayBuffer (for persistence).
 */
export async function loadAudioFile(file: File): Promise<LoadedSample> {
  initAudio();
  const ab = await file.arrayBuffer();
  const buffer = await audioCtx!.decodeAudioData(ab.slice(0));
  return { buffer, data: ab, name: file.name };
}

/**
 * Fetch and decode an audio file from a URL.
 */
export async function fetchAndDecode(url: string): Promise<LoadedSample> {
  initAudio();
  const resp = await fetch(url);
  const ab = await resp.arrayBuffer();
  const buffer = await audioCtx!.decodeAudioData(ab.slice(0));
  // Extract filename from URL
  const name = url.split('/').pop() ?? 'sample';
  return { buffer, data: ab, name };
}
