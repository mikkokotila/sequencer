# Proof: Mid-Task Termination Lock

## Task

20260321-mid-task-termination-lock

## Summary

This governance slice introduces a deterministic stand-down protocol with required artifacts and compiler enforcement that blocks product tasks when stand-down lock is active.

## Changes

1. Added stand-down contract and routing override behavior.
2. Added `gov:standdown` script to capture repo snapshot, optional safety stash, report artifact, and active lock.
3. Added compiler diagnostic `GOV-PROC-008` and lock-state checks in parse phase.
4. Added `docs/qc/standdown/**` to compiler-managed path groups.

## Verification

1. `node --check docs/qc/scripts/standdown.mjs`
2. `node --check docs/qc/scripts/governance-compiler.mjs`
3. `npm run gov:check -- --spec docs/qc/specs/20260321-mid-task-termination-lock.task.spec.json`
