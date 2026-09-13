# Post-remediation package QC — Chrome scope

Product pressure checks and final compiler: PASS (119/119 tests, static/contract/architecture checks and four required oracles). PR readiness is verified separately on the latest head. Historical proof remains BLOCKED; baseline unchanged. Source hashes and test-phase boundaries are in environment.json.

| Contract / area | Verdict | Evidence / result |
|---|---|---|
| F01–F05: files, atomic loads, transaction completion and conflicts | PASS | Audible sample JSON roundtrip, malformed imports preserve state, latest complete load wins, aborted writes reject, stale tabs preserve copies; same-tab load/save race regression. |
| F06/F10: sound-state persistence/reset | PASS | ADSR, master and engine settings survive reload; audible offline envelope hashes match; New Song resets. |
| F07–F09: deletion and MIDI ownership | PASS | No deleted-song resurrection; repeated mono/poly pitches, release tails and disconnect retain bounded ownership. |
| F11–F12: keyboard and startup | PASS | Native interactive Space behavior; storage/worklet failures provide recovery and successful retry. |
| F13: actual DSP performance evidence | PASS | 32 voices / 30 s: p99 upper bound 0.676 ms, budget 2.667 ms, 11,287 packets, 100.0% coverage. Final frozen compiler measurement 0.732 ms; independent Linux CI 1.481 ms. Deliberate real compressor overload rejected. |
| F14: dependency advisories | PASS | Fresh npm audit: zero advisories; supported Node 22 used. |
| F15: aux lifecycle | PASS | Both disabled effects previously restored wet gain 0.7. Generation-owned reset/stop handling keeps them silent, clears audible memory and survives rapid restart. |
| F16: panel selection | PASS | Reverb → Engine → close → Reverb requires one click; before/after browser reproduction retained. |
| Edit model and persistence | PASS | 5,000 seeded operations across all six operation types; live state, IndexedDB and reload match independent model. |
| Audio determinism under sustained pressure | PASS | 16,668 starts, zero late starts/skew, 1,749 onsets per track, 600 changes, nine stalls, CPU4x, 40 restarts, suspend/resume and complete cleanup. |
| Signal quality | PASS | 47 audio assertions; Linux and macOS gates pass. |
| UI resources | PASS | 1,800 operations with rendered engine/effect panels; stable 4,454 nodes, 580 listeners and one document after GC; retained heap +34,700 bytes. |
| Installed Chrome / responsive layout | PASS | Chrome 152.0.7977.83 playback/reload; 1440/768/390 px screenshots inspected. Melody controls wrap without clipping. |
| Production / export | PASS | Built bundle imports/exports 24,044 sample bytes unchanged, reloads and plays; 12-phrase / 6,912-voice / 17,032,438-byte ZIP passes independent CRC, RIFF, PCM24, channel and frame checks. |
| Historical proof | BLOCKED | 24 original attestations missing since baseline b04dd33; current tests cannot recreate historical proof. No waiver or advancement. |
| Physical devices and licensed sample libraries | BLOCKED | Synthetic PCM/MIDI and browser output observed; physical MIDI/acoustic loopback and protected licensed sample files were not verified. |

The soak measures alignment and cleanup through stalls; it does not claim uninterrupted note delivery through arbitrary main-thread freezes. Its end heap snapshot is not GC-normalized; retained-memory claims come only from the separate resource test. Firefox/WebKit assurance is outside the user-requested scope.
