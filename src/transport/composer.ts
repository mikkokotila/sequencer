/** Shared pattern editing API. Selections use zero-based phrase/step/global-track indices. */
import { emit } from '../events';
import { STEPS, TOTAL_TRACKS, PHRASE_COUNTS, MAX_PHRASES } from '../config';
import type { Phrase, SongSection } from '../types';
import {
  phrases,
  currentPhrase,
  switchToPhrase,
  sections,
  variationLocks,
  makeEmptyPhrase,
} from './patterns';
import { currentSongId, bpm } from './song';
import { editDocument, getHistoryState } from './history';
import { normalizeSections } from './song-format';

export interface EditRegion {
  from: number;
  to: number;
  startStep: number;
  endStep: number;
  tracks: number[];
}
export interface PatternClip {
  tracks: number[];
  data: boolean[][][];
  phraseCount: number;
  stepsPerPhrase: number;
}
export type VariationKind = 'sparse' | 'driving' | 'syncopated' | 'answer';
export interface VariationPreview {
  kind: VariationKind;
  region: EditRegion;
  original: Phrase[];
  result: Phrase[];
  added: number;
  removed: number;
  protectedTracks: number[];
  base: string;
  revision: number;
}
function integer(value: number, min: number, max: number, label: string): void {
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`${label} must be an integer from ${min} to ${max}.`);
}
export function validateRegion(region: EditRegion): EditRegion {
  integer(region.from, 0, phrases.length - 1, 'First phrase');
  integer(region.to, region.from, phrases.length - 1, 'Last phrase');
  integer(region.startStep, 0, STEPS - 1, 'First step');
  integer(region.endStep, region.startStep, STEPS - 1, 'Last step');
  if (!Array.isArray(region.tracks) || !region.tracks.length)
    throw new Error('Select at least one track.');
  region.tracks.forEach((track) => integer(track, 0, TOTAL_TRACKS - 1, 'Track'));
  return { ...region, tracks: [...new Set(region.tracks)].sort((a, b) => a - b) };
}
export function readTrack(phrase: Phrase, track: number): boolean[][] {
  if (track < 5) return phrase.drumPat[track]!.map((hit) => [hit]);
  if (track < 8) return phrase.melPat[track - 5]!.map((notes) => [...notes]);
  return phrase.vocalPat.map((hit) => [hit]);
}
function writeTrack(phrase: Phrase, track: number, steps: boolean[][]): void {
  if (track < 5) phrase.drumPat[track] = steps.map((notes) => !!notes[0]);
  else if (track < 8) phrase.melPat[track - 5] = steps.map((notes) => [...notes]);
  else phrase.vocalPat = steps.map((notes) => !!notes[0]);
}
function applyPatterns(next: Phrase[]): void {
  emit('editor:beforeRestore', {});
  phrases.splice(0, phrases.length, ...next);
  switchToPhrase(Math.min(currentPhrase, phrases.length - 1));
}
function changeRegion(
  region: EditRegion,
  label: string,
  transform: (steps: boolean[][], track: number) => boolean[][],
): void {
  const selection = validateRegion(region);
  const next = structuredClone(phrases);
  for (let p = selection.from; p <= selection.to; p++)
    for (const track of selection.tracks) {
      const steps = readTrack(next[p]!, track);
      const selected = steps.slice(selection.startStep, selection.endStep + 1);
      steps.splice(selection.startStep, selected.length, ...transform(selected, track));
      writeTrack(next[p]!, track, steps);
    }
  editDocument(label, () => applyPatterns(next));
}
export function clearRegion(region: EditRegion): void {
  changeRegion(region, 'Clear selection', (steps) => steps.map((notes) => notes.map(() => false)));
}
export function nudgeRegion(region: EditRegion, offset: number): void {
  integer(offset, -STEPS, STEPS, 'Step offset');
  changeRegion(region, 'Nudge selection', (steps) =>
    steps.map((_, i) => steps[(((i - offset) % steps.length) + steps.length) % steps.length]!),
  );
}
export function transposeRegion(region: EditRegion, semitones: number): void {
  integer(semitones, -11, 11, 'Semitone offset');
  changeRegion(region, 'Transpose selection', (steps, track) => {
    if (track < 5 || track > 7) return steps;
    return steps.map((notes) => {
      const next = Array<boolean>(12).fill(false);
      notes.forEach((hit, note) => {
        if (!hit) return;
        const shifted = note + semitones;
        if (shifted < 0 || shifted > 11)
          throw new Error(
            'Transpose exceeds this octave. Select other notes or change the track octave.',
          );
        next[shifted] = true;
      });
      return next;
    });
  });
}
export function copyRegion(region: EditRegion): PatternClip {
  const selection = validateRegion(region);
  return {
    tracks: selection.tracks,
    phraseCount: selection.to - selection.from + 1,
    stepsPerPhrase: selection.endStep - selection.startStep + 1,
    data: selection.tracks.map((track) =>
      phrases
        .slice(selection.from, selection.to + 1)
        .flatMap((phrase) =>
          readTrack(phrase, track).slice(selection.startStep, selection.endStep + 1),
        ),
    ),
  };
}
export function pasteRegion(clip: PatternClip, phrase: number, step = 0): void {
  integer(phrase, 0, phrases.length - 1, 'Paste phrase');
  integer(step, 0, STEPS - 1, 'Paste step');
  integer(clip.phraseCount, 1, MAX_PHRASES, 'Copied phrase count');
  integer(clip.stepsPerPhrase, 1, STEPS, 'Copied step count');
  if (
    !clip.tracks.length ||
    clip.tracks.length !== clip.data.length ||
    new Set(clip.tracks).size !== clip.tracks.length
  )
    throw new Error('Invalid copied tracks.');
  if (phrase + clip.phraseCount > phrases.length || step + clip.stepsPerPhrase > STEPS)
    throw new Error(
      'The copied selection does not fit. Choose an earlier phrase/bar or expand the song.',
    );
  clip.tracks.forEach((track, i) => {
    integer(track, 0, TOTAL_TRACKS - 1, 'Copied track');
    const width = track >= 5 && track <= 7 ? 12 : 1;
    const data = clip.data[i]!;
    if (
      data.length !== clip.phraseCount * clip.stepsPerPhrase ||
      data.some(
        (notes) =>
          notes.length !== width ||
          notes.some((hit) => typeof hit !== 'boolean') ||
          (track === 5 && notes.filter(Boolean).length > 1),
      )
    )
      throw new Error('Invalid copied notes.');
  });
  const next = structuredClone(phrases);
  clip.tracks.forEach((track, i) => {
    for (let p = 0; p < clip.phraseCount; p++) {
      const target = next[phrase + p]!;
      const steps = readTrack(target, track);
      steps.splice(
        step,
        clip.stepsPerPhrase,
        ...clip.data[i]!.slice(p * clip.stepsPerPhrase, (p + 1) * clip.stepsPerPhrase).map(
          (notes) => [...notes],
        ),
      );
      writeTrack(target, track, steps);
    }
  });
  editDocument('Paste selection', () => applyPatterns(next));
}
export function repeatRegion(region: EditRegion): void {
  const selection = validateRegion(region);
  if (selection.endStep === STEPS - 1)
    throw new Error('Select a shorter source range with space after it to repeat into.');
  const next = structuredClone(phrases);
  for (let p = selection.from; p <= selection.to; p++)
    for (const track of selection.tracks) {
      const steps = readTrack(next[p]!, track);
      const source = steps.slice(selection.startStep, selection.endStep + 1);
      for (let i = selection.endStep + 1; i < STEPS; i++)
        steps[i] = [...source[(i - selection.endStep - 1) % source.length]!];
      writeTrack(next[p]!, track, steps);
    }
  editDocument('Repeat selection', () => applyPatterns(next));
}

