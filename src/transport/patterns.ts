/**
 * Pattern and phrase state with controlled mutation functions.
 * Emits events on every change so the UI layer can react.
 *
 * NO DOM types (no HTMLElement, no document).
 */

import type { Phrase, SongSection } from '../types';
import { DRUMS_CFG, MEL_CFG, STEPS, DEFAULT_PHRASES, PHRASE_COUNTS } from '../config';
import { emit } from '../events';
import { defaultTheory, snapToScale } from './theory';
import {
  melodyNotes,
  setMelodyNotes,
  phraseHasNotes,
  midiBase,
  isHarmonyDisabled,
  setHarmonyDisabled,
} from './notes';

// ═══════════════════════════════════════════
//  PHRASES & PATTERNS
// ═══════════════════════════════════════════

/** Create a blank phrase with correctly-sized pattern arrays. */
export function makeEmptyPhrase(): Phrase {
  return {
    drumPat: DRUMS_CFG.map(() => Array<boolean>(STEPS).fill(false)),
    melPat: MEL_CFG.map(() => Array.from({ length: STEPS }, () => Array<boolean>(12).fill(false))),
    vocalPat: Array<boolean>(STEPS).fill(false),
  };
}

export const phrases: Phrase[] = Array.from({ length: DEFAULT_PHRASES }, () => makeEmptyPhrase());

export const sections: SongSection[] = [];
export const theory = defaultTheory();
export const variationLocks: boolean[] = Array.from({ length: 9 }, (_, i) => i === 0 || i === 7);

export let currentPhrase = 0;
export let playingPhrase = 0;

// Active pattern references — point into the current phrase.
// These are reassigned by switchToPhrase().
export let drumPat: boolean[][] = phrases[0]!.drumPat;
export let melPat: boolean[][][] = phrases[0]!.melPat;
export let vocalPat: boolean[] = phrases[0]!.vocalPat;

// Per-track octave offset and harmony interval
export const octaves: number[] = [3, 3, 3];
export const harmonies: number[] = [0, 0, 0];

// ── Default pattern (phrase 0 only) ──
{
  const p0 = phrases[0]!;
  // Kick on beats 1, 2, 3, 4
  p0.drumPat[0]![0] = true;
  p0.drumPat[0]![4] = true;
  p0.drumPat[0]![8] = true;
  p0.drumPat[0]![12] = true;

  // Mono synth melody
  p0.melPat[0]![0]![0] = true;
  p0.melPat[0]![4]![4] = true;
  p0.melPat[0]![8]![7] = true;
}

// ═══════════════════════════════════════════
//  PHRASE NAVIGATION
// ═══════════════════════════════════════════

/**
 * Switch the active editing phrase.
 * Updates `currentPhrase` and re-binds the pat references.
 * Emits 'transport:phraseChanged'.
 */
export function switchToPhrase(idx: number): void {
  const phrase: Phrase | undefined = phrases[idx];
  if (!phrase) return;
  currentPhrase = idx;
  drumPat = phrase.drumPat;
  melPat = phrase.melPat;
  vocalPat = phrase.vocalPat;
  emit('transport:phraseChanged', { phrase: idx });
}

/** Resize without discarding notes. Both GUI and programmatic callers use this operation. */
export function setPhraseCount(count: number): void {
  if (!PHRASE_COUNTS.includes(count)) {
    throw new Error('Choose 12, 24, 36, or 48 phrases.');
  }
  const previous = phrases.length;
  if (count === previous) return;
  for (let i = count; i < previous; i++) {
    if (!isPhraseEmpty(i)) {
      throw new Error(
        `Phrase ${i + 1} contains notes. Clear phrases beyond ${count} before reducing the song length.`,
      );
    }
  }
  if (sections.some((section) => section.start + section.length > count))
    throw new Error('Resize or remove sections beyond the new phrase count first.');
  while (phrases.length < count) phrases.push(makeEmptyPhrase());
  phrases.splice(count);
  if (currentPhrase >= count) switchToPhrase(count - 1);
  emit('transport:phraseCountChanged', { count, previous });
}

