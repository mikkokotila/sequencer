/**
 * Entry point — initializes all modules and wires them together.
 */

import { initAudio, loadWorklets } from './engine/audio';
import { openDB, dbGet, saveSong, loadSong, scheduleSave } from './transport/persistence';
import { loadManifest, wireBrowserEvents } from './ui/browser';
import { buildUI, refreshUI, refreshSongName, updateSongPane } from './ui/build';
import { setupPainting, setOnSave, setOnSongPaneUpdate } from './ui/painting';
import { installSeqAPI, initExtensions } from './engine/extensions/registry';
import { togglePlay, syncBpm } from './engine/scheduler';
import { initPlayhead } from './ui/playhead';
import { genId } from './ui/helpers';
import { SEQ_EXTENSIONS } from './state';
import { currentSongId, setCurrentSongId, setOnBpmChange } from './transport/song';
import { initEngineProcessing } from './ui/engine-panel';

// Register all extensions
import { createVariMu } from './engine/extensions/vari-mu';
import { createMixer } from './engine/extensions/mixer';
import { createReverb } from './engine/extensions/reverb';
import { createDelay } from './engine/extensions/delay';
import { createPultecEq } from './engine/extensions/pultec-eq';

async function init(): Promise<void> {
  // 1. Install SEQ API (makes window.SEQ available for extensions)
  installSeqAPI();

  // 2. Register extensions
  // Order: master bus inserts first, then aux effects, then metering
  // Master bus chain: Pultec EQ → Vari-Mu (serial inserts on master)
  // Aux effects: Reverb, Delay (parallel buses, returns to mixBus)
  // Metering: Mixer (channel fader controls + metering)
  SEQ_EXTENSIONS.push(
    createPultecEq(),
    createVariMu(),
    createMixer(),
    createReverb(),
    createDelay(),
  );

  // 3. Build the UI
  buildUI();

  // 4. Wire painting callbacks + BPM sync
  setOnSave(scheduleSave);
  setOnSongPaneUpdate(updateSongPane);
  setOnBpmChange(syncBpm);

  // 5. Setup mouse painting
  setupPainting();

  // 6. Wire browser events
  wireBrowserEvents();

  // 7. Init audio + extensions + load manifest (parallel)
  await Promise.all([openDB(), loadManifest()]);

  // 8. Init audio, load worklets, extensions, engine processing, and playhead
  initAudio();
  await loadWorklets();
  initExtensions();
  initEngineProcessing(); // visualization analysers only
  initPlayhead();

  // 9. Load last song or create default
  const lastId = await dbGet<string>('meta', 'currentSongId');
  let song = lastId ? await dbGet('songs', lastId) : null;

  if (!song) {
    setCurrentSongId(genId());
    await saveSong();
    if (currentSongId) {
      song = await dbGet('songs', currentSongId);
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
