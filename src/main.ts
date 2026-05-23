/**
 * Entry point — initializes all modules and wires them together.
 */

import * as Tone from 'tone';
import { initAudio, loadWorklets, getAudioContext } from './engine/audio';
import { openDB, dbGet, saveSong, loadSong, scheduleSave } from './transport/persistence';
import { loadManifest, wireBrowserEvents } from './ui/browser';
import { buildUI, refreshUI, refreshSongName, updateSongPane } from './ui/build';
import { setupPainting, setOnSave, setOnSongPaneUpdate } from './ui/painting';
import { initExtensions } from './engine/extensions/registry';
import { togglePlay, syncBpm, stopPlayback, bindTransport } from './engine/scheduler';
import { on } from './events';
import { initPlayhead } from './ui/playhead';
import { genId } from './ui/helpers';
import { SEQ_EXTENSIONS } from './engine/extensions/store';
import {
  currentSongId,
  setCurrentSongId,
  setOnBpmChange,
  bpm,
  drumBuf,
  melBuf,
  vocalBuf,
  mutedArr,
} from './transport/song';
import {
  phrases,
  octaves,
  harmonies,
  isPhraseEmpty,
  findNextPhrase,
  findFirstNonEmpty,
} from './transport/patterns';
import { initEngineProcessing } from './ui/engine-panel';
import { initMidi, disconnectAllMidi } from './engine/midi';
import { buildMidiBrowserDOM, wireMidiBrowserEvents } from './ui/midi-browser';
import { buildAdsrPopupDOM, updateAdsrBtnState } from './ui/adsr-popup';
import { resetAllAdsr } from './engine/adsr';
import { TOTAL_TRACKS } from './config';

// Register all extensions
import { createCompressor } from './engine/extensions/compressor';
import { createMixer } from './engine/extensions/mixer';
import { createReverb } from './engine/extensions/reverb';
import { createDelay } from './engine/extensions/delay';
import { createPultecEq } from './engine/extensions/pultec-eq';
import { createTransformer } from './engine/extensions/transformer';

async function init(): Promise<void> {
  // 1. Register extensions
  // Order: master bus inserts first, then aux effects, then metering
  // Master bus chain: Pultec EQ → Vari-Mu → Transformer (serial inserts)
  // Aux effects: Reverb, Delay (parallel buses, returns to mixBus)
  // Metering: Mixer (channel fader controls + metering)
  SEQ_EXTENSIONS.push(
    createPultecEq(),
    createCompressor(),
    createTransformer(),
    createMixer(),
    createReverb(),
    createDelay(),
  );

  // 3. Build the UI
  buildUI();

  // 3b. Build MIDI browser overlay + ADSR popup
  buildMidiBrowserDOM();
  wireMidiBrowserEvents();
  buildAdsrPopupDOM();

  // 4. Wire painting callbacks + BPM sync
  setOnSave(scheduleSave);
  setOnSongPaneUpdate(updateSongPane);
  setOnBpmChange(syncBpm);

  // 4b. Wire persistence lifecycle events
  on('persistence:songCreated', () => {
    stopPlayback();
    disconnectAllMidi();
    resetAllAdsr();
    refreshUI();
    for (let i = 0; i < TOTAL_TRACKS; i++) updateAdsrBtnState(i);
    refreshSongName();
    updateSongPane();
  });
  on('persistence:songDeleted', () => {
    refreshUI();
    refreshSongName();
    updateSongPane();
  });
  on('persistence:songSwitched', () => {
    stopPlayback();
    disconnectAllMidi();
    resetAllAdsr();
    refreshUI();
    for (let i = 0; i < TOTAL_TRACKS; i++) updateAdsrBtnState(i);
    refreshSongName();
    updateSongPane();
  });
  on('persistence:fileLoaded', () => {
    resetAllAdsr();
    refreshUI();
    for (let i = 0; i < TOTAL_TRACKS; i++) updateAdsrBtnState(i);
    refreshSongName();
    updateSongPane();
  });

  // 5. Setup mouse painting
  setupPainting();

  // 6. Wire browser events
  wireBrowserEvents();

  // 7. Init audio + extensions + load manifest (parallel)
  await Promise.all([openDB(), loadManifest()]);

  // 8. Bind transport data to scheduler (engine↔transport bridge via DI)
  bindTransport({
    phrases,
    octaves,
    harmonies,
    drumBuf,
    melBuf,
    mutedArr,
    getVocalBuf: () => vocalBuf,
    getBpm: () => bpm,
    isPhraseEmpty,
    findNextPhrase,
    findFirstNonEmpty,
  });

  // 8b. Init audio, load worklets, engine processing, extensions, and playhead
  // Engine processing MUST init before extensions so that setFinalOutput()
  // points to the engine chain BEFORE the extension chain is built.
  initAudio();
  // Bind Tone.js to our AudioContext. Without this, Tone spins up its own
  // context and Transport callbacks pass `time` values from a clock that
  // diverges from the one running our sample playback — every src.start(time)
  // ends up scheduled in the past and the grid loses sub-ms precision.
  const ctx = getAudioContext();
  if (ctx) Tone.setContext(ctx);
  await loadWorklets();
  initEngineProcessing();
  initExtensions();
  initPlayhead();

  // 8b. Init MIDI (non-blocking — permission prompt is async)
  void initMidi();

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
