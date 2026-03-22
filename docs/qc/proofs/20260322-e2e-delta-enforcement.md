# Proof — 20260322-e2e-delta-enforcement

## Capability
Added compiler-bound `O-E2E-DELTA` enforcement so runtime implementation diffs cannot pass without behavioral test deltas.

## Changes
- Added `docs/qc/scripts/e2e-delta-gates.mjs`.
- Added `gate:e2e-delta` npm script.
- Added `O-E2E-DELTA` command obligation in `docs/qc/compiler/obligation-rules.json`.
- Wired compiler synthesis to include `O-E2E-DELTA` for product diffs.
- Updated contracts to document binding and failure semantics.

## Determinism
Gate uses staged diff (`git diff --cached`) and compiler-provided env (`GOV_CHANGED_FILES`, `GOV_TASK_TYPE`) only.

## Browser Verification
Not required (governance-only task, no product runtime/UI edits).
