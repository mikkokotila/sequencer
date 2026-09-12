# Runtime gate bindings

The PR #39 runtime compiler check passed all seven command obligations and six audio/control oracles but failed GOV-BIND-001 because Vite configuration, Playwright configuration and server code were outside every path group. These paths now belong to the product group, inheriting CI, E2E, delta-coverage, contract, architecture and commit-attestation gates. No gate or historical attestation requirement is removed.

This is an authorized mid-task governance repair on the same PR branch. Runtime changes are not included in this policy commit. The prior PR #38 changes are retained in the working tree for the following runtime slice; all source and proof files were preserved when separating the staged changes.

Validation: governance self-tests, static CI and commit-range checks are required by the compiler. The following runtime compilation exercises the newly bound files through their full product obligations. No additional real-browser verification was performed for this policy-only change; browser verification is recorded under 20260912-sync-runtime-fixes.

Compiler validation passed: governance self-tests 9/9, static CI, and commit-range check. The runtime compilation must now be rerun with the binding repair committed.
