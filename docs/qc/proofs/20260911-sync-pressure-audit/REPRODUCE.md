# Reproduce the audit

Run from the sequencer checkout to be tested (this run used b450673), with dependencies and Playwright Chromium installed. Start Vite on 127.0.0.1:5173. The scripts load the real application; no source files are changed. A foreground Chromium window and working audio output are required for the stress probe.

```sh
AUDIT_OUTPUT=/absolute/output/directory node /absolute/path/to/stress.mjs
```

Create the output directory first. If launched outside the tested checkout, set SEQUENCER_ROOT to it. SCENARIO optionally selects one scenario by substring. Full run is approximately three minutes, 40–220 BPM, nine tracks, up to 15 voices per step, 4x CPU throttling, 40/180 ms main-thread stalls, edits, tempo changes, and 40 restarts. Keep other CPU-heavy tests separate. Timing and physical-output estimates depend on the machine and output device.

Copy reanalyze.py beside the captured raw JSON files and execute it to produce corrected nearest-partner metrics and runtime-checks.json. This recorded audit reanalyzed the original captures after correcting a grouping ambiguity: choosing all onsets in a 30 ms window can mix adjacent pulses under overload. The committed stress probe now also selects the nearest onset per track. The recording instrumentation and test actions did not change. The worst alignment event is additionally preserved verbatim in worst-track-skew.json.

For smoke.mjs, also build and serve dist on 5175. The development smoke attempts the first real sample library item; on this machine the Downloads symlink raised EPERM and terminated Vite. The production smoke verifies initialization without using the sample library. Start a fresh development server afterwards if needed.

The explicit runtime thresholds are 1 ms maximum missed scheduling deadline, one sample maximum inter-track onset skew, 30 ms visual p99/median output-clock tolerance, 30 ms phrase-boundary tolerance, complete event sequence/track coverage, and complete stop cleanup. These are audit acceptance checks; product policy was not changed.

The standard commands were npm run ci, npm run build, npm run verify:global-debt, npm run e2e, AUDIO_GATE_PORT=5176 npm run audio:gates, and npm run e2e -- --grep 'Transport Sync|Transport/UI Synchronisation' --repeat-each=5 --workers=1. Historical QC used npm run gate:commit-range -- --range b04dd33..b450673.

Audit packaging is a separate compiler invocation against latest main. Its PASS is not a passing product verdict.
