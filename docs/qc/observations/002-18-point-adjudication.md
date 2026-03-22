# Observation 002 — 18-Point Architecture Adjudication

date_utc: 2026-03-21
branch: main
head_at_observation: 6d7e995
scope: GA governance, evidence-only

## Method

Each claim is rated:

- `CONFIRMED`: directly supported by current code.
- `PARTIAL`: core concern is valid, but claim contains overstatement/outdated detail.
- `REJECTED`: not supported by current code.

## Adjudication

### 1) "Fake master insert chain & dummy nodes"
status: `CONFIRMED`

Evidence:
- Registry enforces serial extension chaining on master path: `masterGain -> ext -> ext -> output` in [registry.ts](../../../src/engine/extensions/registry.ts):132,149,158.
- Reverb returns dummy pass node while routing internally via aux sends: [reverb.ts](../../../src/engine/extensions/reverb.ts):94,113,128-130.
- Delay does the same pattern: [delay.ts](../../../src/engine/extensions/delay.ts):98,111,132-134.
- Mixer also returns dummy pass while mutating channel faders directly: [mixer.ts](../../../src/engine/extensions/mixer.ts):39,145-147.

Risk: architectural mismatch hides real routing behavior and weakens determinism.

### 2) "Abandonment of engine interface contract"
status: `PARTIAL`

Evidence:
- Interface exists and claims decoupling: [interface.ts](../../../src/engine/interface.ts):6-7.
- Interface is unused anywhere else in `src/`: `rg` only finds declaration.
- Scheduler imports transport state directly: [scheduler.ts](../../../src/engine/scheduler.ts):10-12,80-85.
- Scheduler re-exports transport functions: [scheduler.ts](../../../src/engine/scheduler.ts):45-55.

Qualification:
- Decoupling claim is effectively broken.
- "Massive circular dependency" is not proven from these files alone.

Risk: interface theater; implementation coupling remains high.

### 3) "window.SEQ global state anti-pattern"
status: `CONFIRMED`

Evidence:
- Global `window.SEQ` is installed and exposes engine internals: [registry.ts](../../../src/engine/extensions/registry.ts):31-49,57-125.
- Extensions consume `window.SEQ` directly for raw nodes:
  - [reverb.ts](../../../src/engine/extensions/reverb.ts):94,113,116.
  - [delay.ts](../../../src/engine/extensions/delay.ts):98,111,117.
  - [mixer.ts](../../../src/engine/extensions/mixer.ts):39,135,172.

Risk: global mutable surface increases hidden coupling and side effects.

### 4) "CPU-heavy bypass + fake GR meter"
status: `PARTIAL`

Evidence:
- Disabled compressor leaves worklets connected; sets params instead of disconnecting: [compressor.ts](../../../src/engine/extensions/compressor.ts):350-360.
- GR meter loop runs every RAF and pins 0.0 dB placeholder: [compressor.ts](../../../src/engine/extensions/compressor.ts):115-127,118-123.

Qualification:
- "Fake meter" is accurate.
- "Always heavy 4x math" is partially overstated because saturation has fast bypass in worklet when drive/mix are near zero, but processor graph remains active.

Risk: off/on truthfulness ambiguity and wasted cycles.

### 5) "Fake benchmark processor"
status: `CONFIRMED`

Evidence:
- `benchmark-processor` measures nearly empty section (`performance.now()` around trivial ops): [benchmark-processor.ts](../../../src/engine/worklets/benchmark-processor.ts):44-50.
- It is loaded globally but not meaningfully wired as benchmark source in benchmark page: [worklet-loader.ts](../../../src/engine/worklet-loader.ts):11,31 and [tests/benchmark.html](../../../tests/benchmark.html):130-207.

Risk: deceptive performance evidence; invalid gate confidence.

### 6) "God-object state.ts anti-pattern"
status: `CONFIRMED`

Evidence:
- Large cross-cutting mutable module state in one file: [state.ts](../../../src/state.ts):24-156.
- Dozens of direct setter exports in same file: [state.ts](../../../src/state.ts):166-255.

Risk: weak ownership boundaries, high mutation surface area.

### 7) "Event bus abandoned in persistence"
status: `PARTIAL`

Evidence:
- Event bus includes song events: [events.ts](../../../src/events.ts):16-19.
- Persistence uses callback injection object instead of bus emits: [persistence.ts](../../../src/transport/persistence.ts):356-368.
- Callback hooks are consumed throughout persistence: [persistence.ts](../../../src/transport/persistence.ts):372,414-416,428-429,493,495-496.
- No usage of `setPersistenceCallbacks(...)` found in `src/` (dead wiring).

Qualification:
- Core concern (bus bypass) is valid.
- Claim that `main.ts` currently injects callbacks is not true on current HEAD.

Risk: lifecycle coupling plus currently unbound callback path.

### 8) "Ghost preview gain nodes"
status: `CONFIRMED`

Evidence:
- `playPreviewSample` creates a new gain node per preview and connects it to mix bus: [audio.ts](../../../src/engine/audio.ts):178-181.
- No disconnect/cleanup path for `previewGain`.

Risk: potential node accumulation and long-session degradation.

### 9) "Schrodinger AudioContext init"
status: `CONFIRMED`