/** Copy the previous phrase's data into `phrases[idx]`. */
export function fillWithPrev(idx: number): void {
  if (idx <= 0) return;
  const prev: Phrase | undefined = phrases[idx - 1];
  const target: Phrase | undefined = phrases[idx];
  if (!prev || !target) return;

  for (let t = 0; t < prev.drumPat.length; t++) {
    const src = prev.drumPat[t];
    const dst = target.drumPat[t];
    if (src && dst) {
      for (let s = 0; s < src.length; s++) {
        dst[s] = src[s]!;
      }
    }
  }
  for (let t = 0; t < prev.melPat.length; t++) {
    const srcTrack = prev.melPat[t];
    const dstTrack = target.melPat[t];
    if (srcTrack && dstTrack) {
      for (let s = 0; s < srcTrack.length; s++) {
        const srcStep = srcTrack[s];
        const dstStep = dstTrack[s];
        if (srcStep && dstStep) {
          for (let n = 0; n < srcStep.length; n++) {
            dstStep[n] = srcStep[n]!;
          }
        }
      }
    }
  }
  if (prev.melHarmDisabled) target.melHarmDisabled = structuredClone(prev.melHarmDisabled);
  else delete target.melHarmDisabled;
  if (prev.melExtra) target.melExtra = structuredClone(prev.melExtra);
  else delete target.melExtra;
  if (theory.locked)
    for (let t = 0; t < 3; t++)
      for (let s = 0; s < STEPS; s++)
        setMelodyNotes(
          target,
          t,
          s,
          melodyNotes(target, t, s).map((note) => resolveMelodyPitch(t, note)),
        );
  for (let s = 0; s < prev.vocalPat.length; s++) {
    target.vocalPat[s] = prev.vocalPat[s]!;
  }
}

// ═══════════════════════════════════════════
//  STEP MUTATORS
// ═══════════════════════════════════════════

/** Set a single drum step and emit. */
export function setDrumStep(track: number, step: number, value: boolean): void {
  const row = drumPat[track];
  if (!row) return;
  row[step] = value;
  emit('transport:patternChanged', { type: 'drum', track, step });
}

/** Set a single melody note and emit. */
export function resolveMelodyPitch(track: number, note: number): number {
  const base = midiBase(octaves[track]!);
  if (!Number.isInteger(note) || !Number.isInteger(base) || note + base < 0 || note + base > 127)
    throw new Error('Pitch is outside the MIDI range.');
  return theory.locked ? snapToScale(note, theory, -base, 127 - base) : note;
}
export function hasMelNote(track: number, step: number, note: number): boolean {
  return note >= 0 && note < 12
    ? !!melPat[track]?.[step]?.[note]
    : !!phrases[currentPhrase]?.melExtra?.[track]?.[step]?.includes(note);
}
export function getMelNotes(track: number, step: number): number[] {
  return melodyNotes(phrases[currentPhrase]!, track, step);
}
export function setMelStep(track: number, step: number, note: number, value: boolean): number {
  if (
    !MEL_CFG[track] ||
    !Number.isInteger(step) ||
    step < 0 ||
    step >= STEPS ||
    typeof value !== 'boolean'
  )
    throw new Error('Invalid melody edit.');
  const resolved = resolveMelodyPitch(track, note);
  const pitch = value ? resolved : note;
  const notes = getMelNotes(track, step).filter((n) => n !== pitch);
  const next = value ? (MEL_CFG[track].mono ? [pitch] : [...notes, pitch]) : notes;
  setMelodyNotes(phrases[currentPhrase]!, track, step, next);
  emit('transport:patternChanged', { type: 'melody', track, step });
  return pitch;
}

/** Set a single vocal step and emit. */
export function setVocalStep(step: number, value: boolean): void {
  vocalPat[step] = value;
  emit('transport:patternChanged', { type: 'vocal', track: 0, step });
}

/**
 * Handle a melody cell toggle from the UI grid.
 *
 * `displayRow` is the row index in the UI grid (0 = top = B, 11 = bottom = C).
 * For mono tracks, enforces single-note-per-step by clearing others first.
 */
