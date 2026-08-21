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
import { getAudioContext, getTrackGains, playSample, stopSequencerVoicesNow } from './audio';
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
let startPending = false;
let startNonce = 0;

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
//  VISUAL SYNC
// ═══════════════════════════════════════════

/**
 * Run a UI-facing callback at the AudioContext time the step is actually heard.
 *
 * Tone.Transport callbacks fire inside the scheduling lookahead — measured here
 * at 49-91ms (median 83ms) ahead of the audio. Painting the playhead straight
 * from that callback puts the highlight ~2/3 of a 16th note ahead of the sound
 * at 120 BPM, and more than a full step ahead above ~180 BPM. Tone.Draw exists
 * for exactly this: it re-times the callback onto the animation frame nearest
 * the given AudioContext time.
 */
function scheduleVisual(fn: () => void, time: number): void {
  Tone.getDraw().schedule(fn, time);
}

/** Drop any visual callbacks still queued from the lookahead window. */
function cancelPendingVisuals(): void {
  Tone.getDraw().cancel(0);
}

// ═══════════════════════════════════════════
//  PHRASE ADVANCE
// ═══════════════════════════════════════════

function advancePhrase(time: number): void {
  if (!transport) return;
  const next = transport.findNextPhrase(playingPhrase);
  if (next < 0) {
    stopPlayback();
    return;
  }
  playingPhrase = next;
  // Defer to audio time — the phrase only actually changes when the step sounds.
  scheduleVisual(() => onPhraseChange?.(), time);
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

  // Step duration for ADSR release scheduling (16th note at current BPM)
  const stepDur = 60 / transport.getBpm() / 4;

  // Drums
  for (let t = 0; t < DRUMS_CFG.length; t++) {
    const row = pd[t];
    const buf = transport.drumBuf[t];
    const gain = gains[t];
    if (row?.[s] && !transport.mutedArr[t]) {
      emit('engine:trigger', {
        track: t,
        step: s,
        phrase: playingPhrase,
        time,
        source: 'drum',
      });
      if (buf && gain) {
        playSample(buf, time, undefined, gain, t, stepDur);
      }
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
      emit('engine:trigger', {
        track: trackIdx,
        step: s,
        phrase: playingPhrase,
        time,
        source: 'melody',
      });
      playSample(buf, time, rate, dest, trackIdx, stepDur);

      // Harmony interval for poly tracks with exactly 1 note
      if (activeNotes.length === 1 && cfg && !cfg.mono) {
        const harmIdx = transport.harmonies[t];
        if (harmIdx !== undefined && harmIdx > 0) {
          const semitones = HARMONY_SEMITONES[harmIdx];
          if (semitones !== undefined) {
            const harmRate = Math.pow(2, ((oct - 1) * 12 + n + semitones) / 12);
            playSample(buf, time, harmRate, dest, trackIdx, stepDur);
          }
        }
      }
    }
  }

  // Vocal
  const vocalIdx = DRUMS_CFG.length + MEL_CFG.length;
  const vb = transport.getVocalBuf();
  if (pv[s] && !transport.mutedArr[vocalIdx]) {
    emit('engine:trigger', {
      track: vocalIdx,
      step: s,
      phrase: playingPhrase,
      time,
      source: 'vocal',
    });
    const dest = gains[vocalIdx];
    if (dest && vb) {
      playSample(vb, time, undefined, dest, vocalIdx, stepDur);
    }
  }

  // Emit step event for UI playhead (no DOM here). Deferred to the step's own
  // audio time so the highlight lands with the sound, not a lookahead early.
  const stepPhrase = playingPhrase;
  scheduleVisual(() => {
    emit('engine:step', { step: s, phrase: stepPhrase });
  }, time);

  // Advance step
  curStep++;
  if (curStep >= STEPS) {
    curStep = 0;
    advancePhrase(time);
  }
}

// ═══════════════════════════════════════════
//  TRANSPORT
// ═══════════════════════════════════════════

/** Start playback using Tone.Transport. */
export function startPlayback(): void {
  if (playing || startPending) return;
  if (!transport) return;
  playing = true;
  curStep = 0;
  playingPhrase = transport.findFirstNonEmpty();

  const tr = Tone.getTransport();

  // Defensive cleanup: prevent duplicate repeat callbacks from prior races.
  if (scheduledEventId !== null) {
    tr.clear(scheduledEventId);
    scheduledEventId = null;
  }
  tr.cancel(0);
  cancelPendingVisuals();

  // Sync Tone.js BPM
  tr.bpm.value = transport.getBpm();
  tr.position = 0;

  // Schedule repeating callback: 16th notes (4 per beat)
  scheduledEventId = tr.scheduleRepeat((time) => {
    scheduleStep(time);
  }, '16n');

  tr.start();
  onPhraseChange?.();
}

/** Stop playback. */
export function stopPlayback(): void {
  startNonce++;
  startPending = false;
  playing = false;
  const tr = Tone.getTransport();

  if (scheduledEventId !== null) {
    tr.clear(scheduledEventId);
    scheduledEventId = null;
  }
  tr.cancel(0);
  tr.stop();
  tr.position = 0;
  stopSequencerVoicesNow();

  // Drop lookahead-queued visuals first, otherwise one can land after the
  // clear below and leave a highlighted column behind on a stopped transport.
  cancelPendingVisuals();

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
  if (playing || startPending) {
    stopPlayback();
  } else {
    const req = ++startNonce;
    startPending = true;
    void Tone.start()
      .then(() => {
        if (req !== startNonce) return;
        startPending = false;
        startPlayback();
      })
      .catch(() => {
        if (req === startNonce) startPending = false;
      });
  }
}

/** Update BPM on the Tone.Transport (call when user changes BPM). */
export function syncBpm(newBpm: number): void {
  Tone.getTransport().bpm.value = newBpm;
}
