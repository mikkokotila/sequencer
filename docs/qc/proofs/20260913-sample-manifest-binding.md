# Sample manifest contract binding

The package-local sample migration reached GOV-BIND-001 because the tracked `samples.json` catalog had no path binding. Its 122 E2E tests and four runtime oracles passed.

Add the exact `samples.json` path to the product group. Future catalog edits require CI, E2E, E2E delta coverage, full contract and architecture checks, and commit-range attestation. No obligation, oracle, baseline, or debt threshold is weakened.

The compiler records executed validation in this task’s verdict and logs. Real-browser verification was not performed for this policy-only slice; the separate local-sample-library proof records the runtime verification.
