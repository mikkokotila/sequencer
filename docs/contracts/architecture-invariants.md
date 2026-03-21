# Architecture Invariants Contract

## Mandate

Architecture must be truthful, deterministic, and enforceable.
No "paper architecture" is allowed where interfaces/contracts say one thing but runtime wiring does another.

## Invariants

1. No dummy extension pass-through nodes as architectural glue.
2. No global raw-audio access surface (`window.SEQ`) for extension behavior.
3. Engine boundary contracts must be used or removed; dead interfaces are prohibited.
4. Scheduler must not read transport internals directly.
5. Persistence must not require injected UI callbacks for core song lifecycle.
6. Preview audio nodes must be explicitly cleaned up.
7. Audio initialization ownership must be centralized; scattered `initAudio()` calls are prohibited.
8. Decode failures must be observable (logged with context and surfaced to users where relevant).
9. UI must not duplicate transport business rules.
10. Critical interaction setup (painting/listeners) must be idempotent.
11. Playhead rendering must prefer CSS class toggles over repeated inline style mutation.
12. Sentinel empty-string state for track types is prohibited; use explicit `null`.
13. Benchmark harness must be deterministic and not use main-thread timing proxies.
14. Benchmark worklet timing must measure meaningful processing windows, not near-no-op sections.

## Programmatic Gate

`npm run gate:architecture` is mandatory and blocking.
All invariant checks must pass for a `PASS` verdict.

## Evidence Requirement

Proof artifacts must include:

1. `npm run gate:architecture` result summary.
2. Any blocked invariants with file/line evidence.
3. Rationale for any temporary exception approved explicitly by the user.
