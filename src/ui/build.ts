/**
 * Main UI builder — constructs the transport, track panels, grids,
 * song pane, and wires all interactive controls.
 */

import type { TrackType } from '../types';
import {
  STEPS,
  BARS,
  SPB,
  NUM_PHRASES,
  DRUMS_CFG,
  MEL_CFG,
  VOCAL_CFG,
  NOTES_DISPLAY,
  SHARPS,
  HARMONY_LABELS,
} from '../config';
import {
  drumPat,
  melPat,
  vocalPat,
  currentPhrase,
  octaves,
  harmonies,
  switchToPhrase,
} from '../transport/patterns';
import {
  bpm,
  setBpm,
  drumNames,
  melNames,
  vocalName,
  setVocalName,
  mutedArr,
  drumSampleData,
  melSampleData,
  vocalSampleData,
  currentSongName,
  setCurrentSongName,
} from '../transport/song';
import {
  drumCells,
  melCells,
  setVocalCells,
  playing,
  playingPhrase,
  setCurStep,
  setPlayingPhrase,
} from '../state';
import { el, makeEditable, truncName } from './helpers';
import {
  updateDrumCell,
  updateMelCell,
  updateVocalCell,
  cycleHarmony,
  updateHarmonyDim,
} from './cells';
import { setupPainting, replicateTrack, clearSelection } from './painting';
import { openBrowser, wireBrowserEvents, setupDragDrop, closeBrowser } from './browser';
import { togglePlay, stopPlayback, isPhraseEmpty, fillWithPrev } from '../engine/scheduler';
import {
  scheduleSave,
  saveSong,
  savePatternFile,
  loadPatternFile,
  newSong,
  deleteSong,
} from '../transport/persistence';

// ═══════════════════════════════════════════
//  Track controls
// ═══════════════════════════════════════════

function toggleMute(gi: number, btn: HTMLElement): void {
  mutedArr[gi] = !mutedArr[gi];
  btn.classList.toggle('muted', !!mutedArr[gi]);
  scheduleSave();
}

function changeOctave(ti: number, d: number): void {
  const cur = octaves[ti] ?? 3;
  octaves[ti] = Math.max(1, Math.min(7, cur + d));
  const ov = document.querySelector(`.melody-track[data-track="${ti}"] .oct-val`);
  if (ov) ov.textContent = String(octaves[ti]);
  scheduleSave();
}

function clearTrack(type: TrackType, idx: number): void {
  if (type === 'drum') {
    const row = drumPat[idx];
    if (row) {
      row.fill(false);
      for (let s = 0; s < STEPS; s++) updateDrumCell(idx, s);
    }
  } else if (type === 'melody') {
    const track = melPat[idx];
    if (track) {
      for (let s = 0; s < STEPS; s++) {
        const step = track[s];
        if (step) step.fill(false);
        for (let n = 0; n < 12; n++) updateMelCell(idx, s, n);
      }
    }
  } else {
    vocalPat.fill(false);
    for (let s = 0; s < STEPS; s++) updateVocalCell(s);
  }
  updateSongPane();
  scheduleSave();
}

// ═══════════════════════════════════════════
//  Step grid builder
// ═══════════════════════════════════════════

export function buildStepGrid(
  container: HTMLElement,
  cells: HTMLElement[],
  type: TrackType,
  trackIdx: number,
): void {
  const grid = el('div', 'step-grid');
  for (let bar = 0; bar < BARS; bar++) {
    const bg = el('div', 'bar-group');
    for (let l = 0; l < SPB; l++) {
      const s = bar * SPB + l;
      const cls = 'step-cell' +
        (l % 4 === 0 ? ' beat-hi' : '') +
        (l > 0 && l % 4 === 0 ? ' beat-gap' : '');
      const c = el('div', cls);
      c.dataset['type'] = type;
      c.dataset['track'] = String(trackIdx);
      c.dataset['step'] = String(s);
      cells[s] = c;
      bg.appendChild(c);
    }
    grid.appendChild(bg);
  }
  container.appendChild(grid);
}

