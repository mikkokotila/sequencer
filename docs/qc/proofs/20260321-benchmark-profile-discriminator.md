# Proof: Benchmark Profile Discriminator

## Task

20260321-benchmark-profile-discriminator

## Summary

This governance slice introduces deterministic benchmark execution profiles so WA can proceed without fake timing claims in headless environments while preserving strict interactive timing requirements.

## Changes

1. Added dual execution profile policy (`headless`, `interactive`) in compiler rules.
2. Added profile-aware benchmark oracle thresholds: interactive `p99_ms <= budget`, headless `structural_ok == 1`.
3. Added spec diagnostic `GOV-SPEC-008` for missing/invalid execution_profile on benchmark tasks.
4. Added profile propagation (`GOV_EXECUTION_PROFILE`) to gate commands and profile-aware benchmark gate behavior in `audio-gates`.
5. Updated routing/contracts/template spec to require explicit execution_profile for benchmark-governed tasks.

## Verification

1. `node --check docs/qc/scripts/governance-compiler.mjs`
2. `node --check docs/qc/scripts/audio-gates.mjs`
3. `npm run gov:check -- --spec docs/qc/specs/20260321-new-song-baseline-reset.task.spec.json --simulate-files tests/benchmark.html --no-write` returns `GOV-SPEC-008` when execution_profile is missing.
4. `npm run gov:check:ga -- --spec docs/qc/specs/20260321-benchmark-profile-discriminator.task.spec.json`
