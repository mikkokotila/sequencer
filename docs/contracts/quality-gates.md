# Quality Gates Contract

## Mandate

After ANY completed task, run governance compiler first:

`npm run gov:check -- --spec docs/qc/specs/<task-id>.task.spec.json`

The compiler derives required gates from staged diff and contracts.
All required obligations must pass.

## Required Programmatic Gates

### 0) Governance Compiler (`npm run gov:check -- --spec ...`)

Mandatory compiler phases:

1. Parse task spec.
2. Bind staged diff to contracts.
3. Synthesize required obligations.
4. Execute required gates and proof checks.
5. Verify final verdict.
6. Attest `verdict.json`.

### 1) CI Pipeline (`npm run ci`)

Runs four gates in sequence. All must pass:

1. **typecheck** — `tsc --noEmit`. Zero errors.
2. **lint** — `eslint src/`. Zero errors. DSP worklet files have extra no-allocation rules.
3. **format** — `prettier --check`. All files formatted.
4. **circular** — `madge --circular`. No circular imports.

### 2) E2E Pipeline (`npm run e2e`)

Playwright suite must pass with zero failures.

### 3) Contract Static Gates (task regression)

Compiler uses delta mode for blocking task-regression checks:

- `node docs/qc/scripts/contract-gates.mjs --mode delta`

Only checks relevant to staged files are blocking.
Full-debt scan remains available via `npm run gate:contracts` and is tracked as non-blocking debt in compiler output.

Blocking regression checks include:

1. No `test.fixme` debt in `e2e/` and `tests/`.
2. No informational `assert(..., true, ...)` assertions in audio test pages.
3. `newSong()` must reset extension state to deterministic defaults.
4. Master insert extensions must keep `setState` non-audible while disabled (`off` means off).
5. Engine master controls must preserve non-explosive low-end response curves (squared control checks).
6. Benchmark harness must be deterministic and worklet-driven (no random main-thread proxy timing).

### 4) Architecture Invariant Gates (task regression)

Compiler uses delta mode for blocking task-regression checks:

- `node docs/qc/scripts/architecture-gates.mjs --mode delta`

Only checks relevant to staged files are blocking.
Full-debt scan remains available via `npm run gate:architecture` and is tracked as non-blocking debt in compiler output.

Blocking regression checks include:

1. No dummy extension pass-through node hacks.
2. No `window.SEQ` global coupling from extensions.
3. No dead engine interface contract.
4. No scheduler direct transport-state imports.
5. No persistence UI-callback lifecycle injection.
6. No preview-node cleanup leaks.
7. No scattered audio init ownership.
8. No silent decode swallow paths.
9. No duplicated transport business logic in UI layer.
10. No non-idempotent painting listener setup.
11. No playhead inline-style thrash paths.
12. No empty-string paint type sentinel.
13. No transport `innerHTML` mega-template injection.
14. No benchmark randomness/proxy timing or near-no-op processor timing windows.

### 5) Audio Browser Gates (`npm run audio:gates`) — conditional

Required when changing audio code in:
- `src/engine/audio.ts`
- `src/engine/worklets/**`
- `src/engine/extensions/**`

Automated browser checks run:
- `tests/audio-quality.html`
- `tests/e2e-signal.html`
- `tests/signal-purity.html`
- `tests/benchmark.html`

These pages must report passing verdicts.

## Aggregate Commands

Underlying gate bundle:

`npm run verify` runs blocking push checks:
- `npm run ci`
- `npm run e2e`
- `npm run gate:commit-range`

`npm run verify:global-debt` runs full debt tracking scans:
- `npm run gate:contracts`
- `npm run gate:architecture`

For audio-code tasks, run `npm run audio:gates` in addition to compiler-required obligations.

Completion flow:

1. Stage the intended files.
2. Run `npm run gov:check -- --spec docs/qc/specs/<task-id>.task.spec.json`.
3. If verdict is `PASS`, commit with `npm run gov:commit -- --spec ... -m \"type(scope): description\"`.

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

Benchmark obligations are profile-driven via `execution_profile` in task spec.

### `interactive` profile

1. Must use real worklet `process()` timing evidence.
2. Pass condition: p99 process() duration < block budget (`bufferSize / sampleRate * 1000 ms`).
3. At 128 samples / 48kHz, budget is 2.67ms. p99 must be under that.

### `headless` profile

1. Timing budget pass is not evaluated as a hard condition.
2. Structural benchmark integrity is required:
   - worklet chain present
   - deterministic inputs (no randomness)
   - no main-thread timing proxy shortcuts (`setInterval`, `currentTime` proxy timing)
3. Structural proof must be machine-generated in benchmark oracle metrics.

**Config:** Run with 16 voices, all effects active, 10-second duration minimum.

## Adding Tests

1. New extension → test node topology in isolation + full chain.
2. Saturation curves → drive=0 transparency test (THD < 0.1%).
3. Aux effects → summing normalization test.
4. Feedback paths → stability at max feedback.
5. All tests use `OfflineAudioContext`.
6. New worklet processor → run benchmark gate with max polyphony.
