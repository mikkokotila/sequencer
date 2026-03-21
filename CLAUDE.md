# Contract Routing

Read the relevant contract BEFORE starting work. Not all contracts apply to every task.

## Always

**Read:** `docs/contracts/commit.md`
**Read:** `docs/contracts/quality-gates.md`
**Read:** `docs/contracts/governance-compiler.md`
**Read:** `docs/contracts/capability-proof-guardrails.md`

### Required Task Staging

Before coding, create task spec:

- `docs/qc/specs/<task-id>.task.spec.json`

Spec must define:

1. capability
2. proof
3. guardrails

Before commit, ensure proof artifacts exist:

1. `docs/qc/proofs/<task-id>/proof.manifest.json`
2. `docs/qc/proofs/<task-id>/verdict.json` (written by compiler)
3. `docs/qc/proofs/<task-id>.md`

### Required Commands

1. Stage intended files only.
2. Run compiler:
   - `npm run gov:check -- --spec docs/qc/specs/<task-id>.task.spec.json`
3. If and only if compiler verdict is `PASS`, commit with:
   - `npm run gov:commit -- --spec docs/qc/specs/<task-id>.task.spec.json -m "type(scope): description"`

Compiler determines which gates must run from staged diff (`ci`, `e2e`, `gate:contracts`, `gate:architecture`, `audio:gates`).

## When changing audio code

Applies to: any file in `src/engine/`, `src/engine/worklets/`, `src/engine/extensions/`.

**Read:** `docs/contracts/audio-determinism.md`

Compiler-bound requirements include:

- `npm run audio:gates`
- audio oracle artifacts (`off_transparent`, `on_audible`, `low_end_continuity`, `clip_guard`, `default_safety`)
- deterministic fixtures + fixed seed

## When writing or modifying nonlinear audio processors

Applies to: compressor, saturation, waveshaper, tape emulation, transformer, and other nonlinear processors.

**Read:** `docs/contracts/adaptive-transfer.md`

## When changing colors, styles, or visual identity

Applies to: CSS in `index.html`, track colors, extension panel styling, grid cell colors, text colors.

**Read:** `docs/contracts/use-of-color.md`

## When changing app structure, features, or architecture

**Read:** `docs/contracts/architecture-invariants.md`
**Update:** `README.md`

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
