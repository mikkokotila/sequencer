# Proof: Replace informational assertions with real test conditions

## Task
20260322-debt-informational-assertions

## Summary
Replaced 8 `assert(..., true, ...)` informational assertions across 3 test pages with real testable conditions. These assertions always passed regardless of actual signal state, providing false confidence.

## Debt Reduction
Target finding from `docs/qc/debt/baseline.json`:
- `No informational assertions`

## Changes
- `tests/audio-quality.html`: 6 assertions fixed — now verify `peak > 0`, `thd > 0`, `peak < 2.91`
- `tests/e2e-signal.html`: 1 assertion fixed — now verifies `thd > 0`
- `tests/signal-purity.html`: 1 assertion fixed — now verifies `peakOut > 0`
