# Governance Compiler Contract

## Mandate

Every task must pass the Governance Compiler before commit.
The compiler is the authoritative source of task completion.

Run:

```bash
npm run gov:check -- --spec docs/qc/specs/<task-id>.task.spec.json
```

Commit through:

```bash
npm run gov:commit -- --spec docs/qc/specs/<task-id>.task.spec.json -m "type(scope): description"
```

## Compiler Phases

1. `parse` - validate task spec schema.
2. `bind` - map staged diff to contract obligations.
3. `synthesize` - generate mandatory proof obligations from diff.
4. `execute` - run required command gates and collect artifacts.
5. `verify` - evaluate diagnostics and final verdict.
6. `attest` - write `docs/qc/proofs/<task-id>/verdict.json`.

## Verdict Policy

Allowed verdicts:

- `PASS`
- `FAIL`
- `BLOCKED`
- `ERROR`

Any verdict other than `PASS` blocks completion and commit.

## Anti-Deception Rules

1. Obligation selection is diff-derived, not author-selected.
2. Product tasks may not modify governance policy files.
3. Governance-change tasks may not include product files.
4. Required proof artifacts are hash-verified against raw evidence.
5. Missing proof artifact is always `BLOCKED`.

## Required Artifacts

Per task, required files:

1. `docs/qc/specs/<task-id>.task.spec.json`
2. `docs/qc/proofs/<task-id>/proof.manifest.json`
3. `docs/qc/proofs/<task-id>/verdict.json`
4. `docs/qc/proofs/<task-id>.md` (human summary)

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

## CI and Enforcement

`gov:check` is required before completion.
`gov:commit` is the standard commit path because it attaches attestation trailers.
