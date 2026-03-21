# Proof: Compiler Remediation Loop Hardening

## Task

20260321-compiler-remediation-loop-hardening

## Summary

This governance slice hardens compiler behavior and guidance so CA must remediate diagnostics iteratively until `PASS` instead of bypassing with direct commits or manual oracle evidence.

## Changes

1. Compiler no longer crashes on parse-stage failures with unresolved proof paths.
2. Added explicit invalid `task_type` diagnostic (`GOV-SPEC-007`) with prescriptive fix (including `fix -> bugfix` mapping guidance).
3. Added required remediation-loop output in compiler summary.
4. Added hard block for manual oracle harness values (`GOV-PROOF-009`).
5. Reduced delta-gate false positives so task-regression checks fail only on new delta violations, not unchanged legacy debt.
6. Updated routing/contracts to require diagnostic-driven rerun loop until `PASS`.

## Verification

1. `gov:check` on invalid spec now returns `BLOCKED` with actionable diagnostics, no fatal crash.
2. Manual oracle artifacts are now explicitly blocked with `GOV-PROOF-009`.
3. Updated delta gates pass for commit `e3e4b21` scope where no new architecture/benchmark debt was introduced.
