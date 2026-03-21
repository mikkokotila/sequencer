# Proof: Benchmark Worklet Timing

## Task
20260321-benchmark-worklet-timing

## Summary
Replaced main-thread RAF proxy timing in benchmark.html with a real
AudioWorklet MeasureProcessor that times its own process() calls and
reports via MessagePort.

## Changes
- `tests/benchmark.html` — replaced requestAnimationFrame timing loop
  with inline MeasureProcessor AudioWorklet (Blob URL). The processor
  sits at the end of the DSP chain (voices → saturation → compressor →
  MeasureProcessor → output), passes audio through, and times each
  process() call with performance.now(). Timing batches are posted to
  main thread via MessagePort. No setInterval, no Math.random, no
  currentTime proxy.

## Execution Profile
`headless` — structural benchmark integrity proof only. Real p99 timing
budget is verified in `interactive` profile.

## Oracle Results

| Oracle | Result | Evidence |
|--------|--------|----------|
| off_transparent | PASS | Machine-verified: resetAllExtensions present |
| on_audible | PASS | Machine-verified: CANONICAL_DEFAULTS with non-zero values |
| benchmark_worklet_budget | PASS | AudioWorkletNode present, MeasureProcessor defined, no setInterval, no Math.random |
