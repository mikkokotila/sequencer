/**
 * Song metadata, track config, audio buffers.
 * Everything that's not patterns and not DOM.
 *
 * NO DOM types (no HTMLElement, no document).
 * AudioBuffer, AudioContext, IDBDatabase are data/reference holders — allowed.
 */

import type { SampleData, SampleManifest } from '../types';
import {
  DRUMS_CFG,
  MEL_CFG,
  DEFAULT_DRUM_NAMES,
  DEFAULT_MEL_NAMES,
  DEFAULT_VOCAL_NAME,
  TOTAL_TRACKS,
} from '../config';

// ═══════════════════════════════════════════
//  BPM
// ═══════════════════════════════════════════

export let bpm = 120;

let onBpmChange: ((v: number) => void) | null = null;
export function setOnBpmChange(fn: (v: number) => void): void {
  onBpmChange = fn;
}

export function setBpm(v: number): void {
  bpm = v;
  onBpmChange?.(v);
}

// ═══════════════════════════════════════════
//  TRACK NAMES
// ═══════════════════════════════════════════

export let drumNames: string[] = [...DEFAULT_DRUM_NAMES];
export let melNames: string[] = [...DEFAULT_MEL_NAMES];
export let vocalName: string = DEFAULT_VOCAL_NAME;

export function setDrumNames(v: string[]): void {
  drumNames = v;
}

export function setMelNames(v: string[]): void {
  melNames = v;
}

export function setVocalName(v: string): void {
  vocalName = v;
}

// ═══════════════════════════════════════════
//  MUTE STATE
// ═══════════════════════════════════════════

export const mutedArr: boolean[] = Array<boolean>(TOTAL_TRACKS).fill(false);

export function setMuted(track: number, value: boolean): void {
  mutedArr[track] = value;
}

// ═══════════════════════════════════════════
//  AUDIO BUFFERS (decoded, loaded at runtime)
// ═══════════════════════════════════════════

export const drumBuf: (AudioBuffer | null)[] = Array<AudioBuffer | null>(DRUMS_CFG.length).fill(
  null,
);

export const melBuf: (AudioBuffer | null)[] = Array<AudioBuffer | null>(MEL_CFG.length).fill(null);

export let vocalBuf: AudioBuffer | null = null;

export function setVocalBuf(v: AudioBuffer | null): void {
  vocalBuf = v;
}

// ═══════════════════════════════════════════
//  SAMPLE DATA (raw ArrayBuffer for persistence)
// ═══════════════════════════════════════════

export const drumSampleData: (SampleData | null)[] = Array<SampleData | null>(
  DRUMS_CFG.length,
).fill(null);

export const melSampleData: (SampleData | null)[] = Array<SampleData | null>(MEL_CFG.length).fill(
  null,
);

export let vocalSampleData: SampleData | null = null;

export function setVocalSampleData(v: SampleData | null): void {
  vocalSampleData = v;
}

// ═══════════════════════════════════════════
//  SAMPLE BROWSER
// ═══════════════════════════════════════════

export let sampleManifest: SampleManifest | null = null;

export function setSampleManifest(v: SampleManifest | null): void {
  sampleManifest = v;
}

// ═══════════════════════════════════════════
//  PERSISTENCE (IndexedDB)
// ═══════════════════════════════════════════

export let currentSongId: string | null = null;
export let currentSongName = 'Untitled';
export let db: IDBDatabase | null = null;
export let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function setCurrentSongId(v: string | null): void {
  currentSongId = v;
}

export function setCurrentSongName(v: string): void {
  currentSongName = v;
}

export function setDb(v: IDBDatabase | null): void {
  db = v;
}

export function setSaveTimer(v: ReturnType<typeof setTimeout> | null): void {
  saveTimer = v;
}
