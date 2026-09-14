/** Preserve the legacy twelve-note grid; sparse overflow stores signed pitches outside it. */
import type { Phrase } from '../types';
import { STEPS, MEL_CFG } from '../config';

export const MIN_RELATIVE_PITCH = -96;
export const MAX_RELATIVE_PITCH = 103;
export function midiBase(octave: number): number {
  return (octave + 1) * 12;
}
export function melodyNotes(phrase: Phrase, track: number, step: number): number[] {
  const notes = phrase.melPat[track]?.[step]?.flatMap((hit, note) => (hit ? [note] : [])) ?? [];
  return [...notes, ...(phrase.melExtra?.[track]?.[step] ?? [])].sort((a, b) => a - b);
}
export function setMelodyNotes(
  phrase: Phrase,
  track: number,
  step: number,
  notes: readonly number[],
): void {
  const row = phrase.melPat[track]?.[step];
  if (!row) throw new Error('Invalid melody track or step.');
  const unique = [...new Set(notes)].sort((a, b) => a - b);
  if (
    unique.some(
      (note) => !Number.isInteger(note) || note < MIN_RELATIVE_PITCH || note > MAX_RELATIVE_PITCH,
    )
  )
    throw new Error('Pitch is outside the supported range.');
  row.fill(false);
  for (const note of unique) if (note >= 0 && note < 12) row[note] = true;
  const extra = unique.filter((note) => note < 0 || note >= 12);
  if (extra.length && !phrase.melExtra)
    phrase.melExtra = MEL_CFG.map(() => Array.from({ length: STEPS }, () => []));
  if (phrase.melExtra) {
    phrase.melExtra[track]![step] = extra;
    if (!phrase.melExtra.some((t) => t.some((s) => s.length))) delete phrase.melExtra;
  }
}
export function phraseHasNotes(phrase: Phrase): boolean {
  return (
    phrase.drumPat.some((row) => row.some(Boolean)) ||
    phrase.vocalPat.some(Boolean) ||
    phrase.melPat.some((track) => track.some((notes) => notes.some(Boolean))) ||
    !!phrase.melExtra?.some((track) => track.some((notes) => notes.length))
  );
}
