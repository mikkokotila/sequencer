# QC Artifact Structure

- `baseline.md` — default QC range anchor (`baseline_sha..HEAD`).
- `specs/` — per-task capability/proof/guardrails specs.
- `observations/` — baseline and follow-up system observations.
- `proofs/` — per-task completion evidence artifacts.
- `runs/` — on-demand QC run outputs and verdicts.

Rules:

1. Missing required proof artifact is a blocking QC violation.
2. QC baseline advances only on a `PASS` verdict.
3. `docs/qc/proofs/<task-id>/verdict.json` is compiler-generated and required.
