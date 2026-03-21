import type { DrumTrackConfig, MelodyTrackConfig, TrackColorConfig } from './types';

export const STEPS = 64;
export const BARS = 4;
export const SPB = 16; // steps per bar
export const NUM_PHRASES = 12;

export const DRUMS_CFG: readonly DrumTrackConfig[] = [
  { color: '#F5C04E', bright: '#FFDA6E', idle: 'rgba(245,192,78,0.75)',  grid: 'rgba(245,192,78,0.14)' },
  { color: '#EEA83E', bright: '#FFC258', idle: 'rgba(238,168,62,0.70)',  grid: 'rgba(238,168,62,0.12)' },
  { color: '#E49432', bright: '#F8AE4C', idle: 'rgba(228,148,50,0.65)', grid: 'rgba(228,148,50,0.11)' },
  { color: '#DA822A', bright: '#EE9C44', idle: 'rgba(218,130,42,0.60)', grid: 'rgba(218,130,42,0.10)' },
  { color: '#D07224', bright: '#E48C3E', idle: 'rgba(208,114,36,0.55)', grid: 'rgba(208,114,36,0.09)' },
] as const;

export const MEL_CFG: readonly MelodyTrackConfig[] = [
  { color: '#A0B4FF', bright: '#BCC8FF', idle: 'rgba(160,180,255,0.70)', grid: 'rgba(160,180,255,0.10)', mono: true },
  { color: '#8C9CF0', bright: '#A8B4FF', idle: 'rgba(140,156,240,0.62)', grid: 'rgba(140,156,240,0.09)', mono: false },
  { color: '#7C8AE2', bright: '#96A2F6', idle: 'rgba(124,138,226,0.55)', grid: 'rgba(124,138,226,0.08)', mono: false },
] as const;

export const VOCAL_CFG: TrackColorConfig = {
  color: '#5CDCC8', bright: '#7AEEDA', idle: 'rgba(92,220,200,0.70)', grid: 'rgba(92,220,200,0.11)'
};

export const NOTES_DISPLAY: readonly string[] = ['B','A#','A','G#','G','F#','F','E','D#','D','C#','C'];
export const SHARPS: ReadonlySet<number> = new Set([1, 3, 6, 8, 10]);

export const DEFAULT_DRUM_NAMES: readonly string[] = ['Kick', 'Snare', 'Closed Hat', 'Open Hat', 'Crash'];
export const DEFAULT_MEL_NAMES: readonly string[] = ['Mono Synth', 'Poly Synth 1', 'Poly Synth 2'];
export const DEFAULT_VOCAL_NAME = 'Sample 1';

export const HARMONY_LABELS: readonly string[] = ['—', '5TH', '7TH', 'OCT'];
export const HARMONY_SEMITONES: readonly number[] = [0, 7, 10, 12];

export const TOTAL_TRACKS: number = DRUMS_CFG.length + MEL_CFG.length + 1;
