# Governance Compiler Contract

## Mandate

Every task must pass the Governance Compiler before commit.
The compiler is the authoritative source of task completion.

`governance-change` tasks are GA-only.
WA may not run governance-change tasks.

Run:

```bash
npm run gov:check -- --spec docs/qc/specs/<task-id>.task.spec.json
```

Commit through:

```bash
npm run gov:commit -- --spec docs/qc/specs/<task-id>.task.spec.json -m "type(scope): description"
```

GA wrappers:

```bash
npm run gov:check:ga -- --spec docs/qc/specs/<task-id>.task.spec.json
npm run gov:commit:ga -- --spec docs/qc/specs/<task-id>.task.spec.json -m "type(scope): description"
```

## Compiler Phases

1. `parse` - validate task spec schema.
2. `bind` - map staged diff to contract obligations.
3. `synthesize` - generate mandatory proof obligations from diff.
4. `execute` - run required command gates and collect artifacts.
5. `verify` - evaluate diagnostics and final verdict.
6. `attest` - write `docs/qc/proofs/<task-id>/verdict.json`.
7. `qc-audit` - write deterministic machine + human audit trail in `docs/qc/runs/`.

During `execute`, obligations are split:

1. `task_regression` (blocking)
2. `global_debt` (blocking, zero-tolerance in full mode)
3. `oracle_harness` (compiler-owned, in-memory custody)
4. `debt_ratchet` (blocking policy over baseline totals)

For product diffs, compiler binds both:

1. `O-E2E` (`npm run e2e`)
2. `O-E2E-DELTA` (`npm run gate:e2e-delta`)

## Verdict Policy

Allowed verdicts:

- `PASS`
- `FAIL`
- `BLOCKED`
- `ERROR`

Any verdict other than `PASS` blocks completion and commit.

## Mandatory Remediation Loop

When verdict is not `PASS`, WA must follow this loop:

1. Read the highest-severity diagnostic (`ERROR` > `BLOCKED` > `FAIL`).
2. Apply one `acceptable_recipe` from that diagnostic.
3. Re-run `npm run gov:check -- --spec <same-spec>`.
4. Repeat until verdict is `PASS`.

Direct commit attempts before `PASS` are non-compliant.

Root-cause rule:

1. Do not optimize for gate text or bypass behavior.
2. Do not weaken gates to make failures disappear.
3. Fix the underlying cause and prove it with deterministic evidence.

## Operator Escalation Protocol

If the same blocking diagnostic repeats and remediation reveals an actual contract/runtime conflict (for example, an environment cannot satisfy a contract as written), WA must pause and escalate instead of inventing workarounds.

Compiler enforces this with `GOV-PROC-007` when repeated gate failures are detected for the same task/spec/command window.

Required escalation artifact:

1. `docs/qc/proofs/<task-id>/operator-guidance.md`

Artifact must include:

1. repeated diagnostic code(s) and failing command(s)
2. exact evidence/log paths
3. why root-cause remediation is blocked in current environment
4. requested operator decision (policy/profile/infrastructure direction)

Until operator guidance is provided, task remains non-complete and uncommitted.

## Stand-Down Lock Protocol

Compiler enforces mid-task termination via `docs/qc/standdown/active.json`.

1. If lock status is `ACTIVE`, product tasks are blocked with `GOV-PROC-008`.
2. Stand-down lock is released only by operator clearing the lock.
3. While lock is active, WA must remain paused and non-committing.

## GA Override

Compiler blocks `task_type=governance-change` unless GA override is provided.

Accepted override channels:

1. CLI flag `--allow-governance-change`
2. environment `GOV_ALLOW_GOVERNANCE_CHANGE=1`

Without override, compiler emits `GOV-ROLE-001` and blocks task.

## Execution Profiles

Compiler resolves benchmark oracle policy by `execution_profile`.

1. Allowed value: `real`
2. `execution_profile` is read from `task.spec.json`
3. Benchmark-governed tasks must declare `execution_profile` explicitly

Profile behavior:

1. `real`: requires real `process()` timing oracle threshold (`sample_count >= 50` and `p99 <= budget`) and structural integrity safeguards.

## Anti-Deception Rules

