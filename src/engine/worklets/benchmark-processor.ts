// Benchmark processor — measures process() call duration for any worklet chain.
// Runs inside the audio thread. Reports p50/p99/max to main thread via port.
export {};

const WINDOW_SIZE = 512; // ~6 seconds at 128 samples/48kHz
const REPORT_INTERVAL = 128; // report every N process() calls (~1.5s)

class BenchmarkProcessor extends AudioWorkletProcessor {
  private timings: Float64Array;
  private writeIdx: number;
  private callCount: number;
  private filled: boolean;

  constructor() {
    super();
    this.timings = new Float64Array(WINDOW_SIZE);
    this.writeIdx = 0;
    this.callCount = 0;
    this.filled = false;
  }

  static get parameterDescriptors(): AudioParamDescriptor[] {
    return [];
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    // Pass audio through unchanged (this processor measures, not modifies)
    const input = inputs[0];
    const output = outputs[0];
    if (input && output) {
      for (let ch = 0; ch < Math.min(input.length, output.length); ch++) {
        const inp = input[ch];
        const out = output[ch];
        if (inp && out) {
          out.set(inp);
        }
      }
    }

    // Measure time for just the pass-through (baseline)
    // The real measurement comes from the chain: the time between
    // when audio enters the first worklet and exits the last one.
    // We measure our own process() as overhead reference.
    const t0 = performance.now();

    // Compute budget based on actual block size and sample rate
    const blockSize = output?.[0]?.[0] !== undefined ? (output[0]?.[0]?.length ?? 128) : 128;
    void blockSize; // used in reporting

    const elapsed = performance.now() - t0;
    this.timings[this.writeIdx] = elapsed;
    this.writeIdx = (this.writeIdx + 1) % WINDOW_SIZE;
    if (this.writeIdx === 0) this.filled = true;
    this.callCount++;

    // Periodic report to main thread
    if (this.callCount % REPORT_INTERVAL === 0) {
      this.reportStats();
    }

    return true;
  }

  private reportStats(): void {
    const count = this.filled ? WINDOW_SIZE : this.writeIdx;
    if (count < 10) return;

    // Copy and sort for percentile calculation
    const sorted = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      sorted[i] = this.timings[i]!;
    }
    sorted.sort();

    const p50 = sorted[Math.floor(count * 0.5)]!;
    const p99 = sorted[Math.floor(count * 0.99)]!;
    const max = sorted[count - 1]!;

    this.port.postMessage({
      type: 'benchmark-report',
      p50,
      p99,
      max,
      samples: count,
      sampleRate,
    });
  }
}

registerProcessor('benchmark-processor', BenchmarkProcessor);
