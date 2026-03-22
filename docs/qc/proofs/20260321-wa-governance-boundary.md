# Proof: WA Governance Boundary

## Task

20260321-wa-governance-boundary

## Summary

This governance slice hard-blocks governance-change tasks in default WA mode and requires explicit GA override for governance development.

## Changes

1. Added role-boundary routing language: WA is product-only and must stand down on governance requests.
2. Added compiler diagnostic `GOV-ROLE-001` for governance-change attempts without GA override.
3. Added compiler/wrapper support for GA override flag/env.
4. Added GA command wrappers in package scripts.

## Verification

1. `node --check docs/qc/scripts/governance-compiler.mjs`
2. `node --check docs/qc/scripts/gov-commit.mjs`
3. `npm run gov:check:ga -- --spec docs/qc/specs/20260321-wa-governance-boundary.task.spec.json`
