/**
 * Visual playhead — subscribes to engine:step and engine:stop events,
 * handles all DOM highlighting. The scheduler never touches DOM.
 */

import { on } from '../events';
import { DRUMS_CFG, MEL_CFG, VOCAL_CFG } from '../config';
import { drumPat, melPat, vocalPat, currentPhrase } from '../transport/patterns';
import { drumCells, melCells, vocalCells } from '../state';
import { displayToSemitone } from './helpers';

let prevVisualStep = -1;

/** Highlight the current step (only when viewing the playing phrase). */
function highlightStep(step: number, phrase: number): void {
  if (phrase !== currentPhrase) {
    prevVisualStep = -1;
    return;
  }
  if (prevVisualStep >= 0) clearHL(prevVisualStep);

  // Drum cells
  for (let t = 0; t < DRUMS_CFG.length; t++) {
    const c = drumCells[t]?.[step];
    const cfg = DRUMS_CFG[t];
    const row = drumPat[t];
    if (!c || !cfg) continue;
    c.classList.add('playing');
    if (row?.[step]) {
      c.style.background = cfg.bright;
      c.style.boxShadow = `0 0 16px ${cfg.bright}80, 0 0 6px ${cfg.color}60`;
    }
  }

  // Melody cells
  for (let t = 0; t < MEL_CFG.length; t++) {
    const cfg = MEL_CFG[t];
    if (!cfg) continue;
    for (let n = 0; n < 12; n++) {
      const c = melCells[t]?.[step]?.[n];
      if (!c) continue;
      c.classList.add('playing');
      const semi = displayToSemitone(n);
      const stepData = melPat[t]?.[step];
      if (stepData?.[semi]) {
        c.style.background = cfg.bright;
        c.style.boxShadow = `0 0 16px ${cfg.bright}80, 0 0 6px ${cfg.color}60`;
      }
    }
  }

  // Vocal cell
  const vc = vocalCells[step];
  if (vc) {
    vc.classList.add('playing');
    if (vocalPat[step]) {
      vc.style.background = VOCAL_CFG.bright;
      vc.style.boxShadow = `0 0 16px ${VOCAL_CFG.bright}80, 0 0 6px ${VOCAL_CFG.color}60`;
    }
  }

  prevVisualStep = step;
}

/** Remove highlight from a step. */
function clearHL(s: number): void {
  for (let t = 0; t < DRUMS_CFG.length; t++) {
    const c = drumCells[t]?.[s];
    const cfg = DRUMS_CFG[t];
    const row = drumPat[t];
    if (!c || !cfg) continue;
    c.classList.remove('playing');
    if (row?.[s]) {
      c.style.background = cfg.idle;
      c.style.boxShadow = '';
    } else {
      c.style.background = '';
      c.style.boxShadow = '';
    }
  }

  for (let t = 0; t < MEL_CFG.length; t++) {
    const cfg = MEL_CFG[t];
    if (!cfg) continue;
    for (let n = 0; n < 12; n++) {
      const c = melCells[t]?.[s]?.[n];
      if (!c) continue;
      c.classList.remove('playing');
      const semi = displayToSemitone(n);
      const stepData = melPat[t]?.[s];
      if (stepData?.[semi]) {
        c.style.background = cfg.idle;
        c.style.boxShadow = '';
      } else {
        c.style.background = '';
        c.style.boxShadow = '';
      }
    }
  }

  const vc = vocalCells[s];
  if (vc) {
    vc.classList.remove('playing');
    if (vocalPat[s]) {
      vc.style.background = VOCAL_CFG.idle;
      vc.style.boxShadow = '';
    } else {
      vc.style.background = '';
      vc.style.boxShadow = '';
    }
  }
}

/** Subscribe to engine events. Call once at init. */
export function initPlayhead(): void {
  on('engine:step', ({ step, phrase }) => {
    highlightStep(step, phrase);
  });

  on('engine:stop', () => {
    if (prevVisualStep >= 0) {
      clearHL(prevVisualStep);
      prevVisualStep = -1;
    }
    // Remove play button active state
    const playBtn = document.getElementById('play-btn');
    if (playBtn) playBtn.classList.remove('active');
  });
}
