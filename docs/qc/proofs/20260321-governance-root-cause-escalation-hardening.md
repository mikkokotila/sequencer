# Proof: Governance Root-Cause + Escalation Hardening

## Task

20260321-governance-root-cause-escalation-hardening

## Summary

This governance slice tightens the remediation loop so CA is repeatedly guided to root-cause fixes, is blocked on repeated unresolved failures pending operator guidance, and cannot pass benchmark gates via page-level PASS text.

## Changes

1. Routing now explicitly requires root-cause remediation and operator escalation on genuine contract/runtime conflict.
2. Governance compiler diagnostics now include concise root-cause reminders and operator-escalation hints.
3. Compiler adds `GOV-PROC-007` when the same `GOV-PROC-002` command failure repeats for the same task/spec in the detection window.
4. `audio-gates` benchmark check now validates numeric metrics (`p99`, `budget`, sample count) instead of trusting UI gate text.

## Verification

1. `npm run gov:check -- --spec docs/qc/specs/20260321-governance-root-cause-escalation-hardening.task.spec.json`
2. Compiler summary prints root-cause/no-workaround reminders and escalation guidance.
3. `docs/qc/proofs/20260321-governance-root-cause-escalation-hardening/verdict.json` is generated with final verdict.
