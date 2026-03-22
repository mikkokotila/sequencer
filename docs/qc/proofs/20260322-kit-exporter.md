# Proof: Kit Exporter

## Task
20260322-kit-exporter

## Summary
Added kit export button to transport bar. When clicked, all loaded samples are bundled into a ZIP file named `{songName}-bundle.zip` and downloaded. Each sample file retains its original name inside the bundle folder.

## Implementation
- `src/transport/kit-export.ts`: Minimal ZIP builder using raw binary construction (no external dependencies). Creates stored/uncompressed ZIP entries with CRC-32 checksums.
- `src/ui/build.ts`: Added export kit button after save/load buttons in file-btns group.
- 4 E2E tests: button visibility, title attribute, click/no-throw behavior, and no-download-when-empty guard.

## Verification
- CI: PASS (64/64 E2E tests)
- Preview: button visible in transport bar
