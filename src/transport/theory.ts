/** Pure pitch, scale and diatonic harmony arithmetic. No live state or randomness. */
import type { SongTheory } from '../types';

export const NOTE_NAMES = [
  'C',
  'C♯',
  'D',
  'E♭',
  'E',
  'F',
  'F♯',
  'G',
  'A♭',
  'A',
  'B♭',
  'B',
] as const;
export const MODES = {
  major: { name: 'Major / Ionian', intervals: [0, 2, 4, 5, 7, 9, 11] },
  dorian: { name: 'Dorian', intervals: [0, 2, 3, 5, 7, 9, 10] },
  phrygian: { name: 'Phrygian', intervals: [0, 1, 3, 5, 7, 8, 10] },
  lydian: { name: 'Lydian', intervals: [0, 2, 4, 6, 7, 9, 11] },
  mixolydian: { name: 'Mixolydian', intervals: [0, 2, 4, 5, 7, 9, 10] },
  minor: { name: 'Minor / Aeolian', intervals: [0, 2, 3, 5, 7, 8, 10] },
  locrian: { name: 'Locrian', intervals: [0, 1, 3, 5, 6, 8, 10] },
  harmonicMinor: { name: 'Harmonic minor', intervals: [0, 2, 3, 5, 7, 8, 11] },
  melodicMinor: { name: 'Melodic minor (ascending)', intervals: [0, 2, 3, 5, 7, 9, 11] },
} as const;
export type Mode = keyof typeof MODES;
export const PROGRESSIONS = [
  { name: 'Tonic pedal · 1–1–1–1', degrees: [1, 1, 1, 1] },
  { name: 'Anthem · 1–5–6–4', degrees: [1, 5, 6, 4] },
  { name: 'Descending · 1–7–6–7', degrees: [1, 7, 6, 7] },
  { name: 'Lift · 1–6–3–7', degrees: [1, 6, 3, 7] },
  { name: 'Cadence · 1–4–5–1', degrees: [1, 4, 5, 1] },
  { name: 'Modal turn · 1–4–1–7', degrees: [1, 4, 1, 7] },
] as const;
export function defaultTheory(): SongTheory {
  return { root: 0, mode: 'major', locked: false, progression: [1, 5, 6, 4] };
}
export function normalizeTheory(value: unknown): SongTheory {
  if (value === undefined) return defaultTheory();
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid song key and mode.');
  const input = value as Record<string, unknown>;
  const defaults = defaultTheory();
  const root = input.root === undefined ? defaults.root : input.root;
  const mode = input.mode === undefined ? defaults.mode : input.mode;
  const locked = input.locked === undefined ? false : input.locked;
  const progression = input.progression === undefined ? defaults.progression : input.progression;
  if (typeof root !== 'number' || !Number.isInteger(root) || root < 0 || root > 11)
    throw new Error('Root must be a pitch class from 0 to 11.');
  if (typeof mode !== 'string' || !Object.prototype.hasOwnProperty.call(MODES, mode))
    throw new Error('Choose a supported mode.');
  if (typeof locked !== 'boolean') throw new Error('Scale Lock must be true or false.');
  if (
    !Array.isArray(progression) ||
    !progression.length ||
    progression.length > 16 ||
    progression.some(
      (degree: unknown) =>
        typeof degree !== 'number' || !Number.isInteger(degree) || degree < 1 || degree > 7,
    )
  )
    throw new Error('A progression needs 1–16 scale degrees, each from 1 to 7.');
  return { root, mode: mode as Mode, locked, progression: (progression as number[]).slice() };
}
export function pitchClass(note: number): number {
  return ((note % 12) + 12) % 12;
}
export function inScale(note: number, theory: Pick<SongTheory, 'root' | 'mode'>): boolean {
  return (MODES[theory.mode].intervals as readonly number[]).includes(
    pitchClass(note - theory.root),
  );
}
/** Search lower before upper at every distance: ties are always resolved downward. */
export function snapToScale(
  note: number,
  theory: Pick<SongTheory, 'root' | 'mode'>,
  min = -Infinity,
  max = Infinity,
): number {
  if (!Number.isInteger(note) || min > max || note < min || note > max)
    throw new Error('Pitch is outside the editable range.');
  for (let distance = 0; distance <= 12; distance++) {
    if (note - distance >= min && inScale(note - distance, theory)) return note - distance;
    if (note + distance <= max && inScale(note + distance, theory)) return note + distance;
  }
  throw new Error('No scale note fits this range.');
}
/** Zero-based degree, including negative/extended degrees; result is a signed semitone. */
export function degreePitch(degree: number, theory: Pick<SongTheory, 'root' | 'mode'>): number {
  const scale = MODES[theory.mode].intervals;
  return theory.root + scale[((degree % 7) + 7) % 7]! + 12 * Math.floor(degree / 7);
}
export function chordPitches(degree: number, theory: SongTheory, size: 3 | 4 = 3): number[] {
  return Array.from({ length: size }, (_, i) => degreePitch(degree - 1 + i * 2, theory));
}
export function chordLabel(degree: number, theory: SongTheory, size: 3 | 4 = 3): string {
  const notes = chordPitches(degree, theory, size);
  const third = notes[1]! - notes[0]!;
  const fifth = notes[2]! - notes[0]!;
  let quality = third === 3 ? 'm' : '';
  if (fifth === 6) quality = 'dim';
  if (fifth === 8) quality = 'aug';
  if (size === 4) {
    const seventh = notes[3]! - notes[0]!;
    if (fifth === 6) quality = seventh === 9 ? 'dim7' : 'm7♭5';
    else quality += seventh === 11 ? (quality === 'm' ? '(maj7)' : 'maj7') : '7';
  }
  return `${NOTE_NAMES[pitchClass(notes[0]!)]}${quality}`;
}
/** Enumerate close inversions; prefer common tones and small movement between voices. */
export function voiceChord(
  notes: number[],
  previous: readonly number[],
  min: number,
  max: number,
): number[] {
  const candidates: number[][] = [];
  for (let inversion = 0; inversion < notes.length; inversion++) {
    const rotated = notes.map(
      (_, i) => notes[(i + inversion) % notes.length]! + (i + inversion >= notes.length ? 12 : 0),
    );
    for (let octave = -3; octave <= 2; octave++) {
      const candidate = rotated.map((note) => note + octave * 12);
      if (candidate.every((note) => note >= min && note <= max)) candidates.push(candidate);
    }
  }
  const center = (min + max) / 2;
  const cost = (candidate: number[]) =>
    previous.length === candidate.length
      ? candidate.reduce(
          (sum, note, i) =>
            sum + Math.abs(note - previous[i]!) + (previous.includes(note) ? -0.25 : 0),
          0,
        )
      : Math.abs(candidate.reduce((sum, note) => sum + note, 0) / candidate.length - center);
  candidates.sort((a, b) => cost(a) - cost(b) || a[0]! - b[0]!);
  if (!candidates.length) throw new Error('The chord does not fit the chosen register.');
  return candidates[0]!;
}

