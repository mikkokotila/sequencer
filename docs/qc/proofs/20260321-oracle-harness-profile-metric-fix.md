# Proof: Oracle Harness Profile Metric Fix

## Task

20260321-oracle-harness-profile-metric-fix

## Summary

Fix benchmark oracle metric output so `execution_profile=headless` emits `structural_ok` and `execution_profile=interactive` retains `p99_ms` compatibility.

## Verification

1. `node --check docs/qc/scripts/oracle-harness.mjs`
2. `npm run gov:check:ga -- --spec docs/qc/specs/20260321-oracle-harness-profile-metric-fix.task.spec.json`
