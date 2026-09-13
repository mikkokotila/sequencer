// Profile the shipped processors, not an unrelated passthrough callback.
const names = ['compressor-processor', 'saturation-processor', 'freeverb-processor', 'delay-processor', 'transformer-processor'];
const expected = [1, 2, 1, 1, 1]; // Pultec and compressor each own a saturation stage.
const counts = new Uint32Array(names.length);
let ticks, control, request = 0;
let frame = -1, startedAt = 0, wallStart = 0, armed = false, armedFrame = -1;
let timerError = null;
const register = globalThis.registerProcessor.bind(globalThis);
globalThis.registerProcessor = (name, ProductProcessor) => {
  const index = names.indexOf(name);
  if (index < 0) return register(name, ProductProcessor);
  class ProfiledProductProcessor extends ProductProcessor {
    process(inputs, outputs, parameters) {
      if (armed && currentFrame > armedFrame) {
        if (frame !== currentFrame) {
          frame = currentFrame;
          counts.fill(0);
          // The most recent worker timestamp is at or BEFORE the span starts.
          startedAt = Number(Atomics.load(ticks, 0)) / 1000;
          wallStart = Date.now();
        }
        counts[index]++;
      }
      return super.process(inputs, outputs, parameters);
    }
  }
  register(name, ProfiledProductProcessor);
};

class GraphMeasurement extends AudioWorkletProcessor {
  constructor(options) {
    super();
    ticks = new BigInt64Array(options.processorOptions.ticks);
    control = new Int32Array(options.processorOptions.control);
    this.port.onmessage = event => {
      if (event.data === 'start') {
        armedFrame = currentFrame; armed = true;
        this.port.postMessage({ type: 'started', timer: 'shared-worker-handshake', precisionMs: 0.1 });
      }
      if (event.data === 'stop') { armed = false; this.port.postMessage({ type: 'stopped' }); }
    };
  }
  process(inputs, outputs) {
    const input = inputs[0], output = outputs[0];
    const frames = output?.[0]?.length ?? 0;
    if (armed && currentFrame > armedFrame) {
      if (frame !== currentFrame || counts.some((n, i) => n !== expected[i])) timerError = 'The complete product DSP chain did not execute in this quantum';
      // The worker acknowledges only AFTER receiving this end-of-span request.
      // Include the handshake overhead and 0.1ms precision allowance at EACH
      // boundary: the result is an upper bound, never an underestimated duration.
      Atomics.store(control, 0, ++request);
      const deadline = Date.now() + 20;
      while (Atomics.load(control, 1) !== request) {
        if (Date.now() > deadline) { timerError = 'Measurement clock stopped responding'; break; }
      }
      const endedAt = Number(Atomics.load(ticks, 1)) / 1000;
      const wallEnd = Date.now();
      const upper = endedAt - startedAt + 0.2;
      if (endedAt < startedAt || upper < wallEnd - wallStart - 1) timerError = 'Inconsistent worklet clock evidence';
      this.port.postMessage({ type: 'sample', frame: currentFrame, frames, startedAt, endedAt,
        wallStart, wallEnd, durationUpperBoundMs: upper, counts: Array.from(counts), error: timerError });
    }
    if (input && output) for (let ch = 0; ch < output.length; ch++) {
      if (input[ch]) output[ch].set(input[ch]);
    }
    return true;
  }
}
register('graph-measurement', GraphMeasurement);
