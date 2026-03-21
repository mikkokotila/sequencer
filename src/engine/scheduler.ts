/**
 * Scheduler — Tone.js Transport for tempo-accurate scheduling,
 * AudioBufferSourceNode for sample playback.
 * NO DOM access. Emits events for UI playhead.
 */

import * as Tone from 'tone';
import { STEPS, DRUMS_CFG, MEL_CFG, HARMONY_SEMITONES } from '../config';
import { getAudioContext, getTrackGains, initAudio, playSample } from './audio';
import { phrases, octaves, harmonies } from '../transport/patterns';
import { drumBuf, melBuf, vocalBuf, mutedArr, bpm as getBpm } from '../transport/song';
import { emit } from '../events';

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
//  PHRASE QUERIES (re-exported from patterns)
// ═══════════════════════════════════════════
export {
  isPhraseEmpty,
  findNextPhrase,
  findFirstNonEmpty,
  fillWithPrev,
} from '../transport/patterns';
import {
  isPhraseEmpty as _isPhraseEmpty,
  findNextPhrase as _findNextPhrase,
  findFirstNonEmpty as _findFirstNonEmpty,
} from '../transport/patterns';

// ═══════════════════════════════════════════
//  PHRASE ADVANCE
// ═══════════════════════════════════════════

function advancePhrase(): void {
  const next = _findNextPhrase(playingPhrase);
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
  if (!ctx) return;

  const s = curStep;
  const phrase = phrases[playingPhrase];
  if (!phrase) return;

  const pd = phrase.drumPat;
  const pm = phrase.melPat;
  const pv = phrase.vocalPat;
  const gains = getTrackGains();

  // Drums
  for (let t = 0; t < DRUMS_CFG.length; t++) {
    const row = pd[t];
    const buf = drumBuf[t];
    const gain = gains[t];
    if (row?.[s] && buf && !mutedArr[t] && gain) {
      playSample(buf, time, undefined, gain);
    }
  }

  // Melody
  for (let t = 0; t < MEL_CFG.length; t++) {
    const buf = melBuf[t];
    const trackIdx = DRUMS_CFG.length + t;
    if (!buf || mutedArr[trackIdx]) continue;
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
      const oct = octaves[t];
      if (oct === undefined) continue;
      const rate = Math.pow(2, ((oct - 1) * 12 + n) / 12);
      playSample(buf, time, rate, dest);

      // Harmony interval for poly tracks with exactly 1 note
      if (activeNotes.length === 1 && cfg && !cfg.mono) {
        const harmIdx = harmonies[t];
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
  if (pv[s] && vocalBuf && !mutedArr[vocalIdx]) {
    const dest = gains[vocalIdx];
    if (dest) {
      playSample(vocalBuf, time, undefined, dest);
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
  initAudio();

  playing = true;
  curStep = 0;
  playingPhrase = _findFirstNonEmpty();

  // Sync Tone.js BPM
  Tone.getTransport().bpm.value = getBpm;

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
