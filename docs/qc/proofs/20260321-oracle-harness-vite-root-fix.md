# Proof Summary

task_id: 20260321-oracle-harness-vite-root-fix
spec_path: docs/qc/specs/20260321-oracle-harness-vite-root-fix.task.spec.json

## Fixes

- Replaced unsupported `vite --root` flag usage with positional root argument.
- Tightened benchmark instrumentation to count `setInterval` and `Math.random` only when stack contains `benchmark.html`.

## Verification

- `node docs/qc/scripts/oracle-harness.mjs --task-id 20260321-benchmark-worklet-timing --oracles benchmark_worklet_budget --subject-sha TEST_SUBJECT_SHA --execution-profile headless --challenge test-challenge --repo-root . --json`
- `npm run gov:check:observer -- --spec docs/qc/specs/20260321-oracle-harness-vite-root-fix.task.spec.json`
- `npm run gov:commit:observer -- --spec docs/qc/specs/20260321-oracle-harness-vite-root-fix.task.spec.json -m "fix(governance): repair harness benchmark runtime probe"`
