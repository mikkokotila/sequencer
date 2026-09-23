# Refresh PR #34: original sample-kit export

The user authorized bringing PR #34 to merge readiness, including integration with current main, the Documents save path and actual ZIP-content verification. This product request overrides the default GA-only scope. A merge preserves both current main and the original PR history without rewriting the remote branch. Historical kit proof artifacts are retained as historical evidence; this task's manifest and verdict cover the final implementation.

## Result

Export Sample Kit snapshots every loaded drum, synth and vocal sample, including muted/unused tracks, and saves their original bytes in a named bundle folder. The exporter reuses the current shared ZIP writer and asynchronous export API. Local dev/preview saves ZIPs in Documents; static hosting retains browser downloads. Existing ZIPs get numbered filenames. The button prevents duplicate clicks during saving, reports the actual destination or an actionable failure, and allows retry. Empty kits produce no file and report that a sample must first be loaded.

Unsafe path components and characters are removed from bounded filenames; Unicode is retained. Duplicate names, including case-insensitive and canonical Unicode equivalents, receive distinct suffixes. Names and bytes are fixed before asynchronous saving, so later song edits cannot alter an in-flight export. No audio or arrangement changes are made. Existing raw samples are exported, with no rendering, effects, pitch or envelope processing.

## Validation

Seven dedicated real-browser integration tests cover local Documents saves, every byte on all nine tracks, preservation of previous exports, names and extraction safety, empty-kit recovery, server failure and retry, static-host download fallback, in-flight edits/duplicate-click prevention, and programmatic results/rejections. Python's independent zipfile reader checks the central directory, UTF-8 flags and every CRC before comparing source bytes. The production GUI regression loads a generated 16-bit WAV through the sample browser and verifies its kit entry equals the exact original WAV. All filesystem tests use temporary folders; the user's song and exports are untouched.

The compiler-owned full suite, static/contract/architecture/commit-range checks and eight audio/control oracles are authoritative in the manifest, logs and verdict. No required check is skipped or weakened. Governance policy/runtime infrastructure remains identical to current main; the compiler log conflict uses main's intact hash chain, with prior branch history preserved in Git.

Seven kit tests also pass in installed Google Chrome. The ten focused Chromium kit/production tests, production build, type/lint/format and circular checks all pass.
