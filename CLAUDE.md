# Contract Routing

Read the relevant contract BEFORE starting work. Not all contracts apply to every task.

## Always

**Read:** `docs/contracts/commit.md`
Every completed change gets a conventional commit.

**Run:** `npm run ci`
Every completed change must pass all four CI gates (typecheck, lint, format, circular). Read `docs/contracts/quality-gates.md` for details.

**Run:** `npm run e2e`
Every completed change must pass all E2E tests. Read `docs/contracts/e2e.md` for details. Every new feature or bug fix must add corresponding tests.

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
Run `tests/audio-quality.html` after changes. All 25 assertions must pass.
Run `tests/benchmark.html` after worklet/DSP changes. p99 must be within budget.

## When writing or modifying nonlinear audio processors

Applies to: compressor, saturation, waveshaper, tape emulation, transformer — any processor that distorts, clips, or shapes the signal nonlinearly.

**Read:** `docs/contracts/adaptive-transfer.md`
Transfer function must vary with input level/frequency/history. Static curves are rejected.

## When changing colors, styles, or visual identity

Applies to: CSS in `index.html`, track colors, extension panel styling, grid cell colors, text colors.

**Read:** `docs/contracts/use-of-color.md`
Three color families. Controls are monochrome. No color for decoration.

## When changing app structure, features, or architecture

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
