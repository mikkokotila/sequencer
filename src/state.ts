import type { Extension, Phrase, SampleData, SampleManifest, Selection } from './types';
import {
  DRUMS_CFG,
  MEL_CFG,
  STEPS,
  NUM_PHRASES,
  DEFAULT_DRUM_NAMES,
  DEFAULT_MEL_NAMES,
  DEFAULT_VOCAL_NAME,
  TOTAL_TRACKS,
} from './config';

// ═══════════════════════════════════════════
//  Paint / UI types (not in ./types because they are state-internal)
// ═══════════════════════════════════════════

/** The track-type being painted, or empty string when idle. */
export type PaintType = 'drum' | 'melody' | 'vocal' | '';

// ═══════════════════════════════════════════
//  AUDIO
// ═══════════════════════════════════════════

export let audioCtx: AudioContext | null = null;
export let masterGain: GainNode | null = null;
export const trackGains: GainNode[] = []; // per-track gain nodes: [drum0..4, mel0..2, vocal]

// ═══════════════════════════════════════════
//  PLAYBACK
// ═══════════════════════════════════════════

export let bpm = 120;
export let playing = false;
export let curStep = 0;
export let nextTime = 0;
export let timer: ReturnType<typeof setTimeout> | null = null;
export let prevVisualStep = -1;
export let playingPhrase = 0;

// ═══════════════════════════════════════════
//  PHRASES & PATTERNS
// ═══════════════════════════════════════════

/** Create a blank phrase with correctly-sized pattern arrays. */
export function makeEmptyPhrase(): Phrase {
  return {
    drumPat: DRUMS_CFG.map(() => Array<boolean>(STEPS).fill(false)),
    melPat: MEL_CFG.map(() =>
      Array.from({ length: STEPS }, () => Array<boolean>(12).fill(false)),
    ),
    vocalPat: Array<boolean>(STEPS).fill(false),
  };
}

export const phrases: Phrase[] = Array.from({ length: NUM_PHRASES }, () =>
  makeEmptyPhrase(),
);

export let currentPhrase = 0;

// Active pattern references — point into the current phrase.
// These are reassigned by switchToPhrase().
export let drumPat: boolean[][] = phrases[0]!.drumPat;
export let melPat: boolean[][][] = phrases[0]!.melPat;
export let vocalPat: boolean[] = phrases[0]!.vocalPat;

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
//  TRACK METADATA
// ═══════════════════════════════════════════

export let drumNames: string[] = [...DEFAULT_DRUM_NAMES];
export let melNames: string[] = [...DEFAULT_MEL_NAMES];
export let vocalName: string = DEFAULT_VOCAL_NAME;

export const octaves: number[] = [3, 3, 3];
export const harmonies: number[] = [0, 0, 0];
export const mutedArr: boolean[] = Array<boolean>(TOTAL_TRACKS).fill(false);

// ═══════════════════════════════════════════
//  BUFFERS (decoded AudioBuffers, loaded at runtime)
// ═══════════════════════════════════════════

export const drumBuf: (AudioBuffer | null)[] = Array<AudioBuffer | null>(
  DRUMS_CFG.length,
).fill(null);

export const melBuf: (AudioBuffer | null)[] = Array<AudioBuffer | null>(
  MEL_CFG.length,
).fill(null);

export let vocalBuf: AudioBuffer | null = null;

// ═══════════════════════════════════════════
//  SAMPLE DATA (raw ArrayBuffer for persistence)
// ═══════════════════════════════════════════

export const drumSampleData: (SampleData | null)[] = Array<SampleData | null>(
  DRUMS_CFG.length,
).fill(null);

export const melSampleData: (SampleData | null)[] = Array<SampleData | null>(
  MEL_CFG.length,
).fill(null);

export let vocalSampleData: SampleData | null = null;

// ═══════════════════════════════════════════
//  UI STATE
// ═══════════════════════════════════════════

export let painting = false;
export let paintVal = true;
export let paintType: PaintType = '';