Evidence:
- `initAudio()` called from many layers:
  - [main.ts](../../../src/main.ts):64
  - [scheduler.ts](../../../src/engine/scheduler.ts):162
  - [registry.ts](../../../src/engine/extensions/registry.ts):257
  - [engine-panel.ts](../../../src/ui/engine-panel.ts):114
  - [browser.ts](../../../src/ui/browser.ts):441
  - [audio.ts](../../../src/engine/audio.ts):190,200
  - [persistence.ts](../../../src/transport/persistence.ts):283

Risk: ownership ambiguity, hidden side effects, brittle startup sequencing.

### 10) "Silent decode failures"
status: `CONFIRMED`

Evidence:
- Decode failures are swallowed with null fallback and no user-visible signal:
  - [persistence.ts](../../../src/transport/persistence.ts):291-295
  - [persistence.ts](../../../src/transport/persistence.ts):307-311
  - [persistence.ts](../../../src/transport/persistence.ts):323-326

Risk: silent data loss / trust erosion.

### 11) "Placebo engine settings panel"
status: `PARTIAL`

Evidence:
- Runtime dropdowns (`buffer size`, `sample rate`, `oversampling`) only update local readouts: [engine-panel.ts](../../../src/ui/engine-panel.ts):31-34,391-410,562-595.
- Readout is computed from local vars, not actual AudioContext runtime: [engine-panel.ts](../../../src/ui/engine-panel.ts):391-403,709-723.
- However, engine has real native processing controls (filter/saturation/compression) applied to actual nodes: [engine-panel.ts](../../../src/ui/engine-panel.ts):36-47,98-110,119-147,642-660.

Qualification:
- "All controls are fake" is outdated.
- Runtime config controls are still largely placebo.

Risk: misleading operational telemetry.

### 12) "UI hardcodes extension DSP curves"
status: `REJECTED`

Evidence:
- Current engine panel controls local engine-owned nodes directly, not extension parameters: [engine-panel.ts](../../../src/ui/engine-panel.ts):12,36-47,98-110,642-660.
- No `setExtParam(...)` pattern remains in current file.

Risk: none for this specific claim on current HEAD.

### 13) "Destructive sequence-mode preview swap"
status: `CONFIRMED`

Evidence:
- During sequence mode preview, buffers are hot-swapped in live playback arrays: [browser.ts](../../../src/ui/browser.ts):474-478.
- Cancelling preview triggers re-decode of original sample data: [browser.ts](../../../src/ui/browser.ts):386-432,447-453.

Risk: runtime churn, decode load spikes, transient inconsistency.

### 14) "Inlined transport innerHTML template"
status: `CONFIRMED`

Evidence:
- Transport header is hardcoded via `innerHTML`: [build.ts](../../../src/ui/build.ts):327-334.
- Event binding then relies on `getElementById(...)` lookups: [build.ts](../../../src/ui/build.ts):543-560.

Risk: maintainability and handler fragility.

### 15) "Duplicate business logic in UI vs transport"
status: `CONFIRMED`

Evidence:
- Transport defines canonical functions:
  - `setMelodyCell`: [patterns.ts](../../../src/transport/patterns.ts):144-163.
  - `replicateTrack`: [patterns.ts](../../../src/transport/patterns.ts):236-271.
- UI defines parallel implementations:
  - `setMelodyCell`: [cells.ts](../../../src/ui/cells.ts):71-90.
  - `replicateTrack`: [painting.ts](../../../src/ui/painting.ts):95-140.

Risk: drift and repeated regressions.

### 16) "Event listener russian roulette"
status: `CONFIRMED`

Evidence:
- `setupPainting()` attaches document-level listeners without init guard: [painting.ts](../../../src/ui/painting.ts):144-247.
- `build.ts` explicitly warns duplicate registration breaks behavior: [build.ts](../../../src/ui/build.ts):657-659.

Risk: accidental double-init breaks interaction determinism.

### 17) "Inline CSS churn in playhead updates"
status: `CONFIRMED`

Evidence:
- Playhead loop writes inline styles every step across many cells:
  - set: [playhead.ts](../../../src/ui/playhead.ts):30-31,46-47,57-58
  - clear: [playhead.ts](../../../src/ui/playhead.ts):74-78,92-97,105-109
- Cell update helpers also write inline style per mutation: [cells.ts](../../../src/ui/cells.ts):22-27,39-44,54-59.

Risk: avoidable paint/layout overhead and style drift.

### 18) "PaintType empty-string sentinel"
status: `PARTIAL`

Evidence:
- `PaintType` includes `''`: [state.ts](../../../src/state.ts):18.
- Mouse logic uses `cell.dataset.type ?? ''` cast and compares to `paintType`: [painting.ts](../../../src/ui/painting.ts):152,207.

Qualification:
- Ambiguous sentinel exists.
- Current step/melody cells do set dataset.type in builder paths: [build.ts](../../../src/ui/build.ts):132,478,499.

Risk: latent ambiguity; low immediate exploitability but weak typing invariant.

## Net Assessment

Summary counts:

- `CONFIRMED`: 12
- `PARTIAL`: 5
- `REJECTED`: 1

Overall: the majority of concerns are valid and systemic. The architecture currently relies on mixed contracts, hidden global coupling, and several non-deterministic or misleading quality mechanisms.
