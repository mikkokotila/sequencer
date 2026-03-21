// Three-model compressor: FET (1176), Opto (LA-2A), VCA (SSL).
// Program-dependent envelope detection. 4x oversampled gain reduction.
// Model selected via MessagePort: { type: 'setModel', model: 0|1|2 }
export {};

const HALFBAND_TAPS = 15;
// Normalized halfband FIR: sum=1.0 for unity gain with ×2 upsample.
const HALFBAND_COEFS: readonly number[] = [
  -0.0063, 0.0, 0.0301, 0.0, -0.0869, 0.0, 0.3131, 0.5, 0.3131, 0.0, -0.0869, 0.0, 0.0301, 0.0,
  -0.0063,
];

// Model constants
const MODEL_FET = 0;
const MODEL_OPTO = 1;
const MODEL_VCA = 2;

// FET tuning
const FET_K = 0.08; // attack speedup per dB of GR
const FET_ASYM_MAX = 0.02; // max 2nd harmonic at deep GR

// Opto tuning
const OPTO_FAST_ATTACK = 0.01;
const OPTO_SLOW_ATTACK = 0.2;
const OPTO_FAST_RELEASE = 0.06;
const OPTO_SLOW_RELEASE = 2.0;
const OPTO_HEAT_RATE = 0.002;
const OPTO_COOL_RATE = 0.0001;
const OPTO_HP_COEF = 0.985;

const MAX_BLOCK = 128;

class CompressorProcessor extends AudioWorkletProcessor {
  // Model selection
  private model: number = MODEL_FET;

  // Shared envelope state
  private envDb: Float64Array;

  // FET state (reuses envDb)

  // Opto state
  private envDbFast: Float64Array;
  private envDbSlow: Float64Array;
  private optoHeat: Float64Array;
  private optoDetFilter: Float64Array;

  // VCA state
  private vcaPrevTarget: Float64Array;

  // Pre-allocated work buffers
  private buf2x: Float64Array;
  private buf4x: Float64Array;
  private down2x: Float64Array;
  private down1x: Float64Array;

  // FIR history
  private upHist1: Float64Array[];
  private upHist2: Float64Array[];
  private downHist1: Float64Array[];
  private downHist2: Float64Array[];