export function setVariationLock(track: number, locked: boolean): void {
  integer(track, 0, TOTAL_TRACKS - 1, 'Track');
  if (typeof locked !== 'boolean') throw new Error('Track lock must be true or false.');
  editDocument('Protect track from variations', () => {
    variationLocks[track] = locked;
  });
}
function fingerprint(): string {
  return JSON.stringify({ id: currentSongId, phrases, variationLocks });
}
export function previewVariation(region: EditRegion, kind: VariationKind): VariationPreview {
  const selection = validateRegion(region);
  if (!['sparse', 'driving', 'syncopated', 'answer'].includes(kind))
    throw new Error('Choose a variation style.');
  const tracks = selection.tracks.filter((track) => !variationLocks[track]);
  if (!tracks.length)
    throw new Error('All selected tracks are protected. Unlock one to create a variation.');
  const original = structuredClone(phrases.slice(selection.from, selection.to + 1));
  const result = structuredClone(original);
  let added = 0,
    removed = 0;
  for (const phrase of result)
    for (const track of tracks) {
      const steps = readTrack(phrase, track);
      const source = steps.slice(selection.startStep, selection.endStep + 1);
      const changed = source.map((notes) => [...notes]);
      const hits = source.flatMap((notes, i) => (notes.some(Boolean) ? [i] : []));
      if (!hits.length) continue;
      const blank = () => source[0]!.map(() => false);
      if (kind === 'sparse')
        hits.forEach((at, i) => {
          if (i % 2 === 1) changed[at] = blank();
        });
      if (kind === 'driving')
        for (const at of hits) {
          const target = at + 2;
          if (target < source.length && !source[target]!.some(Boolean))
            changed[target] = [...source[at]!];
        }
      if (kind === 'syncopated')
        for (const at of hits) {
          const target = at + 2;
          if (
            (at + selection.startStep) % 4 === 0 &&
            target < source.length &&
            !source[target]!.some(Boolean)
          ) {
            changed[at] = blank();
            changed[target] = [...source[at]!];
          }
        }
      if (kind === 'answer') {
        const half = Math.floor(source.length / 2);
        if (half < 4) throw new Error('Answer needs at least eight selected steps.');
        for (let i = half; i < source.length; i++)
          changed[i] = [...source[(((i - half - 2) % half) + half) % half]!];
      }
      source.forEach((notes, step) =>
        notes.forEach((hit, note) => {
          if (hit && !changed[step]![note]) removed++;
          if (!hit && changed[step]![note]) added++;
        }),
      );
      steps.splice(selection.startStep, source.length, ...changed);
      writeTrack(phrase, track, steps);
    }
  return {
    kind,
    region: selection,
    original,
    result,
    added,
    removed,
    protectedTracks: selection.tracks.filter((track) => variationLocks[track]),
    base: fingerprint(),
    revision: getHistoryState().revision,
  };
}
export function applyVariation(preview: VariationPreview): void {
  if (preview.base !== fingerprint() || preview.revision !== getHistoryState().revision)
    throw new Error(
      'The song changed after this preview. Create a fresh variation before applying.',
    );
  // Recompute from validated inputs: a caller cannot smuggle edits into a protected track.
  const fresh = previewVariation(preview.region, preview.kind);
  editDocument(`Apply ${preview.kind} variation`, () => {
    const next = [...phrases];
    next.splice(preview.region.from, fresh.result.length, ...fresh.result);
    applyPatterns(next);
  });
}

