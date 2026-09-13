# Package-local sample library

The user explicitly requested gitignored `samples/drums` and `samples/synths` directories in the package root. This authorizes the product configuration and UI path fix despite the default governance-only scope. Work starts from merged PR #41 on latest main (`d3cd6a1`).

The sample middleware now serves only WAV paths under these two canonical roots in development and preview. The former external-root override is removed. The tracked manifest rebases all 1,830 drum entries and 159 synth entries; every synth entry now preserves the actual instrument/preset subfolders in the copied library. The browser displays the sample basename and encodes each path segment separately. The local folder names were normalized to lowercase; audio content was not altered. `/samples/` is explicitly ignored; legacy root links are also ignored.

Validation completed before compiler execution:
- All 1,989 manifest entries resolve to readable RIFF/WAVE files in the local library.
- Real drum and nested synth HTTP requests return 200 with `audio/wav`.
- Five targeted tests pass: read failures/recovery/traversal protection, denial feedback, dev server routing, preview server routing, and nested synth display/load.
- Typecheck, lint, formatting, and circular dependency checks pass.
- Real-browser verification performed in the actual app: BD 909 Clean 01 and Fuzz Bass Mirage previews decode; loading the nested bass closes the browser and updates its title. A separate NEON SAUVAGE - Library song uses nine unmodified local WAVs, plays with active meters, emits no console warnings/errors, and survives reload with its samples and settings intact.

The first full compiler run passed all 122 Chrome E2E tests and all four runtime oracles, but correctly failed because `samples.json` lacked a contract binding. The separately attested sample-manifest-binding repair adds this file to the product group without weakening checks.

The CI tests use temporary synthetic fixtures and route fixtures; licensed WAV files and song exports are never staged or published. Historical QC debt and the baseline are unchanged. Full required-check results are recorded by the compiler-owned verdict and log.
