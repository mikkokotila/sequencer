# Benchmark evidence and tooling repair

F13: old gates trusted a displayed p99 and any constructed worklet. They now independently validate raw processing packets, all six shipped processor instances, the actual 128-frame/48kHz budget, a minimum ten-second workload, render continuity/coverage and independent clocks. Nine negative evidence mutations plus a positive control exercise the validator. Compiler snapshots resolve installed tooling while keeping application/config source frozen to the staged tree. A terminal-state regex bug in the benchmark oracle is also corrected.

Headed Chromium development probes on runtime commit 05dc391 plus the new benchmark prototype: normal p99 upper bound 0.682ms, 3,787 samples, 100.0% coverage; an injected two-million-iteration sine loop in the shipped compressor produced 15.722ms, 666 samples and 17.6% coverage. The independent validator accepts normal evidence and rejects overload. These are development probes; the separate product slice regenerates compiler-owned evidence for its final staged source.

F14: npm audit changed from eight advisories (six high, two moderate) to zero after compatible tooling updates, including Vite 6.4.3. Supported Node 22 replaces the unsupported local Node 23/older shared CI baseline for verification. Original audit reports remain intact. No historical proof gap is waived or fabricated.

Real-browser verification: performed, headed Chromium with synthetic samples. No physical MIDI device or acoustic loopback.
