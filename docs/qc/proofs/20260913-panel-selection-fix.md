# Panel selection and final package QC

F16: opening Engine visually closed the active extension without clearing its selected ID. After closing Engine, the first click on that extension only cleared the stale selection. Engine now clears the selected ID when it closes the extension; one click reopens the extension. The exact user flow fails before and passes after (adjacent before.txt and after.txt).

Real-browser verification performed. The post-remediation pressure evidence is in `20260913-package-final-qc/`; its environment.json records the tested parent commit, pending product patch and source hashes. All fixes stay in PR #41 per explicit user authorization, overriding default GA-only scope and fresh-branch routing. Historical missing proofs are preserved; no baseline waiver.

F13 CI refinement: an overloaded headless renderer could invalidate the measurement handshake, but the benchmark discarded every raw packet. It now retains failed measurements while keeping the same strict positive gate. The negative test injects at least eight milliseconds of compute in the real compressor on every platform and independently requires the raw wall-time lower bound to exceed the real 128-frame budget. Setup failures or missing processing evidence cannot satisfy it.

CI diagnostics: the compiler previously collapsed a UI assertion into a generic error without its test name. The reporter emits the existing FAIL-ITEM protocol with test title, source location and full assertion context. A real deliberately failing sentinel verifies the diagnostic path; no retry/skip/assertion relaxation.

Chrome-only final pressure checks all pass; see ../proofs/20260913-package-final-qc/REPORT.md. Current final source hashes are recorded separately from the earlier pressure phase.

Final compiler PASS: 119/119 Chrome/Chromium regressions, static checks, eight contract checks, 15 architecture checks and all four required oracles. Final frozen benchmark: p99 upper bound 0.732 ms, 3,790 packets, 2.667 ms budget.
