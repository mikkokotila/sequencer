# PR #39 runtime fixes

The user explicitly requested all identified product fixes in the existing PR, overriding this checkout's default GA-only scope and fresh-branch routing. PR #38's published fixes are incorporated into PR #39. Historical reports remain intact.

| Identified issue | Implemented correction | Evidence |
|---|---|---|
| Phrase marker advances before audio; stale highlights on view changes | Separate queued and audible phrase positions; output-clock events update marker and grid together | 40/120/220 BPM boundaries, skipped phrases, wrap, and repeated view edits |
| Visuals lead device output; imported Tone context escapes ownership test | One native AudioContext; device timestamps with latency fallback; initialization-time context capture | Exactly one context, fallback regression, independent device-clock observations |
| 180 ms stalls cause late starts and inter-track onset skew | 350 ms audio queue; future deadline recovery; render only latest audible step after blocked frames | Dense 15-voice steps, 4x CPU throttling, 180 ms stalls: 2,835 starts, zero late, zero measured skew |
| Cancellation can split tracks across audio blocks | Shared 25 ms future start/stop lead | Injected 12 ms cancellation interruption: before 39 vs 49 onsets; after 51 onsets on every track |
| Production worklets are emitted as raw TypeScript; sample manifest omitted | Compile worklets through Vite worker pipeline; bundle manifest URL | Production build/preview decodes and plays generated WAV, initializes all processors, no page errors |
| Sample read EPERM terminates Vite | Open/stat before streaming; handled pipeline errors; containment in development and preview | EPERM, missing file, read failure, encoded paths, retry, HEAD, traversal; actual library returns 403 followed by healthy app 200 |
| Fixed-duration synchronization capture is flaky | Wait for required captured events; isolate timing probes from other browser workers | Full suite and repeat regressions |

Focused final run: 9/9 tests pass. Across six timing scenarios: 8,919 scheduled sources, no late starts, no surviving sources/highlights/markers, one context per page, and no wrong marker/step on observed frames. Unblocked frame step-age p99 is 4.73/6.08/9.46 ms at 40/120/220 BPM. Earlier eight-repeat run: 13,716 starts, zero late starts or track skew. See `20260912-sync-runtime-fixes/stress/final-summary.json` and the raw captures.

A browser cannot draw during an intentionally blocked main thread. Recovery shows the current audible step rather than replaying obsolete frames; under 180 ms stalls the current step's observed age reaches p99 62.07 ms, within the 68.18 ms step duration at 220 BPM. This is distinct from the previous unconditional 30 ms callback-age audit threshold. Device timing is estimated from browser output timestamps, not physical acoustic loopback. Stalls exceeding the queue can interrupt audio and are reanchored without overdue bursts. Queued edits retain their timing; cancellation has a 25 ms lead.

The real sample folder still requires macOS permission or relocation. Synthetic WAV fixtures verify decoding/playback without publishing licensed sample data. The operating-system denial remains a local setup limitation, while its process-crashing failure is fixed.

Historical QC remains BLOCKED: 24 existing product commits lack attestations. No proof was fabricated and no baseline advancement or legacy exception was applied. Current compiler validation is independent of that historical completeness claim.

The complete browser suite passed 84/84, audio suites passed 47/47, and the worklet benchmark passed with p99 2.667 ms over 3,375 samples against a 5.330 ms budget. All seven compiler command gates and six audio/control oracles passed. Initial attestation was blocked by unbound Vite, Playwright and server paths; task 20260912-runtime-gate-bindings repairs that classification in a separate commit on the same PR. Final compiler attestation passed with zero diagnostics after the binding repair: all seven command gates and all six audio/control oracles passed again. The complete suite passed 84/84 in that attested run.
