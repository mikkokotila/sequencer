// Freeverb algorithm: 8 parallel comb filters + 4 series allpass filters.
export {};

const REFERENCE_RATE = 44100;
const COMB_DELAYS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617] as const;
const ALLPASS_DELAYS = [556, 441, 341, 225] as const;
const NUM_COMBS = 8;
const NUM_ALLPASSES = 4;
const ALLPASS_FEEDBACK = 0.5;

class CombFilter {
  private readonly buffer: Float32Array;
  private readonly bufferLength: number;
  private index: number;
  private lastFiltered: number;

  constructor(delaySamples: number) {
    this.bufferLength = delaySamples;
    this.buffer = new Float32Array(delaySamples);
    this.index = 0;
    this.lastFiltered = 0;
  }

  process(input: number, feedback: number, damping: number): number {
    const idx = this.index;
    const delayed = this.buffer[idx] ?? 0;
    const filtered = delayed * (1 - damping) + this.lastFiltered * damping;
    this.lastFiltered = filtered;
    this.buffer[idx] = input + filtered * feedback;
    this.index = idx + 1 < this.bufferLength ? idx + 1 : 0;
    return delayed;
  }
}

class AllpassFilter {
  private readonly buffer: Float32Array;
  private readonly bufferLength: number;
  private index: number;

  constructor(delaySamples: number) {
    this.bufferLength = delaySamples;
    this.buffer = new Float32Array(delaySamples);
    this.index = 0;
  }

  process(input: number): number {
    const idx = this.index;
    const delayed = this.buffer[idx] ?? 0;
    const output = -input + delayed;
    this.buffer[idx] = input + delayed * ALLPASS_FEEDBACK;
    this.index = idx + 1 < this.bufferLength ? idx + 1 : 0;
    return output;
  }
}

class FreeverbProcessor extends AudioWorkletProcessor {
  private readonly combs: CombFilter[];
  private readonly allpasses: AllpassFilter[];

  static get parameterDescriptors(): AudioParamDescriptor[] {
    return [
      { name: 'roomSize', defaultValue: 0.7, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'damping', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'wet', defaultValue: 0.3, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'dry', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    const rateScale = sampleRate / REFERENCE_RATE;

    this.combs = [];
    for (let i = 0; i < NUM_COMBS; i++) {
      const baseDelay = COMB_DELAYS[i] ?? 1116;
      this.combs.push(new CombFilter(Math.round(baseDelay * rateScale)));
    }

    this.allpasses = [];
    for (let i = 0; i < NUM_ALLPASSES; i++) {
      const baseDelay = ALLPASS_DELAYS[i] ?? 556;
      this.allpasses.push(new AllpassFilter(Math.round(baseDelay * rateScale)));
    }
  }

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!input || !output) return true;

    const roomSize = parameters['roomSize']?.[0] ?? 0.7;
    const damping = parameters['damping']?.[0] ?? 0.5;
    const wet = parameters['wet']?.[0] ?? 0.3;
    const dry = parameters['dry']?.[0] ?? 1;

    const feedback = roomSize * 0.28 + 0.7;
    const blockSize = output.length;

    for (let s = 0; s < blockSize; s++) {
      const inp = input[s] ?? 0;

      let combSum = 0;
      for (let c = 0; c < NUM_COMBS; c++) {
        const comb = this.combs[c];
        if (comb) {
          combSum += comb.process(inp, feedback, damping);
        }
      }

      let allpassOut = combSum;
      for (let a = 0; a < NUM_ALLPASSES; a++) {
        const ap = this.allpasses[a];
        if (ap) {
          allpassOut = ap.process(allpassOut);
        }
      }

      output[s] = inp * dry + allpassOut * wet;
    }

    return true;
  }
}

registerProcessor('freeverb-processor', FreeverbProcessor);
