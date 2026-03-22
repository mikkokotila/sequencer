/**
 * Audio engine — canonical studio signal flow.
 *
 * Per channel:
 *   samples → trackGain → channelFader → channelPan → mixBus
 *                                              ↓
 *                          post-fader post-pan aux sends → Reverb/Delay buses
 *
 * FX buses:
 *   reverbBus → freeverb → reverbReturn → mixBus
 *   delayBus  → delay    → delayReturn  → mixBus
 *
 * Master chain:
 *   mixBus → masterTrim → [Pultec EQ] → [Vari-Mu] → [Transformer] → [Limiter] → destination
 */

import { TOTAL_TRACKS } from '../config';
import type { LoadedSample } from '../types';
import { loadAllWorklets } from './worklet-loader';
import { applyEnvelope, isAdsrEnabled } from './adsr';

// ── Module state ──
let audioCtx: AudioContext | null = null;

// Per-channel nodes
const trackGains: GainNode[] = []; // sample playback target
const channelFaders: GainNode[] = []; // user-controlled level
const channelPans: StereoPannerNode[] = []; // pan position

// Mixing
let mixBus: GainNode | null = null; // single summing point for all dry + FX returns
let masterTrim: GainNode | null = null; // gain staging before master chain
let masterGain: GainNode | null = null; // first node in master insert chain

// Final output — master chain connects to this (defaults to ctx.destination)
let finalOutput: AudioNode | null = null;

// Persistent preview gain — reused for all sample previews (avoids node accumulation)
let previewGain: GainNode | null = null;

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

export function getChannelFaders(): GainNode[] {
  return channelFaders;
}

export function getChannelPans(): StereoPannerNode[] {
  return channelPans;
}

export function getMixBus(): GainNode | null {
  return mixBus;
}

export function getMasterTrim(): GainNode | null {
  return masterTrim;
}

export function getFinalOutput(): AudioNode | null {
  return finalOutput;
}

export function setFinalOutput(node: AudioNode): void {
  finalOutput = node;
}

/**
 * Initialize the AudioContext and the full channel strip routing.
 * Safe to call multiple times — only creates once.
 *
 * Signal flow per channel:
 *   trackGain[i] → channelFader[i] → channelPan[i] → mixBus
 *
 * Mix bus to master:
 *   mixBus → masterTrim → masterGain → [master chain] → destination
 */
export function initAudio(): void {
  if (!audioCtx) {
    audioCtx = new AudioContext();

    // Mix bus — the single summing point for ALL sources
    mixBus = audioCtx.createGain();
    mixBus.gain.value = 1.0;

    // Master trim — gain staging before master chain processors
    masterTrim = audioCtx.createGain();
    masterTrim.gain.value = 1.0; // unity by default

    // Master gain — first node of master insert chain
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.8; // headroom

    // Default output
    finalOutput = audioCtx.destination;

    // Persistent preview gain (reused, not recreated per preview)
    previewGain = audioCtx.createGain();
    previewGain.gain.value = 1;
    previewGain.connect(mixBus);

    // Wire: mixBus → masterTrim → masterGain → destination
    mixBus.connect(masterTrim);
    masterTrim.connect(masterGain);
    masterGain.connect(finalOutput);

    // Create per-channel strip: trackGain → fader → pan → mixBus
    for (let i = 0; i < TOTAL_TRACKS; i++) {
      const tg = audioCtx.createGain(); // sample target
      const fader = audioCtx.createGain();
      fader.gain.value = 0.8; // default channel level
      const pan = audioCtx.createStereoPanner();
      pan.pan.value = 0; // center

      tg.connect(fader);
      fader.connect(pan);
      pan.connect(mixBus);

      trackGains.push(tg);
      channelFaders.push(fader);
      channelPans.push(pan);
    }
  }
  if (audioCtx.state === 'suspended') {
    void audioCtx.resume();
  }
}

/**
 * Load all AudioWorklet processors into the current AudioContext.
 */
export async function loadWorklets(): Promise<void> {
  if (!audioCtx) return;
  await loadAllWorklets(audioCtx);
}

/**
 * Play a sample at a given time with optional playback rate, destination, and ADSR envelope.
 *
 * When trackIndex and stepDuration are provided, an ADSR envelope GainNode
 * is inserted between the source and destination.
 */
export function playSample(
  buffer: AudioBuffer,
  time: number,
  rate?: number,
  dest?: AudioNode,
  trackIndex?: number,
  stepDuration?: number,
): AudioBufferSourceNode | null {
  if (!audioCtx) return null;
  const src = audioCtx.createBufferSource();
  src.buffer = buffer;
  if (rate !== undefined) src.playbackRate.value = rate;

  const target = dest ?? mixBus ?? audioCtx.destination;

  if (trackIndex !== undefined && isAdsrEnabled(trackIndex)) {
    // Apply ADSR envelope between source and destination
    applyEnvelope(audioCtx, src, target, trackIndex, time, stepDuration);
  } else {
    src.connect(target);
  }

  src.start(time);
  return src;
}

/**
 * Play a sample immediately for UI preview.
 */
export function playPreviewSample(
  buffer: AudioBuffer,
  rate?: number,
  prevSource?: AudioBufferSourceNode | null,
): AudioBufferSourceNode | null {
  if (!audioCtx || !previewGain) return null;

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
  src.connect(previewGain);
  src.start(0);
  return src;
}

/**
 * Load an audio file from a File input.
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
  const name = url.split('/').pop() ?? 'sample';
  return { buffer, data: ab, name };
}
