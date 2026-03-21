/**
 * UI-only state — painting interaction, selection, and DOM cell references.
 *
 * This file contains ONLY state that belongs to the UI layer.
 * Canonical state locations:
 *   - Patterns/phrases: transport/patterns.ts
 *   - Song metadata/buffers: transport/song.ts
 *   - Playback: engine/scheduler.ts
 *   - Extensions: engine/extensions/store.ts
 *   - Audio nodes: engine/audio.ts
 */

import type { Selection } from './types';

// ═══════════════════════════════════════════
//  Paint / UI types
// ═══════════════════════════════════════════

/** The track-type being painted, or null when idle. */
export type PaintType = 'drum' | 'melody' | 'vocal';

// ═══════════════════════════════════════════
//  PAINTING STATE
// ═══════════════════════════════════════════

export let painting = false;
export let paintVal = true;
export let paintType: PaintType | null = null;

export let selecting = false;
export let selection: Selection = { track: -1, start: -1, end: -1 };

// ═══════════════════════════════════════════
//  DOM CELL REFERENCES
// ═══════════════════════════════════════════

export const drumCells: HTMLElement[][] = [];
export const melCells: HTMLElement[][][] = [];
export let vocalCells: HTMLElement[] = [];

// ═══════════════════════════════════════════
//  SETTERS
// ═══════════════════════════════════════════

export function setPainting(v: boolean): void {
  painting = v;
}
export function setPaintVal(v: boolean): void {
  paintVal = v;
}
export function setPaintType(v: PaintType | null): void {
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
