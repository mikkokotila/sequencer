# Proof: CA Governance Boundary

## Task

20260321-ca-governance-boundary

## Summary

This governance slice hard-blocks governance-change tasks in default CA mode and requires explicit observer override for governance development.

## Changes

1. Added role-boundary routing language: CA is product-only and must stand down on governance requests.
2. Added compiler diagnostic `GOV-ROLE-001` for governance-change attempts without observer override.
3. Added compiler/wrapper support for observer override flag/env.
4. Added observer command wrappers in package scripts.

## Verification

1. `node --check docs/qc/scripts/governance-compiler.mjs`
2. `node --check docs/qc/scripts/gov-commit.mjs`
3. `npm run gov:check:observer -- --spec docs/qc/specs/20260321-ca-governance-boundary.task.spec.json`
