/** Seeded, role-aware composition. Shared bar harmony; repeating motifs with restrained answers. */
import type { SongTheory } from '../types';
import { chordPitches, degreePitch, inScale, pitchClass, voiceChord } from './theory';

export type VoiceRole = 'bass' | 'melody' | 'chords' | 'arpeggio';
export type MusicalStyle = 'sparse' | 'driving' | 'syncopated' | 'answer';
export interface GenerationOptions {
  seed: number;
  roles: VoiceRole[]; // the three synth channels, including currently unselected channels
  chordSize: 3 | 4;
}
export const DEFAULT_ROLES: VoiceRole[] = ['bass', 'chords', 'melody'];
export function normalizeGeneration(value: unknown): GenerationOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid generator options.');
  const input = value as Record<string, unknown>;
  if (
    typeof input.seed !== 'number' ||
    !Number.isInteger(input.seed) ||
    input.seed < 1 ||
    input.seed > 2147483647
  )
    throw new Error('Idea must be an integer from 1 to 2147483647.');
  if (
    !Array.isArray(input.roles) ||
    input.roles.length !== 3 ||
    input.roles.some(
      (role: unknown) =>
        typeof role !== 'string' || !['bass', 'melody', 'chords', 'arpeggio'].includes(role),
    )
  )
    throw new Error('Choose a musical role for each synth channel.');
  const roles = (input.roles as VoiceRole[]).slice();
  if (roles[0] === 'chords')
    throw new Error('The mono synth can play bass, melody or arpeggios. Chords need a poly synth.');
  if (input.chordSize !== 3 && input.chordSize !== 4)
    throw new Error('Choose triads or seventh chords.');
  return { seed: input.seed, roles, chordSize: input.chordSize };
}

function hash(seed: number, salt: number): number {
  let x = (seed ^ Math.imul(salt + 1, 0x9e3779b9)) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  return x >>> 0;
}
const MOTIFS = [
  [0, 2, 1, 3, 2, 1, 4, 0],
  [0, 1, 2, 4, 3, 2, 1, 0],
  [2, 1, 0, 2, 4, 3, 1, 0],
  [0, 3, 2, 1, 0, 2, 1, 4],
  [1, 0, 2, 1, 3, 4, 2, 0],
  [0, 2, 4, 2, 1, 3, 2, 0],
];
function rhythm(role: VoiceRole, style: MusicalStyle, bar: number, idea: number): number[] {
  if (role === 'chords') {
    if (style === 'sparse') return [0];
    if (style === 'driving') return [0, 4, 8, 12];
    if (style === 'syncopated') return idea % 2 ? [2, 6, 10, 14] : [0, 6, 10, 14];
    return bar % 2 ? [6, 14] : [0, 8];
  }
  if (style === 'sparse') return role === 'bass' ? [0, 8] : idea % 2 ? [0, 7, 12] : [0, 6, 12];
  if (style === 'driving')
    return role === 'melody' ? [0, 2, 4, 7, 8, 10, 12, 14] : [0, 2, 4, 6, 8, 10, 12, 14];
  if (style === 'syncopated') return idea % 2 ? [0, 3, 6, 10, 14] : [0, 3, 7, 10, 15];
  return bar % 2 ? [4, 7, 10, 14] : [0, 3, 6];
}
function nearestClass(pc: number, previous: number, min: number, max: number): number {
  const candidates: number[] = [];
  for (let note = min; note <= max; note++)
    if (pitchClass(note) === pitchClass(pc)) candidates.push(note);
  candidates.sort((a, b) => Math.abs(a - previous) - Math.abs(b - previous) || a - b);
  return candidates[0]!;
}
function scaleNeighbor(
  note: number,
  direction: number,
  theory: SongTheory,
  min: number,
  max: number,
): number {
  for (let delta = 1; delta <= 3; delta++) {
    const candidate = note + delta * direction;
    if (candidate >= min && candidate <= max && inScale(candidate, theory)) return candidate;
  }
  return note;
}
/** Generate a whole four-bar phrase; callers apply only their selected bars/steps. */
export function generatePart(
  theory: SongTheory,
  role: VoiceRole,
  style: MusicalStyle,
  phrase: number,
  track: number,
  options: GenerationOptions,
): number[][] {
  const output: number[][] = Array.from({ length: 64 }, () => []);
  const idea = hash(options.seed, track);
  const motif = MOTIFS[idea % MOTIFS.length]!;
  let previous = role === 'bass' ? theory.root : theory.root + 7;
  let voicing: number[] = Array.from(
    { length: options.chordSize },
    (_, i) => theory.root + (idea % 3) * 4 - 4 + i * 4,
  );
  for (let bar = 0; bar < 4; bar++) {
    const globalBar = phrase * 4 + bar;
    const degree = theory.progression[globalBar % theory.progression.length]!;
    const chord = chordPitches(degree, theory, options.chordSize);
    voicing = voiceChord(
      chord,
      voicing,
      role === 'arpeggio' ? 0 : -5,
      role === 'arpeggio' ? 23 : 18,
    );
    const hits = rhythm(role, style, bar, idea);
    for (const [event, step] of hits.entries()) {
      let notes: number[];
      if (role === 'chords') notes = [...voicing];
      else if (role === 'arpeggio') {
        const order = idea % 2 ? [0, 1, 2, 1, 3, 2, 1, 0] : [0, 2, 1, 3, 2, 1, 0, 1];
        notes = [voicing[order[event % order.length]! % voicing.length]!];
      } else if (role === 'bass') {
        let pitch = pitchClass(chord[0]!);
        if (event > 0 && event % 3 === 2) pitch = pitchClass(chord[2]!);
        else if (event > 0 && (idea + event) % 5 === 0) pitch = pitchClass(chord[1]!);
        if (step >= 14 && style !== 'sparse') {
          const nextDegree = theory.progression[(globalBar + 1) % theory.progression.length]!;
          const nextRoot = pitchClass(degreePitch(nextDegree - 1, theory));
          pitch = scaleNeighbor(nextRoot, -1, theory, 0, 11);
        }
        notes = [pitch];
      } else {
        const motifIndex = (event + (phrase % 4 === 3 && bar >= 2 ? 1 : 0)) % motif.length;
        let pitch = nearestClass(chord[motif[motifIndex]! % chord.length]!, previous, 0, 23);
        if (step % 4 !== 0 && event > 0)
          pitch = scaleNeighbor(previous, motif[motifIndex]! % 2 ? 1 : -1, theory, 0, 23);
        // Re-establish harmony at each bar entrance and close the fourth-bar answer.
        if (event === 0 || (bar === 3 && event === hits.length - 1))
          pitch = nearestClass(chord[0]!, previous, 0, 23);
        notes = [pitch];
        previous = pitch;
      }
      output[bar * 16 + step] = notes;
    }
  }
  return output;
}
