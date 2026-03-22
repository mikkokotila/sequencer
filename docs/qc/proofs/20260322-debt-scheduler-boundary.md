# Proof: Scheduler transport boundary enforcement

## Task
20260322-debt-scheduler-boundary

## Summary
Removed direct `../transport/patterns` and `../transport/song` imports from `src/engine/scheduler.ts`. Replaced with dependency injection via `bindTransport()` called from `main.ts`. The scheduler now receives transport data through an injected `TransportSource` interface, maintaining a clean engine→transport boundary.

## Debt Reduction
Target finding from `docs/qc/debt/baseline.json`:
- `Scheduler does not import transport internals directly`

## Changes
- `src/engine/scheduler.ts`: removed 2 transport imports, added `TransportSource` interface + `bindTransport()`, all data access via `transport.*`
- `src/main.ts`: calls `bindTransport()` with references to patterns/song data
- `src/ui/build.ts`: imports `isPhraseEmpty`/`fillWithPrev` directly from `transport/patterns` instead of re-export through scheduler
