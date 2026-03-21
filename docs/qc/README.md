# QC Artifact Structure

- `baseline.md` — default QC range anchor (`baseline_sha..HEAD`).
- `specs/` — per-task capability/proof/guardrails specs.
- `observations/` — baseline and follow-up system observations.
- `proofs/` — per-task completion evidence artifacts.
- `runs/` — on-demand QC run outputs and verdicts.
- `logs/compiler.log` — append-only hash-chained compiler warning/error audit log.

Rules:

1. Missing required proof artifact is a blocking QC violation.
2. QC baseline advances only on a `PASS` verdict.
3. `docs/qc/proofs/<task-id>/verdict.json` is compiler-generated and required.
4. Compiler audit log chain must remain valid; tampering blocks compiler execution.
