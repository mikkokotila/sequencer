/**
 * Cell rendering — update visual state of drum / melody / vocal grid cells,
 * melody‐cell mono enforcement, multi‐note detection, and harmony cycling.
 */

import {
  DRUMS_CFG,
  MEL_CFG,
  VOCAL_CFG,
  STEPS,
  HARMONY_LABELS,
} from '../config';
import {
  drumPat,
  melPat,
  vocalPat,
  harmonies,
} from '../transport/patterns';
import {
  drumCells,
  melCells,
  vocalCells,
} from '../state';
import { displayToSemitone } from './helpers';

// ═══════════════════════════════════════════
//  Cell visual updates
// ═══════════════════════════════════════════

/** Set drum cell background/shadow based on current pattern state. */
export function updateDrumCell(t: number, s: number): void {
  const c = drumCells[t]?.[s];
  const cfg = DRUMS_CFG[t];
  if (!c || !cfg) return;
  if (drumPat[t]?.[s]) {
    c.classList.add('active');
    c.style.background = cfg.idle;
    c.style.boxShadow = '';
  } else {
    c.classList.remove('active');
    c.style.background = '';
    c.style.boxShadow = '';
  }
}

/** Set melody cell background/shadow based on current pattern state. */
export function updateMelCell(t: number, s: number, dr: number): void {
  const semi = displayToSemitone(dr);
  const c = melCells[t]?.[s]?.[dr];
  const cfg = MEL_CFG[t];
  if (!c || !cfg) return;
  if (melPat[t]?.[s]?.[semi]) {
    c.classList.add('active');
    c.style.background = cfg.idle;
    c.style.boxShadow = '';
  } else {
    c.classList.remove('active');
    c.style.background = '';
    c.style.boxShadow = '';
  }
}

/** Set vocal cell background/shadow based on current pattern state. */
export function updateVocalCell(s: number): void {
  const c = vocalCells[s];
  if (!c) return;
  if (vocalPat[s]) {
    c.classList.add('active');
    c.style.background = VOCAL_CFG.idle;
    c.style.boxShadow = '';
  } else {
    c.classList.remove('active');
    c.style.background = '';
    c.style.boxShadow = '';
  }
}

// ═══════════════════════════════════════════
//  Melody cell editing
// ═══════════════════════════════════════════

/**
 * Set a melody cell value, enforcing mono mode when applicable.
 * In mono mode, enabling a note clears all other notes on that step.
 */
export function setMelodyCell(
  t: number,
  s: number,
  dr: number,
  val: boolean,
): void {
  const semi = displayToSemitone(dr);
  const cfg = MEL_CFG[t];
  const stepNotes = melPat[t]?.[s];
  if (!cfg || !stepNotes) return;

  if (cfg.mono && val) {
    for (let n = 0; n < 12; n++) {
      if (n !== semi && stepNotes[n]) {
        stepNotes[n] = false;
        updateMelCell(t, s, 11 - n);
      }
    }
  }

  stepNotes[semi] = val;
  updateMelCell(t, s, dr);

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
  const b = document.querySelector(
    `.melody-track[data-track="${t}"] .harmony-toggle`,
  );
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

  const b = document.querySelector(
    `.melody-track[data-track="${t}"] .harmony-toggle`,
  );
  if (b) {
    const label = HARMONY_LABELS[next];
    b.textContent = 'HARM: ' + (label ?? '—');
    b.classList.toggle('active', next > 0);
  }

  return next;
}