export function nameSection(start: number, length: number, name: string, id?: string): SongSection {
  const section = { id: id ?? crypto.randomUUID(), name, start, length };
  const next = normalizeSections(
    [...sections.filter((item) => item.id !== section.id), section],
    phrases.length,
  );
  editDocument('Name section', () => {
    sections.splice(0, sections.length, ...next);
  });
  return { ...next.find((item) => item.id === section.id)! };
}
export function removeSection(id: string): void {
  const index = sections.findIndex((section) => section.id === id);
  if (index < 0) throw new Error('Section no longer exists.');
  editDocument('Remove section name', () => {
    sections.splice(index, 1);
  });
}
function sectionById(id: string): SongSection {
  const section = sections.find((item) => item.id === id);
  if (!section) throw new Error('Section no longer exists.');
  return { ...section };
}
function fitPatterns(next: Phrase[], nextSections: SongSection[]): Phrase[] {
  const hasNotes = (phrase: Phrase) =>
    phrase.drumPat.some((row) => row.some(Boolean)) ||
    phrase.melPat.some((track) => track.some((notes) => notes.some(Boolean))) ||
    phrase.vocalPat.some(Boolean);
  let needed = next.length;
  const sectionEnd = Math.max(0, ...nextSections.map((section) => section.start + section.length));
  while (needed > sectionEnd && !hasNotes(next[needed - 1]!)) needed--;
  const count = PHRASE_COUNTS.find((value) => value >= Math.max(phrases.length, needed));
  if (!count)
    throw new Error('This edit exceeds 48 phrases. Shorten the song before adding a section.');
  next.splice(count);
  while (next.length < count) next.push(makeEmptyPhrase());
  return next;
}
export function duplicateSection(id: string): SongSection {
  const section = sectionById(id);
  const at = section.start + section.length;
  const copy = {
    ...section,
    id: crypto.randomUUID(),
    name: `${section.name.slice(0, 27)} copy`,
    start: at,
  };
  const nextSections = [
    ...sections.map((item) => ({
      ...item,
      start: item.start >= at ? item.start + section.length : item.start,
    })),
    copy,
  ];
  const next = structuredClone(phrases);
  next.splice(at, 0, ...structuredClone(phrases.slice(section.start, at)));
  fitPatterns(next, nextSections);
  const validated = normalizeSections(nextSections, next.length);
  editDocument('Duplicate section', () => {
    applyPatterns(next);
    sections.splice(0, sections.length, ...validated);
    switchToPhrase(copy.start);
  });
  return copy;
}
export function moveSection(id: string, target: number): void {
  const section = sectionById(id);
  integer(target, 0, phrases.length, 'Destination phrase');
  if (target >= section.start && target <= section.start + section.length) return;
  if (sections.some((item) => target > item.start && target < item.start + item.length))
    throw new Error('Move to a section boundary, not inside another section.');
  const order = phrases.map((_, i) => i);
  const block = order.splice(section.start, section.length);
  const at = target > section.start ? target - section.length : target;
  order.splice(at, 0, ...block);
  const next = order.map((i) => structuredClone(phrases[i]!));
  const nextSections = normalizeSections(
    sections.map((item) => ({ ...item, start: order.indexOf(item.start) })),
    next.length,
  );
  editDocument('Move section', () => {
    applyPatterns(next);
    sections.splice(0, sections.length, ...nextSections);
    switchToPhrase(at);
  });
}
export function resizeSection(id: string, length: number): void {
  const section = sectionById(id);
  integer(length, 1, MAX_PHRASES, 'Section length');
  if (length === section.length) return;
  const next = structuredClone(phrases);
  const source = next.slice(section.start, section.start + section.length);
  const replacement = Array.from({ length }, (_, i) => structuredClone(source[i % source.length]!));
  next.splice(section.start, section.length, ...replacement);
  const delta = length - section.length;
  const nextSections = sections.map((item) =>
    item.id === id
      ? { ...item, length }
      : { ...item, start: item.start > section.start ? item.start + delta : item.start },
  );
  fitPatterns(next, nextSections);
  const validated = normalizeSections(nextSections, next.length);
  editDocument('Resize section', () => {
    applyPatterns(next);
    sections.splice(0, sections.length, ...validated);
    switchToPhrase(section.start);
  });
}
export function sectionDuration(section: Pick<SongSection, 'start' | 'length'>): {
  bars: number;
  seconds: number;
} {
  const count = phrases
    .slice(section.start, section.start + section.length)
    .filter(
      (phrase) =>
        phrase.drumPat.some((row) => row.some(Boolean)) ||
        phrase.melPat.some((track) => track.some((notes) => notes.some(Boolean))) ||
        phrase.vocalPat.some(Boolean),
    ).length;
  return { bars: section.length * 4, seconds: (count * 16 * 60) / bpm };
}