export let selecting = false;
export let selection: Selection = { track: -1, start: -1, end: -1 };

// ═══════════════════════════════════════════
//  DOM CELL REFERENCES
// ═══════════════════════════════════════════

export const drumCells: HTMLElement[][] = [];
export const melCells: HTMLElement[][][] = [];
export let vocalCells: HTMLElement[] = [];

// ═══════════════════════════════════════════
//  PERSISTENCE (IndexedDB)
// ═══════════════════════════════════════════

export let db: IDBDatabase | null = null;
export let currentSongId: string | null = null;
export let currentSongName = 'Untitled';
export let saveTimer: ReturnType<typeof setTimeout> | null = null;

// ═══════════════════════════════════════════
//  SAMPLE BROWSER
// ═══════════════════════════════════════════

export let sampleManifest: SampleManifest | null = null;

// ═══════════════════════════════════════════
//  EXTENSION API
// ═══════════════════════════════════════════

export const SEQ_EXTENSIONS: Extension[] = [];
export let activeExtensionId: string | null = null;
export const seqStopCallbacks: Array<() => void> = [];

// ═══════════════════════════════════════════
//  SETTERS
//
//  Module-level `let` bindings cannot be reassigned from outside
//  the module.  Every variable declared with `let` above needs a
//  setter so other modules can mutate shared state.
// ═══════════════════════════════════════════

export function setAudioCtx(ctx: AudioContext | null): void {
  audioCtx = ctx;
}
export function setMasterGain(g: GainNode | null): void {
  masterGain = g;
}
export function setBpm(v: number): void {
  bpm = v;
}
export function setPlaying(v: boolean): void {
  playing = v;
}
export function setCurStep(v: number): void {
  curStep = v;
}
export function setNextTime(v: number): void {
  nextTime = v;
}
export function setTimer(v: ReturnType<typeof setTimeout> | null): void {
  timer = v;
}
export function setPrevVisualStep(v: number): void {
  prevVisualStep = v;
}
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
export function setDrumNames(v: string[]): void {
  drumNames = v;
}
export function setMelNames(v: string[]): void {
  melNames = v;
}
export function setVocalName(v: string): void {
  vocalName = v;
}
export function setVocalBuf(v: AudioBuffer | null): void {
  vocalBuf = v;
}
export function setVocalSampleData(v: SampleData | null): void {
  vocalSampleData = v;
}
export function setPainting(v: boolean): void {
  painting = v;
}
export function setPaintVal(v: boolean): void {
  paintVal = v;
}
export function setPaintType(v: PaintType): void {
  paintType = v;
}
export function setSelecting(v: boolean): void {
  selecting = v;
}
export function setSelection(v: Selection): void {
  selection = v;
}
export function setVocalCells(v: HTMLElement[]): void {
  vocalCells = v;
}
export function setDb(v: IDBDatabase | null): void {
  db = v;
}
export function setCurrentSongId(v: string | null): void {
  currentSongId = v;
}
export function setCurrentSongName(v: string): void {
  currentSongName = v;
}
export function setSaveTimer(v: ReturnType<typeof setTimeout> | null): void {
  saveTimer = v;
}
export function setSampleManifest(v: SampleManifest | null): void {
  sampleManifest = v;
}
export function setActiveExtensionId(v: string | null): void {
  activeExtensionId = v;
}

// ═══════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════

/**
 * Switch the active editing phrase.
 * Updates `currentPhrase` and re-binds the pat references
 * to the selected phrase's arrays.
 *
 * NOTE: This is the pure-state portion of switchToPhrase.
 * The caller is responsible for calling refreshUI() /
 * updateSongPane() after this returns.
 */
export function switchToPhrase(idx: number): void {
  const phrase: Phrase | undefined = phrases[idx];
  if (!phrase) return;
  currentPhrase = idx;
  drumPat = phrase.drumPat;
  melPat = phrase.melPat;
  vocalPat = phrase.vocalPat;
}
