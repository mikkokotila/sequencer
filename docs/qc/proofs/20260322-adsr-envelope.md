# Proof: ADSR Envelope

## Task
20260322-adsr-envelope

## Summary
Added per-track ADSR envelope controls to all 9 tracks. Each track header has an ADSR button that opens a popup with 4 vertical sliders (Attack, Decay, Sustain, Release) and a live canvas visualization showing the envelope shape in the track's color.

## New Files
- `src/engine/adsr.ts` — Envelope state, Web Audio gain automation (applyEnvelope, triggerRelease, resetAllAdsr)
- `src/ui/adsr-popup.ts` — Popup UI with canvas visualization and vertical sliders

## Modified Files
- `src/engine/audio.ts` — playSample() accepts trackIndex + stepDuration for ADSR
- `src/engine/scheduler.ts` — passes trackIndex and step duration to all playSample calls
- `src/engine/midi.ts` — uses ADSR for note-on (attack/decay/sustain) and note-off (release)
- `src/ui/build.ts` — ADSR button on all 9 track headers, Escape handler
- `src/main.ts` — buildAdsrPopupDOM(), resetAllAdsr() on song lifecycle
- `index.html` — CSS for .adsr-btn, .adsr-popup, .adsr-canvas, vertical sliders
- `e2e/sequencer.spec.ts` — 6 new ADSR tests (58 total)
- `README.md` — updated description, project structure, test count
- `docs/Audio-Engine-Spec.md` — added ADSR envelope section

## Default Transparency
At defaults (A=5ms, D=100ms, S=100%, R=100ms), behavior is nearly identical to pre-ADSR — instant attack, full sustain, short release.
