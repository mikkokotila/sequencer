# Quality Gates Contract

## Mandate

After ANY change that touches code, run `npm run ci`. All gates must pass.

## CI Pipeline (`npm run ci`)

Runs four gates in sequence. All must pass:

1. **typecheck** — `tsc --noEmit`. Zero errors.
2. **lint** — `eslint src/`. Zero errors. DSP worklet files have extra no-allocation rules.
3. **format** — `prettier --check`. All files formatted.
4. **circular** — `madge --circular`. No circular imports.

## audio-gate (manual, run when audio code changes)

**Location:** `tests/audio-quality.html`
**Run:** Open in browser. Tests auto-run. All 25 assertions must pass.

## Gain Staging Rules (enforced by tests)

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

## WaveShaper Curve Rules

1. At amount=0, curve MUST be identity: `f(x) = x`.
2. Use crossfade: `curve[i] = x * (1 - amount) + shaped * amount`.
3. No raw asymmetry. Use `Math.sin(x * PI)` for even harmonics.

## benchmark-gate (manual, run when DSP code changes)

**Location:** `tests/benchmark.html`
**Run:** Open in browser. Click RUN STRESS TEST. p99 must be within budget.

**Pass condition:** p99 process() duration < block budget (bufferSize / sampleRate * 1000 ms).
At 128 samples / 48kHz, budget is 2.67ms. p99 must be under that.

**Config:** Run with 16 voices, all effects active, 10-second duration minimum.

**What it measures:**
- Real AudioContext timing under maximum polyphony stress
- p50 (median), p99, and max process() duration
- DSP load as percentage of budget
- Visualizes duration over time with budget line

**When to run:** After any change to worklet processors, effect chain topology, or signal routing.

## Adding Tests

1. New extension → test node topology in isolation + full chain.
2. Saturation curves → drive=0 transparency test (THD < 0.1%).
3. Aux effects → summing normalization test.
4. Feedback paths → stability at max feedback.
5. All tests use `OfflineAudioContext`.
6. New worklet processor → run benchmark-gate with max polyphony.
