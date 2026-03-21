# Observation 001 — Audio Governance Gap Report

date_utc: 2026-03-21
branch: main
head_at_observation: efeb304
observer_scope: governance-only

## Current State Snapshot

- `npm run ci`: PASS
- `npm run e2e`: PASS with `45 passed, 1 skipped (fixme)`
- Routing/contracts intent: strong
- Deterministic enforcement: incomplete

## Confirmed Gaps

1. Audio quality/benchmark checks are not fully enforced by required programmatic gates.
2. Benchmark harness is non-deterministic and not aligned with real worklet process-duration claims.
3. Audio test pages contain informational assertions that cannot fail regressions.
4. Default-state assumptions drift across tests/runtime.
5. Control correctness is under-verified for acoustic truthfulness (`off` transparency, `on` audibility).
6. New-song determinism leak exists around extension state reset behavior.
7. E2E still includes `test.fixme`, while contract target is zero.

## Governance Action in This Slice

1. Route full completion through `npm run verify`.
2. Add deterministic audio behavior contract (`docs/contracts/audio-determinism.md`).
3. Upgrade quality/e2e contracts to hard-block unresolved `fixme` and non-deterministic behaviors.
4. Add upcoming static contract gates (wired in next slice) to make repeated regressions fail fast.

## Expected Outcome

After gate wiring, the system should fail early when these exact regressions reappear, instead of relying on manual recall.
