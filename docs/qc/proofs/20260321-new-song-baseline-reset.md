# Proof: Deterministic New Song Baseline Reset

## Task
20260321-new-song-baseline-reset

## Summary
newSong() now calls resetAllExtensions() which resets every extension to canonical default parameters with _enabled=false. This prevents prior tone state from carrying over into new songs, satisfying the audio-determinism contract requirement.

## Changes

### src/engine/extensions/store.ts
- Added `CANONICAL_DEFAULTS` map defining initial state for all 6 extensions
- Added `resetAllExtensions()` function that iterates SEQ_EXTENSIONS, calls setState(defaults), sets _enabled=false, calls setEnabled(false)

### src/transport/persistence.ts
- Added `resetAllExtensions()` call in `newSong()` after clearing buffers and before saving
- Import from store.ts (no circular dependency)

### e2e/sequencer.spec.ts
- Replaced `test.fixme('new song clears patterns')` with passing `test('new song resets patterns and extensions deterministically')`
- Test enables an extension, clicks a cell, creates new song, verifies cell cleared AND extension toggle is OFF

## Gate Results

| Gate | Result |
|------|--------|
| npm run ci | PASS |
| npm run e2e | PASS (52 tests, 0 skipped) |
| circular deps | PASS (no cycles) |

## Oracle Results

| Oracle | Result | Key Metric |
|--------|--------|------------|
| off_transparent | PASS | delta_lufs = 0.0 |
| on_audible | PASS | delta_lufs = 6.0 |
| clip_guard | PASS | clip_count = 0 |
| default_safety | PASS | peak_dbfs = -1.94 |

## Save/Load Roundtrip
Extension state roundtrip is verified by the existing persistence system:
1. `collectSongData()` serializes `ext.getState()` + `ext._enabled` for each extension
2. `loadSong()` calls `ext.setState(s)` + `ext.setEnabled(s._enabled)` for each extension
3. After `newSong()` → `saveSong()`, the saved state contains canonical defaults + `_enabled=false`
4. Loading that song restores exactly the same defaults
