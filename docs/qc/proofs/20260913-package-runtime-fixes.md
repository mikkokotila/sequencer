# Package runtime integrity fixes

User authorization: all identified issues are to be fixed in the same PR #41, including product code. Original baseline reproductions remain in `20260913-package-pressure/FINDINGS.md` and adjacent captures.

| Finding | Repair and regression |
|---|---|
| F01–F02 | Versioned base64 sample files, whole-song schema/audio validation before mutation; audible roundtrip and invalid-file matrix. |
| F03/F05/F07 | Transaction-complete promises; atomic revision comparison and write; rejected stale/deleted records; export/copy/reload recovery; no deleted-song resurrection. |
| F04 | Load-generation cancellation around file reads and sample decodes; all state applied together only by the latest operation. |
| F06/F10 | ADSR, master gain and permanent engine settings persist and reset with each song. |
| F08–F09 | Held-note map plus owned voice set; identity-safe ended cleanup; bounded release tails and complete device-disconnect cancellation. |
| F11–F12 | Space respects interactive/modal focus; visible startup failure with fresh-document retry. |
| Mobile | Melody toolbar wraps and notes scroll without clipped controls. |

Real-browser verification is performed using synthetic samples and MIDI events; no physical MIDI or acoustic loopback. The adjacent compiler manifest and machine logs record actual check outcomes. F13 benchmark and F14 dependency updates are separate slices within the same PR. Historical missing attestations remain unresolved; this proof does not invent or waive them.

Validation: compiler PASS with 110/110 Chromium tests (26 new integrity regressions), 47/47 signal/audio assertions, eight contract checks and 15 architecture checks. The legacy benchmark also returned PASS, but that result remains invalid under F13 and is not evidence of DSP capacity. Audible envelope hashing and sample playback survive reload.
