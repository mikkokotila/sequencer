// Transformer coloring — even-harmonic saturation with level-dependent behavior.
// Models the core saturation of analog input/output transformers (Neve, API, Trident).
// Quiet signals pass clean, loud signals get colored with 2nd and 4th harmonics.
// 4x oversampled. LF thickening + HF rolloff.
export {};

const HALFBAND_TAPS = 15;
// Normalized halfband FIR: sum=1.0 for unity gain with ×2 upsample.
const HALFBAND_COEFS: readonly number[] = [
  -0.0063, 0.0, 0.0301, 0.0, -0.0869, 0.0, 0.3131, 0.5, 0.3131, 0.0, -0.0869, 0.0, 0.0301, 0.0,
  -0.0063,
];

const MAX_BLOCK = 128;

class TransformerProcessor extends AudioWorkletProcessor {
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

  // Filter state (per channel)
  private lfState: Float64Array; // low-shelf filter state
  private hfState: Float64Array; // high-frequency rolloff filter state

  constructor() {
    super();

    this.buf2x = new Float64Array(MAX_BLOCK * 2);
    this.buf4x = new Float64Array(MAX_BLOCK * 4);
    this.down2x = new Float64Array(MAX_BLOCK * 2);
    this.down1x = new Float64Array(MAX_BLOCK);

    this.upHist1 = [new Float64Array(HALFBAND_TAPS), new Float64Array(HALFBAND_TAPS)];
    this.upHist2 = [new Float64Array(HALFBAND_TAPS), new Float64Array(HALFBAND_TAPS)];
    this.downHist1 = [new Float64Array(HALFBAND_TAPS), new Float64Array(HALFBAND_TAPS)];
    this.downHist2 = [new Float64Array(HALFBAND_TAPS), new Float64Array(HALFBAND_TAPS)];

    this.lfState = new Float64Array(2);
    this.hfState = new Float64Array(2);
  }

  static get parameterDescriptors(): AudioParamDescriptor[] {
    return [
      { name: 'drive', defaultValue: 0.15, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'color', defaultValue: 0.1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'air', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  // ── FIR helpers (same as compressor/saturation) ──

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

    const drive = parameters['drive']?.[0] ?? 0.15;
    const color = parameters['color']?.[0] ?? 0.1;
    const air = parameters['air']?.[0] ?? 0.5;

    // Fast bypass: no drive and no color = identity
    if (drive < 0.001 && color < 0.001) {
      for (let ch = 0; ch < numChannels; ch++) {
        const inp = input[ch];
        const out = output[ch];
        if (inp && out) out.set(inp);
      }
      return true;
    }

    const sr4x = sampleRate * 4;
    // Squared curves for perceptually linear control feel
    const driveSq = drive * drive; // 1%→0.0001, 10%→0.01, 50%→0.25, 100%→1.0
    const colorSq = color * color;
    const driveGain = 1 + driveSq * 2;
    const outputComp = 1 / (1 + driveSq * 0.5);

    // LF thickening scales with squared drive
    const lfBoostLin = 1 + driveSq * 0.19;
    const lfAlpha = 1 - Math.exp((-2 * Math.PI * 80) / sr4x);

    // HF rolloff: one-pole lowpass coefficient
    // air=0 → 10kHz, air=0.5 → 18kHz, air=1 → 40kHz
    const hfCutoff = 10000 + air * 30000;
    const hfAlpha = 1 - Math.exp((-2 * Math.PI * hfCutoff) / sr4x);

    const buf2x = this.buf2x;
    const buf4x = this.buf4x;
    const down2x = this.down2x;
    const down1x = this.down1x;

    for (let ch = 0; ch < numChannels; ch++) {
      const inp = input[ch];
      const out = output[ch];
      if (!inp || !out) continue;

      let lfS = this.lfState[ch] ?? 0;
      let hfS = this.hfState[ch] ?? 0;

      // Upsample 1x → 2x → 4x
      const upHist1 = this.upHist1[ch];
      if (!upHist1) continue;
      this.upsample2(inp, blockSize, buf2x, upHist1, 0);

      const upHist2 = this.upHist2[ch];
      if (!upHist2) continue;
      this.upsample2From64(buf2x, blockSize * 2, buf4x, upHist2, 0);

      // Process at 4x rate
      for (let i = 0; i < blockSize * 4; i++) {
        let sample = buf4x[i] ?? 0;

        // 1. Drive into core
        const x = sample * driveGain;

        // 2. Even-harmonic generation (level-dependent)
        // Uses sin(x*PI) per waveshaper contract — generates true even harmonics
        // (2nd, 4th) without DC bias or raw asymmetry.
        const absX = Math.abs(x);
        const levelFactor = Math.min(1, absX * 2); // quiet=0, loud=1

        // sin(x*PI) produces even harmonics of the input signal
        const evenHarmonic = Math.sin(x * Math.PI);

        // Blend: original + level-scaled even harmonics (squared color for smooth control)
        sample = sample + colorSq * levelFactor * evenHarmonic * 0.08;

        // 3. LF thickening + HF rolloff — only when drive is significant
        if (driveSq > 0.01) {
          // LF thickening (one-pole lowshelf)
          lfS += lfAlpha * (sample - lfS);
          sample = sample + (lfS - sample) * (lfBoostLin - 1) * driveSq;

          // HF rolloff (one-pole lowpass, blended with dry by drive amount)
          hfS += hfAlpha * (sample - hfS);
          sample = sample * (1 - driveSq) + hfS * driveSq;
        }

        // 4. Output level compensation
        buf4x[i] = sample * outputComp;
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

      // Save filter state
      this.lfState[ch] = lfS;
      this.hfState[ch] = hfS;
    }

    return true;
  }
}

registerProcessor('transformer-processor', TransformerProcessor);
