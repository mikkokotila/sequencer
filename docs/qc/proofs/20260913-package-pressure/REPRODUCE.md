# Reproduce package QC

Use Node 23.10.0, repository dependencies (`npm ci`), and installed Playwright Chromium/Firefox/WebKit; tested on macOS arm64. Run commands from the repository root on cd2564c. All new probes use private browser state and generated audio; no licensed samples are required.

1. Start `npm run dev -- --host 127.0.0.1 --port 5173 --strictPort`. Keep ports 5174 and 5177 free for gates.
2. Run `npm run verify`, `npm run verify:global-debt`, and `npm run audio:gates` sequentially. The audio benchmark's nominal PASS is invalidated by step 7.
3. Run `node docs/qc/proofs/20260913-package-pressure/pressure.mjs`. It records all cases, including failures; process exit 0 means collection completed, not that QC passed. `QC_CASE` filters case names; `QC_OUTPUT` selects another output folder.
4. Run `node docs/qc/proofs/20260913-package-pressure/soak.mjs` alone (~3 minutes). Its onset tap measures actual per-track samples; it does not infer audio alignment solely from scheduler events. Heap metrics in this run were unavailable; UI heap is measured separately.
5. Run `node docs/qc/proofs/20260913-package-pressure/export-pressure.mjs`, then `python3 docs/qc/proofs/20260913-package-pressure/check-export.py`. The generated 17MB ZIP stays under `/private/tmp`; `QC_ZIP` overrides that location. No generated audio is committed.
6. Run `node docs/qc/proofs/20260913-package-pressure/ui-resource-pressure.mjs`; this measures allocation/cleanup under repeated synchronous panel operations, not long-term paint/animation memory.
7. Run `node docs/qc/proofs/20260913-package-pressure/benchmark-audit.mjs`. A response-local instrumentation patch adds two million sine iterations to each worklet callback. Both baseline and stressed benchmark still PASS with the same p99 while throughput collapses. Product files are untouched.
8. Run `node docs/qc/proofs/20260913-package-pressure/compatibility.mjs` and `node docs/qc/proofs/20260913-package-pressure/firefox-diagnosis.mjs`. Smoke covers startup, scheduling/stop, reload and three viewport sizes; it is not the full 84-test suite on every engine.
9. Run `npm audit --json`, `npm audit --omit=dev --json`, and `npm run gate:commit-range -- --range b04dd33..cd2564c`.

Probe corrections: first-pass MIDI counts were taken before the audio backend had warmed up; final probes wait for >350ms of actual AudioContext time. The initial modal selector was invalid and was corrected. Worklet-failure injection now targets addModule, not broad development module URLs. First-pass artifacts are retained and are not the final verdict.
Firefox's first rAF-polled wait timed out; independent native/app AudioContexts then worked in headed and headless runs, and timer-polled compatibility passed. The original timeout remains unexplained. No repeated passing run is used to erase that uncertainty.
The original WAV-check command used a wrong header offset; the committed independent parser uses RIFF offsets 22/24/32/34 and passes. Results are not product-fix evidence.

Edit-generator correction: low bits of the initial linear generator exercised only drum/vocal/clear operations. The final generator uses higher bits and requires nonzero counts in all six categories. `edit-model-results.json` records 811/795/854/846/838/856 operations, with matching model, saved state and reload. Original results remain intact.
