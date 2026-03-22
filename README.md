# Sequencer

Browser-based step sequencer with sample playback, melodic pitch control, per-track ADSR envelopes, MIDI input, kit export, 12-phrase song structure, and a professional audio engine featuring three-model compression (FET/Opto/VCA), Freeverb, interpolated delay, and Pultec EQ — all running on AudioWorklet processors with 4x oversampled nonlinear stages.

## Run locally

```
npm install
npm run dev
```

Opens at [http://localhost:5173](http://localhost:5173). Vite provides hot module replacement — changes take effect immediately without restart.

## Quality gates

```
npm run ci          # typecheck + lint + format + circular deps
npm run e2e         # Playwright end-to-end tests (58 tests)
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
│   ├── scheduler.ts              Tone.js Transport scheduling
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
├── transport/                 State, persistence & file I/O
│   ├── patterns.ts               Phrase/pattern state + mutations
│   ├── song.ts                   Song metadata, BPM, track config
│   ├── persistence.ts            IndexedDB save/load
│   └── kit-export.ts             ZIP bundle export for sample kits
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

DRUMS/                         Drum sample library
SYNTHS/                        Synth sample library
samples.json                   Sample browser manifest
```

## Tech stack

- **TypeScript** — strict mode with `noUncheckedIndexedAccess`
- **Vite** — dev server + build
- **Tone.js** — Transport scheduling
- **AudioWorklet** — all custom DSP on the audio thread
- **ESLint** — typescript-eslint strict-type-checked
- **Prettier** — formatting
- **Playwright** — E2E testing
- **Husky + lint-staged** — pre-commit hooks
