/**
 * Visual playhead — subscribes to engine:step and engine:stop events,
 * handles all DOM highlighting. The scheduler never touches DOM.
 */

import { on } from '../events';
import { DRUMS_CFG, MEL_CFG, VOCAL_CFG } from '../config';
import { currentPhrase } from '../transport/patterns';
import { drumCells, melCells, vocalCells } from '../state';
import { updateDrumCell, updateMelCell, updateVocalCell } from './cells';

let prevVisualStep = -1;

/** Highlight the current step (only when viewing the playing phrase). */
function highlightStep(step: number, phrase: number): void {
  if (phrase !== currentPhrase) {
    // The playing phrase is no longer the one on screen. Clear the column we
    // last lit, otherwise it stays highlighted for the rest of the session —
    // updateXCell() only restores `.active`, it never removes `.playing`.
    if (prevVisualStep >= 0) clearHL(prevVisualStep);
    prevVisualStep = -1;
    return;
  }
  if (prevVisualStep >= 0) clearHL(prevVisualStep);

  // Drum cells
  for (let t = 0; t < DRUMS_CFG.length; t++) {
    const c = drumCells[t]?.[step];
    if (!c) continue;
    c.classList.add('playing');
  }

  // Melody cells
  for (let t = 0; t < MEL_CFG.length; t++) {
    if (!MEL_CFG[t]) continue;
    for (let n = 0; n < 12; n++) {
      const c = melCells[t]?.[step]?.[n];
      if (!c) continue;
      c.classList.add('playing');
    }
  }

  // Vocal cell
  const vc = vocalCells[step];
  if (vc) {
    vc.classList.add('playing');
  }

  prevVisualStep = step;
}

/** Remove highlight from a step. */
function clearHL(s: number): void {
  for (let t = 0; t < DRUMS_CFG.length; t++) {
    const c = drumCells[t]?.[s];
    if (!c) continue;
    c.classList.remove('playing');
    updateDrumCell(t, s);
  }

  for (let t = 0; t < MEL_CFG.length; t++) {
    if (!MEL_CFG[t]) continue;
    for (let n = 0; n < 12; n++) {
      const c = melCells[t]?.[s]?.[n];
      if (!c) continue;
      c.classList.remove('playing');
      updateMelCell(t, s, n);
    }
  }

  const vc = vocalCells[s];
  if (vc) {
    vc.classList.remove('playing');
    updateVocalCell(s);
  }
}

/**
 * Remove every residual `.playing` mark.
 *
 * clearHL() only knows about the single step it last tracked, so it cannot
 * recover a column orphaned by a phrase-view switch. This sweep is the
 * backstop for stop and view-switch transitions; it is not on the per-step path.
 */
function clearAllHighlights(): void {
  document.querySelectorAll('.playing').forEach((c) => c.classList.remove('playing'));
  prevVisualStep = -1;
}

/** Inject playhead CSS rules so highlight is driven by class toggles, not inline styles. */
function injectPlayheadCSS(): void {
  const style = document.createElement('style');
  const rules: string[] = [];

  // Drum tracks: active + playing = bright highlight
  for (let t = 0; t < DRUMS_CFG.length; t++) {
    const cfg = DRUMS_CFG[t];
    if (!cfg) continue;
    rules.push(
      `.step-cell[data-type="drum"][data-track="${t}"].active.playing { background: ${cfg.bright} !important; box-shadow: 0 0 16px ${cfg.bright}80, 0 0 6px ${cfg.color}60 !important; }`,
    );
  }

  // Melody tracks: active + playing = bright highlight
  for (let t = 0; t < MEL_CFG.length; t++) {
    const cfg = MEL_CFG[t];
    if (!cfg) continue;
    rules.push(
      `.melody-cell[data-track="${t}"].active.playing { background: ${cfg.bright} !important; box-shadow: 0 0 16px ${cfg.bright}80, 0 0 6px ${cfg.color}60 !important; }`,
    );
  }

  // Vocal track: active + playing = bright highlight
  rules.push(
    `.step-cell[data-type="vocal"].active.playing { background: ${VOCAL_CFG.bright} !important; box-shadow: 0 0 16px ${VOCAL_CFG.bright}80, 0 0 6px ${VOCAL_CFG.color}60 !important; }`,
  );

  // Non-active cells that are playing get a subtle highlight
  rules.push(
    `.step-cell.playing, .melody-cell.playing { background: rgba(255,255,255,0.03) !important; }`,
  );

  style.textContent = rules.join('\n');
  document.head.appendChild(style);
}

/** Subscribe to engine events. Call once at init. */
export function initPlayhead(): void {
  injectPlayheadCSS();

  on('engine:step', ({ step, phrase }) => {
    highlightStep(step, phrase);
  });

  on('engine:stop', () => {
    if (prevVisualStep >= 0) {
      clearHL(prevVisualStep);
      prevVisualStep = -1;
    }
    // Backstop: a column orphaned by an earlier view switch is not tracked by
    // prevVisualStep, so clear anything still marked.
    clearAllHighlights();
    // Remove play button active state
    const playBtn = document.getElementById('play-btn');
    if (playBtn) playBtn.classList.remove('active');
  });

  // Switching the viewed phrase must not leave the old column frozen on screen.
  on('transport:phraseChanged', () => {
    clearAllHighlights();
  });
}
