# Task proof — synchronization pressure audit

task_id: 20260911-sync-pressure-audit
spec_path: docs/qc/specs/20260911-sync-pressure-audit.task.spec.json
attestation_path: docs/qc/proofs/20260911-sync-pressure-audit/verdict.json

Runtime audit verdict: FAIL. Historical required proof: BLOCKED. This committed audit records failures; its PASS packaging attestation does not imply a passing product.

Tested product SHA: b450673f2de00ccf281bf4501ff595593107940b. Audit branch base: df835b3 (latest main).

See [full audit](../runs/20260911-140906Z-b450673.md), the reproducible browser harness, aggregate metrics, raw timing traces, smoke results, and execution logs in the adjacent proof directory.

Browser verification: VERIFIED in real headed Chromium, plus a headless production smoke check. No physical loopback or real-library playback verification: the library read failed with EPERM. All product source files remain unchanged.

The compiler runs CI and commit-range checks for this evidence-only QC task. No prewritten oracle payload is supplied. Compiler diagnostics use its hash-chained logs/compiler.log. Baseline is unchanged because product verdict is FAIL and required historical proof is incomplete.
