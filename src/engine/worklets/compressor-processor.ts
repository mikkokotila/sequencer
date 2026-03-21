// Soft-knee compressor with 4x oversampled gain reduction.
export {};

const HALFBAND_TAPS = 15;
const HALFBAND_COEFS: readonly number[] = [
  -0.0126, 0.0, 0.0602, 0.0, -0.1738, 0.0, 0.6262, 1.0, 0.6262, 0.0, -0.1738, 0.0, 0.0602, 0.0,
  -0.0126,
];

class CompressorProcessor extends AudioWorkletProcessor {
  private envDb: Float64Array = new Float64Array(2);

  private upHist1: Float64Array[];
  private upHist2: Float64Array[];
  private downHist1: Float64Array[];
  private downHist2: Float64Array[];

  constructor() {
    super();
    this.upHist1 = [new Float64Array(HALFBAND_TAPS), new Float64Array(HALFBAND_TAPS)];
    this.upHist2 = [new Float64Array(HALFBAND_TAPS), new Float64Array(HALFBAND_TAPS)];
    this.downHist1 = [new Float64Array(HALFBAND_TAPS), new Float64Array(HALFBAND_TAPS)];
    this.downHist2 = [new Float64Array(HALFBAND_TAPS), new Float64Array(HALFBAND_TAPS)];
  }

  static get parameterDescriptors(): AudioParamDescriptor[] {
    return [
      {
        name: 'threshold',
        defaultValue: -18,
        minValue: -60,
        maxValue: 0,
        automationRate: 'k-rate',
      },
      { name: 'ratio', defaultValue: 4, minValue: 1, maxValue: 20, automationRate: 'k-rate' },
      { name: 'knee', defaultValue: 30, minValue: 0, maxValue: 40, automationRate: 'k-rate' },
      {
        name: 'attack',
        defaultValue: 0.01,
        minValue: 0.001,
        maxValue: 0.3,
        automationRate: 'k-rate',
      },
      {
        name: 'release',
        defaultValue: 0.15,
        minValue: 0.01,
        maxValue: 1,
        automationRate: 'k-rate',
      },
      { name: 'makeupGain', defaultValue: 1, minValue: 0, maxValue: 2, automationRate: 'k-rate' },
    ];
  }

  private firConvolve(sample: number, history: Float64Array, writeIdx: number): number {
    history[writeIdx % HALFBAND_TAPS] = sample;
    let sum = 0;
    for (let t = 0; t < HALFBAND_TAPS; t++) {
      sum +=
        (HALFBAND_COEFS[t] ?? 0) *
        (history[(writeIdx - t + HALFBAND_TAPS * 2) % HALFBAND_TAPS] ?? 0);
    }
    return sum;
  }

  private upsample2(
    input: Float32Array,
    count: number,
    output: Float64Array,
    history: Float64Array,
    histOffset: number,
  ): number {
    let wi = histOffset;
    let oi = 0;
    for (let i = 0; i < count; i++) {
      output[oi++] = this.firConvolve((input[i] ?? 0) * 2, history, wi++);
      output[oi++] = this.firConvolve(0, history, wi++);
    }
    return wi;
  }

  private upsample2From64(
    input: Float64Array,
    count: number,
    output: Float64Array,
    history: Float64Array,
    histOffset: number,
  ): number {
    let wi = histOffset;
    let oi = 0;
    for (let i = 0; i < count; i++) {
      output[oi++] = this.firConvolve((input[i] ?? 0) * 2, history, wi++);
      output[oi++] = this.firConvolve(0, history, wi++);
    }
    return wi;
  }

  private downsample2(
    input: Float64Array,
    count: number,
    output: Float64Array,
    history: Float64Array,
    histOffset: number,
  ): number {
    let wi = histOffset;
    let oi = 0;
    for (let i = 0; i < count; i++) {
      const filtered = this.firConvolve(input[i] ?? 0, history, wi++);
      if (i % 2 === 0) {
        output[oi++] = filtered;
      }
    }
    return wi;
  }

  private gainComputeDb(
    inputDb: number,
    threshold: number,
    ratio: number,
    kneeWidth: number,
  ): number {
    const halfKnee = kneeWidth * 0.5;
    if (inputDb < threshold - halfKnee) {
      return 0;
    } else if (inputDb > threshold + halfKnee) {
      return (threshold - inputDb) * (1 - 1 / ratio);
    } else {
      const x = inputDb - threshold + halfKnee;
      return ((1 / ratio - 1) * x * x) / (2 * kneeWidth);
    }
  }

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !output || input.length === 0) return true;

    const numChannels = Math.min(input.length, output.length);
    const firstCh = input[0];
    if (!firstCh) return true;
    const blockSize = firstCh.length;
    if (blockSize === 0) return true;

    const threshold = parameters['threshold']?.[0] ?? -18;
    const ratio = parameters['ratio']?.[0] ?? 4;
    const kneeWidth = parameters['knee']?.[0] ?? 30;
    const attackTime = parameters['attack']?.[0] ?? 0.01;
    const releaseTime = parameters['release']?.[0] ?? 0.15;
    const makeupGain = parameters['makeupGain']?.[0] ?? 1;

    const alphaAttack4x = Math.exp(-1 / (attackTime * sampleRate * 4));
    const alphaRelease4x = Math.exp(-1 / (releaseTime * sampleRate * 4));

    const buf2x = new Float64Array(blockSize * 2);
    const buf4x = new Float64Array(blockSize * 4);
    const down2x = new Float64Array(blockSize * 2);
    const down1x = new Float64Array(blockSize);

    for (let ch = 0; ch < numChannels; ch++) {
      const inp = input[ch];
      const out = output[ch];
      if (!inp || !out) continue;
      let envDb = this.envDb[ch] ?? 0;

      const upHist1 = this.upHist1[ch];
      if (!upHist1) continue;
      this.upsample2(inp, blockSize, buf2x, upHist1, 0);

      const upHist2 = this.upHist2[ch];
      if (!upHist2) continue;
      this.upsample2From64(buf2x, blockSize * 2, buf4x, upHist2, 0);

      for (let i = 0; i < blockSize * 4; i++) {
        const sample = buf4x[i] ?? 0;
        const absSample = Math.abs(sample);
        const inputDb = absSample > 1e-10 ? 20 * Math.log10(absSample) : -200;
        const targetGainDb = this.gainComputeDb(inputDb, threshold, ratio, kneeWidth);

        if (targetGainDb < envDb) {
          envDb = alphaAttack4x * envDb + (1 - alphaAttack4x) * targetGainDb;
        } else {
          envDb = alphaRelease4x * envDb + (1 - alphaRelease4x) * targetGainDb;
        }

        const gainLin = Math.pow(10, envDb / 20) * makeupGain;
        buf4x[i] = sample * gainLin;
      }

      const downHist1 = this.downHist1[ch];
      if (!downHist1) continue;
      this.downsample2(buf4x, blockSize * 4, down2x, downHist1, 0);

      const downHist2 = this.downHist2[ch];
      if (!downHist2) continue;
      this.downsample2(down2x, blockSize * 2, down1x, downHist2, 0);

      for (let i = 0; i < blockSize; i++) {
        out[i] = down1x[i] ?? 0;
      }

      this.envDb[ch] = envDb;
    }

    return true;
  }
}

registerProcessor('compressor-processor', CompressorProcessor);
