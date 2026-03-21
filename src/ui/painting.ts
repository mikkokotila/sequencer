/**
 * Mouse interaction for painting notes, selection, and track replication.
 */

import { STEPS, SPB, MEL_CFG } from '../config';
import {
  drumPat, melPat, vocalPat, melCells,
  painting, paintVal, paintType,
  selecting, selection, setPainting, setPaintVal, setPaintType,
  setSelecting, setSelection,
} from '../state';
import type { PaintType } from '../state';
import { displayToSemitone } from './helpers';
import { updateDrumCell, updateMelCell, updateVocalCell, setMelodyCell } from './cells';

// ── Callbacks (wired by main.ts) ──
let onSave: (() => void) | null = null;
let onSongPaneUpdate: (() => void) | null = null;

export function setOnSave(fn: () => void): void { onSave = fn; }
export function setOnSongPaneUpdate(fn: () => void): void { onSongPaneUpdate = fn; }

// ── Selection visuals ──

export function updateSelectionVisuals(): void {
  document.querySelectorAll('.step-selected').forEach(c => c.classList.remove('step-selected'));
  if (selection.track < 0) return;
  const lo = Math.min(selection.start, selection.end);
  const hi = Math.max(selection.start, selection.end);
  for (let s = lo; s <= hi; s++) {
    for (let d = 0; d < 12; d++) {
      melCells[selection.track]?.[s]?.[d]?.classList.add('step-selected');
    }
  }
  updateRepButtons();
}

export function updateRepButtons(): void {
  document.querySelectorAll('.rep-btn').forEach(b => {
    const el = b as HTMLElement;
    const t = Number(el.dataset['track'] ?? -1);
    el.classList.toggle('lit', selection.track === t && selection.start >= 0 && selection.start !== selection.end);
  });
}

export function clearSelection(): void {
  setSelection({ track: -1, start: -1, end: -1 });
  updateSelectionVisuals();
}

export function replicateSelection(t: number): void {
  const lo = Math.min(selection.start, selection.end);
  const hi = Math.max(selection.start, selection.end);
  if (lo < 0 || lo === hi) return;
  const len = hi - lo + 1;
  const pat: boolean[][] = [];
  for (let s = lo; s <= hi; s++) {
    const stepData = melPat[t]?.[s];
    pat.push(stepData ? [...stepData] : Array(12).fill(false) as boolean[]);
  }
  for (let s = hi + 1; s < STEPS; s++) {
    const pi = (s - hi - 1) % len;
    const source = pat[pi];
    const target = melPat[t]?.[s];
    if (source && target) {
      for (let n = 0; n < 12; n++) {
        target[n] = source[n] ?? false;
      }
    }
  }
  for (let s = hi + 1; s < STEPS; s++) {
    for (let d = 0; d < 12; d++) updateMelCell(t, s, d);
  }
  clearSelection();
  onSave?.();
}

// ── Track-level replication ──

export function replicateTrack(type: string, idx: number): void {
  let lastStep = -1;
  for (let s = STEPS - 1; s >= 0; s--) {
    if (type === 'drum' && drumPat[idx]?.[s]) { lastStep = s; break; }
    if (type === 'melody' && melPat[idx]?.[s]?.some((n: boolean) => n)) { lastStep = s; break; }
    if (type === 'vocal' && vocalPat[s]) { lastStep = s; break; }
  }
  if (lastStep < 0) return;

  const patLen = (Math.floor(lastStep / SPB) + 1) * SPB;
  if (patLen >= STEPS) return;

  for (let s = patLen; s < STEPS; s++) {
    const src = s % patLen;
    if (type === 'drum') {
      const trackPat = drumPat[idx];
      if (trackPat) {
        trackPat[s] = trackPat[src] ?? false;
        updateDrumCell(idx, s);
      }
    } else if (type === 'melody') {
      const trackPat = melPat[idx];
      if (trackPat) {
        const srcStep = trackPat[src];
        if (srcStep) trackPat[s] = [...srcStep];
        for (let d = 0; d < 12; d++) updateMelCell(idx, s, d);
      }
    } else {
      vocalPat[s] = vocalPat[src] ?? false;
      updateVocalCell(s);
    }
  }
  onSave?.();
}

// ── Painting setup ──

export function setupPainting(): void {
  document.addEventListener('mousedown', (e: MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    const cell = target.closest('.step-cell, .melody-cell') as HTMLElement | null;
    if (!cell) return;
    e.preventDefault();

    const type = (cell.dataset['type'] ?? '') as PaintType;
    const t = Number(cell.dataset['track'] ?? 0);
    const s = Number(cell.dataset['step'] ?? 0);

    // Shift+click on melody = selection mode
    const cfg = MEL_CFG[t];
    if (e.shiftKey && type === 'melody' && cfg && !cfg.mono) {
      setSelecting(true);
      setSelection({ track: t, start: s, end: s });
      updateSelectionVisuals();
      return;
    }

    if (selection.track >= 0) clearSelection();
    setPainting(true);
    setPaintType(type);

    if (type === 'drum') {
      const trackPat = drumPat[t];
      if (trackPat) {
        const current = trackPat[s] ?? false;
        setPaintVal(!current);
        trackPat[s] = paintVal;
        updateDrumCell(t, s);
      }
    } else if (type === 'melody') {
      const dr = Number(cell.dataset['note'] ?? 0);
      const semi = displayToSemitone(dr);
      const trackPat = melPat[t];
      const stepPat = trackPat?.[s];
      if (stepPat) {
        setPaintVal(!(stepPat[semi] ?? false));
        setMelodyCell(t, s, dr, paintVal);
      }
    } else {
      const current = vocalPat[s] ?? false;
      setPaintVal(!current);
      vocalPat[s] = paintVal;
      updateVocalCell(s);
    }
    onSave?.();
  });

  document.addEventListener('mousemove', (e: MouseEvent) => {
    if (selecting) {
      const target = e.target as HTMLElement;
      const cell = target.closest('.melody-cell') as HTMLElement | null;
      if (!cell || Number(cell.dataset['track'] ?? -1) !== selection.track) return;
      setSelection({ ...selection, end: Number(cell.dataset['step'] ?? 0) });
      updateSelectionVisuals();
      return;
    }
    if (!painting) return;
    const target = e.target as HTMLElement;
    const cell = target.closest('.step-cell, .melody-cell') as HTMLElement | null;
    if (!cell || cell.dataset['type'] !== paintType) return;

    const t = Number(cell.dataset['track'] ?? 0);
    const s = Number(cell.dataset['step'] ?? 0);

    if (paintType === 'drum') {
      const trackPat = drumPat[t];
      if (trackPat && trackPat[s] !== paintVal) {
        trackPat[s] = paintVal;
        updateDrumCell(t, s);
      }
    } else if (paintType === 'melody') {
      const dr = Number(cell.dataset['note'] ?? 0);
      const semi = displayToSemitone(dr);
      const stepPat = melPat[t]?.[s];
      if (stepPat && stepPat[semi] !== paintVal) {
        setMelodyCell(t, s, dr, paintVal);
      }
    } else {
      if (vocalPat[s] !== paintVal) {
        vocalPat[s] = paintVal;
        updateVocalCell(s);
      }
    }
  });

  document.addEventListener('mouseup', () => {
    if (selecting) {
      setSelecting(false);
      if (selection.start > selection.end) {
        setSelection({ ...selection, start: selection.end, end: selection.start });
      }
      updateRepButtons();
      return;
    }
    if (painting) {
      setPainting(false);
      onSongPaneUpdate?.();
      onSave?.();
    }
  });
}
