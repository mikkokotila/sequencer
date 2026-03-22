# Proof: Fix ADSR Playback

## Task
20260322-fix-adsr-playback

## Root Cause
`applyEnvelope()` called `source.stop(futureTime)` before `playSample()` called `source.start(time)`. Web Audio API requires `start()` before `stop()`. In some browsers this silently fails (source never plays), in others it throws and breaks the scheduling loop — causing sound loss across multiple tracks.

## Fix
1. Changed `applyEnvelope()` return type from `GainNode` to `{ envelope: GainNode, stopAt: number }` — it no longer calls `source.stop()` directly.
2. `playSample()` now calls `src.start(time)` first, then `src.stop(stopAt)` after.
3. MIDI path updated to use the new return type.

## Verification
- Added deterministic E2E test `ADSR envelope actually modulates audio when enabled` that uses OfflineAudioContext to prove:
  - With 500ms attack, first 10ms of signal is near-silent (peak < 0.1)
  - At 100ms the signal is rising but still attenuated (peak < 0.25)
  - The ramp is monotonically increasing (100ms peak > 10ms peak)
- This is real audio verification, not UI-only checks.

## Gate Results
- CI: PASS (60/60 E2E tests)
- Audio gates: PASS (25/25 audio-quality, 14/14 e2e-signal, 8/8 signal-purity, benchmark PASS)
