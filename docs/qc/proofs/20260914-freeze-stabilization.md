# Feature-freeze stabilization

The explicit user request to fix the reproduced freeze blockers overrides the default GA-only scope. This branch starts at f42cb8646e168f9cff2616c44f563f134a382c18 (origin/main after merged PR #49). This is one stabilization PR; no new product controls or features.

## Fixes

- Previously, generating one bar turned off the entire synth track's HARM setting. Untouched phrases therefore lost their extra harmony voice. Generation now marks only its own nonempty poly steps as complete written voicings. Global HARM, protected tracks and steps outside the selection retain their sound. Live playback, audition, phrase WAV and full-song WAV/MP3 use the same scoped setting.
- Step voicings follow clipboard, nudge, transpose, repeat, rhythm variations, section operations, undo and saved/portable data. Emptying a step clears its setting; a subsequent fresh manual note uses the track HARM default. Manual edits of an existing written voicing preserve it. Version 3 is derived for both stored records and portable files when the new setting is present, so older builds reject unsupported songs instead of silently changing their sound. Current imports accept versions 1, 2 and 3.
- Previously, key/mode changes and ordinary document restores removed the MIDI device binding. Edits and undo/redo now silence held notes and release tails without removing the input listener. Later key presses continue working. Song loads and unplug events still stop sources and disconnect the device. Late ended callbacks cannot release a newer voice's key ownership.

## Verification

Twelve new regression tests cover partial/protected selections; exact unchanged-phrase PCM (<1e-6 peak difference); matching live/phrase/full-export source rates; versioned GUI JSON import, IndexedDB reload and history; malformed import/clipboard atomicity; both repeat paths, section operations and all four rhythm variations; held/releasing MIDI voices, repeated edits/undo/redo, future input, late callbacks, song load and unplug. The existing generated-preview/Apply PCM regression now asserts that the track harmonies remain unchanged.

All 56 focused Chrome/Chromium tests pass (12 new stabilization regressions plus 44 existing composition regressions). All 12 new tests also pass in separately launched installed Google Chrome. Production build and static checks pass. Compiler-owned full Chrome regression, static/architecture/contract/commit-range gates and eight audio oracles are authoritative in the generated manifest, logs and verdict. No thresholds, contracts or governance policies are weakened.

Initial focused failures were fixture defects: raw JSON comparisons depended on object key order, and a low-level load used an exported file without an ID before calling saveSong (which correctly skips documents without a current ID). Corrected the stable data comparison and preserved the current song ID, then added an actual GUI file-import/save/reload check. These failures did not require production persistence semantics to change. The temporary installed-Chrome configuration initially served the temporary directory (404); setting its server working directory to the repo fixed the harness, and all 12 tests passed.

The existing song and sample library are untouched. S2400 export remains experimental pending physical hardware acceptance; these browser tests do not establish hardware compatibility. Historical feature requests and superseded PRs remain outside this stabilization slice.
