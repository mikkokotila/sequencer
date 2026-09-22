# Explicit export destinations

The user requested existing song JSONs in `~/Documents/songs`, future song JSON exports in the same folder, and other sequencer downloads in `~/Documents`. They explicitly confirmed that filesystem writes happen only with Export. The product request overrides the default GA-only scope. This related export slice continues the still-open PR #51 and preserves its cancellation-diagnostics fix.

## Result

- The dev and preview server publish explicit song JSON exports in Documents/songs and WAV, MP3, loop ZIP and S2400 ZIP exports in Documents. Editing and IndexedDB autosave do not write filesystem exports.
- A shared async save API returns the actual destination. The GUI displays that path; network, permission and disk failures remain visible. Static deployments without the endpoint retain browser downloads. The existing download API is now asynchronous, documented with `await`.
- UTF-8 filenames retain accents and are bounded by byte length. Existing files are never replaced: concurrent repeated exports obtain numbered filenames through atomic exclusive publication. Uploads stream into private temporary files; interrupted or rejected uploads clean up without publishing partial exports.
- The endpoint accepts only loopback clients and local Host values, checks browser Origin/fetch-site and requires an explicit custom request header. File categories choose the directory server-side. Traversal, unsupported extensions, symlink escape and oversized payloads are rejected. No arbitrary file paths are accepted.
- The normal Playwright server explicitly uses browser download mode to preserve existing download coverage without writing to the user's Documents. New integration tests run real servers against isolated temporary Documents directories.

## Validation

69 focused Chromium regressions pass, covering the 14 new destination cases plus existing song export, S2400 and persistence/package integrity coverage. All 14 new tests also pass in installed Google Chrome on the final implementation. Production build and static checks pass. The compiler-owned full suite, contracts, architecture, commit-range checks and audio oracles are authoritative in the generated manifest, logs and verdict.

New coverage includes actual GUI JSON exports with embedded WAV bytes, no JSON after ordinary save, WAV/MP3/S2400/loop files in Documents, concurrent filename collisions, long Unicode names, dev/preview parity, static-host fallbacks, permission denial, broken destination repair, interrupted upload cleanup, cancellation during saving, and host/origin/client/path/type/size boundaries. Initial failures were fixture defects: the JSON fixture used a base64 string where in-memory SampleData requires an ArrayBuffer; Node fetch ignored an overridden Host header, so the adversarial Host test now uses a raw HTTP request. No production validation was weakened.

The actual in-app GUI was restored using its existing Retry startup control after a transient worklet fetch error during Vite restart. It loaded PLEIN RÉGIME at 96 BPM. Clicking Export Pattern saved `/Users/mikkokotila/Documents/songs/PLEIN RÉGIME.json`; parsing the real file confirmed its name, 96 BPM, 36 phrases and embedded sample data. The song was not imported, reset or edited. No audio DSP or song arrangement changes are included.

## Existing files moved

The original `plein-regime.sequencer.json` was moved to Documents/songs. `plein-regime-project.zip` and `LE-FEU-RESTE-S2400.zip` were moved to Documents. Each destination was created exclusively and verified against its source before removing the old copy. The composition helper now writes its song JSON into Documents/songs. These personal artifacts remain outside Git.

The first full compiler run passed 236 tests and all eight audio oracles but failed two legacy production tests. Their preview server still used the new local-save default while the assertions expected browser download events; its broad sample route also intercepted the WAV save URL. The production fixture now explicitly selects browser mode for those unchanged download assertions, narrows sample interception to WAV pathnames, and confines every preview instance to a temporary Documents directory. A third production GUI test verifies the built application's local JSON save path. All three production tests pass. The one positively identified Untitled/48-phrase fixture file written during the failed run was moved out of the user's songs folder into the task QC archive; personal songs were retained. Required validation is rerun after this fixture correction.
