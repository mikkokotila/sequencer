/**
 * Scheduler — phrase management, audio scheduling loop, transport controls.
 */

import { STEPS, NUM_PHRASES, DRUMS_CFG, MEL_CFG, VOCAL_CFG, HARMONY_SEMITONES } from './config';
import { getAudioContext, getTrackGains, initAudio, playSample } from './audio';
import { displayToSemitone } from './ui/helpers';
import {
  phrases,
  drumPat,
  melPat,
  vocalPat,
  currentPhrase,
  drumBuf,
  melBuf,
  vocalBuf,
  mutedArr,
  octaves,
  harmonies,
  drumCells,
  melCells,
  vocalCells,
  bpm,
  playing,
  curStep,
  nextTime,
  timer,
  prevVisualStep,
  playingPhrase,
  seqStopCallbacks,
  setPlaying,
  setCurStep,
  setNextTime,
  setTimer,
  setPrevVisualStep,
  setPlayingPhrase,
} from './state';

// ═══════════════════════════════════════════
//  UI CALLBACK HOOKS
// ═══════════════════════════════════════════

let onPhraseChange: (() => void) | null = null;
let onScheduleSave: (() => void) | null = null;

export function setOnPhraseChange(fn: () => void): void {
  onPhraseChange = fn;
}

export function setOnScheduleSave(fn: () => void): void {
  onScheduleSave = fn;
}

// ═══════════════════════════════════════════
//  PHRASE QUERIES
// ═══════════════════════════════════════════

/** Check whether a phrase has any active steps across all tracks. */
export function isPhraseEmpty(idx: number): boolean {
  const p = phrases[idx];
  if (!p) return true;
  for (let t = 0; t < DRUMS_CFG.length; t++) {
    const row = p.drumPat[t];
    if (!row) continue;
    for (let s = 0; s < STEPS; s++) {
      if (row[s]) return false;
    }
  }
  for (let t = 0; t < MEL_CFG.length; t++) {
    const track = p.melPat[t];
    if (!track) continue;
    for (let s = 0; s < STEPS; s++) {
      const step = track[s];
      if (!step) continue;
      for (let n = 0; n < 12; n++) {
        if (step[n]) return false;
      }
    }
  }
  for (let s = 0; s < STEPS; s++) {
    if (p.vocalPat[s]) return false;
  }
  return true;
}

/** Find the next non-empty phrase after fromIdx, wrapping around. Returns -1 if all empty. */
export function findNextPhrase(fromIdx: number): number {
  for (let i = 1; i <= NUM_PHRASES; i++) {
    const idx = (fromIdx + i) % NUM_PHRASES;
    if (!isPhraseEmpty(idx)) return idx;
  }
  return -1;
}

/** Find the first non-empty phrase. Returns 0 if all are empty. */
export function findFirstNonEmpty(): number {
  for (let i = 0; i < NUM_PHRASES; i++) {
    if (!isPhraseEmpty(i)) return i;
  }
  return 0;
}

/** Deep-copy the previous phrase's patterns into the given phrase index. */
export function fillWithPrev(idx: number): void {
  if (idx <= 0) return;
  const prev = phrases[idx - 1];
  const cur = phrases[idx];
  if (!prev || !cur) return;

  for (let t = 0; t < DRUMS_CFG.length; t++) {
    const prevRow = prev.drumPat[t];
    const curRow = cur.drumPat[t];
    if (!prevRow || !curRow) continue;
    for (let s = 0; s < STEPS; s++) {
      curRow[s] = prevRow[s]!;
    }
  }
  for (let t = 0; t < MEL_CFG.length; t++) {
    const prevTrack = prev.melPat[t];
    const curTrack = cur.melPat[t];
    if (!prevTrack || !curTrack) continue;
    for (let s = 0; s < STEPS; s++) {
      const prevStep = prevTrack[s];
      const curStep_ = curTrack[s];
      if (!prevStep || !curStep_) continue;
      for (let n = 0; n < 12; n++) {
        curStep_[n] = prevStep[n]!;
      }
    }
  }
  for (let s = 0; s < STEPS; s++) {
    cur.vocalPat[s] = prev.vocalPat[s]!;
  }

  if (currentPhrase === idx) {
    // The caller's refreshUI will pick up the new pattern via the active references.
    // We just need to notify.
  }
  onPhraseChange?.();
  onScheduleSave?.();
}

// ═══════════════════════════════════════════
//  PHRASE ADVANCE (called when curStep wraps)
// ═══════════════════════════════════════════

function advancePhrase(): void {
  const next = findNextPhrase(playingPhrase);
  if (next < 0) {
    stopPlayback();
    return;
  }
  setPlayingPhrase(next);
  onPhraseChange?.();
}

// ═══════════════════════════════════════════
//  SCHEDULER LOOP
// ═══════════════════════════════════════════

/** The main 25ms scheduling loop. Looks ahead 100ms and schedules audio events. */
function scheduler(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  while (nextTime < ctx.currentTime + 0.1) {
    scheduleStep(curStep, nextTime);
    setNextTime(nextTime + (60 / bpm) / 4);
    const next = curStep + 1;
    if (next >= STEPS) {
      setCurStep(0);
      advancePhrase();
    } else {
      setCurStep(next);
    }
  }
}

