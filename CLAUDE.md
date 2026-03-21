# Contract Routing

Read the relevant contract BEFORE starting work. Not all contracts apply to every task.

## Always

**Read:** `docs/contracts/commit.md`
Every completed change gets a conventional commit.

**Run:** `npm run verify`
Every completed change must pass the full programmatic gate set:
- `npm run ci`
- `npm run e2e`
- `npm run gate:contracts`
- `npm run gate:architecture`
Read `docs/contracts/quality-gates.md` and `docs/contracts/e2e.md` for details.

**Write:** `docs/qc/proofs/<task-id>.md`
Every completed task must include a committed proof artifact with:
- task id
- commit SHA(s)
- required gate results
- contract applicability checklist
- browser verification status

## When changing audio code

Applies to: any file in `src/engine/`, `src/engine/worklets/`, `src/engine/extensions/`.

**Read:** `docs/contracts/quality-gates.md`
**Read:** `docs/contracts/audio-determinism.md`
**Run:** `npm run audio:gates`
This runs browser automation for:
- `tests/audio-quality.html`
- `tests/e2e-signal.html`
- `tests/signal-purity.html`
- `tests/benchmark.html`

Audio changes are blocked if these fail or if `npm run gate:contracts` reports:
- non-deterministic/default-state risks
- off/on semantics regressions
- control-curve regressions
- unresolved `test.fixme` or informational assertions

## When writing or modifying nonlinear audio processors

Applies to: compressor, saturation, waveshaper, tape emulation, transformer — any processor that distorts, clips, or shapes the signal nonlinearly.

**Read:** `docs/contracts/adaptive-transfer.md`
Transfer function must vary with input level/frequency/history. Static curves are rejected.

## When changing colors, styles, or visual identity

Applies to: CSS in `index.html`, track colors, extension panel styling, grid cell colors, text colors.

**Read:** `docs/contracts/use-of-color.md`
Three color families. Controls are monochrome. No color for decoration.

## When changing app structure, features, or architecture

**Read:** `docs/contracts/architecture-invariants.md`
**Update:** `README.md`
Keep the signal flow diagram, project structure, and feature descriptions current. README must always reflect the actual state of the app.

## When running on-demand QC

**Read:** `docs/qc/baseline.md`
Default reviewed range is `baseline_sha..HEAD`.

**Inspect:** commits and `docs/qc/proofs/*.md`
QC is evidence inspection unless explicitly asked to rerun gates.

**Write:** `docs/qc/runs/<timestamp>-<headsha>.md`
Include:
- reviewed commit range
- commit list
- contract/gate matrix (`PASS | FAIL | BLOCKED`)
- blocker evidence
- final verdict

**Update:** `docs/qc/baseline.md`
Advance `baseline_sha` only when final verdict is `PASS`.
