/**
 * Timing measurement AudioWorkletProcessor for benchmark.
 * Measures performance.now() delta between consecutive process() calls
 * and reports via MessagePort. Passes audio through unchanged.
 */
class MeasureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._last = 0;
  }
  process(inputs, outputs) {
    const now = performance.now();
    if (this._last > 0) {
      this.port.postMessage(now - this._last);
    }
    this._last = now;
    const inp = inputs[0];
    const out = outputs[0];
    if (inp && out) {
      for (let c = 0; c < inp.length && c < out.length; c++) {
        const ic = inp[c];
        const oc = out[c];
        if (ic && oc) oc.set(ic);
      }
    }
    return true;
  }
}
registerProcessor('measure-processor', MeasureProcessor);
