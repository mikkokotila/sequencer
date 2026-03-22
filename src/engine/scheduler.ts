/**
 * Scheduler — Tone.js Transport for tempo-accurate scheduling,
 * AudioBufferSourceNode for sample playback.
 * NO DOM access. NO direct transport imports. Emits events for UI playhead.
 *
 * Transport data is injected via bindTransport() from main.ts,
 * keeping the engine→transport boundary clean.
 */

import * as Tone from 'tone';
import { STEPS, DRUMS_CFG, MEL_CFG, HARMONY_SEMITONES } from '../config';
import { getAudioContext, getTrackGains, playSample } from './audio';
import type { Phrase } from '../types';
import { emit } from '../events';

// ═══════════════════════════════════════════
//  Transport data source (injected, not imported)
// ═══════════════════════════════════════════

export interface TransportSource {
  readonly phrases: Phrase[];
  readonly octaves: number[];
  readonly harmonies: number[];
  readonly drumBuf: (AudioBuffer | null)[];
  readonly melBuf: (AudioBuffer | null)[];
  readonly mutedArr: boolean[];
  getVocalBuf(): AudioBuffer | null;
  getBpm(): number;
  isPhraseEmpty(idx: number): boolean;
  findNextPhrase(from: number): number;
  findFirstNonEmpty(): number;
}

let transport: TransportSource | null = null;

/**
 * Bind transport data source. Must be called once from main.ts
 * before playback can start.
 */
export function bindTransport(src: TransportSource): void {
  transport = src;
}

// ── Internal state ──
let playing = false;
let curStep = 0;
let playingPhrase = 0;
let scheduledEventId: number | null = null;

// ── Callbacks ──
let onPhraseChange: (() => void) | null = null;
const stopCallbacks: (() => void)[] = [];

export function setOnPhraseChange(fn: () => void): void {
  onPhraseChange = fn;
}
export function onStop(fn: () => void): void {
  stopCallbacks.push(fn);
}

// ── Accessors ──
export function isPlaying(): boolean {
  return playing;
}
export function getPlayingPhrase(): number {
  return playingPhrase;
}
export function setPlayingPhrase(p: number): void {
  playingPhrase = p;
}

// ═══════════════════════════════════════════
//  PHRASE ADVANCE
// ═══════════════════════════════════════════

function advancePhrase(): void {
  if (!transport) return;
  const next = transport.findNextPhrase(playingPhrase);
  if (next < 0) {
    stopPlayback();
    return;
  }
  playingPhrase = next;
  onPhraseChange?.();
}

// ═══════════════════════════════════════════
//  STEP SCHEDULING (called by Tone.Transport)
// ═══════════════════════════════════════════

function scheduleStep(time: number): void {
  const ctx = getAudioContext();
  if (!ctx || !transport) return;

  const s = curStep;
  const phrase = transport.phrases[playingPhrase];
  if (!phrase) return;

  const pd = phrase.drumPat;
  const pm = phrase.melPat;
  const pv = phrase.vocalPat;
  const gains = getTrackGains();

  // Drums
  for (let t = 0; t < DRUMS_CFG.length; t++) {
    const row = pd[t];
    const buf = transport.drumBuf[t];
    const gain = gains[t];
    if (row?.[s] && buf && !transport.mutedArr[t] && gain) {
      playSample(buf, time, undefined, gain);
    }
  }

  // Melody
  for (let t = 0; t < MEL_CFG.length; t++) {
    const buf = transport.melBuf[t];
    const trackIdx = DRUMS_CFG.length + t;
    if (!buf || transport.mutedArr[trackIdx]) continue;
    const dest = gains[trackIdx];
    if (!dest) continue;
    const cfg = MEL_CFG[t];

    const trackPat = pm[t];
    const stepPat = trackPat?.[s];
    if (!stepPat) continue;

    const activeNotes: number[] = [];
    for (let n = 0; n < 12; n++) {
      if (stepPat[n]) activeNotes.push(n);
    }

    for (const n of activeNotes) {
      const oct = transport.octaves[t];
      if (oct === undefined) continue;
      const rate = Math.pow(2, ((oct - 1) * 12 + n) / 12);
      playSample(buf, time, rate, dest);

      // Harmony interval for poly tracks with exactly 1 note
      if (activeNotes.length === 1 && cfg && !cfg.mono) {
        const harmIdx = transport.harmonies[t];
        if (harmIdx !== undefined && harmIdx > 0) {
          const semitones = HARMONY_SEMITONES[harmIdx];
          if (semitones !== undefined) {
            const harmRate = Math.pow(2, ((oct - 1) * 12 + n + semitones) / 12);
            playSample(buf, time, harmRate, dest);
          }
        }
      }
    }
  }

  // Vocal
  const vocalIdx = DRUMS_CFG.length + MEL_CFG.length;
  const vb = transport.getVocalBuf();
  if (pv[s] && vb && !transport.mutedArr[vocalIdx]) {
    const dest = gains[vocalIdx];
    if (dest) {
      playSample(vb, time, undefined, dest);
    }
  }

  // Emit step event for UI playhead (no DOM here)
  emit('engine:step', { step: s, phrase: playingPhrase });

  // Advance step
  curStep++;
  if (curStep >= STEPS) {
    curStep = 0;
    advancePhrase();
  }
}

// ═══════════════════════════════════════════
//  TRANSPORT
// ═══════════════════════════════════════════

/** Start playback using Tone.Transport. */
export function startPlayback(): void {
  if (!transport) return;
  playing = true;
  curStep = 0;
  playingPhrase = transport.findFirstNonEmpty();

  // Sync Tone.js BPM
  Tone.getTransport().bpm.value = transport.getBpm();

  // Schedule repeating callback: 16th notes (4 per beat)
  scheduledEventId = Tone.getTransport().scheduleRepeat((time) => {
    scheduleStep(time);
  }, '16n');

  Tone.getTransport().start();
  onPhraseChange?.();
}

/** Stop playback. */
export function stopPlayback(): void {
  playing = false;

  if (scheduledEventId !== null) {
    Tone.getTransport().clear(scheduledEventId);
    scheduledEventId = null;
  }
  Tone.getTransport().stop();
  Tone.getTransport().position = 0;

  curStep = 0;

  // Notify UI to clear playhead
  emit('engine:stop', {} as Record<string, never>);

  for (const fn of stopCallbacks) {
    try {
      fn();
    } catch {
      /* swallow */
    }
  }

  onPhraseChange?.();
}

/** Toggle play/stop. */
export function togglePlay(): void {
  if (playing) {
    stopPlayback();
  } else {
    void Tone.start().then(() => {
      startPlayback();
    });
  }
}

/** Update BPM on the Tone.Transport (call when user changes BPM). */
export function syncBpm(newBpm: number): void {
  Tone.getTransport().bpm.value = newBpm;
}