/** Play all active notes for a given step from the PLAYING phrase. */
function scheduleStep(s: number, time: number): void {
  const ctx = getAudioContext();
  if (!ctx) return;

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
      const rate = Math.pow(2, ((octaves[t]! - 1) * 12 + n) / 12);
      playSample(buf, time, rate, dest);

      // Harmony interval for poly tracks with exactly 1 note active
      if (activeNotes.length === 1 && cfg && !cfg.mono && harmonies[t]! > 0) {
        const harmIdx = harmonies[t]!;
        const semitones = HARMONY_SEMITONES[harmIdx];
        if (semitones !== undefined) {
          const harmRate = Math.pow(2, ((octaves[t]! - 1) * 12 + n + semitones) / 12);
          playSample(buf, time, harmRate, dest);
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

  // Schedule visual highlight
  const delay = Math.max(0, (time - ctx.currentTime) * 1000);
  setTimeout(() => { highlightStep(s); }, delay);
}

// ═══════════════════════════════════════════
//  VISUAL PLAYHEAD
// ═══════════════════════════════════════════

/** Highlight the current step in the grid (only when viewing the playing phrase). */
function highlightStep(s: number): void {
  // Only show playhead if we're viewing the playing phrase
  if (playingPhrase !== currentPhrase) {
    setPrevVisualStep(-1);
    return;
  }
  if (prevVisualStep >= 0) clearHL(prevVisualStep);

  // Drum cells
  for (let t = 0; t < DRUMS_CFG.length; t++) {
    const c = drumCells[t]?.[s];
    const cfg = DRUMS_CFG[t];
    const row = drumPat[t];
    if (!c || !cfg) continue;
    c.classList.add('playing');
    if (row?.[s]) {
      c.style.background = cfg.bright;
      c.style.boxShadow = `0 0 16px ${cfg.bright}80, 0 0 6px ${cfg.color}60`;
    }
  }

  // Melody cells
  for (let t = 0; t < MEL_CFG.length; t++) {
    const cfg = MEL_CFG[t];
    if (!cfg) continue;
    for (let n = 0; n < 12; n++) {
      const c = melCells[t]?.[s]?.[n];
      if (!c) continue;
      c.classList.add('playing');
      const semi = displayToSemitone(n);
      const step = melPat[t]?.[s];
      if (step?.[semi]) {
        c.style.background = cfg.bright;
        c.style.boxShadow = `0 0 16px ${cfg.bright}80, 0 0 6px ${cfg.color}60`;
      }
    }
  }

  // Vocal cell
  const vc = vocalCells[s];
  if (vc) {
    vc.classList.add('playing');
    if (vocalPat[s]) {
      vc.style.background = VOCAL_CFG.bright;
      vc.style.boxShadow = `0 0 16px ${VOCAL_CFG.bright}80, 0 0 6px ${VOCAL_CFG.color}60`;
    }
  }

  setPrevVisualStep(s);
}

/** Remove the visual highlight from a step. */
function clearHL(s: number): void {
  // Drum cells
  for (let t = 0; t < DRUMS_CFG.length; t++) {
    const c = drumCells[t]?.[s];
    const cfg = DRUMS_CFG[t];
    const row = drumPat[t];
    if (!c || !cfg) continue;
    c.classList.remove('playing');
    if (row?.[s]) {
      c.style.background = cfg.idle;
      c.style.boxShadow = '';
    } else {
      c.style.background = '';
      c.style.boxShadow = '';
    }
  }

  // Melody cells
  for (let t = 0; t < MEL_CFG.length; t++) {
    const cfg = MEL_CFG[t];
    if (!cfg) continue;
    for (let n = 0; n < 12; n++) {
      const c = melCells[t]?.[s]?.[n];
      if (!c) continue;
      c.classList.remove('playing');
      const semi = displayToSemitone(n);
      const step = melPat[t]?.[s];
      if (step?.[semi]) {
        c.style.background = cfg.idle;
        c.style.boxShadow = '';
      } else {
        c.style.background = '';
        c.style.boxShadow = '';
      }
    }
  }

  // Vocal cell
  const vc = vocalCells[s];
  if (vc) {
    vc.classList.remove('playing');
    if (vocalPat[s]) {
      vc.style.background = VOCAL_CFG.idle;
      vc.style.boxShadow = '';
    } else {
      vc.style.background = '';
      vc.style.boxShadow = '';
    }
  }
}

// ═══════════════════════════════════════════
//  TRANSPORT
// ═══════════════════════════════════════════

/** Start playback: init audio, reset step counter, begin scheduler loop. */
export function startPlayback(): void {
  initAudio();
  const audioCtx = getAudioContext();
  if (!audioCtx) return;

  setPlaying(true);
  setCurStep(0);
  setPlayingPhrase(findFirstNonEmpty());
  setNextTime(audioCtx.currentTime + 0.05);
  setTimer(setInterval(scheduler, 25));

  const playBtn = document.getElementById('play-btn');
  if (playBtn) playBtn.classList.add('active');

  onPhraseChange?.();
}

/** Stop playback: clear interval, reset state, remove highlights. */
export function stopPlayback(): void {
  setPlaying(false);
  if (timer) clearInterval(timer);
  setTimer(null);
  setCurStep(0);

  if (prevVisualStep >= 0) {
    clearHL(prevVisualStep);
    setPrevVisualStep(-1);
  }

  const playBtn = document.getElementById('play-btn');
  if (playBtn) playBtn.classList.remove('active');

  for (const fn of seqStopCallbacks) {
    try { fn(); } catch (_e) { /* swallow */ }
  }

  onPhraseChange?.();
}

/** Toggle between play and stop. */
export function togglePlay(): void {
  if (playing) {
    stopPlayback();
  } else {
    startPlayback();
  }
}
