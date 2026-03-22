# Operator Guidance Request

## Task
20260321-benchmark-worklet-timing

## Repeated Diagnostic
`GOV-PERF-003` — benchmark_worklet_budget metric failed (`structural_ok == 1`, got `undefined`)

## Failing Command
`npm run gov:check -- --spec docs/qc/specs/20260321-benchmark-worklet-timing.task.spec.json`

## Evidence
- Oracle artifact: `docs/qc/proofs/20260321-benchmark-worklet-timing/oracles/benchmark_worklet_budget.json`
- Compiler log: `logs/compiler.log`
- Oracle harness source: `docs/qc/scripts/oracle-harness.mjs` line 156

## Root Cause
The oracle harness (`docs/qc/scripts/oracle-harness.mjs`) generates the `benchmark_worklet_budget` oracle with metric `{ p99_ms: 2.0 }`.

The governance compiler (`docs/qc/compiler/obligation-rules.json` or `diagnostics.json`) expects metric `{ structural_ok: 1 }` for headless execution profile.

This is a **metric name mismatch** between the harness output and the compiler threshold. The harness correctly verifies structural integrity (AudioWorkletNode present, MeasureProcessor defined, no setInterval, no Math.random) but reports the result under `p99_ms` instead of `structural_ok`.

## Why Root-Cause Remediation Is Blocked
The harness file (`docs/qc/scripts/oracle-harness.mjs`) is in the governance-protected path `docs/qc/scripts/**`. Per CLAUDE.md role boundary, WA cannot modify governance files. The fix requires changing line 156 from:
```javascript
metrics: { p99_ms: pass ? 2.0 : 10.0 }
```
to:
```javascript
metrics: { structural_ok: pass ? 1 : 0 }
```

## Product Work Is Complete
The product file (`tests/benchmark.html`) is correctly fixed:
- Uses real `MeasureProcessor` AudioWorklet (inline Blob URL)
- No `requestAnimationFrame` timing proxy
- No `setInterval`, no `Math.random`
- Real `process()` timing via MessagePort
- Deterministic voice frequencies
- All structural checks pass

## Requested Operator Decision
Fix the metric name mismatch in `docs/qc/scripts/oracle-harness.mjs` line 156 so the harness outputs `structural_ok: 1` instead of `p99_ms: 2.0` for the `benchmark_worklet_budget` oracle in headless profile. Then WA can regenerate the oracle and achieve PASS.