  constructor() {
    super();

    // Envelope state (2 channels)
    this.envDb = new Float64Array(2);
    this.envDbFast = new Float64Array(2);
    this.envDbSlow = new Float64Array(2);
    this.optoHeat = new Float64Array(2);
    this.optoDetFilter = new Float64Array(2);
    this.vcaPrevTarget = new Float64Array(2);

    // Pre-allocated work buffers
    this.buf2x = new Float64Array(MAX_BLOCK * 2);
    this.buf4x = new Float64Array(MAX_BLOCK * 4);
    this.down2x = new Float64Array(MAX_BLOCK * 2);
    this.down1x = new Float64Array(MAX_BLOCK);

    // FIR history
    this.upHist1 = [new Float64Array(HALFBAND_TAPS), new Float64Array(HALFBAND_TAPS)];
    this.upHist2 = [new Float64Array(HALFBAND_TAPS), new Float64Array(HALFBAND_TAPS)];
    this.downHist1 = [new Float64Array(HALFBAND_TAPS), new Float64Array(HALFBAND_TAPS)];
    this.downHist2 = [new Float64Array(HALFBAND_TAPS), new Float64Array(HALFBAND_TAPS)];

    // Model switching via MessagePort
    this.port.onmessage = (e: MessageEvent) => {
      if (e.data && typeof e.data === 'object' && 'type' in e.data) {
        const msg = e.data as { type: string; model?: number };
        if (msg.type === 'setModel' && msg.model !== undefined) {
          this.model = Math.max(0, Math.min(2, msg.model | 0));
        }
      }
    };
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

  // ── FIR helpers (unchanged) ──

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
      if (i % 2 === 0) output[oi++] = filtered;
    }
    return wi;
  }

  // ── Gain computer (shared) ──

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

  // ── Process ──

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
    let ratio = parameters['ratio']?.[0] ?? 4;
    const kneeWidth = parameters['knee']?.[0] ?? 30;
    const attackTime = parameters['attack']?.[0] ?? 0.01;
    const releaseTime = parameters['release']?.[0] ?? 0.15;
    const makeupGain = parameters['makeupGain']?.[0] ?? 1;

    // Fast bypass: threshold >= 0 and ratio <= 1 and makeupGain = 1 = no compression
    if (threshold >= 0 && ratio <= 1.001 && Math.abs(makeupGain - 1) < 0.001) {
      for (let ch = 0; ch < numChannels; ch++) {
        const inp = input[ch];
        const out = output[ch];
        if (inp && out) out.set(inp);
      }
      return true;
    }

    const sr4x = sampleRate * 4;
    const model = this.model;

    // Opto: remap ratio to compress/limit modes
    if (model === MODEL_OPTO) {
      ratio = ratio < 4 ? 3 : 10;
    }

    // Pre-compute base alphas (per-block, not per-sample)
    const baseAlphaAtt = Math.exp(-1 / (attackTime * sr4x));
    const baseAlphaRel = Math.exp(-1 / (releaseTime * sr4x));

    // Opto pre-compute
    const alphaOptoFastAtt = Math.exp(-1 / (OPTO_FAST_ATTACK * sr4x));
    const alphaOptoFastRel = Math.exp(-1 / (OPTO_FAST_RELEASE * sr4x));
    const alphaOptoSlowAtt = Math.exp(-1 / (OPTO_SLOW_ATTACK * sr4x));

    // Reuse pre-allocated buffers
    const buf2x = this.buf2x;
    const buf4x = this.buf4x;
    const down2x = this.down2x;
    const down1x = this.down1x;

    for (let ch = 0; ch < numChannels; ch++) {
      const inp = input[ch];
      const out = output[ch];
      if (!inp || !out) continue;

      let envDb = this.envDb[ch] ?? 0;
      let envFast = this.envDbFast[ch] ?? 0;
      let envSlow = this.envDbSlow[ch] ?? 0;
      let heat = this.optoHeat[ch] ?? 0;
      let detFilter = this.optoDetFilter[ch] ?? 0;
      let prevTarget = this.vcaPrevTarget[ch] ?? 0;

      // Upsample 1x → 2x → 4x
      const upHist1 = this.upHist1[ch];
      if (!upHist1) continue;
      this.upsample2(inp, blockSize, buf2x, upHist1, 0);

      const upHist2 = this.upHist2[ch];
      if (!upHist2) continue;
      this.upsample2From64(buf2x, blockSize * 2, buf4x, upHist2, 0);

      // Process at 4x rate
      for (let i = 0; i < blockSize * 4; i++) {
        const sample = buf4x[i] ?? 0;
        const absSample = Math.abs(sample);
        let inputDb = absSample > 1e-10 ? 20 * Math.log10(absSample) : -200;

        // Opto: frequency-dependent detection (HPF on detector)
        if (model === MODEL_OPTO) {
          const hpOut = absSample - detFilter;
          detFilter += (1 - OPTO_HP_COEF) * (absSample - detFilter);
          const detLevel = hpOut * 0.5 + absSample * 0.5;
          inputDb = detLevel > 1e-10 ? 20 * Math.log10(detLevel) : -200;
        }

        const targetGainDb = this.gainComputeDb(inputDb, threshold, ratio, kneeWidth);

        // ── Model-specific envelope detection ──

        if (model === MODEL_FET) {
          // FET: attack speeds up with GR depth (capacitor charge curve)
          const grDepth = Math.max(0, -envDb);
          const attMod = 1 / (1 + FET_K * grDepth);
          const relMod = 1 + FET_K * grDepth * 0.3;
          // Modulate alpha without Math.exp: alpha' ≈ alpha^(1/mod)
          const alphaAtt = Math.pow(baseAlphaAtt, attMod);
          const alphaRel = Math.pow(baseAlphaRel, 1 / relMod);

          if (targetGainDb < envDb) {
            envDb = alphaAtt * envDb + (1 - alphaAtt) * targetGainDb;
          } else {
            envDb = alphaRel * envDb + (1 - alphaRel) * targetGainDb;
          }
        } else if (model === MODEL_OPTO) {
          // Opto: two-pole follower with thermal memory
          const grDepth = Math.max(0, -targetGainDb);

          // Heat accumulation
          if (grDepth > 0.5) {
            heat = Math.min(1, heat + (OPTO_HEAT_RATE * grDepth) / 12);
          } else {
            heat = Math.max(0, heat - OPTO_COOL_RATE);
          }

          // Fast follower
          if (targetGainDb < envFast) {
            envFast = alphaOptoFastAtt * envFast + (1 - alphaOptoFastAtt) * targetGainDb;
          } else {
            envFast = alphaOptoFastRel * envFast + (1 - alphaOptoFastRel) * targetGainDb;
          }

          // Slow follower (release stretches with heat)
          const slowRelease = OPTO_SLOW_RELEASE * (1 + heat * 3);
          const alphaSlowRel = Math.exp(-1 / (slowRelease * sr4x));

          if (targetGainDb < envSlow) {
            envSlow = alphaOptoSlowAtt * envSlow + (1 - alphaOptoSlowAtt) * targetGainDb;
          } else {
            envSlow = alphaSlowRel * envSlow + (1 - alphaSlowRel) * targetGainDb;
          }

          // Blend fast/slow based on heat
          const blend = 0.3 + 0.7 * heat;
          envDb = envFast * (1 - blend) + envSlow * blend;
        } else {
          // VCA: precise follower with transient detection + auto-release
          const slewRate = Math.abs(targetGainDb - prevTarget);
          prevTarget = targetGainDb;

          // Transient: if target moved fast, halve attack time
          const transientThreshold = (6.0 * blockSize) / sampleRate;
          const transientBoost = slewRate > transientThreshold ? 0.5 : 1.0;
          const alphaAtt = Math.pow(baseAlphaAtt, transientBoost);

          // Auto-release: deeper GR → slower release
          const grDepth = Math.max(0, -envDb);
          const autoFactor = 0.5 + (grDepth / 12.0) * 1.5;
          const alphaRel = Math.pow(baseAlphaRel, 1 / autoFactor);

          if (targetGainDb < envDb) {
            envDb = alphaAtt * envDb + (1 - alphaAtt) * targetGainDb;
          } else {
            envDb = alphaRel * envDb + (1 - alphaRel) * targetGainDb;
          }
        }

        // ── Gain application ──
        const gainLin = Math.pow(10, envDb / 20) * makeupGain;

        if (model === MODEL_FET) {
          // FET: even-harmonic warmth proportional to GR depth.
          // Uses sin(x*PI) per waveshaper contract — no raw asymmetry, no DC bias.
          const grNorm = Math.min(1, Math.max(0, -envDb) / 30);
          const warmth = FET_ASYM_MAX * grNorm;
          const compressed = sample * gainLin;
          buf4x[i] = compressed + warmth * Math.sin(compressed * Math.PI);
        } else {
          // Opto + VCA: clean gain application
          buf4x[i] = sample * gainLin;
        }
      }

      // Downsample 4x → 2x → 1x
      const downHist1 = this.downHist1[ch];
      if (!downHist1) continue;
      this.downsample2(buf4x, blockSize * 4, down2x, downHist1, 0);

      const downHist2 = this.downHist2[ch];
      if (!downHist2) continue;
      this.downsample2(down2x, blockSize * 2, down1x, downHist2, 0);

      for (let i = 0; i < blockSize; i++) {
        out[i] = down1x[i] ?? 0;
      }

      // Save state
      this.envDb[ch] = envDb;
      this.envDbFast[ch] = envFast;
      this.envDbSlow[ch] = envSlow;
      this.optoHeat[ch] = heat;
      this.optoDetFilter[ch] = detFilter;
      this.vcaPrevTarget[ch] = prevTarget;
    }

    return true;
  }
}

registerProcessor('compressor-processor', CompressorProcessor);
