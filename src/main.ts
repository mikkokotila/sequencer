/**
 * Entry point — initializes all modules and wires them together.
 */

import { initAudio } from './audio';
import { openDB, dbGet, saveSong, loadSong, scheduleSave } from './persistence';
import { loadManifest, wireBrowserEvents } from './ui/browser';
import { buildUI, refreshUI, refreshSongName, updateSongPane } from './ui/build';
import { setupPainting, setOnSave, setOnSongPaneUpdate } from './ui/painting';
import { installSeqAPI, initExtensions } from './extensions/registry';
import { togglePlay } from './scheduler';
import { genId } from './ui/helpers';
import * as state from './state';

// Register all extensions
import { createVariMu } from './extensions/vari-mu';
import { createMixer } from './extensions/mixer';
import { createReverb } from './extensions/reverb';
import { createDelay } from './extensions/delay';
import { createPultecEq } from './extensions/pultec-eq';

async function init(): Promise<void> {
  // 1. Install SEQ API (makes window.SEQ available for extensions)
  installSeqAPI();

  // 2. Register extensions
  state.SEQ_EXTENSIONS.push(
    createVariMu(),
    createMixer(),
    createReverb(),
    createDelay(),
    createPultecEq(),
  );

  // 3. Build the UI
  buildUI();

  // 4. Wire painting callbacks
  setOnSave(scheduleSave);
  setOnSongPaneUpdate(updateSongPane);

  // 5. Setup mouse painting
  setupPainting();

  // 6. Wire browser events
  wireBrowserEvents();

  // 7. Init audio + extensions + load manifest (parallel)
  await Promise.all([openDB(), loadManifest()]);

  // 8. Init audio and extensions
  initAudio();
  initExtensions();

  // 9. Load last song or create default
  const lastId = await dbGet('meta', 'currentSongId') as string | undefined;
  let song = lastId ? await dbGet('songs', lastId) : null;

  if (!song) {
    state.setCurrentSongId(genId());
    await saveSong();
    if (state.currentSongId) {
      song = await dbGet('songs', state.currentSongId);
    }
  }

  if (song) {
    await loadSong(song);
    refreshUI();
    refreshSongName();
    updateSongPane();
  }

  // 10. Space bar for play/stop
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (e.code === 'Space' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) {
      e.preventDefault();
      togglePlay();
    }
  });

  // Save on visibility change (tab close/switch)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      void saveSong();
    }
  });
}

// Boot
void init();