export function setMelodyCell(
  track: number,
  step: number,
  displayRow: number,
  value: boolean,
): void {
  const cfg = MEL_CFG[track];
  if (!cfg) return;

  const semi = 11 - displayRow;
  setMelStep(track, step, semi, value);
}

// ═══════════════════════════════════════════
//  PHRASE QUERIES
// ═══════════════════════════════════════════

/** Check whether phrase at `idx` has any active steps. */
export function isPhraseEmpty(idx: number): boolean {
  const p = phrases[idx];
  return !p || !phraseHasNotes(p);
}

/** Find the next non-empty phrase starting after `fromIdx`, wrapping around. */
export function findNextPhrase(fromIdx: number): number {
  for (let i = 1; i <= phrases.length; i++) {
    const idx = (fromIdx + i) % phrases.length;
    if (!isPhraseEmpty(idx)) return idx;
  }
  return fromIdx;
}

/** Find the first non-empty phrase (0-based). Returns 0 if all empty. */
export function findFirstNonEmpty(): number {
  for (let i = 0; i < phrases.length; i++) {
    if (!isPhraseEmpty(i)) return i;
  }
  return 0;
}

// ═══════════════════════════════════════════
//  TRACK OPERATIONS
// ═══════════════════════════════════════════

/** Clear all steps for a drum track in the current phrase. */
export function clearDrumTrack(track: number): void {
  const row = drumPat[track];
  if (!row) return;
  row.fill(false);
  emit('transport:patternChanged', { type: 'drum', track, step: -1 });
}

/** Clear all steps for a melody track in the current phrase. */
export function clearMelTrack(track: number): void {
  const trackArr = melPat[track];
  if (!trackArr) return;
  for (let step = 0; step < STEPS; step++) setMelodyNotes(phrases[currentPhrase]!, track, step, []);
  emit('transport:patternChanged', { type: 'melody', track, step: -1 });
}

/** Clear all steps for the vocal track in the current phrase. */
export function clearVocalTrack(): void {
  vocalPat.fill(false);
  emit('transport:patternChanged', { type: 'vocal', track: 0, step: -1 });
}

/**
 * FILL function: replicate a bar pattern across all bars in the current phrase.
 * Takes the first bar (steps 0-15) and copies it to bars 2-4.
 */
export function replicateTrack(type: 'drum' | 'melody' | 'vocal', track: number): void {
  const SPB = 16; // steps per bar

  if (type === 'drum') {
    const row = drumPat[track];
    if (!row) return;
    for (let bar = 1; bar < 4; bar++) {
      for (let s = 0; s < SPB; s++) {
        row[bar * SPB + s] = row[s]!;
      }
    }
    emit('transport:patternChanged', { type: 'drum', track, step: -1 });
  } else if (type === 'melody') {
    const phrase = phrases[currentPhrase]!;
    for (let bar = 1; bar < 4; bar++)
      for (let s = 0; s < SPB; s++) {
        setMelodyNotes(
          phrase,
          track,
          bar * SPB + s,
          melodyNotes(phrase, track, s).map((note) => resolveMelodyPitch(track, note)),
        );
        setHarmonyDisabled(phrase, track, bar * SPB + s, isHarmonyDisabled(phrase, track, s));
      }
    emit('transport:patternChanged', { type: 'melody', track, step: -1 });
  } else {
    for (let bar = 1; bar < 4; bar++) {
      for (let s = 0; s < SPB; s++) {
        vocalPat[bar * SPB + s] = vocalPat[s]!;
      }
    }
    emit('transport:patternChanged', { type: 'vocal', track: 0, step: -1 });
  }
}

// ═══════════════════════════════════════════
//  SETTERS
// ═══════════════════════════════════════════

export function setPlayingPhrase(v: number): void {
  playingPhrase = v;
}

export function setCurrentPhrase(v: number): void {
  currentPhrase = v;
}

export function setDrumPat(v: boolean[][]): void {
  drumPat = v;
}

export function setMelPat(v: boolean[][][]): void {
  melPat = v;
}

export function setVocalPat(v: boolean[]): void {
  vocalPat = v;
}
