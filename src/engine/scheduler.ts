/**
 * Sample-accurate scheduling on the engine's single AudioContext.
 * A 350 ms queue survives the measured 180 ms main-thread stalls. Pattern and
 * tempo edits take effect at the first unqueued step.
 * Audible position is independent of this scheduling cursor.
 */
import { STEPS, DRUMS_CFG, MEL_CFG, HARMONY_SEMITONES } from '../config';
import {
  getAudioContext,
  getTrackGains,
  playSample,
  stopSequencerVoicesNow,
  SEQUENCER_LEAD_SECONDS,
} from './audio';
import { getOutputTime } from './output-clock';
import type { Phrase, SongTheory } from '../types';
import { emit } from '../events';
import { isHarmonyDisabled, melodyNotes } from '../transport/notes';
import { snapToScale } from '../transport/theory';

export interface TransportSource {
  readonly phrases: Phrase[];
  readonly octaves: number[];
  readonly harmonies: number[];
  readonly drumBuf: (AudioBuffer | null)[];
  readonly melBuf: (AudioBuffer | null)[];
  readonly mutedArr: boolean[];
  getVocalBuf(): AudioBuffer | null;
  getBpm(): number;
  getTheory?(): SongTheory;
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

interface ScheduledStep {
  step: number;
  phrase: number;
  time: number;
}

const LOOKAHEAD = 0.35;
const TICK_MS = 25;
let playing = false;
let curStep = 0;
let queuedPhrase = 0;
let playingPhrase = -1;
let nextStepTime = 0;
let tempo = 120;
let startPending = false;
let startNonce = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let frame = 0;
const visualQueue: ScheduledStep[] = [];
let onPhraseChange: (() => void) | null = null;
const stopCallbacks: (() => void)[] = [];

export function setOnPhraseChange(fn: () => void): void {
  onPhraseChange = fn;
}
export function onStop(fn: () => void): void {
  stopCallbacks.push(fn);
}
export function isPlaying(): boolean {
  return playing;
}
/** The phrase at the output device, never the lookahead cursor. */
export function getPlayingPhrase(): number {
  return playingPhrase;
}
/** Queue a phrase jump without moving its marker ahead of its sound. */
export function setPlayingPhrase(p: number): void {
  if (!transport?.phrases[p]) return;
  queuedPhrase = p;
}

function scheduleStep(time: number, s: number, stepPhrase: number, stepDur: number): void {
  if (!transport) return;
  const phrase = transport.phrases[stepPhrase];
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
    if (row?.[s] && !transport.mutedArr[t]) {
      emit('engine:trigger', {
        track: t,
        step: s,
        phrase: stepPhrase,
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

    const activeNotes = melodyNotes(phrase, t, s);

    for (const n of activeNotes) {
      const oct = transport.octaves[t];
      if (oct === undefined) continue;
      const rate = Math.pow(2, ((oct - 1) * 12 + n) / 12);
      emit('engine:trigger', {
        track: trackIdx,
        step: s,
        phrase: stepPhrase,
        time,
        source: 'melody',
      });
      playSample(buf, time, rate, dest, trackIdx, stepDur);

      // Harmony interval for poly tracks with exactly 1 note
      if (activeNotes.length === 1 && cfg && !cfg.mono && !isHarmonyDisabled(phrase, t, s)) {
        const harmIdx = transport.harmonies[t];
        if (harmIdx !== undefined && harmIdx > 0) {
          const semitones = HARMONY_SEMITONES[harmIdx];
          if (semitones !== undefined) {
            const key = transport.getTheory?.();
            const harmony = key?.locked ? snapToScale(n + semitones, key) : n + semitones;
            const harmRate = Math.pow(2, ((oct - 1) * 12 + harmony) / 12);
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
      phrase: stepPhrase,
      time,
      source: 'vocal',
    });
    const dest = gains[vocalIdx];
    if (dest && vb) {
      playSample(vb, time, undefined, dest, vocalIdx, stepDur);
    }
  }

  visualQueue.push({ step: s, phrase: stepPhrase, time });
}

function pump(): void {
  const ctx = getAudioContext();
  if (!playing || !ctx || !transport || ctx.state !== 'running') return;
  // If a suspension longer than the queue occurs, resume with a shared future
  // deadline. Never submit a burst of overdue sources across audio blocks.
  if (nextStepTime < ctx.currentTime + 0.01) {
    nextStepTime = ctx.currentTime + SEQUENCER_LEAD_SECONDS;
  }
  const horizon = ctx.currentTime + LOOKAHEAD;
  while (nextStepTime < horizon) {
    const duration = 60 / tempo / 4;
    scheduleStep(nextStepTime, curStep, queuedPhrase, duration);
    nextStepTime += duration;
    curStep++;
    if (curStep === STEPS) {
      curStep = 0;
      const next = transport.findNextPhrase(queuedPhrase);
      if (next < 0) {
        stopPlayback();
        return;
      }
      queuedPhrase = next;
    }
  }
}

function paintOutput(): void {
  if (!playing) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = getOutputTime(ctx);
  let audible: ScheduledStep | undefined;
  // A long frame cannot be painted retroactively. Show the current audible
  // step on recovery, rather than replaying a backlog of obsolete highlights.
  while (visualQueue[0] && visualQueue[0].time <= now) {
    audible = visualQueue.shift();
  }
  if (audible) {
    const changed = playingPhrase !== audible.phrase;
    playingPhrase = audible.phrase;
    emit('engine:step', audible);
    if (changed) onPhraseChange?.();
  }
  frame = requestAnimationFrame(paintOutput);
}

export function startPlayback(): void {
  const ctx = getAudioContext();
  if (playing || startPending || !transport || ctx?.state !== 'running') return;
  playing = true;
  emit('engine:start', {});
  curStep = 0;
  queuedPhrase = transport.findFirstNonEmpty();
  playingPhrase = -1;
  visualQueue.length = 0;
  syncBpm(transport.getBpm());
  nextStepTime = ctx.currentTime + SEQUENCER_LEAD_SECONDS;
  pump();
  timer = setInterval(pump, TICK_MS);
  frame = requestAnimationFrame(paintOutput);
  onPhraseChange?.();
}

export function stopPlayback(): void {
  startNonce++;
  startPending = false;
  playing = false;
  if (timer !== null) clearInterval(timer);
  timer = null;
  cancelAnimationFrame(frame);
  visualQueue.length = 0;
  stopSequencerVoicesNow();
  curStep = 0;
  playingPhrase = -1;
  emit('engine:stop', {} as Record<string, never>);
  for (const fn of stopCallbacks) {
    try {
      fn();
    } catch {
      /* A listener must not prevent transport cleanup. */
    }
  }
  onPhraseChange?.();
}

export function togglePlay(): void {
  if (playing || startPending) {
    stopPlayback();
    return;
  }
  const ctx = getAudioContext();
  if (!ctx || !transport) return;
  const req = ++startNonce;
  startPending = true;
  void ctx
    .resume()
    .then(() => {
      if (req !== startNonce) return;
      startPending = false;
      startPlayback();
    })
    .catch(() => {
      if (req === startNonce) startPending = false;
    });
}

/** Already submitted steps retain their timestamps; tempo changes never overlap them. */
export function syncBpm(newBpm: number): void {
  tempo = Number.isFinite(newBpm) ? Math.max(40, Math.min(220, newBpm)) : 120;
}
