/**
 * Cell rendering — update visual state of drum / melody / vocal grid cells,
 * melody‐cell mono enforcement, multi‐note detection, and harmony cycling.
 *
 * Uses CSS class toggles for cell state — no inline style mutation.
 * Active-cell colors are defined via CSS custom properties set on the cell
 * at build time (--cell-idle) and consumed by the .active class in index.html.
 */

import { MEL_CFG, STEPS, HARMONY_LABELS } from '../config';
import {
  drumPat,
  melPat,
  vocalPat,
  harmonies,
  setMelodyCell as setMelodyCellData,
} from '../transport/patterns';
import { drumCells, melCells, vocalCells } from '../state';
import { displayToSemitone } from './helpers';

// ═══════════════════════════════════════════
//  Cell visual updates (class-only, no inline style)
// ═══════════════════════════════════════════

/** Set drum cell active/inactive state via CSS class. */
export function updateDrumCell(t: number, s: number): void {
  const c = drumCells[t]?.[s];
  if (!c) return;
  c.classList.toggle('active', !!drumPat[t]?.[s]);
}

/** Set melody cell active/inactive state via CSS class. */
export function updateMelCell(t: number, s: number, dr: number): void {
  const semi = displayToSemitone(dr);
  const c = melCells[t]?.[s]?.[dr];
  if (!c) return;
  c.classList.toggle('active', !!melPat[t]?.[s]?.[semi]);
}

/** Set vocal cell active/inactive state via CSS class. */
export function updateVocalCell(s: number): void {
  const c = vocalCells[s];
  if (!c) return;
  c.classList.toggle('active', !!vocalPat[s]);
}

// ═══════════════════════════════════════════
//  Melody cell editing
// ═══════════════════════════════════════════

/**
 * Set a melody cell value, enforcing mono mode when applicable.
 * Delegates data mutation to the canonical patterns.ts version,
 * then handles visual updates.
 */
export function setMelodyCellUI(t: number, s: number, dr: number, val: boolean): void {
  const cfg = MEL_CFG[t];
  if (!cfg) return;

  // Delegate all data mutation (mono enforcement + step write) to patterns.ts
  setMelodyCellData(t, s, dr, val);

  // Visual update: mono mode may have cleared other rows, so refresh all 12
  if (cfg.mono && val) {
    for (let d = 0; d < 12; d++) updateMelCell(t, s, d);
  } else {
    updateMelCell(t, s, dr);
  }

  if (!cfg.mono) updateHarmonyDim(t);
}

// ═══════════════════════════════════════════
//  Multi-note & harmony
// ═══════════════════════════════════════════

/** Check whether any step in melody track t has more than one note active. */
export function checkMultiNote(t: number): boolean {
  const trackPat = melPat[t];
  if (!trackPat) return false;
  for (let s = 0; s < STEPS; s++) {
    const stepNotes = trackPat[s];
    if (!stepNotes) continue;
    let c = 0;
    for (let n = 0; n < 12; n++) {
      if (stepNotes[n]) c++;
    }
    if (c > 1) return true;
  }
  return false;
}

/** Dim or un-dim the harmony toggle button based on multi-note status. */
export function updateHarmonyDim(t: number): void {
  const b = document.querySelector(`.melody-track[data-track="${t}"] .harmony-toggle`);
  if (b) b.classList.toggle('dimmed', checkMultiNote(t));
}

/**
 * Cycle harmony mode (none / 5th / 7th / oct) for melody track t.
 * Returns the new harmony index so the caller can trigger a save.
 */
export function cycleHarmony(t: number): number {
  const prev = harmonies[t];
  if (prev === undefined) return 0;
  const next = (prev + 1) % HARMONY_LABELS.length;
  harmonies[t] = next;

  const b = document.querySelector(`.melody-track[data-track="${t}"] .harmony-toggle`);
  if (b) {
    const label = HARMONY_LABELS[next];
    b.textContent = 'HARM: ' + (label ?? '—');
    b.classList.toggle('active', next > 0);
  }

  return next;
}
