# Proof: MIDI Device Connectivity

## Task
20260321-midi-device-connectivity

## Summary
Added Web MIDI API integration allowing melody/synth tracks to connect to MIDI input devices for live sample playback at pitched rates.

## New Files
- `src/engine/midi.ts` — MIDI input management (engine layer, no DOM)
- `src/ui/midi-browser.ts` — MIDI device browser modal (UI layer)

## Modified Files
- `src/events.ts` — added midi:connected, midi:disconnected, midi:devicesChanged events
- `src/ui/build.ts` — MIDI button on melody track headers + event subscriptions
- `src/main.ts` — MIDI init, browser DOM construction, song lifecycle cleanup
- `index.html` — CSS for .midi-btn and .midi-overlay families
- `e2e/sequencer.spec.ts` — 6 new MIDI Controls tests
- `README.md` — updated description, project structure, test count

## Gate Results

| Gate | Result |
|------|--------|
| npm run ci | PASS (typecheck + lint + format + circular deps) |
| npm run e2e | PASS (51 tests: 45 existing + 6 new) |
| Browser verification | PASS (preview screenshot confirmed) |

## Oracle Results

| Oracle | Result | Evidence |
|--------|--------|----------|
| off_transparent | PASS | No audio nodes created when MIDI disconnected |
| on_audible | PASS | Note-on creates BufferSource → velocityGain → trackGain chain |

## Architecture Compliance
- No dummy nodes (MIDI creates real BufferSource + GainNode per note)
- No window.SEQ usage (midi.ts imports from canonical modules)
- Proper cleanup (disconnectMidiFromTrack stops all voices, removes listener)
- Event-driven (uses event bus for connected/disconnected/devicesChanged)
- Idempotent init (initMidi guards with `if (midiAccess) return true`)
