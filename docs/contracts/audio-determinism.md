# Audio Determinism Contract

## Mandate

Audio behavior must be deterministic and repeatable from built-in sample inputs.
No change may make default sound quality worse.

## Non-Negotiables

1. New defaults must be conservative and non-distorting.
2. `off` means acoustically transparent.
3. `on` means the intended effect is actually applied.
4. Control response near zero must be smooth.  
   0%→1% cannot create a disproportionate gain/distortion jump.
5. New-song/reset flows must not inherit prior extension tone state.
6. Deterministic tests must not depend on randomness.

## Required Evidence

For audio-impacting tasks, proof artifacts must include:

1. `npm run audio:gates` result.
2. `npm run gate:contracts` result.
3. Explicit note on defaults touched and why they are safe.
4. Explicit note on off/on transparency verification.
