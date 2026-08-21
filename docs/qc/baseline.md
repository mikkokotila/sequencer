# QC Baseline State

baseline_sha: b04dd33
last_qc_at_utc: 2026-08-21T19:14:00Z
last_verdict: FAIL
reviewed_by: claude
notes: QC run 20260821-191400Z-df835b3 re-ran all gates over b04dd33..df835b3. Every gate is green at HEAD (ci, e2e 74/74, e2e-delta, governance-self 9/9, contracts 8/8, architecture 15/15, compiler PASS with debt delta -11) and three transport/UI synchronisation defects were found, fixed and regression-tested under task 20260821-playhead-sync-integrity. Baseline still NOT advanced: gate:commit-range over the full range remains FAIL with 24 historical product commits missing governance trailers (same blocker as run 20260322-060643-46d3542, all pre-dating the compiler). Resolving it requires a GA-level decision (history rewrite or an explicit pre-compiler amnesty rule) and is out of Worker-Agent scope.
