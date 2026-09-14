/**
 * Visual playhead — subscribes to engine:step and engine:stop events,
 * handles all DOM highlighting. The scheduler never touches DOM.
 */

import { on } from '../events';
import { DRUMS_CFG, MEL_CFG, VOCAL_CFG } from '../config';
import { currentPhrase, switchToPhrase } from '../transport/patterns';
import { drumCells, melCells, vocalCells } from '../state';
import { updateDrumCell, updateMelCell, updateVocalCell } from './cells';
import { refreshUI, updateSongPane } from './build';
import { clearSelection, finishPaintingGesture } from './painting';
import { getPlayingPhrase, isPlaying } from '../engine/scheduler';

let prevVisualStep = -1;
let followPlayhead = false;
let followControl: HTMLInputElement | undefined;
const FOLLOW_KEY = 'sequencer.follow-playhead';

export function isFollowingPlayhead(): boolean {
  return followPlayhead;
}
function followPhrase(phrase: number): void {
  if (!followPlayhead || phrase < 0 || phrase === currentPhrase) return;
  // A held stroke must never spill into a phrase the user did not start editing.
  finishPaintingGesture();
  clearSelection();
  switchToPhrase(phrase);
  refreshUI();
  updateSongPane();
}
export function setFollowPlayhead(enabled: boolean): void {
  if (typeof enabled !== 'boolean') throw new Error('Follow Playhead must be true or false.');
  followPlayhead = enabled;
  if (followControl) followControl.checked = enabled;
  try {
    localStorage.setItem(FOLLOW_KEY, String(enabled));
  } catch {
    /* Session preference still works. */
  }
  if (isPlaying()) followPhrase(getPlayingPhrase());
}
function createFollowControl(): void {
  const label = document.createElement('label');
  label.className = 'composer-follow';
  label.title =
    'Show the phrase currently reaching the audio output. Off keeps your editing view in place.';
  followControl = document.createElement('input');
  followControl.type = 'checkbox';
  followControl.setAttribute('aria-label', 'Follow playhead');
  try {
    followPlayhead = localStorage.getItem(FOLLOW_KEY) === 'true';
  } catch {
    /* Default off. */
  }
  followControl.checked = followPlayhead;
  followControl.onchange = () => setFollowPlayhead(followControl!.checked);
  label.append(followControl, document.createTextNode('Follow playhead'));
  document.querySelector('.phrase-controls')?.append(label);
}

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
  createFollowControl();

  on('engine:step', ({ step, phrase }) => {
    followPhrase(phrase);
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
