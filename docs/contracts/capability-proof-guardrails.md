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

## Proof Requirements

`proof` must include:

1. deterministic fixtures (built-in samples)
2. fixed seed
3. oracle list
4. oracle artifacts bound to compiler `subject_sha`

Mandatory minimum oracles for product tasks:

1. `off_transparent`
2. `on_audible`

Audio/control/persistence changes require extra diff-bound oracles from compiler rules.

## Guardrail Requirements

`guardrails` must include booleans:

1. `allow_fixme`
2. `allow_skip`
3. `allow_contract_edits`

Default policy for normal product tasks:

- `allow_fixme: false`
- `allow_skip: false`
- `allow_contract_edits: false`

## Truthfulness Standards

1. UI evidence alone is insufficient for audio-control tasks.
2. `off` must be acoustically transparent.
3. `on` must create intended audible effect.
4. low-end range continuity must be verified with dense near-zero sampling.
5. defaults must satisfy non-clipping safety limits.

## Required Paths and Templates

Use templates:

- `docs/qc/specs/TEMPLATE.task.spec.json`
- `docs/qc/proofs/TEMPLATE.proof.manifest.json`
- `docs/qc/proofs/TEMPLATE.md`

## Binding and Scope

Compiler checks that staged files match declared `in_scope`.
Unexpected files are blocking violations and must be split into separate tasks.
