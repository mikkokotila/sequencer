# Global Debt Baseline Freeze

baseline_id: 20260322-global-debt-baseline
frozen_at_utc: 2026-03-22T05:54:20Z

## Counts

- contracts full scan failures: 5
- architecture full scan failures: 6
- total failures: 11

## Sources

- `docs/qc/debt/baselines/20260322-global-debt-baseline/contracts-full.out.log`
- `docs/qc/debt/baselines/20260322-global-debt-baseline/contracts-full.err.log`
- `docs/qc/debt/baselines/20260322-global-debt-baseline/architecture-full.out.log`
- `docs/qc/debt/baselines/20260322-global-debt-baseline/architecture-full.err.log`

## Contract Findings (5)

1. No informational assertions
2. `src/engine/extensions/pultec-eq.ts`: `setState` respects disabled state
3. `src/engine/extensions/compressor.ts`: `setState` respects disabled state
4. `src/engine/extensions/transformer.ts`: `setState` respects disabled state
5. Engine low-end control curve safety

## Architecture Findings (6)

1. No global `window.SEQ` extension coupling
2. Engine interface contract is actually consumed
3. Scheduler does not import transport internals directly
4. Audio initialization ownership is centralized
5. UI does not duplicate transport business logic
6. Playhead/cell rendering avoids repeated inline style mutation

## Next Step

Enable compiler ratchet enforcement against this baseline:

- all product tasks: debt count must not increase
- debt-burn tasks (`guardrails.require_debt_reduction=true`): debt count must decrease by at least 1