// ═══════════════════════════════════════════
//  Extension icons (delegated)
// ═══════════════════════════════════════════

// These are set by the registry module after it initializes
let _buildExtIcons: (() => void) | null = null;
let _updateExtIcons: (() => void) | null = null;

export function setExtIconsBuilder(fn: () => void): void { _buildExtIcons = fn; }
export function setExtIconsUpdater(fn: () => void): void { _updateExtIcons = fn; }

export function buildExtIcons(): void { _buildExtIcons?.(); }
export function updateExtIcons(): void { _updateExtIcons?.(); }

// ═══════════════════════════════════════════
//  Song pane
// ═══════════════════════════════════════════

export function updateSongPane(): void {
  const slots = document.querySelectorAll('.phrase-slot');
  slots.forEach((slot, i) => {
    slot.classList.toggle('active', i === currentPhrase);
    slot.classList.toggle('has-content', !isPhraseEmpty(i));
    slot.classList.toggle('playing-phrase', playing && i === playingPhrase);
  });
}

// ═══════════════════════════════════════════
//  Refresh UI
// ═══════════════════════════════════════════

export function refreshUI(): void {
  // Update all cells
  for (let t = 0; t < DRUMS_CFG.length; t++)
    for (let s = 0; s < STEPS; s++) updateDrumCell(t, s);
  for (let t = 0; t < MEL_CFG.length; t++)
    for (let s = 0; s < STEPS; s++)
      for (let d = 0; d < 12; d++) updateMelCell(t, s, d);
  for (let s = 0; s < STEPS; s++) updateVocalCell(s);

  // Drum tracks
  document.querySelectorAll('.melody-track[data-type="drum"]').forEach((row, ti) => {
    const n = row.querySelector('.track-name');
    if (n) n.textContent = drumNames[ti] ?? '';
    const sb = row.querySelector('.sample-btn') as HTMLElement | null;
    if (sb) {
      const sd = drumSampleData[ti];
      if (sd) {
        sb.textContent = truncName(sd.name);
        sb.classList.add('loaded');
        sb.title = sd.name;
      } else {
        sb.textContent = 'LOAD';
        sb.classList.remove('loaded');
        sb.title = '';
      }
    }
    const mb = row.querySelector('.mute-btn') as HTMLElement | null;
    if (mb) mb.classList.toggle('muted', !!mutedArr[ti]);
  });

  // Melody tracks
  document.querySelectorAll('.melody-track[data-type="melody"]').forEach((panel, ti) => {
    const n = panel.querySelector('.track-name');
    if (n) n.textContent = melNames[ti] ?? '';
    const ov = panel.querySelector('.oct-val');
    if (ov) ov.textContent = String(octaves[ti] ?? 3);
    const sb = panel.querySelector('.sample-btn') as HTMLElement | null;
    if (sb) {
      const sd = melSampleData[ti];
      if (sd) {
        sb.textContent = truncName(sd.name);
        sb.classList.add('loaded');
        sb.title = sd.name;
      } else {
        sb.textContent = 'LOAD';
        sb.classList.remove('loaded');
        sb.title = '';
      }
    }
    const mb = panel.querySelector('.mute-btn') as HTMLElement | null;
    if (mb) mb.classList.toggle('muted', !!mutedArr[DRUMS_CFG.length + ti]);
    const ht = panel.querySelector('.harmony-toggle') as HTMLElement | null;
    if (ht) {
      const label = HARMONY_LABELS[harmonies[ti] ?? 0] ?? '\u2014';
      ht.textContent = 'HARM: ' + label;
      ht.classList.toggle('active', (harmonies[ti] ?? 0) > 0);
      updateHarmonyDim(ti);
    }
  });

  // Vocal track
  const vrow = document.querySelector('.melody-track[data-type="vocal"]') as HTMLElement | null;
  if (vrow) {
    const n = vrow.querySelector('.track-name');
    if (n) n.textContent = vocalName;
    const sb = vrow.querySelector('.sample-btn') as HTMLElement | null;
    if (sb) {
      if (vocalSampleData) {
        sb.textContent = truncName(vocalSampleData.name);
        sb.classList.add('loaded');
        sb.title = vocalSampleData.name;
      } else {
        sb.textContent = 'LOAD';
        sb.classList.remove('loaded');
        sb.title = '';
      }
    }
    const mb = vrow.querySelector('.mute-btn') as HTMLElement | null;
    if (mb) mb.classList.toggle('muted', !!mutedArr[DRUMS_CFG.length + MEL_CFG.length]);
  }

  // BPM
  const br = document.getElementById('bpm-range') as HTMLInputElement | null;
  const bn = document.getElementById('bpm-num') as HTMLInputElement | null;
  if (br) br.value = String(bpm);
  if (bn) bn.value = String(bpm);
}

