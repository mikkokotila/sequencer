# Findings on merged main cd2564c

Priorities describe observed impact; no product fixes are included in this QC branch. `pressure-results.json` records each reproduction and positive controls.

| ID | Priority | Reproduction / observed failure | Repair acceptance criterion |
|---|---|---|---|
| F01 | P1 | Export a pattern with a synthetic WAV, then import it: `ArrayBuffer` becomes `{}`; decoding fails and the track becomes silent. `persistence.ts:434` | Portable sample encoding, or explicit pattern-only semantics that preserve/relink audio; audible roundtrip regression. |
| F02 | P1 | Import negative BPM, phrase 99, or object-valued name: existing patterns are erased and invalid state is accepted. Malformed JSON only logs an error. `persistence.ts:488` | Validate the entire file before mutation; preserve prior state on failure; show actionable feedback. |
| F03 | P1 | Abort an IndexedDB transaction after its put request succeeds: `dbPut` resolves although the record does not exist. `persistence.ts:98` | Resolve on transaction completion; reject abort/error and surface failed autosaves. |
| F04 | P1 | Delay decoding older song A, finish newer B, then release A: name/id/sample belong to A while BPM belongs to B. `persistence.ts:230` | Stage decoded state and commit only the latest load; test overlapping UI imports and song loads. |
| F05 | P1 | Two isolated pages share one DB: A saves a rename, B saves BPM from stale state; A's saved name silently disappears. `persistence.ts:182` | Conflict/version detection or enforced single-editor ownership; no silent overwrite. |
| F06 | P1 | Enable ADSR with custom envelope and master gain 0.23, save/reload: ADSR resets off/default and master becomes 0.8. `persistence.ts:134`, `mixer.ts:221` | Persist and restore sound-defining controls, with audible as well as state assertions. |
| F07 | P2 | Delete the only stored song: its old id remains alongside a new song because `newSong()` first saves it again. `persistence.ts:415` | Deleted id remains absent after replacement and reload. |
| F08 | P1 | Poly track receives the same MIDI note twice then note-off/disconnect: one source remains alive. `midi.ts:276` | Every repeated-pitch voice has an owned lifecycle and can be stopped. |
| F09 | P1 | Mono track retriggers the same pitch; the prior source's ended callback deletes the replacement entry; note-off misses it. `midi.ts:280` | Identity-safe ended cleanup and a regression spanning the old ended event. |
| F10 | P2 | Set engine lowpass to 200 Hz, create New Song: filtering remains at 200 Hz. `engine-panel.ts:40`, `main.ts:94` | Define whether engine controls are global; if New Song promises a clean sound, include this processing in its reset and persistence policy. |
| F11 | P2 | Focus the sample-browser close button and press Space: global transport starts instead of activating the button normally. `main.ts:180` | Respect interactive/modal focus and native button keyboard behavior. |
| F12 | P2 | Deny IndexedDB or reject worklet download: initialization strands Play disabled with no visible recovery explanation. `main.ts:131`, `main.ts:150` | Visible initialization failure state and safe retry/recovery. |
| F13 | P1 | Inject two million sine iterations per quantum: blocks fall 1566→289, while both runs claim PASS/p99 2.667 ms. Timer absent; 128-frame rendering uses a 256-frame budget. See `benchmark-audit-results.json`. `tests/benchmark.html:137` | Measure actual product DSP compute cost; enforce the real 128-frame budget and all-effects workload. |
| F14 | P2 | npm reports eight dev-tool advisories (six high, two moderate); production-only audit reports zero. See both dependency audit JSON files. | Review reachable advisories and update affected tooling with normal build/browser regression coverage. |
