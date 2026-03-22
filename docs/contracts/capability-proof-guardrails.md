# Capability-Proof-Guardrails Contract

## Mandate

Every task spec must explicitly define three layers:

1. `capability` - what slice is being built.
2. `proof` - deterministic evidence proving it works.
3. `guardrails` - constraints that prevent regressions and deception.

No task may complete without all three layers.

## Capability Requirements

`capability` must include:

1. summary
2. `in_scope` file patterns
3. `out_of_scope` file patterns
4. control truth table (`id`, `default`, `range`, `off_semantics`, `on_semantics`)

For benchmark-governed tasks, task spec must also declare top-level `execution_profile` (`headless` or `interactive`).

## Proof Requirements

`proof` must include:

1. deterministic fixtures (built-in samples)
2. fixed seed
3. oracle list
4. oracle artifacts bound to compiler `subject_sha`
5. machine-generated oracle outputs (`harness_version` must not be manual)
6. compiler-owned harness custody (oracle payload produced during `gov:check`, not CA-authored disk submission)

Mandatory minimum oracles for product tasks:

1. `off_transparent`
2. `on_audible`

Audio/control/persistence changes require extra diff-bound oracles from compiler rules.
Manual narrative oracle evidence is blocking and must be replaced with deterministic harness output.
Manual disk-authored oracle JSON as proof input is non-compliant.

## Guardrail Requirements

`guardrails` must include booleans:

1. `allow_fixme`
2. `allow_skip`
3. `allow_contract_edits`
4. `require_debt_reduction` (optional, default `false`)

Default policy for normal product tasks:

- `allow_fixme: false`
- `allow_skip: false`
- `allow_contract_edits: false`
- `require_debt_reduction: false`

Debt-burn tasks set:

- `require_debt_reduction: true`

## Truthfulness Standards

1. UI evidence alone is insufficient for audio-control tasks.
2. `off` must be acoustically transparent.
3. `on` must create intended audible effect.
4. low-end range continuity must be verified with dense near-zero sampling.
5. defaults must satisfy non-clipping safety limits.
6. failing gates must be solved at root cause; gate-text workarounds are non-compliant.

## Required Paths and Templates

Use templates:

- `docs/qc/specs/TEMPLATE.task.spec.json`
- `docs/qc/proofs/TEMPLATE.proof.manifest.json`
- `docs/qc/proofs/TEMPLATE.md`

## Binding and Scope

Compiler checks that staged files match declared `in_scope`.
Unexpected files are blocking violations and must be split into separate tasks.
