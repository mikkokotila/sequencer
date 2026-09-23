# Sequencer

Browser-based step sequencer with sample playback, melodic pitch control, per-track ADSR envelopes, MIDI input, 12–48 phrase song structure (36 by default), and a professional audio engine featuring three-model compression (FET/Opto/VCA), Freeverb, interpolated delay, and Pultec EQ — all running on AudioWorklet processors with 4x oversampled nonlinear stages.

## Run locally

```
npm install
npm run dev
```

Opens at [http://localhost:5173](http://localhost:5173). Vite provides hot module replacement — changes take effect immediately without restart.

Keep local sample files in the package root under these lowercase folders:

```text
samples/
  drums/     # drum library, including its category subfolders
  synths/    # synth library, including its instrument/preset subfolders
```

The entire `samples/` directory is ignored by Git. `samples.json` is the tracked browser index; its paths match the supplied Essential WAV From Mars library, preserving the original folders inside `drums/` and `synths/`. Synth entries point to the original C1 WAVs inside each preset folder. When changing the library contents, update the matching index paths.

Both `npm run dev` and `npm run preview` serve `/samples/drums/...` and `/samples/synths/...` from this directory. The package no longer uses the old `DRUMS`/`SYNTHS` links or `SEQUENCER_SAMPLE_ROOT`. Static production hosting must serve the same `/samples/` paths separately; audio files are not bundled. Sample loading failures remain visible in the browser and permit retry.

Use **Download Song Audio** in the toolbar to save the full song as stereo **WAV (24-bit, 44.1 kHz)** or **MP3 (320 kbps)**. The export plays every non-empty phrase once in numeric order, matching transport order, and includes samples, mutes, levels, pan, octaves, harmonies, envelopes, all enabled effects, and engine controls. Sample and effect tails are retained; only inaudible padding is trimmed. MP3 can include the small encoder delay/padding inherent in its frames. Exports capture the current song when started, so subsequent edits cannot alter the file. Rendering and encoding stay local, with progress, cancellation, and retry on failure. The export limit is ten minutes including tails.

**Export locations:** when running locally with `npm run dev` or `npm run preview`, **Export Pattern** writes song JSONs to `~/Documents/songs`; WAV, MP3, sample-kit ZIP, loop ZIP and S2400 ZIP exports go to `~/Documents`. These files are written only when you export; normal editing still autosaves to browser storage. Existing files are preserved with numbered filenames on repeated export. Permission or disk errors remain visible and can be retried. Static hosting falls back to the browser's configured download folder. Programmatic exports use the same destinations; `savePatternFile()` and `downloadSongAudio()` are asynchronous and return the actual saved filename and path. `SEQUENCER_DOCUMENTS_DIR` overrides the Documents directory; `SEQUENCER_DOWNLOAD_MODE=browser` explicitly uses browser downloads (also used by tests).

Programmatic callers use the same API as the GUI:

```ts
import { exportSongAudio, downloadSongAudio } from './src/transport/song-audio';

const abortController = new AbortController();
const result = await exportSongAudio('mp3', {
  signal: abortController.signal, // optional
  onProgress: ({ stage, fraction }) => console.log(stage, fraction), // optional
});
// result contains a Blob, filename, and rendered duration in seconds.
await downloadSongAudio(result); // optional: save the file using the GUI's destination
```

MP3 encoding uses [@breezystack/lamejs](https://github.com/gideonstele/lamejs), licensed under LGPL-3.0. The existing ZIP export remains available for individual dry phrase loops.

Playback uses a 350 ms scheduling queue. Edits affect the next unqueued step; already queued notes keep their timing. The playhead follows estimated device output. After a blocked browser frame it jumps directly to the current audible step. Stalls longer than the queue can interrupt playback; missed scheduling deadlines are reanchored without an overdue burst.

## Quality gates

```
npm run ci          # typecheck + lint + format + circular deps
npm run e2e         # browser regression and audio synchronization stress tests
```

Manual audio tests (open in browser):
- `tests/audio-quality.html` — signal path quality (25 assertions)
- `tests/signal-purity.html` — sample-in vs sample-out comparison
- `tests/e2e-signal.html` — real engine chain verification
- `tests/benchmark.html` — DSP stress test with p99 measurement

## Signal flow

```
Per channel:
  samples → trackGain → channelFader → channelPan → mixBus
                                            ↓
                          post-fader post-pan aux sends → Reverb / Delay

FX buses:
  Reverb bus → Freeverb → reverb return → mixBus
  Delay bus  → Delay    → delay return  → mixBus

Master chain:
  mixBus → masterTrim → Pultec EQ → Vari-Mu Compressor → Transformer → output
```

## Project structure

```
src/
├── engine/                    Audio engine (no DOM)
│   ├── adsr.ts                   Per-track ADSR envelope state + automation
│   ├── audio.ts                  AudioContext, channel strip, mix bus
│   ├── midi.ts                   MIDI input management + live play
│   ├── scheduler.ts              Native AudioContext scheduling + output clock
│   ├── worklet-loader.ts         AudioWorklet module loading
│   ├── worklets/                 DSP processors (AudioWorklet)
│   │   ├── compressor-processor.ts   Three-model compressor (FET/Opto/VCA)
│   │   ├── saturation-processor.ts   4x oversampled waveshaper
│   │   ├── freeverb-processor.ts     Schroeder-Moorer reverb
│   │   ├── delay-processor.ts        Hermite-interpolated delay line
│   │   └── transformer-processor.ts  Analog core saturation
│   └── extensions/               Plug-and-play audio processors
│       ├── registry.ts               Extension chain + SEQ API
│       ├── vari-mu.ts                Bus compressor (FET/Opto/VCA models)
│       ├── mixer.ts                  Channel levels + metering
│       ├── reverb.ts                 Freeverb aux send/return
│       ├── delay.ts                  Tape delay aux send/return
│       └── pultec-eq.ts              Passive EQ + tube saturation
│
├── transport/                 State & persistence (no DOM)
│   ├── patterns.ts               Phrase/pattern state + mutations
│   ├── song.ts                   Song metadata, BPM, track config
│   └── persistence.ts            IndexedDB save/load
│
├── ui/                        User interface
│   ├── build.ts                  DOM construction + event wiring
│   ├── cells.ts                  Grid cell rendering
│   ├── painting.ts               Mouse interaction (click/drag paint)
│   ├── browser.ts                Sample browser modal
│   ├── adsr-popup.ts             ADSR envelope popup with visualization
│   ├── midi-browser.ts           MIDI device browser modal
│   ├── engine-panel.ts           Engine visualization (spectrum + oscilloscope)
│   ├── playhead.ts               Playhead animation
│   └── helpers.ts                DOM utilities
│
├── config.ts                  Constants
├── types.ts                   TypeScript interfaces
├── state.ts                   Shared runtime state
├── events.ts                  Typed event bus
└── main.ts                    Entry point

docs/contracts/                Design contracts
  commit.md                      Conventional commits + verification
  quality-gates.md               CI + audio + benchmark gates
  use-of-color.md                Three-family color system
  adaptive-transfer.md           Nonlinear processor requirements
  e2e.md                         End-to-end test coverage mandate

tests/                         Audio quality test suites
e2e/                           Playwright E2E tests

samples/drums/                 Local drum sample library (gitignored)
samples/synths/                Local synth sample library (gitignored)
samples.json                   Sample browser manifest
```

## Tech stack

- **TypeScript** — strict mode with `noUncheckedIndexedAccess`
- **Vite** — dev server + build
- **Web Audio** — one AudioContext, buffered scheduling and device output timestamps
- **AudioWorklet** — all custom DSP on the audio thread
- **ESLint** — typescript-eslint strict-type-checked
- **Prettier** — formatting
- **Playwright** — E2E testing
- **Husky + lint-staged** — pre-commit hooks

### Sample kits

**Export Sample Kit** in the toolbar saves `{songName}-bundle.zip` to `~/Documents` when running locally. It contains the original sample bytes from every loaded drum, synth and vocal track, including muted tracks and samples unused by the current patterns. No sequencing, pitch, envelopes or effects are rendered. Samples keep their names inside the bundle folder; unsafe characters are removed and duplicate names receive numbered suffixes (also accounting for case-insensitive extraction). Empty kits show an error without writing a file. Save failures remain visible on the button and allow retry; repeated exports preserve existing ZIPs. Static hosting uses the browser download folder.

Programmatic use: `await exportKit()` from `src/transport/kit-export.ts` returns `{ filename, path? }` through the same save API. The export snapshots sample names and bytes before saving.

### S2400 drum projects (experimental)

Use **Download song → Export S2400 drums** for a native project ZIP with drum patterns and samples on A1–A5. Synths, effects and Song-mode chains are excluded. Generated projects still require S2400 hardware playback verification. [Scope, SD-card instructions and public API](docs/s2400-export.md).

### Song length

Choose 12, 24, 36, or 48 phrases in the song pane, with 12 slots per row. New songs default to 36; older songs gain 36 available slots without changing their notes or tempo. The selection is saved with each song and travels with JSON exports. Reducing the count requires all removed phrases to be empty and stops playback. Each phrase is four bars; at 130 BPM, 36 filled phrases last about 4:26 and 48 last about 5:54. Empty phrases remain skipped during playback and audio export.

Programmatic callers use `setPhraseCount(count)` from `src/transport/patterns.ts`, the same operation as the GUI. Song JSON accepts `phraseCount` with the same four choices; more phrase data than the declared count is rejected. WAV/MP3 exports retain the existing 10-minute limit including effect tails.

### Sequenced note length

Each track's ADSR popup includes **Note length** in sixteenth-note steps (1–64; default 1). It controls the envelope duration of sequenced notes; MIDI still uses note-off, and samples play naturally when ADSR is off. The same value is available through `setTrackAdsr(track, { gateSteps: 2 })` and is saved in `sound.adsr[].gateSteps`. Older songs default to one step. Live playback, phrase WAVs and full-song WAV/MP3 exports use this value. S2400 drum export remains dry and omits envelopes.

To correct a half-tempo arrangement without changing its sound, double BPM, place each note at twice its original global step index (splitting phrases as needed), and double each enabled envelope's `gateSteps`. Sample audio, ADSR times, pitch and time-based effects stay unchanged.

### Build a song from reusable phrases

The existing phrase pane now has **Undo**, **Redo**, **Edit**, **Sections**, and **Vary**. Shift-click two phrase slots to select a range, or choose the first/last phrase inside a dialog. The pane shows the playable bars and duration at the actual BPM.

- **Edit:** select phrases, bars, and tracks; copy/cut/paste, clear, repeat the selected bars through each phrase's ending, nudge by one sixteenth note, or transpose synth notes by a semitone. Paste uses the copied track positions and replaces only its destination bars. Nudge wraps inside the selection; transpose crosses octave boundaries and rejects pitches beyond MIDI 0–127 atomically.
- **Sections:** name phrase groups (Intro, Main, Break, etc.), select them from the section strip, duplicate or reorder them, and resize them. Extending repeats the section's material; shortening trims its ending. Structural edits move the notes with the labels and cannot discard material beyond the 48-phrase limit. Section times follow playback, which skips empty phrases.
- **Vary → Rhythm variations:** select the tracks and bars to develop. Protect any tracks that must remain unchanged (kick and main lead are protected by default). **Sparse** keeps alternating events, **Driving** adds pulses two steps after existing events where free, **Syncopated** moves on-beat events to free offbeats, and **Answer** echoes the first half two steps late in the second half. These are deterministic transformations using existing pitches and samples.
- Hear the original or variation for any selected phrase through the current mix and effects. Audition never writes notes or autosaves its candidate. **Apply variation** commits one undoable edit; **Discard variation**, closing the dialog, or Escape cancels it. A changed song invalidates a stale preview.
- Undo/redo covers painting strokes, bulk edits, section metadata, tempo, names, samples, envelopes, and sound controls. A pointer drag is one edit. Use the buttons or Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z (Ctrl+Y also works); focused text fields retain native text undo. Restoring an edit stops playback and cancels pending sample loads. History lasts for this loaded session, keeps at most 50 edits, and limits additional retained sample audio to 128 MiB. Loading/importing another song, reloading, or saving a recovery copy resets history. Sections and protection settings persist in saved songs and portable JSON.

The GUI uses the same operations available programmatically:

```ts
import {
  previewVariation, applyVariation, copyRegion, pasteRegion,
  nameSection, duplicateSection, moveSection, resizeSection,
} from './src/transport/composer';
import { undo, redo, editDocument } from './src/transport/history';
import { renderSongToBuffer } from './src/transport/render-song';

// Zero-based indices: develop hats and bass in the first two four-bar phrases.
const region = { from: 0, to: 1, startStep: 0, endStep: 63, tracks: [2, 3, 5] };
const candidate = previewVariation(region, 'driving');
const audition = await renderSongToBuffer({ phraseOverride: candidate.result });
// Play audition.buffer, then choose whether to apply:
applyVariation(candidate);
undo();
redo();

const clip = copyRegion(region);
pasteRegion(clip, 4); // Paste into phrases 5–6, on the copied tracks.
const intro = nameSection(0, 2, 'Intro');
const copy = duplicateSection(intro.id);
resizeSection(copy.id, 4);
moveSection(copy.id, 0);

// Group existing synchronous API mutations into one undoable, autosaved edit.
editDocument('My combined edit', () => { /* perform synchronous edits here */ });
```

Track indices are 0–4 drums, 5 mono bass, 6–7 poly synths, and 8 the sample track. Bulk operations validate their complete selection before committing. Variation Apply checks the source document and recomputes the transformation so protected tracks cannot be changed through a modified preview object. The song renderer's optional `phraseOverride` accepts 1–48 phrases, preserves their empty positions for audition, and snapshots their notes/settings before asynchronous work begins.


### Song key, Scale Lock and synth composition

Set **Song root** and **Song mode** in the transport. All three synths share this harmony. Modes include major, natural minor, Dorian, Phrygian, Lydian, Mixolydian, Locrian, harmonic minor, and ascending melodic minor. **Harmony** sets a repeating progression of 1–16 scale degrees (one chord per bar); use a preset, enter degrees, or try **New progression** for mode-specific suggestions. Existing songs default to C major with Scale Lock off, retaining their original notes.

**Vary → Compose synths** generates parts from empty or existing phrases. Select synth tracks and bars, choose each voice's role (**Bass**, **Melody**, **Chords**, **Arpeggio**), then choose **Sparse**, **Driving**, **Syncopated**, or **Answer**. The mono synth supports every role except chords. **New idea** changes the reproducible idea number. Triads or seventh chords share the same song progression; bass anchors, melodic motifs, passing tones, common tones and close chord inversions coordinate the voices. Ideas repeat with restrained phrase-end changes. The current samples, octave controls and track envelopes determine the sound and note length.

Audition the original and candidate before applying. Protected/unselected tracks and notes outside the selected bars remain unchanged. Generated steps play their written voicings without an extra HARM voice. Track HARM settings and the sound of unselected steps stay unchanged. This step-local setting follows copied/moved notes, audition, undo and saved songs; it clears when the step is emptied. The HARM control remains the default for manual single-note steps. Changing song state invalidates the preview. Generation is deterministic, runs locally, and uses the same editing/rendering API as the GUI.

**Scale Lock** snaps new or moved pitches to the nearest note in the chosen scale; equal distances always choose the lower pitch. It covers painting, MIDI input, paste, transpose and variation edits. Enabling it or changing key leaves existing notes intact. **Fit existing song notes to scale** converts all synth notes in one undoable edit. Derived HARM voices follow the scale while locked. Scale membership prevents outside notes; rhythm, voicing and sound choice still shape the musical result.

Each synth keeps twelve visible rows. The pitch-view arrows browse adjacent octaves without transposing; arrow counts flag notes outside the view, and reset returns to the base octave. A snap across C/B reveals the actual adjacent note instead of wrapping it to the opposite end of the octave. Editing, playback, phrase WAVs, full-song WAV/MP3, save/load and JSON preserve these pitches. The legacy `melPat` boolean grid remains unchanged; signed semitones outside 0–11 use optional `melExtra[track][step]`. Saved records and portable JSON use version 3 when step-local harmony settings exist, version 2 for extended pitches alone, and version 1 otherwise. Older applications reject unsupported files instead of silently changing the music; current imports accept all three versions. The optional `melHarmDisabled[track][step]` field preserves complete generated voicings without changing track-wide HARM.

```ts
import { setSongTheory, previewMusicalVariation, applyVariation } from './src/transport/composer';
import { renderSongToBuffer } from './src/transport/render-song';

setSongTheory({ root: 2, mode: 'dorian', locked: true, progression: [1, 4, 1, 7] });
const candidate = previewMusicalVariation(
  { from: 0, to: 3, startStep: 0, endStep: 63, tracks: [5, 6] },
  'driving',
  { seed: 17, roles: ['bass', 'chords', 'melody'], chordSize: 3 },
);
const audition = await renderSongToBuffer({
  phraseOverride: candidate.result,
});
// Play audition.buffer, then apply only if wanted.
applyVariation(candidate);
```

Pitch APIs `setMelStep(track, step, signedSemitone, on)` and `getMelNotes(track, step)` in `transport/patterns.ts` accept/return pitches relative to the track's base C. Wrap direct note writes in `editDocument` for undo and autosave. MIDI note-on quantizes pitch while note-off retains ownership of the original key, including two keys that map to the same pitch. Key/mode changes, bulk edits and undo/redo stop held notes and release tails while retaining MIDI input bindings. Loading a song or unplugging the device still disconnects it.

**Follow playhead** in the phrase pane defaults off. Enable it to keep the track view on the phrase currently reaching the audio output. It follows audible boundaries, ends held painting strokes before changing phrases, and preserves note history. It is a saved browser preference, independent of song files; `setFollowPlayhead(boolean)` and `isFollowingPlayhead()` are available from `ui/playhead.ts`.