/** Small harmonic grammars emphasize each mode's characteristic degrees. */
export function suggestProgression(mode: Mode, idea: number): number[] {
  if (!Number.isInteger(idea) || idea < 1)
    throw new Error('Progression idea must be a positive integer.');
  const modal: Partial<Record<Mode, number[][]>> = {
    dorian: [
      [1, 4, 1, 7],
      [1, 3, 4, 1],
      [1, 2, 4, 1],
    ],
    phrygian: [
      [1, 2, 1, 7],
      [1, 7, 2, 1],
      [1, 6, 2, 1],
    ],
    lydian: [
      [1, 2, 1, 5],
      [1, 5, 2, 1],
      [1, 7, 2, 1],
    ],
    mixolydian: [
      [1, 7, 4, 1],
      [1, 4, 7, 1],
      [1, 5, 7, 4],
    ],
    locrian: [
      [1, 2, 5, 1],
      [1, 7, 2, 1],
      [1, 6, 2, 1],
    ],
    minor: [
      [1, 6, 3, 7],
      [1, 7, 6, 7],
      [1, 4, 7, 1],
    ],
    harmonicMinor: [
      [1, 6, 4, 5],
      [1, 4, 5, 1],
      [1, 2, 5, 1],
    ],
    melodicMinor: [
      [1, 4, 5, 1],
      [1, 2, 5, 1],
      [1, 6, 4, 5],
    ],
  };
  const choices = modal[mode] ?? [
    [1, 4, 5, 1],
    [1, 5, 6, 4],
    [1, 6, 2, 5],
    [1, 2, 4, 1],
  ];
  return [...choices[(idea - 1) % choices.length]!];
}