// ═══════════════════════════════════════════
//  Song name refresh
// ═══════════════════════════════════════════

export function refreshSongName(): void {
  const nameEl = document.getElementById('song-name');
  if (nameEl) {
    nameEl.textContent = currentSongName;
    nameEl.title = currentSongName + ' (double-click to rename)';
  }
}

// ═══════════════════════════════════════════
//  Song name inline editing
// ═══════════════════════════════════════════

function setupSongNameEdit(elem: HTMLElement): void {
  elem.addEventListener('dblclick', () => {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'song-name-input';
    input.value = currentSongName;
    elem.replaceWith(input);
    input.focus();
    input.select();

    const commit = (): void => {
      setCurrentSongName(input.value.trim() || 'Untitled');
      const newEl = document.createElement('div');
      newEl.id = 'song-name';
      newEl.className = 'song-name';
      newEl.textContent = currentSongName;
      newEl.title = currentSongName + ' (double-click to rename)';
      input.replaceWith(newEl);
      setupSongNameEdit(newEl);
      void saveSong();
    };

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (ev: KeyboardEvent) => {
      if (ev.key === 'Enter') input.blur();
      if (ev.key === 'Escape') {
        input.value = currentSongName;
        input.blur();
      }
    });
  });
}

// ═══════════════════════════════════════════
//  BUILD UI (main entry point)
// ═══════════════════════════════════════════

