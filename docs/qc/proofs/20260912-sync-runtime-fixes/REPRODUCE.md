# Reproduce the runtime verification

Install dependencies and Playwright Chromium, then run from the checkout:

```sh
npm run e2e
npm run e2e -- e2e/sync-pressure.spec.ts --repeat-each=3
npm run audio:gates
```

Playwright starts development Vite on 5174; the production regression builds and starts preview on 5177. Run timing suites serially on an otherwise idle machine. The standard config uses one browser worker and zero retries. `test-results/*/observations.json` records source deadlines, independent AudioWorklet onsets, output timestamps and rendered grid state. Production and library tests generate their own WAV data; no licensed sample files are required.

The six pressure cases exercise 40/120/220 BPM phrase boundaries, dense polyphony with 180 ms main-thread stalls and 4x CPU throttling, 40 tempo/restart cycles, and 12 interruptions inside the stop loop. A real audio worklet captures onset times separately from JavaScript scheduling events; every track must have the same count and onset alignment within one sample. The stop-boundary negative control was captured before the shared deadline change and is preserved as `stress/stop-boundary-before.json`.

`focused-tests.txt` and `stress/final-summary.json` describe the final focused run. Eight repeats of the original nine-track stall case, before adding dense polyphony and the stop fix, are summarized separately. One exploratory stop-test repetition was invalidated by an agent edit triggering Vite HMR; the unchanged final matrix was subsequently rerun successfully. Earlier development failures led to the production manifest and stop-deadline fixes; they were not retried away.

The app is served locally by `npm run dev` on 5173. Set `SEQUENCER_SAMPLE_ROOT` to the parent of readable DRUMS/SYNTHS libraries for actual sample-library loading. The recorded real-library check still received macOS permission denial, returned HTTP 403, and confirmed the app remained available with HTTP 200.
