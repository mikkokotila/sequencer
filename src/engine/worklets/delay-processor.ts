// Interpolated delay line with Hermite cubic interpolation and one-pole LPF tone control.
export {};

const MAX_DELAY_SECONDS = 2;
const MIN_DELAY_SECONDS = 0.01;
const MAX_FEEDBACK = 0.95;

function hermite(frac: number, xm1: number, x0: number, x1: number, x2: number): number {
  const c = (x1 - xm1) * 0.5;
  const v = x0 - x1;
  const w = c + v;
  const a = w + v + (x2 - x0) * 0.5;
  const b = w + a;
  return ((a * frac - b) * frac + c) * frac + x0;
}

class DelayProcessor extends AudioWorkletProcessor {
  private readonly buffer: Float32Array;
  private readonly bufferLength: number;
  private writeIndex: number;
  private filterState: number;

  static get parameterDescriptors(): AudioParamDescriptor[] {
    return [
      { name: 'delayTime', defaultValue: 0.375, minValue: MIN_DELAY_SECONDS, maxValue: MAX_DELAY_SECONDS, automationRate: 'k-rate' },
      { name: 'feedback', defaultValue: 0.35, minValue: 0, maxValue: MAX_FEEDBACK, automationRate: 'k-rate' },
      { name: 'tone', defaultValue: 0.3, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mix', defaultValue: 0.25, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.bufferLength = Math.ceil(MAX_DELAY_SECONDS * sampleRate) + 4;
    this.buffer = new Float32Array(this.bufferLength);
    this.writeIndex = 0;
    this.filterState = 0;
  }

  private readInterpolated(delaySamples: number): number {
    const len = this.bufferLength;
    const readPos = this.writeIndex - delaySamples;
    const readFloor = Math.floor(readPos);
    const frac = readPos - readFloor;

    const i0 = ((readFloor % len) + len) % len;
    const im1 = i0 === 0 ? len - 1 : i0 - 1;
    const i1 = i0 + 1 < len ? i0 + 1 : 0;
    const i2 = i1 + 1 < len ? i1 + 1 : 0;

    return hermite(
      frac,
      this.buffer[im1] ?? 0,
      this.buffer[i0] ?? 0,
      this.buffer[i1] ?? 0,
      this.buffer[i2] ?? 0,
    );
  }

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!input || !output) return true;

    const delayTime = parameters['delayTime']?.[0] ?? 0.375;
    const feedback = parameters['feedback']?.[0] ?? 0.35;
    const tone = parameters['tone']?.[0] ?? 0.3;
    const mix = parameters['mix']?.[0] ?? 0.25;

    const delaySamples = Math.max(
      MIN_DELAY_SECONDS * sampleRate,
      Math.min(delayTime * sampleRate, this.bufferLength - 4),
    );

    // One-pole lowpass coefficient: tone=0 is dark (more filtering), tone=1 is bright (less filtering)
    const alpha = 0.1 + tone * 0.9;

    const blockSize = output.length;

    for (let s = 0; s < blockSize; s++) {
      const inp = input[s] ?? 0;
      const delayed = this.readInterpolated(delaySamples);

      this.filterState = this.filterState + alpha * (delayed - this.filterState);
      this.buffer[this.writeIndex] = inp + this.filterState * feedback;
      this.writeIndex = this.writeIndex + 1 < this.bufferLength ? this.writeIndex + 1 : 0;

      output[s] = inp * (1 - mix) + delayed * mix;
    }

    return true;
  }
}

registerProcessor('delay-processor', DelayProcessor);