export function buildUI(): void {
  const app = document.getElementById('app');
  if (!app) return;

  // ── Transport ──
  const transport = el('div', 'transport');
  transport.innerHTML = `
    <div class="transport-btns"><button class="tb" id="play-btn" title="Play (Space)"><svg width="8" height="10" viewBox="0 0 14 16" fill="none"><path d="M1 1.5L13 8L1 14.5V1.5Z" fill="currentColor"/></svg></button><button class="tb" id="stop-btn" title="Stop"><svg width="7" height="7" viewBox="0 0 12 12" fill="none"><rect width="12" height="12" rx="1.5" fill="currentColor"/></svg></button></div>
    <div class="song-ctrl"><div id="song-name" class="song-name" title="Double-click to rename">Untitled</div><div class="song-btns"><button class="tb" id="song-new" title="New Song"><svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button><button class="tb" id="song-del" title="Delete Song"><svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M3 4.5h10M5.5 4.5V3a1 1 0 011-1h3a1 1 0 011 1v1.5M4.5 4.5l.7 8.5a1 1 0 001 .9h3.6a1 1 0 001-.9l.7-8.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div></div>
    <div class="file-btns"><button class="tb" id="save-btn" title="Export Pattern"><svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M8 2v8M5 7l3 3 3-3M3 12h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button><button class="tb" id="load-btn" title="Import Pattern"><svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M8 10V2M5 5l3-3 3 3M3 12h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>
    <div class="bpm-ctrl"><label>BPM</label><input type="range" id="bpm-range" min="40" max="220" value="${bpm}"><input type="number" id="bpm-num" min="40" max="220" value="${bpm}"></div>
    <div class="ext-icons" id="ext-icons"></div>`;
  app.appendChild(transport);

  // ── Drums ──
  const drumsSec = el('div', 'section');
  DRUMS_CFG.forEach((cfg, ti) => {
    const panel = el('div', 'melody-track');
    panel.dataset['track'] = String(ti);
    panel.dataset['type'] = 'drum';
    const header = el('div', 'melody-track-header');
    const cb = el('div', 'track-color');
    cb.style.background = cfg.color;
    header.appendChild(cb);
    const nm = el('div', 'track-name');
    nm.textContent = drumNames[ti] ?? '';
    nm.title = drumNames[ti] ?? '';
    header.appendChild(nm);
    makeEditable(nm, () => drumNames[ti] ?? '', v => { drumNames[ti] = v; }, () => scheduleSave());
    const sb = el('button', 'sample-btn');
    sb.textContent = 'LOAD';
    sb.onclick = () => openBrowser('drum', ti);
    header.appendChild(sb);
    const fill = el('button', 'fill-btn');
    fill.textContent = 'FILL';
    fill.onclick = () => replicateTrack('drum', ti);
    header.appendChild(fill);
    const clr = el('button', 'clear-btn');
    clr.textContent = 'CLR';
    clr.onclick = () => clearTrack('drum', ti);
    header.appendChild(clr);
    const mb = el('button', 'mute-btn');
    mb.textContent = 'M';
    mb.onclick = () => toggleMute(ti, mb);
    header.appendChild(mb);
    panel.appendChild(header);
    const gw = el('div', 'single-grid-wrapper');
    drumCells[ti] = [];
    buildStepGrid(gw, drumCells[ti]!, 'drum', ti);
    panel.appendChild(gw);
    setupDragDrop(panel, 'drum', ti);
    drumsSec.appendChild(panel);
  });
  app.appendChild(drumsSec);

  // ── Melody ──
  const melSec = el('div', 'section');
  MEL_CFG.forEach((cfg, ti) => {
    const panel = el('div', 'melody-track');
    panel.dataset['track'] = String(ti);
    panel.dataset['type'] = 'melody';
    const header = el('div', 'melody-track-header');
    const cb = el('div', 'track-color');
    cb.style.background = cfg.color;
    header.appendChild(cb);
    const nm = el('div', 'track-name');
    nm.textContent = melNames[ti] ?? '';
    nm.title = melNames[ti] ?? '';
    header.appendChild(nm);
    makeEditable(nm, () => melNames[ti] ?? '', v => { melNames[ti] = v; }, () => scheduleSave());
    if (!cfg.mono) {
      const ht = el('button', 'harmony-toggle');
      const harmLabel = HARMONY_LABELS[harmonies[ti] ?? 0] ?? '\u2014';
      ht.textContent = 'HARM: ' + harmLabel;
      ht.classList.toggle('active', (harmonies[ti] ?? 0) > 0);
      ht.onclick = () => { cycleHarmony(ti); scheduleSave(); };
      header.appendChild(ht);
    }
    const sb = el('button', 'sample-btn');
    sb.textContent = 'LOAD';
    sb.onclick = () => openBrowser('melody', ti);
    header.appendChild(sb);
    const fill = el('button', 'fill-btn');
    fill.textContent = 'FILL';
    fill.onclick = () => replicateTrack('melody', ti);
    header.appendChild(fill);
    const clr = el('button', 'clear-btn');
    clr.textContent = 'CLR';
    clr.onclick = () => clearTrack('melody', ti);
    header.appendChild(clr);
    const mb = el('button', 'mute-btn');
    mb.textContent = 'M';
    mb.onclick = () => toggleMute(DRUMS_CFG.length + ti, mb);
    header.appendChild(mb);
    const oc = el('div', 'octave-ctrl');
    const ol = el('label', '');
    ol.textContent = 'OCT';
    oc.appendChild(ol);
    const od = el('button', '');
    od.textContent = '\u2212';
    od.onclick = () => changeOctave(ti, -1);
    oc.appendChild(od);
    const ov = el('span', 'oct-val');
    ov.textContent = String(octaves[ti] ?? 3);
    oc.appendChild(ov);
    const ou = el('button', '');
    ou.textContent = '+';
    ou.onclick = () => changeOctave(ti, 1);
    oc.appendChild(ou);
    header.appendChild(oc);
    panel.appendChild(header);

    // Melody grid with note labels
    const wrapper = el('div', 'melody-grid-wrapper');
    const labels = el('div', 'note-labels');
    NOTES_DISPLAY.forEach((note, di) => {
      const l = el('div', 'note-label' + (SHARPS.has(di) ? ' sharp' : ''));
      l.textContent = note;
      labels.appendChild(l);
    });
    wrapper.appendChild(labels);

    const grid = el('div', 'melody-grid');
    melCells[ti] = [];
    for (let s = 0; s < STEPS; s++) melCells[ti]![s] = [];
    NOTES_DISPLAY.forEach((_note, di) => {
      const row = el('div', 'melody-row');
      const isSharp = SHARPS.has(di);
      for (let bar = 0; bar < BARS; bar++) {
        const bg = el('div', 'bar-group');
        for (let l = 0; l < SPB; l++) {
          const s = bar * SPB + l;
          const cls = 'melody-cell' +
            (isSharp ? ' black-key' : ' white-key') +
            (l % 4 === 0 ? ' beat-hi' : '') +
            (l > 0 && l % 4 === 0 ? ' beat-gap' : '');
          const c = el('div', cls);
          c.dataset['type'] = 'melody';
          c.dataset['track'] = String(ti);
          c.dataset['step'] = String(s);
          c.dataset['note'] = String(di);
          melCells[ti]![s]![di] = c;
          bg.appendChild(c);
        }
        row.appendChild(bg);
      }
      grid.appendChild(row);
    });
    wrapper.appendChild(grid);
    panel.appendChild(wrapper);
    setupDragDrop(panel, 'melody', ti);
    melSec.appendChild(panel);
  });
  app.appendChild(melSec);

  // ── Vocal / Sample track ──
  const vocSec = el('div', 'section');
  const vpanel = el('div', 'melody-track');
  vpanel.dataset['type'] = 'vocal';
  const vheader = el('div', 'melody-track-header');
  const vcb = el('div', 'track-color');
  vcb.style.background = VOCAL_CFG.color;
  vheader.appendChild(vcb);
  const vnm = el('div', 'track-name');
  vnm.textContent = vocalName;
  vnm.title = vocalName;
  vheader.appendChild(vnm);
  makeEditable(vnm, () => vocalName, v => { setVocalName(v); }, () => scheduleSave());
  const vsb = el('button', 'sample-btn');
  vsb.textContent = 'LOAD';
  vsb.onclick = () => openBrowser('vocal', 0);
  vheader.appendChild(vsb);
  const vfill = el('button', 'fill-btn');
  vfill.textContent = 'FILL';
  vfill.onclick = () => replicateTrack('vocal', 0);
  vheader.appendChild(vfill);
  const vclr = el('button', 'clear-btn');
  vclr.textContent = 'CLR';
  vclr.onclick = () => clearTrack('vocal', 0);
  vheader.appendChild(vclr);
  const vmb = el('button', 'mute-btn');
  vmb.textContent = 'M';
  vmb.onclick = () => toggleMute(DRUMS_CFG.length + MEL_CFG.length, vmb);
  vheader.appendChild(vmb);
  vpanel.appendChild(vheader);
  const vgw = el('div', 'single-grid-wrapper');
  const newVocalCells: HTMLElement[] = [];
  buildStepGrid(vgw, newVocalCells, 'vocal', 0);
  setVocalCells(newVocalCells);
  vpanel.appendChild(vgw);
  setupDragDrop(vpanel, 'vocal', 0);
  vocSec.appendChild(vpanel);
  app.appendChild(vocSec);

  // ── Wire transport buttons ──
  const playBtn = document.getElementById('play-btn');
  if (playBtn) playBtn.onclick = togglePlay;
  const stopBtn = document.getElementById('stop-btn');
  if (stopBtn) stopBtn.onclick = stopPlayback;
  const saveBtn = document.getElementById('save-btn');
  if (saveBtn) saveBtn.onclick = savePatternFile;
  const loadBtn = document.getElementById('load-btn');
  if (loadBtn) loadBtn.onclick = loadPatternFile;
  const songNewBtn = document.getElementById('song-new');
  if (songNewBtn) songNewBtn.onclick = () => { void newSong(); };
  const songDelBtn = document.getElementById('song-del');
  if (songDelBtn) songDelBtn.onclick = () => { void deleteSong(); };

  // Song name inline editing
  const songNameEl = document.getElementById('song-name');
  if (songNameEl) setupSongNameEdit(songNameEl);

  // BPM controls
  const bpmRange = document.getElementById('bpm-range') as HTMLInputElement | null;
  const bpmNum = document.getElementById('bpm-num') as HTMLInputElement | null;
  if (bpmRange) {
    bpmRange.oninput = () => {
      setBpm(Number(bpmRange.value));
      if (bpmNum) bpmNum.value = String(bpm);
      scheduleSave();
    };
  }
  if (bpmNum) {
    bpmNum.onchange = () => {
      setBpm(Math.max(40, Math.min(220, Number(bpmNum.value))));
      if (bpmRange) bpmRange.value = String(bpm);
      bpmNum.value = String(bpm);
      scheduleSave();
    };
  }

  // Keyboard shortcuts
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (e.code === 'Space' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) {
      e.preventDefault();
      togglePlay();
    }
    if (e.code === 'Escape') {
      const browserOverlay = document.getElementById('browser-overlay');
      if (browserOverlay?.classList.contains('open')) {
        closeBrowser();
      } else {
        clearSelection();
      }
    }
  });

  // Browser modal events
  wireBrowserEvents();

  // ── Song Pane (phrases) ──
  const songPane = el('div', '');
  songPane.id = 'song-pane';
  for (let i = 0; i < NUM_PHRASES; i++) {
    const slot = el('div', 'phrase-slot' + (i === 0 ? ' active' : ''));
    slot.dataset['phrase'] = String(i);
    const num = el('span', 'phrase-num');
    num.textContent = String(i + 1);
    const dot = el('span', 'phrase-dot');
    slot.appendChild(num);
    slot.appendChild(dot);
    slot.addEventListener('click', (e: MouseEvent) => {
      if ((e.target as HTMLElement).classList.contains('phrase-fill-btn')) return;
      switchToPhrase(i);
      refreshUI();
      updateSongPane();
    });
    slot.addEventListener('dblclick', (e: MouseEvent) => {
      if ((e.target as HTMLElement).classList.contains('phrase-fill-btn')) return;
      if (playing) {
        setPlayingPhrase(i);
        setCurStep(0);
        updateSongPane();
      }
    });
    if (i > 0) {
      const fb = el('button', 'phrase-fill-btn');
      fb.textContent = '\u2190';
      fb.title = 'Fill with previous phrase';
      fb.addEventListener('click', (e: MouseEvent) => {
        e.stopPropagation();
        fillWithPrev(i);
        refreshUI();
        updateSongPane();
      });
      slot.appendChild(fb);
    }
    songPane.appendChild(slot);
  }
  document.body.appendChild(songPane);

  // Set up painting interaction
  setupPainting();
}
