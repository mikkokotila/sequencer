# Audio and benchmark pressure fixes

User authorization: fix all findings, including product code, in existing PR #41.

- F13: benchmark now runs all six shipped effect factories, five shipped processor types (six instances), and 16 sample voices. Shared-worker timestamp handshakes conservatively bound the actual DSP span. Independent validation uses raw packets and the 128-frame / 48 kHz budget (2.667 ms). A deliberate overload in the real compressor must fail.
- F15: both aux effects previously restored wet gain to 0.7 while disabled, after setState and after a stale stop callback (see original aux-before.json). Generation-owned reset acknowledgements now clear processor memory before restoring audio, and new playback cancels old stop callbacks.
- F04/F05 refinement: loads wait for already queued saves before committing state; reload reads after the queue drains, avoiding obsolete same-tab revision expectations.
- Seven new browser regressions cover actual audible effect memory, disabled state, rapid restart and save/load. An eighth challenges the benchmark with real DSP overload.

Real-browser verification is performed. Measurements use synthetic samples and no physical MIDI device or acoustic loopback. Historical missing attestations remain BLOCKED; no baseline advancement or invented proof. Compiler-generated checks and oracle artifacts supply the final verdict.

Final validation: compiler PASS; 118/118 browser tests, 47/47 audio assertions, eight contract checks, 15 architecture checks and all eight compiler-owned oracles PASS. The canonical frozen-source benchmark measured p99 upper bound 0.666 ms against 2.667 ms, 3,788 packets and 100.1% render coverage. The injected real compressor overload was rejected. The initial blocked harness capture is retained with its subsequent canonical-path repair.
