# Task Proof — Playhead / Transport Synchronisation Integrity

task_id: 20260821-playhead-sync-integrity
spec_path: docs/qc/specs/20260821-playhead-sync-integrity.task.spec.json
completed_at_utc: 2026-08-21T19:14:00Z
author: claude-wa
commit_shas:
- (see gov:commit trailer)
attestation_path: docs/qc/proofs/20260821-playhead-sync-integrity/verdict.json

## Summary

Three transport↔UI synchronisation defects found by on-demand QC over
`b04dd33..df835b3`. All three were invisible to the existing gate set: every
contract, architecture and CI gate passed both before and after, because none
of them assert anything about *when* a visual update is delivered relative to
the audio it represents.

### 1. Playhead painted ahead of the audio (measured 49–91ms, median 83ms)

`scheduleStep()` emitted `engine:step` synchronously inside the
`Tone.Transport.scheduleRepeat` callback. That callback fires in the transport's
scheduling lookahead — Tone's own documentation states these callbacks "always
happen _before_ the scheduled time and are not synchronized to the animation
frame so they are not good for triggering tightly synchronized visuals and
sound."

Measured on the default pattern: the visual led the sound by 49–91ms
(median 83ms). A 16th-note step is 125ms at 120 BPM and 68ms at the app's
maximum 220 BPM, so the playhead ran roughly two-thirds of a step early at
default tempo and **more than a full step early** above ~180 BPM.

Fix: visual emission is routed through `Tone.getDraw().schedule(cb, time)`,
which re-times the callback onto the animation frame nearest the step's own
AudioContext time. Post-fix lead is single-digit milliseconds.

The audio path is untouched — `playSample()` still receives the same lookahead
`time`, and `engine:trigger` still carries schedule-time data, so inter-track
sample alignment is unchanged (verified by the pre-existing `Transport Sync`
stress test, still passing).

### 2. Phrase-view switch froze a lit playhead column permanently

`highlightStep()` early-returned when the playing phrase was not the phrase on
screen, setting `prevVisualStep = -1` **without clearing the column it had last
lit**. `updateDrumCell`/`updateMelCell`/`updateVocalCell` only restore `.active`
— they never remove `.playing`, and `refreshUI()` therefore could not recover
it either. Measured: 42 cells (one full column: 5 drum + 3×12 melody + 1 vocal)
stayed lit for the rest of the session, surviving Stop.

Fix: clear on the early-return path; clear on `transport:phraseChanged`; and
sweep any residual `.playing` on `engine:stop` as a backstop for columns that
`prevVisualStep` no longer tracks. The per-step fast path is unchanged — the
sweep runs only on stop and view-switch transitions.

### 3. `playing-phrase` song-pane marker never appeared at all

`setOnPhraseChange()` had **no caller anywhere in the codebase**, so the
scheduler's `onPhraseChange?.()` — invoked on start, on stop, and on every
automatic phrase advance — was permanently a no-op. `updateSongPane()` computes
`.playing-phrase` correctly, but nothing ever called it while the transport ran.
Measured: zero slots marked at rest, during playback, and after stop.

Fix: `setOnPhraseChange(updateSongPane)` wired in `main.ts`. The advance-path
notification is deferred to audio time alongside the step event, so the marker
moves with the sound rather than with the lookahead.

## Required Gates

| Gate | Required | Result | Evidence |
|---|---|---|---|
| `npm run gov:check -- --spec ...` | yes | PASS | `docs/qc/proofs/20260821-playhead-sync-integrity/verdict.json` |
| `npm run ci` | yes | PASS | `logs/O-CI.log` (exit 0) |
| `npm run e2e` | yes | PASS | `logs/O-E2E.log` — 74/74 passing |
| `npm run gate:e2e-delta` | yes | PASS | `logs/O-E2E-DELTA.log` |
| `npm run gate:contracts` | yes | PASS | `logs/O-GATE-CONTRACTS-FULL.log` — 8/8 |
| `npm run gate:architecture` | yes | PASS | `logs/O-GATE-ARCH-FULL.log` — 15/15 |
| `npm run gate:commit-range` | yes | PASS | `logs/O-COMMIT-RANGE.log` |
| `tests/audio-quality.html` | N/A | N/A | no audio-code change (`src/engine/audio.ts`, worklets, extensions untouched) |
| `tests/benchmark.html` | N/A | N/A | no worklet/benchmark change |

Debt ratchet: `baseline_total=11 | current_total=0 | delta=-11` — no increase.

## Contract Applicability

| Contract | Applies | Status | Evidence |
|---|---|---|---|
| `docs/contracts/commit.md` | yes | PASS | committed via `gov:commit` |
| `docs/contracts/quality-gates.md` | yes | PASS | all 6 compiler obligations PASS |
| `docs/contracts/governance-compiler.md` | yes | PASS | verdict PASS, 0 diagnostics |
| `docs/contracts/e2e.md` | yes | PASS | 3 added behavioural tests |
| `docs/contracts/architecture-invariants.md` | yes | PASS | 15/15; invariant 3 (dead interface) improved by wiring the dead callback |
| `docs/contracts/audio-determinism.md` | no | N/A | no audio-code change |
| `docs/contracts/adaptive-transfer.md` | no | N/A | no nonlinear processor change |
| `docs/contracts/use-of-color.md` | no | N/A | no colour/style change |

## Browser Verification

status: VERIFIED

Each of the three new tests was verified to **fail against the pre-fix
sources** and pass after, by stashing only `src/engine/scheduler.ts`,
`src/ui/playhead.ts` and `src/main.ts` and re-running the block — all three
failed; restored, all three passed. This rules out tautological tests.

Additionally the app was driven manually in a real browser (Vite dev server,
Chromium): sample browser resolved 553 samples, a kick sample loaded and played,
transport started and the playhead advanced and wrapped correctly, console clean.

## Notes

- **Discarded hypothesis (recorded for honesty).** An earlier suspicion that the
  final step of a song was truncated — `advancePhrase()` → `stopPlayback()` →
  `stopSequencerVoicesNow()` calling `src.stop(now)` on voices scheduled at a
  future `time` — was tested and **disproved**. `findNextPhrase()` wraps and
  never returns a negative index, so the song loops and never auto-ends; the
  measured `killedBeforeSounding` count was 0. No change made.
- **Consequence of the above:** `advancePhrase()`'s `if (next < 0)` branch is
  unreachable with the current `findNextPhrase()`. It is left in place as a
  defensive guard on the injected `TransportSource` interface (a different
  implementation could return -1), but it is dead against today's wiring.
- **Open observation, not fixed here (needs its own task).** The page creates
  **two** AudioContexts: one `suspended` with `currentTime` frozen at 0, and the
  live one. The existing test `AudioContexts are unique — Tone is bound to the
  engine context` patches `window.AudioContext` *after* page load and therefore
  cannot see the first context, giving false assurance. Capturing via
  `addInitScript` shows `ctxCount: 2, states: ['suspended', 'running']`. Not
  addressed in this task because touching audio initialisation binds the full
  `audio:gates` + oracle obligation set, which is a separate slice.
