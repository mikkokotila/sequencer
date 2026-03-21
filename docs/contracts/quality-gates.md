# Quality Gates Contract

## Mandate

After ANY change to the package, the `audio-gate` test suite MUST pass before the change is considered complete.

## audio-gate

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

## Adding Tests

1. New extension → test node topology in isolation + full chain.
2. Saturation curves → drive=0 transparency test (THD < 0.1%).
3. Aux effects → summing normalization test.
4. Feedback paths → stability at max feedback.
5. All tests use `OfflineAudioContext`.
