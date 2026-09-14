/**
 * Entry point — initializes all modules and wires them together.
 */

import { initAudio, loadWorklets } from './engine/audio';
import {
  openDB,
  dbGet,
  saveSong,
  loadSong,
  scheduleSave,
  reportPersistenceError,
} from './transport/persistence';
import { loadManifest, wireBrowserEvents } from './ui/browser';
import { buildUI, refreshUI, refreshSongName, updateSongPane } from './ui/build';
import { setupPainting, setOnSave, setOnSongPaneUpdate } from './ui/painting';
import { initExtensions, toggleExtension } from './engine/extensions/registry';
import {
  togglePlay,
  syncBpm,
  stopPlayback,
  bindTransport,
  setOnPhraseChange,
} from './engine/scheduler';
import { on } from './events';
import { beginHistoryGesture, endHistoryGesture } from './transport/history';
import { initPlayhead } from './ui/playhead';
import { initComposerTools } from './ui/composer-tools';
import { initTheoryControls } from './ui/theory-controls';
import { genId } from './ui/helpers';
import { SEQ_EXTENSIONS, activeExtensionId } from './engine/extensions/store';
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
  theory,
  isPhraseEmpty,
  findNextPhrase,
  findFirstNonEmpty,
} from './transport/patterns';
import { initEngineProcessing, close as closeEnginePanel } from './ui/engine-panel';
import { initMidi, disconnectAllMidi, silenceAllMidi } from './engine/midi';
import { buildMidiBrowserDOM, wireMidiBrowserEvents } from './ui/midi-browser';
import { buildAdsrPopupDOM, updateAdsrBtnState, closeAdsrPopup } from './ui/adsr-popup';
import { initPersistenceStatus, showStartupError } from './ui/persistence-status';
import { TOTAL_TRACKS } from './config';

// Register all extensions
import { createCompressor } from './engine/extensions/compressor';
import { createMixer } from './engine/extensions/mixer';
import { createReverb } from './engine/extensions/reverb';
import { createDelay } from './engine/extensions/delay';
import { createPultecEq } from './engine/extensions/pultec-eq';
import { createTransformer } from './engine/extensions/transformer';

async function init(): Promise<void> {
  initPersistenceStatus();
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

  // 2. The engine owns the only AudioContext; the scheduler uses its clock.
  initAudio();

  // 3. Build the UI
  buildUI();
  initComposerTools();
  initTheoryControls();
  document.getElementById('app')?.setAttribute('inert', '');
  const playButton = document.getElementById('play-btn') as HTMLButtonElement | null;
  if (playButton) playButton.disabled = true;

  // 3b. Build MIDI browser overlay + ADSR popup
  buildMidiBrowserDOM();
  wireMidiBrowserEvents();
  buildAdsrPopupDOM();

  // 4. Wire painting callbacks + BPM sync
  setOnSave(scheduleSave);
  setOnSongPaneUpdate(updateSongPane);
  setOnBpmChange(syncBpm);
  // The scheduler owns which phrase is playing; without this the song pane's
  // `.playing-phrase` marker never lights up at all — start, stop and
  // auto-advance all route through this one callback.
  setOnPhraseChange(updateSongPane);

  on('engine:settingsChanged', scheduleSave);
  on('editor:beforeRestore', () => {
    stopPlayback();
    silenceAllMidi();
    closeAdsrPopup();
    closeEnginePanel();
    if (activeExtensionId) toggleExtension(activeExtensionId);
  });
  on('editor:documentChanged', () => {
    refreshUI();
    refreshSongName();
    updateSongPane();
    for (let i = 0; i < TOTAL_TRACKS; i++) updateAdsrBtnState(i);
  });
  let sliderGesture = false;
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (event.target instanceof Element && event.target.matches('input[type="range"]')) {
        sliderGesture = true;
        beginHistoryGesture('Adjust sound');
      }
    },
    true,
  );
  const finishSlider = () => {
    if (sliderGesture) {
      sliderGesture = false;
      endHistoryGesture();
    }
  };
  document.addEventListener('pointerup', finishSlider);
  document.addEventListener('pointercancel', finishSlider);
  window.addEventListener('blur', finishSlider);
  on('transport:phraseCountChanged', ({ count, previous }) => {
    // A shrink may remove a manually queued empty phrase. Clear that queue atomically.
    if (count < previous) stopPlayback();
    refreshUI();
    updateSongPane();
    scheduleSave();
  });
  on('transport:songLoaded', () => {
    refreshUI();
    refreshSongName();
    updateSongPane();
  });
  on('persistence:beforeLoad', () => {
    stopPlayback();
    disconnectAllMidi();
    closeAdsrPopup();
    closeEnginePanel();
    if (activeExtensionId) toggleExtension(activeExtensionId);
  });

  // 4b. Wire persistence lifecycle events
  on('persistence:songCreated', () => {
    stopPlayback();
    disconnectAllMidi();
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
    refreshUI();
    for (let i = 0; i < TOTAL_TRACKS; i++) updateAdsrBtnState(i);
    refreshSongName();
    updateSongPane();
  });
  on('persistence:fileLoaded', () => {
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
    getTheory: () => theory,
    isPhraseEmpty,
    findNextPhrase,
    findFirstNonEmpty,
  });

  // 8b. Load worklets, init engine processing + extensions + playhead.
  // (The engine AudioContext was created at step 2.)
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
    await loadSong(song, true);
    refreshUI();
    refreshSongName();
    updateSongPane();
  }

  // 10. Space bar for play/stop
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    const target = e.target instanceof Element ? e.target : null;
    if (e.code !== 'Space' || e.repeat || e.defaultPrevented) return;
    if (
      target?.closest(
        'button, input, textarea, select, a, [role="button"], [contenteditable]:not([contenteditable="false"])',
      )
    )
      return;
    if (
      document.querySelector(
        '.browser-overlay.open, .midi-overlay.open, .adsr-popup.open, [role="dialog"][aria-modal="true"]',
      )
    )
      return;
    e.preventDefault();
    togglePlay();
  });

  document.getElementById('app')?.removeAttribute('inert');
  for (let i = 0; i < TOTAL_TRACKS; i++) updateAdsrBtnState(i);
  if (playButton) playButton.disabled = false;
  document.documentElement.dataset.ready = 'true';

  // Save on visibility change (tab close/switch)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      void saveSong().catch(reportPersistenceError);
    }
  });
}

// Boot
void init().catch(showStartupError);
