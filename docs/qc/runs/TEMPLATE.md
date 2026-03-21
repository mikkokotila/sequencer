# QC Run Template

run_id: <YYYYMMDD-HHMMSS-headsha>
run_at_utc: <ISO-8601>
reviewed_by: <agent-or-human>
range: <from_sha>..<to_sha>
commits_reviewed:
- <sha> <message>

## Gate + Contract Matrix

| Item | Status | Evidence |
|---|---|---|
| Governance compiler attestation | PASS/FAIL/BLOCKED | `docs/qc/proofs/<task-id>/verdict.json` |
| Commit contract | PASS/FAIL/BLOCKED | |
| CI gate evidence | PASS/FAIL/BLOCKED | |
| E2E gate evidence | PASS/FAIL/BLOCKED | |
| Architecture gate evidence | PASS/FAIL/BLOCKED | |
| Audio gate evidence (if applicable) | PASS/FAIL/BLOCKED/N/A | |
| Benchmark gate evidence (if applicable) | PASS/FAIL/BLOCKED/N/A | |
| Architecture invariants contract | PASS/FAIL/BLOCKED/N/A | |
| Adaptive transfer contract (if applicable) | PASS/FAIL/BLOCKED/N/A | |
| Color contract (if applicable) | PASS/FAIL/BLOCKED/N/A | |

## Blocking Findings

- List each blocker with commit SHA and proof path.
- If none, write `None`.

## Final Verdict

verdict: PASS / FAIL / BLOCKED
rationale: <single paragraph>

## Baseline Action

advance_baseline: yes/no
new_baseline_sha: <sha or n/a>
