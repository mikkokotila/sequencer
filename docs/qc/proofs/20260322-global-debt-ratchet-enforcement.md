# Proof Summary

task_id: 20260322-global-debt-ratchet-enforcement
spec_path: docs/qc/specs/20260322-global-debt-ratchet-enforcement.task.spec.json

## Outcome

Implemented blocking global debt ratchet over non-blocking full scans.

- baseline source: `docs/qc/debt/baseline.json`
- product task rule: no increase vs baseline (`GOV-DEBT-002`)
- debt-burn task rule (`guardrails.require_debt_reduction=true`): strict reduction required (`GOV-DEBT-003`)
- missing/invalid baseline: blocked (`GOV-DEBT-001`)

## Compiler Surface

- Added debt baseline read + validation.
- Added global debt failure extraction from full-scan logs.
- Added ratchet diagnostics and attestation fields.
- Added optional spec guardrail `require_debt_reduction`.

## Documentation Surface

Routing, contracts, diagnostics, and template spec updated to enforce debt-burn workflow.
