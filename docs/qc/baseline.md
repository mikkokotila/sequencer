# QC Baseline State

baseline_sha: b04dd33
last_qc_at_utc: 2026-09-12T10:42:26Z
last_verdict: BLOCKED
reviewed_by: codex
notes: Historical commit-range validation still identifies 24 product commits without required governance attestations. Baseline is not advanced and no legacy exception is assumed. These commits span both sides of the initial compiler introduction; the earlier claim that all predated it was inaccurate. Current runtime remediation and compiler evidence are recorded separately under task 20260912-sync-runtime-fixes in PR #39. Current tests cannot supply missing proof at the original historical commit SHAs.
