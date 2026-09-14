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

Programmatic callers use the same API as the GUI:

```ts
import { exportSongAudio, downloadSongAudio } from './src/transport/song-audio';

const abortController = new AbortController();
const result = await exportSongAudio('mp3', {
  signal: abortController.signal, // optional
  onProgress: ({ stage, fraction }) => console.log(stage, fraction), // optional
});
// result contains a Blob, filename, and rendered duration in seconds.
downloadSongAudio(result); // optional: trigger a browser download
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

### S2400 drum projects (experimental)

Use **Download song → Export S2400 drums** for a native project ZIP with drum patterns and samples on A1–A5. Synths, effects and Song-mode chains are excluded. Generated projects still require S2400 hardware playback verification. [Scope, SD-card instructions and public API](docs/s2400-export.md).

### Song length

Choose 12, 24, 36, or 48 phrases in the song pane, with 12 slots per row. New songs default to 36; older songs gain 36 available slots without changing their notes or tempo. The selection is saved with each song and travels with JSON exports. Reducing the count requires all removed phrases to be empty and stops playback. Each phrase is four bars; at 130 BPM, 36 filled phrases last about 4:26 and 48 last about 5:54. Empty phrases remain skipped during playback and audio export.

Programmatic callers use `setPhraseCount(count)` from `src/transport/patterns.ts`, the same operation as the GUI. Song JSON accepts `phraseCount` with the same four choices; more phrase data than the declared count is rejected. WAV/MP3 exports retain the existing 10-minute limit including effect tails.

### Sequenced note length

Each track's ADSR popup includes **Note length** in sixteenth-note steps (1–64; default 1). It controls the envelope duration of sequenced notes; MIDI still uses note-off, and samples play naturally when ADSR is off. The same value is available through `setTrackAdsr(track, { gateSteps: 2 })` and is saved in `sound.adsr[].gateSteps`. Older songs default to one step. Live playback, phrase WAVs and full-song WAV/MP3 exports use this value. S2400 drum export remains dry and omits envelopes.

To correct a half-tempo arrangement without changing its sound, double BPM, place each note at twice its original global step index (splitting phrases as needed), and double each enabled envelope's `gateSteps`. Sample audio, ADSR times, pitch and time-based effects stay unchanged.
