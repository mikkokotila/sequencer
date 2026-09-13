# State gate bindings

Observed failures: deterministic-reset inspection assumed an inline reset; engine curve inspection assumed UI ownership. Both assumptions broke when the runtime fixes moved reset into the atomic loader and sound controls into the engine.

The reset check follows local helper calls with cycle protection. The curve check still evaluates the actual cutoff, resonance and compression mappings against the existing endpoint and low-end bounds. The persistence structural oracle follows the atomic loader. No thresholds or historical attestations are waived.

Real-browser verification was not performed for this policy-only slice; runtime browser evidence is recorded separately. Compiler execution and required checks are in the adjacent manifest and logs.
