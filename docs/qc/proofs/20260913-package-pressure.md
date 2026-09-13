# Package pressure QC — 2026-09-13

Product QC: **FAIL**. Historical proof: **BLOCKED**. This task records findings; no product source, test gates, dependencies, contracts, or baseline were changed.

- Tested merged main `cd2564ccb172832a47b0c180ced32fbf3927256d`, after PR39; branch `codex/package-pressure-qc-20260913` starts there.
- [QC matrix](../runs/20260913-083738Z-cd2564c.md); [findings and acceptance criteria](20260913-package-pressure/FINDINGS.md); [reproduction](20260913-package-pressure/REPRODUCE.md).
- Existing suite: 84/84; audio signal assertions: 47/47. New pressure cases: 6 PASS, 16 FAIL. Positive controls and failures remain together in the recorded output.
- Sustained sync: 16,704 starts, zero late starts or measured inter-track skew, 600 changes, nine stalls, 40 restarts, complete cleanup.
- Real browser verification performed in private Chromium contexts; WebKit smoke passed; Firefox initial timeout and successful native/app rechecks are both preserved. No physical MIDI device was tested.
- Benchmark challenge demonstrates an invalid performance assurance: unchanged p99 despite an 81.5% reduction in processed blocks. No real DSP p99 claim is made.
- No legacy exception is authorized. Historical baseline `b04dd33` remains unchanged; 24 commits still lack required original proof.
- `gov:check`/`gov:commit` PASS validates this audit's packaging and scope, **not** product correctness or release readiness.
