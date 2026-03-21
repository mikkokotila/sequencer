# Quality Gates Contract

## Mandate

After ANY completed task, run `npm run verify`. All required gates must pass.

## Required Programmatic Gates

### 1) CI Pipeline (`npm run ci`)

Runs four gates in sequence. All must pass:

1. **typecheck** — `tsc --noEmit`. Zero errors.
2. **lint** — `eslint src/`. Zero errors. DSP worklet files have extra no-allocation rules.
3. **format** — `prettier --check`. All files formatted.
4. **circular** — `madge --circular`. No circular imports.

### 2) E2E Pipeline (`npm run e2e`)

Playwright suite must pass with zero failures.

### 3) Contract Static Gates (`npm run gate:contracts`)

Static policy checks that fail on known recurring regressions:

1. No `test.fixme` debt in `e2e/` and `tests/`.
2. No informational `assert(..., true, ...)` assertions in audio test pages.
3. `newSong()` must reset extension state to deterministic defaults.
4. Master insert extensions must keep `setState` non-audible while disabled (`off` means off).
5. Engine master controls must preserve non-explosive low-end response curves (squared control checks).
6. Benchmark harness must be deterministic and worklet-driven (no random main-thread proxy timing).

### 4) Audio Browser Gates (`npm run audio:gates`) — conditional

Required when changing audio code in:
- `src/engine/**`
- `src/engine/worklets/**`
- `src/engine/extensions/**`

Automated browser checks run:
- `tests/audio-quality.html`
- `tests/e2e-signal.html`
- `tests/signal-purity.html`
- `tests/benchmark.html`

These pages must report passing verdicts.

## Aggregate Command

`npm run verify` runs the required non-conditional gates:
- `npm run ci`
- `npm run e2e`
- `npm run gate:contracts`

For audio-code tasks, run `npm run audio:gates` in addition to `npm run verify`.

## Gain Staging Rules

| Node | Max Gain | Notes |
|------|----------|-------|
| Per-track GainNode | 1.0 | Mixer default 0.8 |
| masterGain | 0.8 | Headroom for summing |
| Vari-Mu inputGain | 1 + drive * 1.5 | Max 2.5x at full drive |
| Vari-Mu outputGain | output * 1.5 | Max 1.5x at full output |
| Mixer master slider | 1.0 max | No boost above unity |
| Aux send bus | 1 / sqrt(trackCount) | Normalize for track count |
| Aux per-track send | 0.15 (reverb), 0.12 (delay) | Conservative defaults |
| Delay feedback | 0.95 max | Hard-capped |

## Control Truthfulness Rules

1. `off` must be acoustically transparent, not just visually toggled.
2. `on` must audibly apply only the intended processing.
3. Enabling a control from 0% to 1% must not cause disproportionate jumps.
4. New-song/default-state flows must reset extension behavior deterministically.

## WaveShaper Curve Rules (nonlinear processors)

1. At amount=0, curve MUST be identity: `f(x) = x`.
2. Use crossfade: `curve[i] = x * (1 - amount) + shaped * amount`.
3. No raw asymmetry. Use `Math.sin(x * PI)` for even harmonics.

## Benchmark Gate Rules

`tests/benchmark.html` is valid only when benchmark measurement is deterministic and tied to worklet processing (not random oscillator/main-thread interval proxies).

**Pass condition:** p99 process() duration < block budget (bufferSize / sampleRate * 1000 ms).
At 128 samples / 48kHz, budget is 2.67ms. p99 must be under that.

**Config:** Run with 16 voices, all effects active, 10-second duration minimum.

## Adding Tests

1. New extension → test node topology in isolation + full chain.
2. Saturation curves → drive=0 transparency test (THD < 0.1%).
3. Aux effects → summing normalization test.
4. Feedback paths → stability at max feedback.
5. All tests use `OfflineAudioContext`.
6. New worklet processor → run benchmark gate with max polyphony.