1. Obligation selection is diff-derived, not author-selected.
2. Product tasks may not modify governance policy files.
3. Governance-change tasks may not include product files.
4. Compiler invokes oracle harness directly and captures payload in-memory.
5. Oracle artifacts are written by compiler after payload verification.
6. Required proof artifacts are hash-verified against raw evidence.
7. Missing proof artifact is always `BLOCKED`.
8. Compiler-managed artifacts (`docs/qc/specs/**`, `docs/qc/proofs/**`, `logs/compiler.log`) do not count as governance-policy edits in feature tasks.
9. Governance scripts must have clean staged state (no unstaged drift) before compiler executes.
10. Product tasks cannot increase full-scan global debt relative to frozen baseline.
11. Debt-burn tasks with `guardrails.require_debt_reduction=true` must reduce total debt by at least one finding.
12. Static source gates must be toolchain-independent and in-process (no shell `rg/grep` dependency for verdict logic).
13. Source-structure assertions must use AST semantics, not brittle token/line matching.
14. Governance self-tests (`npm run gate:governance-self`) must pass and enforce these anti-regression constraints.

## Global Debt Ratchet

Frozen baseline path:

- `docs/qc/debt/baseline.json`

Ratchet rules:

1. For all product tasks (`feature|bugfix|refactor`), current full-scan debt must be `<= baseline`.
2. If `guardrails.require_debt_reduction=true`, current full-scan debt must be `< baseline`.
3. Baseline file is governance-owned and not editable in product debt-burn tasks.

## Required Artifacts

Per task, required files:

1. `docs/qc/specs/<task-id>.task.spec.json`
2. `docs/qc/proofs/<task-id>/proof.manifest.json`
3. `docs/qc/proofs/<task-id>/verdict.json`
4. `docs/qc/proofs/<task-id>.md` (human summary)

Global compiler audit trail:

5. `logs/compiler.log` (append-only warning/error trail)

## Prescriptive Diagnostics

Diagnostic metadata is machine-readable in:

- `docs/qc/compiler/diagnostics.json`

Each diagnostic includes:

1. why failure happened
2. acceptable remediation recipes
3. disallowed workarounds
4. required evidence
5. allowed/forbidden change scope
6. exact recheck protocol

Compiler diagnostics are not advisory text. They are mandatory instructions for the next remediation step.

## Immutable Audit Trail

Compiler warnings/errors are appended to `logs/compiler.log` as JSONL entries with a hash-chain:

1. each entry stores `prev_hash`
2. each entry hash is `sha256(entry_without_hash)`
3. chain starts at genesis hash of 64 zeroes
4. compiler verifies existing chain before appending new entries

If chain verification fails, compiler exits with `GOV-PROC-003`.

## Subject Hash Model

Oracle artifacts bind to `subject_sha`, not full staged tree SHA.

`subject_sha` is computed from staged product files only, excluding compiler-managed artifacts.
This removes self-referential tree loops for proof/oracle files.

## Oracle Evidence Policy

Manual/self-asserted oracle evidence is not accepted.

1. `harness_version` values beginning with `manual` are compiler-blocked.
2. WA must not submit disk-authored oracle JSON as proof input.
3. Compiler executes harness and verifies payload challenge-response in the same run.
4. Oracle artifacts must be generated by deterministic machine harnesses with hash-verifiable raw outputs.
5. Replay resistance is enforced via one-time compiler challenge bound to task id, subject hash, profile, and oracle payload digest.

## Index-Snapshot Harness Execution

Compiler runs oracle harness from a git-index snapshot for the staged tree when available.

1. Snapshot source: `git write-tree` + `git archive`.
2. Harness reads repo content from snapshot root (`--repo-root`), not mutable working tree paths.
3. If governance scripts have unstaged edits, compiler blocks with `GOV-PROC-009` before harness execution.

## CI and Enforcement

`gov:check` is required before completion.
`gov:commit` is the standard commit path because it attaches attestation trailers.
`npm run gate:commit-range` enforces that product commits contain valid governance trailers and a PASS attestation.

Authoritative remote check:

1. GitHub workflow `compiler-gate` (`.github/workflows/compiler-gate.yml`) executes compiler policy in CI.
2. `main` must require `compiler-gate` to pass on the latest PR head SHA before merge.

## Remote Completion Enforcement

Local pass is necessary but not sufficient for task completion.

After `gov:commit`:

1. Push the commit immediately: `git push origin HEAD`.
2. Ensure the current branch has an open PR to `main`.
3. If no PR exists, create one immediately:
   - `gh pr create --base main --head <current-branch> --fill`
4. Keep all subsequent task commits on the same branch/PR until merge.
5. Wait for required CI checks and review feedback to land on that PR.
6. Address every review conversation in-thread (fix + reply, or explicit no-fix rationale).
7. Run `npm run gate:pr-ready` and require `PASS` before reporting task completion.

Branch-splitting policy:

1. One task lifecycle = one active branch.
2. Switching to a second branch to continue the same task is non-compliant.
