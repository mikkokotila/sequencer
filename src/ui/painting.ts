/**
 * Mouse interaction for painting notes, selection, and track replication.
 */

import { STEPS, MEL_CFG } from '../config';
import { beginHistoryGesture, endHistoryGesture, editDocument } from '../transport/history';
import {
  drumPat,
  melPat,
  vocalPat,
  replicateTrack as replicateTrackData,
  getMelNotes,
  resolveMelodyPitch,
  currentPhrase,
  phrases,
} from '../transport/patterns';
import {
  melCells,
  painting,
  paintVal,
  paintType,
  selecting,
  selection,
  setPainting,
  setPaintVal,
  setPaintType,
  setSelecting,
  setSelection,
} from '../state';
import type { PaintType } from '../state';
import { displayToSemitone } from './helpers';
import { getPitchView } from './pitch-view';
import { setMelodyNotes } from '../transport/notes';
import { updateDrumCell, updateMelCell, updateVocalCell, setMelodyCellUI } from './cells';

// ── Callbacks (wired by main.ts) ──
let onSave: (() => void) | null = null;
let onSongPaneUpdate: (() => void) | null = null;

export function setOnSave(fn: () => void): void {
  onSave = fn;
}
export function setOnSongPaneUpdate(fn: () => void): void {
  onSongPaneUpdate = fn;
}

// ── Selection visuals ──

export function updateSelectionVisuals(): void {
  document.querySelectorAll('.step-selected').forEach((c) => c.classList.remove('step-selected'));
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
  document.querySelectorAll('.rep-btn').forEach((b) => {
    const el = b as HTMLElement;
    const t = Number(el.dataset.track ?? -1);
    el.classList.toggle(
      'lit',
      selection.track === t && selection.start >= 0 && selection.start !== selection.end,
    );
  });
}

export function clearSelection(): void {
  setSelection({ track: -1, start: -1, end: -1 });
  updateSelectionVisuals();
}

export function replicateSelection(t: number): void {
  editDocument('Repeat selected notes', () => repeatSelection(t));
}

function repeatSelection(t: number): void {
  const lo = Math.min(selection.start, selection.end);
  const hi = Math.max(selection.start, selection.end);
  if (lo < 0 || lo === hi) return;
  const len = hi - lo + 1;
  const pat = Array.from({ length: len }, (_, i) => getMelNotes(t, lo + i));
  for (let s = hi + 1; s < STEPS; s++)
    setMelodyNotes(
      phrases[currentPhrase]!,
      t,
      s,
      pat[(s - hi - 1) % len]!.map((note) => resolveMelodyPitch(t, note)),
    );
  for (let s = hi + 1; s < STEPS; s++) {
    for (let d = 0; d < 12; d++) updateMelCell(t, s, d);
  }
  clearSelection();
  onSave?.();
}

// ── Track-level replication ──

export function replicateTrackUI(type: string, idx: number): void {
  // Delegate all data mutation to the canonical patterns.ts version
  replicateTrackData(type as 'drum' | 'melody' | 'vocal', idx);

  // Refresh all visual cells for the track
  if (type === 'drum') {
    for (let s = 0; s < STEPS; s++) updateDrumCell(idx, s);
  } else if (type === 'melody') {
    for (let s = 0; s < STEPS; s++) {
      for (let d = 0; d < 12; d++) updateMelCell(idx, s, d);
    }
  } else {
    for (let s = 0; s < STEPS; s++) updateVocalCell(s);
  }

  onSave?.();
}

// ── Painting setup ──

let paintingInitialized = false;

export function setupPainting(): void {
  if (paintingInitialized) return;
  paintingInitialized = true;

  document.addEventListener('mousedown', (e: MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    const cell = target.closest<HTMLElement>('.step-cell, .melody-cell');
    if (!cell) return;
    e.preventDefault();

    const type = (cell.dataset.type as PaintType | undefined) ?? null;
    const t = Number(cell.dataset.track ?? 0);
    const s = Number(cell.dataset.step ?? 0);

    // Shift+click on melody = selection mode
    const cfg = MEL_CFG[t];
    if (e.shiftKey && type === 'melody' && cfg && !cfg.mono) {
      setSelecting(true);
      setSelection({ track: t, start: s, end: s });
      updateSelectionVisuals();
      return;
    }

    if (selection.track >= 0) clearSelection();
    beginHistoryGesture('Paint notes');
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
      const dr = Number(cell.dataset.note ?? 0);
      const raw = getPitchView(t) + displayToSemitone(dr);
      const semi = getMelNotes(t, s).includes(raw) ? raw : resolveMelodyPitch(t, raw);
      const trackPat = melPat[t];
      const stepPat = trackPat?.[s];
      if (stepPat) {
        setPaintVal(!getMelNotes(t, s).includes(semi));
        setMelodyCellUI(t, s, 11 - (semi - getPitchView(t)), paintVal);
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
      const cell = target.closest<HTMLElement>('.melody-cell');
      if (!cell || Number(cell.dataset.track ?? -1) !== selection.track) return;
      setSelection({ ...selection, end: Number(cell.dataset.step ?? 0) });
      updateSelectionVisuals();
      return;
    }
    if (!painting) return;
    const target = e.target as HTMLElement;
    const cell = target.closest<HTMLElement>('.step-cell, .melody-cell');
    if (cell?.dataset.type !== paintType) return;

    const t = Number(cell.dataset.track ?? 0);
    const s = Number(cell.dataset.step ?? 0);

    if (paintType === 'drum') {
      const trackPat = drumPat[t];
      if (trackPat && trackPat[s] !== paintVal) {
        trackPat[s] = paintVal;
        updateDrumCell(t, s);
      }
    } else if (paintType === 'melody') {
      const dr = Number(cell.dataset.note ?? 0);
      const raw = getPitchView(t) + displayToSemitone(dr);
      const semi = getMelNotes(t, s).includes(raw) ? raw : resolveMelodyPitch(t, raw);
      const stepPat = melPat[t]?.[s];
      if (stepPat && getMelNotes(t, s).includes(semi) !== paintVal) {
        setMelodyCellUI(t, s, 11 - (semi - getPitchView(t)), paintVal);
      }
    } else {
      if (vocalPat[s] !== paintVal) {
        vocalPat[s] = paintVal;
        updateVocalCell(s);
      }
    }
  });

  document.addEventListener('mouseup', finishPaintingGesture);
  window.addEventListener('blur', finishPaintingGesture);
}

export function finishPaintingGesture(): void {
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
    endHistoryGesture();
    onSongPaneUpdate?.();
    onSave?.();
  }
}
