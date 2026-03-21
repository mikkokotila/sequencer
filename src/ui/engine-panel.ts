/**
 * Engine Control Panel — full-screen overlay with runtime settings,
 * master bus demo knobs, spectrum analyzer, and waveform oscilloscope.
 * Uses real AnalyserNodes on the master bus for live visualization.
 */

import { getAudioContext, getMasterGain, initAudio, setFinalOutput } from '../engine/audio';
import { rebuildAudioChain } from '../engine/extensions/registry';

// ── State ──
let isOpen = false;
let panelEl: HTMLDivElement | null = null;
let animFrame = 0;

// Audio demo chain nodes
let demoFilter: BiquadFilterNode | null = null;
let demoSaturator: WaveShaperNode | null = null;
let demoCompressor: DynamicsCompressorNode | null = null;
let demoGain: GainNode | null = null;
let analyser: AnalyserNode | null = null;
let analyserTime: AnalyserNode | null = null;

// Canvases
let spectrumCanvas: HTMLCanvasElement | null = null;
let waveformCanvas: HTMLCanvasElement | null = null;
let spectrumCtx: CanvasRenderingContext2D | null = null;
let waveformCtx: CanvasRenderingContext2D | null = null;

// Settings state
let bufferSize = 128;
let sampleRateVal = 48000;
let oversampleMode: OverSampleType = '4x';
let limiterOn = true;
let filterCutoff = 100; // 0-100% — wide open by default
let filterRes = 0; // 0-100% — no resonance by default
let saturation = 0; // 0-100% — no saturation by default
let compression = 0; // 0-100% — no compression by default

// Demo oscillator sources
let demoOscs: OscillatorNode[] = [];
let demoRunning = false;

// ── Helpers ──
function pctToFreq(pct: number): number {
  // 0%=200Hz, 100%=20000Hz, logarithmic
  return 200 * Math.pow(100, pct / 100);
}

function pctToQ(pct: number): number {
  return 0.5 + (pct / 100) * 14.5; // 0.5 to 15
}

function makeSatCurve(drive: number): Float32Array {
  const n = 4096;
  const curve = new Float32Array(n);
  const amount = drive / 100;
  if (amount < 0.001) {
    for (let i = 0; i < n; i++) curve[i] = (i * 2) / n - 1;
    return curve;
  }
  const k = 1 + amount * 50;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    const shaped = ((Math.PI + k) * x) / (Math.PI + k * Math.abs(x));
    const warmth = 0.04 * amount * (x * x - Math.abs(x));
    curve[i] = x * (1 - amount) + (shaped + warmth) * amount;
  }
  return curve;
}

// ── Audio Setup ──
// Engine processing is PERMANENT — initialized once at app startup,
// never torn down. Opening/closing the panel only shows/hides the UI
// and starts/stops the visualization animation loop.
//
// Engine processing sits AFTER the extension chain, BEFORE ctx.destination:
// masterGain → [extensions] → engineFilter → engineSaturator → engineCompressor → engineGain → destination
//                                                                                     ├→ analyser
//                                                                                     └→ analyserTime
//
// The engine creates a GainNode as the "finalOutput" that the extension chain
// connects to (via setFinalOutput). Then the engine chain connects that input
// through processing to ctx.destination. This is permanent — never torn down.
let engineInitialized = false;

export function initEngineProcessing(): void {
  if (engineInitialized) return;
  initAudio();
  const ctx = getAudioContext();
  if (!ctx) return;

  // Create the engine input node — this becomes the finalOutput that
  // the extension chain (or masterGain directly) connects to
  demoFilter = ctx.createBiquadFilter();
  demoFilter.type = 'lowpass';
  demoFilter.frequency.value = pctToFreq(filterCutoff);
  demoFilter.Q.value = pctToQ(filterRes);

  demoSaturator = ctx.createWaveShaper();
  demoSaturator.curve = makeSatCurve(saturation) as unknown as Float32Array<ArrayBuffer>;
  demoSaturator.oversample = oversampleMode;

  demoCompressor = ctx.createDynamicsCompressor();
  applyCompression(compression);

  demoGain = ctx.createGain();
  demoGain.gain.value = 1.0;

  analyser = ctx.createAnalyser();
  analyser.fftSize = 4096;
  analyser.smoothingTimeConstant = 0.8;

  analyserTime = ctx.createAnalyser();
  analyserTime.fftSize = 2048;
  analyserTime.smoothingTimeConstant = 0;

  // Wire the permanent engine chain
  demoFilter.connect(demoSaturator);
  demoSaturator.connect(demoCompressor);
  demoCompressor.connect(demoGain);
  demoGain.connect(ctx.destination);
  demoGain.connect(analyser);
  demoGain.connect(analyserTime);

  // Set the engine filter as the final output — everything upstream
  // (masterGain, extensions) now connects here instead of ctx.destination
  setFinalOutput(demoFilter);

  // Rebuild the extension chain so it connects to the new finalOutput
  rebuildAudioChain();

  engineInitialized = true;
}

function applyCompression(pct: number): void {
  if (!demoCompressor) return;
  // 0% = no compression, 100% = heavy
  const thresh = -6 - pct * 0.4; // -6 to -46
  const ratio = 1 + pct * 0.19; // 1 to 20
  demoCompressor.threshold.value = thresh;
  demoCompressor.ratio.value = ratio;
  demoCompressor.knee.value = 10;
  demoCompressor.attack.value = 0.003;
  demoCompressor.release.value = 0.15;
}

function startDemoOscs(): void {
  const ctx = getAudioContext();
  const master = getMasterGain();
  if (!ctx || !master || demoRunning) return;

  // Detuned sawtooth stack — connects to masterGain so it goes through
  // the same processing chain as the sequencer audio
  const freqs = [55, 55.1, 110, 110.15, 220, 220.3];
  freqs.forEach((f) => {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = f;
    const g = ctx.createGain();
    g.gain.value = 0.04; // quiet
    osc.connect(g).connect(master);
    osc.start();
    demoOscs.push(osc);
  });
  demoRunning = true;
}

function stopDemoOscs(): void {
  demoOscs.forEach((o) => {
    try {
      o.stop();
      o.disconnect();
    } catch {
      /* */
    }
  });
  demoOscs = [];
  demoRunning = false;
}

// ── Visualization ──
function drawSpectrum(): void {
  if (!spectrumCanvas || !spectrumCtx || !analyser) return;
  const w = spectrumCanvas.width;
  const h = spectrumCanvas.height;
  const ctx = spectrumCtx;

  const data = new Float32Array(analyser.frequencyBinCount);
  analyser.getFloatFrequencyData(data);

  const sr = sampleRateVal;
  const nyquist = sr / 2;
  const minF = 30;
  const maxF = nyquist;
  const logMin = Math.log10(minF);
  const logMax = Math.log10(maxF);
  const dbMin = -100;
  const dbMax = 0;

  ctx.clearRect(0, 0, w, h);

  // Grid
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  ctx.font = '9px monospace';
  ctx.fillStyle = '#444';

  // Frequency grid lines
  const freqLines = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
  freqLines.forEach((f) => {
    if (f > maxF) return;
    const x = ((Math.log10(f) - logMin) / (logMax - logMin)) * w;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
    const label = f >= 1000 ? `${f / 1000}k` : String(f);
    ctx.fillText(label, x + 3, h - 4);
  });

  // dB grid lines
  for (let db = -80; db <= 0; db += 10) {
    const y = (1 - (db - dbMin) / (dbMax - dbMin)) * h;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
    if (db % 20 === 0) ctx.fillText(`${db}dB`, 3, y - 3);
  }

  // Spectrum fill + stroke
  const binWidth = sr / analyser.fftSize;
  ctx.beginPath();
  let moved = false;

  for (let px = 0; px < w; px++) {
    const logF = logMin + (px / w) * (logMax - logMin);
    const freq = Math.pow(10, logF);
    const bin = Math.round(freq / binWidth);
    if (bin >= data.length) break;
    const db = data[bin] ?? dbMin;
    const y = (1 - (db - dbMin) / (dbMax - dbMin)) * h;

    if (!moved) {
      ctx.moveTo(px, y);
      moved = true;
    } else ctx.lineTo(px, y);
  }

  // Fill area
  const lastX = w;
  ctx.lineTo(lastX, h);
  ctx.lineTo(0, h);
  ctx.closePath();

  const gradient = ctx.createLinearGradient(0, 0, 0, h);
  gradient.addColorStop(0, 'rgba(92,220,200,0.30)');
  gradient.addColorStop(1, 'rgba(92,220,200,0.0)');
  ctx.fillStyle = gradient;
  ctx.fill();

  // Stroke on top
  ctx.beginPath();
  moved = false;
  for (let px = 0; px < w; px++) {
    const logF = logMin + (px / w) * (logMax - logMin);
    const freq = Math.pow(10, logF);
    const bin = Math.round(freq / binWidth);
    if (bin >= data.length) break;
    const db = data[bin] ?? dbMin;
    const y = (1 - (db - dbMin) / (dbMax - dbMin)) * h;
    if (!moved) {
      ctx.moveTo(px, y);
      moved = true;
    } else ctx.lineTo(px, y);
  }
  ctx.strokeStyle = '#5CDCC8';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Cutoff indicator
  const cutoffFreq = pctToFreq(filterCutoff);
  const cutoffX = ((Math.log10(cutoffFreq) - logMin) / (logMax - logMin)) * w;
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = '#EEA83E';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cutoffX, 0);
  ctx.lineTo(cutoffX, h);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#EEA83E';
  ctx.font = '8px monospace';
  const cutLabel =
    cutoffFreq >= 1000 ? `${(cutoffFreq / 1000).toFixed(1)}k` : `${Math.round(cutoffFreq)}Hz`;
  ctx.fillText(cutLabel, cutoffX + 4, 12);
}

function drawWaveform(): void {
  if (!waveformCanvas || !waveformCtx || !analyserTime) return;
  const w = waveformCanvas.width;
  const h = waveformCanvas.height;
  const ctx = waveformCtx;

  const bufLen = analyserTime.fftSize;
  const data = new Float32Array(bufLen);
  analyserTime.getFloatTimeDomainData(data);

  ctx.clearRect(0, 0, w, h);

  // Grid
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  ctx.font = '9px monospace';
  ctx.fillStyle = '#444';

  const ampLines = [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1];
  ampLines.forEach((a) => {
    const y = ((1 - a) * h) / 2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
    if (a === 0 || Math.abs(a) === 0.5 || Math.abs(a) === 1) {
      ctx.fillText(a.toFixed(1), 3, y - 3);
    }
  });

  // Zero-crossing trigger
  let trigIdx = 0;
  for (let i = 1; i < bufLen; i++) {
    const prev = data[i - 1];
    const curr = data[i];
    if (prev !== undefined && curr !== undefined && prev < 0 && curr >= 0) {
      trigIdx = i;
      break;
    }
  }

  // Draw ~2 periods from trigger
  const drawLen = Math.min(bufLen - trigIdx, Math.round(bufLen * 0.5));

  // Fill area
  ctx.beginPath();
  for (let i = 0; i < drawLen; i++) {
    const x = (i / drawLen) * w;
    const sample = data[trigIdx + i] ?? 0;
    const y = ((1 - sample) * h) / 2;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  // Close to center line for fill
  ctx.lineTo(w, h / 2);
  ctx.lineTo(0, h / 2);
  ctx.closePath();

  const gradient = ctx.createLinearGradient(0, 0, 0, h);
  gradient.addColorStop(0, 'rgba(140,156,240,0.12)');
  gradient.addColorStop(0.5, 'rgba(140,156,240,0.0)');
  gradient.addColorStop(1, 'rgba(140,156,240,0.12)');
  ctx.fillStyle = gradient;
  ctx.fill();

  // Stroke
  ctx.beginPath();
  for (let i = 0; i < drawLen; i++) {
    const x = (i / drawLen) * w;
    const sample = data[trigIdx + i] ?? 0;
    const y = ((1 - sample) * h) / 2;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = '#8C9CF0';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Compression threshold lines
  if (compression > 5) {
    const threshLin = Math.pow(10, demoCompressor!.threshold.value / 20);
    const yTop = ((1 - threshLin) * h) / 2;
    const yBot = ((1 + threshLin) * h) / 2;
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = '#EEA83E';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, yTop);
    ctx.lineTo(w, yTop);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, yBot);
    ctx.lineTo(w, yBot);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#EEA83E';
    ctx.font = '7px monospace';
    ctx.fillText('THRESH', w - 40, yTop - 3);
  }
}

function animLoop(): void {
  if (!isOpen) return;
  drawSpectrum();
  drawWaveform();
  animFrame = requestAnimationFrame(animLoop);
}

// ── Computed readouts ──
function getLatency(): string {
  return ((bufferSize / sampleRateVal) * 2000).toFixed(2) + ' ms';
}

function getBlockBudget(): string {
  return ((bufferSize / sampleRateVal) * 1000).toFixed(2) + ' ms';
}

function getEffectiveRate(): string {
  const mult = oversampleMode === 'none' ? 1 : oversampleMode === '2x' ? 2 : 4;
  const rate = sampleRateVal * mult;
  return rate >= 1000 ? `${(rate / 1000).toFixed(0)}kHz` : `${rate}Hz`;
}

function getDSPLoad(): number {
  const osMultiplier = oversampleMode === 'none' ? 1 : oversampleMode === '2x' ? 2 : 3;
  const bufMultiplier =
    bufferSize <= 64 ? 4 : bufferSize <= 128 ? 2.5 : bufferSize <= 256 ? 1.5 : 1;
  return Math.min(100, Math.round(12 * osMultiplier * bufMultiplier));
}

// ── UI Building ──
function makeSelect(
  id: string,
  options: string[],
  defaultVal: string,
  onChange: (v: string) => void,
): HTMLSelectElement {
  const sel = document.createElement('select');
  sel.id = id;
  sel.style.cssText =
    'background:#222;border:1px solid #333;color:#ddd;padding:4px 8px;border-radius:4px;font:11px monospace;cursor:pointer;';
  options.forEach((opt) => {
    const o = document.createElement('option');
    o.value = opt;
    o.textContent = opt;
    if (opt === defaultVal) o.selected = true;
    sel.appendChild(o);
  });
  sel.onchange = () => onChange(sel.value);
  return sel;
}

function makeKnob(label: string, initial: number, onChange: (v: number) => void): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:4px;flex:1;';

  const valDisplay = document.createElement('div');
  valDisplay.style.cssText = 'font:11px monospace;color:#ddd;';
  valDisplay.textContent = `${initial}%`;

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '100';
  slider.value = String(initial);
  slider.style.cssText = 'width:100%;accent-color:#888;cursor:pointer;';
  slider.oninput = () => {
    const v = Number(slider.value);
    valDisplay.textContent = `${v}%`;
    onChange(v);
  };

  const lbl = document.createElement('div');
  lbl.style.cssText = 'font:8px monospace;color:#666;letter-spacing:1px;text-transform:uppercase;';
  lbl.textContent = label;

  wrap.appendChild(valDisplay);
  wrap.appendChild(slider);
  wrap.appendChild(lbl);
  return wrap;
}

function makeRow(label: string, value: string | HTMLElement): HTMLDivElement {
  const row = document.createElement('div');
  row.style.cssText =
    'display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #222;';

  const lbl = document.createElement('div');
  lbl.style.cssText = 'font:10px monospace;color:#999;';
  lbl.textContent = label;

  const val = document.createElement('div');
  val.style.cssText = 'font:11px monospace;color:#ddd;';
  if (typeof value === 'string') {
    val.textContent = value;
  } else {
    val.appendChild(value);
  }

  row.appendChild(lbl);
  row.appendChild(val);
  return row;
}

function makeSectionTitle(text: string): HTMLDivElement {
  const d = document.createElement('div');
  d.style.cssText =
    'font:9px monospace;color:#666;letter-spacing:2px;text-transform:uppercase;padding:16px 0 8px;border-bottom:1px solid #2a2a32;margin-bottom:8px;';
  d.textContent = text;
  return d;
}

function buildPanel(): HTMLDivElement {
  const panel = document.createElement('div');
  panel.id = 'engine-panel';
  panel.style.cssText = `
    position:fixed;inset:0;z-index:850;
    background:#18181D;
    display:flex;
    opacity:0;pointer-events:none;
    transition:opacity 0.35s cubic-bezier(0.4,0,0.2,1);
  `;

  // ── Left: Visualizations (stacked) ──
  const vizSide = document.createElement('div');
  vizSide.style.cssText =
    'flex:1;display:flex;flex-direction:column;padding:16px;gap:8px;min-width:0;';

  // Spectrum
  const specWrap = document.createElement('div');
  specWrap.style.cssText =
    'flex:1;position:relative;border:1px solid #2a2a32;border-radius:8px;overflow:hidden;background:#111;';
  const specLabel = document.createElement('div');
  specLabel.style.cssText =
    'position:absolute;top:8px;left:10px;font:9px monospace;color:#5CDCC8;letter-spacing:1.5px;z-index:1;opacity:0.7;';
  specLabel.textContent = 'SPECTRUM ANALYZER';
  spectrumCanvas = document.createElement('canvas');
  spectrumCanvas.style.cssText = 'width:100%;height:100%;display:block;';
  specWrap.appendChild(specLabel);
  specWrap.appendChild(spectrumCanvas);
  vizSide.appendChild(specWrap);

  // Waveform
  const waveWrap = document.createElement('div');
  waveWrap.style.cssText =
    'flex:1;position:relative;border:1px solid #2a2a32;border-radius:8px;overflow:hidden;background:#111;';
  const waveLabel = document.createElement('div');
  waveLabel.style.cssText =
    'position:absolute;top:8px;left:10px;font:9px monospace;color:#8C9CF0;letter-spacing:1.5px;z-index:1;opacity:0.7;';
  waveLabel.textContent = 'WAVEFORM OSCILLOSCOPE';
  waveformCanvas = document.createElement('canvas');
  waveformCanvas.style.cssText = 'width:100%;height:100%;display:block;';
  waveWrap.appendChild(waveLabel);
  waveWrap.appendChild(waveformCanvas);
  vizSide.appendChild(waveWrap);

  panel.appendChild(vizSide);

  // ── Right: Controls ──
  const ctrlSide = document.createElement('div');
  ctrlSide.style.cssText =
    'width:320px;flex-shrink:0;border-left:1px solid #2a2a32;overflow-y:auto;padding:16px 20px;display:flex;flex-direction:column;';

  // Header
  const header = document.createElement('div');
  header.style.cssText =
    'display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;';
  const title = document.createElement('div');
  title.style.cssText = 'font:11px monospace;font-weight:800;color:#bbb;letter-spacing:2.5px;';
  title.textContent = 'ENGINE';
  const closeBtn = document.createElement('button');
  closeBtn.style.cssText =
    'width:26px;height:26px;border-radius:50%;border:1px solid #333;background:transparent;color:#888;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;transition:all 0.15s;';
  closeBtn.textContent = '\u00D7';
  closeBtn.onmouseenter = () => {
    closeBtn.style.background = 'rgba(255,60,90,0.15)';
    closeBtn.style.color = '#ff5070';
  };
  closeBtn.onmouseleave = () => {
    closeBtn.style.background = 'transparent';
    closeBtn.style.color = '#888';
  };
  closeBtn.onclick = () => toggle();
  header.appendChild(title);
  header.appendChild(closeBtn);
  ctrlSide.appendChild(header);

  // DSP Load
  const loadWrap = document.createElement('div');
  loadWrap.style.cssText = 'margin-bottom:16px;';
  const loadLabel = document.createElement('div');
  loadLabel.style.cssText = 'font:8px monospace;color:#666;letter-spacing:1.5px;margin-bottom:4px;';
  loadLabel.textContent = 'DSP LOAD';
  const loadBar = document.createElement('div');
  loadBar.style.cssText = 'height:4px;background:#222;border-radius:2px;overflow:hidden;';
  const loadFill = document.createElement('div');
  loadFill.id = 'dsp-load-fill';
  loadFill.style.cssText = 'height:100%;border-radius:2px;transition:width 0.3s,background 0.3s;';
  updateDSPLoad(loadFill);
  loadBar.appendChild(loadFill);
  const loadVal = document.createElement('div');
  loadVal.id = 'dsp-load-val';
  loadVal.style.cssText = 'font:10px monospace;color:#999;margin-top:2px;text-align:right;';
  loadVal.textContent = `${getDSPLoad()}%`;
  loadWrap.appendChild(loadLabel);
  loadWrap.appendChild(loadBar);
  loadWrap.appendChild(loadVal);
  ctrlSide.appendChild(loadWrap);

  // Runtime section
  ctrlSide.appendChild(makeSectionTitle('Runtime'));
  ctrlSide.appendChild(
    makeRow(
      'Buffer Size',
      makeSelect('ep-buf', ['64', '128', '256', '512'], String(bufferSize), (v) => {
        bufferSize = Number(v);
        updateReadouts();
      }),
    ),
  );
  ctrlSide.appendChild(
    makeRow(
      'Sample Rate',
      makeSelect('ep-sr', ['44100', '48000', '96000'], String(sampleRateVal), (v) => {
        sampleRateVal = Number(v);
        updateReadouts();
      }),
    ),
  );

  // Playback section
  ctrlSide.appendChild(makeSectionTitle('Playback'));
  ctrlSide.appendChild(makeRow('Playback Engine', 'Native AudioBufferSourceNode'));

  // Effects section
  ctrlSide.appendChild(makeSectionTitle('Effects'));
  ctrlSide.appendChild(
    makeRow(
      'Oversampling',
      makeSelect('ep-os', ['none', '2x', '4x', '8x'], oversampleMode, (v) => {
        oversampleMode = v as OverSampleType;
        if (demoSaturator) demoSaturator.oversample = oversampleMode;
        updateReadouts();
      }),
    ),
  );
  ctrlSide.appendChild(makeRow('EQ', 'Native BiquadFilter'));
  ctrlSide.appendChild(
    makeRow(
      'Reverb Algorithm',
      makeSelect('ep-rev', ['Freeverb'], 'Freeverb', () => {
        /* noop — single option */
      }),
    ),
  );

  // Limiter toggle
  const limiterToggle = document.createElement('div');
  limiterToggle.style.cssText =
    'cursor:pointer;width:36px;height:18px;border-radius:9px;background:#1e2036;border:1px solid #2e3150;position:relative;transition:all 0.25s;';
  const limiterDot = document.createElement('div');
  limiterDot.style.cssText =
    'position:absolute;top:2px;left:20px;width:12px;height:12px;border-radius:50%;background:#4afe70;transition:all 0.25s;';
  limiterToggle.style.background = 'rgba(74,254,112,0.15)';
  limiterToggle.style.borderColor = 'rgba(74,254,112,0.4)';
  limiterToggle.appendChild(limiterDot);
  limiterToggle.onclick = () => {
    limiterOn = !limiterOn;
    limiterDot.style.left = limiterOn ? '20px' : '2px';
    limiterDot.style.background = limiterOn ? '#4afe70' : '#505478';
    limiterToggle.style.background = limiterOn ? 'rgba(74,254,112,0.15)' : '#1e2036';
    limiterToggle.style.borderColor = limiterOn ? 'rgba(74,254,112,0.4)' : '#2e3150';
  };
  ctrlSide.appendChild(makeRow('Master Limiter', limiterToggle));

  // Master Bus Demo
  ctrlSide.appendChild(makeSectionTitle('Master Bus Demo'));
  const knobRow = document.createElement('div');
  knobRow.style.cssText = 'display:flex;gap:12px;margin-top:8px;';
  knobRow.appendChild(
    makeKnob('Cutoff', filterCutoff, (v) => {
      filterCutoff = v;
      if (demoFilter) demoFilter.frequency.value = pctToFreq(v);
    }),
  );
  knobRow.appendChild(
    makeKnob('Resonance', filterRes, (v) => {
      filterRes = v;
      if (demoFilter) demoFilter.Q.value = pctToQ(v);
    }),
  );
  ctrlSide.appendChild(knobRow);

  const knobRow2 = document.createElement('div');
  knobRow2.style.cssText = 'display:flex;gap:12px;margin-top:12px;';
  knobRow2.appendChild(
    makeKnob('Saturation', saturation, (v) => {
      saturation = v;
      if (demoSaturator)
        demoSaturator.curve = makeSatCurve(v) as unknown as Float32Array<ArrayBuffer>;
    }),
  );
  knobRow2.appendChild(
    makeKnob('Compression', compression, (v) => {
      compression = v;
      applyCompression(v);
    }),
  );
  ctrlSide.appendChild(knobRow2);

  // Demo sound toggle
  const demoBtn = document.createElement('button');
  demoBtn.style.cssText =
    'margin-top:16px;width:100%;padding:8px;background:#222;border:1px solid #333;border-radius:4px;color:#999;font:9px monospace;letter-spacing:1.5px;cursor:pointer;transition:all 0.15s;';
  demoBtn.textContent = 'START TEST SIGNAL';
  demoBtn.onclick = () => {
    if (demoRunning) {
      stopDemoOscs();
      demoBtn.textContent = 'START TEST SIGNAL';
      demoBtn.style.borderColor = '#333';
      demoBtn.style.color = '#999';
    } else {
      startDemoOscs();
      demoBtn.textContent = 'STOP TEST SIGNAL';
      demoBtn.style.borderColor = 'rgba(74,254,112,0.4)';
      demoBtn.style.color = '#4afe70';
    }
  };
  ctrlSide.appendChild(demoBtn);

  // Readout section
  ctrlSide.appendChild(makeSectionTitle('Readout'));
  const readoutLatency = document.createElement('div');
  const readoutBudget = document.createElement('div');
  const readoutRate = document.createElement('div');
  readoutLatency.id = 'ep-latency';
  readoutBudget.id = 'ep-budget';
  readoutRate.id = 'ep-effrate';
  ctrlSide.appendChild(makeRow('Round-trip Latency', getLatency()));
  ctrlSide.appendChild(makeRow('Block Budget', getBlockBudget()));
  ctrlSide.appendChild(makeRow('Effective Oversample Rate', getEffectiveRate()));

  panel.appendChild(ctrlSide);
  return panel;
}

function updateDSPLoad(fillEl?: HTMLDivElement | null): void {
  const load = getDSPLoad();
  const el = fillEl ?? (document.getElementById('dsp-load-fill') as HTMLDivElement | null);
  const val = document.getElementById('dsp-load-val');
  if (el) {
    el.style.width = `${load}%`;
    el.style.background = load < 50 ? '#4afe70' : load < 75 ? '#EEA83E' : '#ff3c5a';
  }
  if (val) val.textContent = `${load}%`;
}

function updateReadouts(): void {
  // Update readout values in the existing DOM
  const rows = panelEl?.querySelectorAll('[style*="justify-content:space-between"]');
  if (!rows) return;
  rows.forEach((row) => {
    const label = row.querySelector('div:first-child');
    const value = row.querySelector('div:last-child');
    if (!label || !value || value.querySelector('select') || value.querySelector('div')) return;
    const txt = label.textContent || '';
    if (txt === 'Round-trip Latency') value.textContent = getLatency();
    if (txt === 'Block Budget') value.textContent = getBlockBudget();
    if (txt === 'Effective Oversample Rate') value.textContent = getEffectiveRate();
  });
  updateDSPLoad();
}

function resizeCanvases(): void {
  [spectrumCanvas, waveformCanvas].forEach((c) => {
    if (!c) return;
    const rect = c.getBoundingClientRect();
    c.width = rect.width * (window.devicePixelRatio || 1);
    c.height = rect.height * (window.devicePixelRatio || 1);
    const ctx2d = c.getContext('2d');
    if (ctx2d) ctx2d.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
  });
  spectrumCtx = spectrumCanvas?.getContext('2d') ?? null;
  waveformCtx = waveformCanvas?.getContext('2d') ?? null;
}

// ── Public API ──
export function toggle(): void {
  if (isOpen) {
    close();
  } else {
    open();
  }
}

export function open(): void {
  if (isOpen) return;

  if (!panelEl) {
    panelEl = buildPanel();
    document.body.appendChild(panelEl);
  }

  // Close any open extension panel
  const extPanel = document.getElementById('ext-panel');
  if (extPanel?.classList.contains('open')) {
    extPanel.classList.remove('open');
    document.getElementById('app')?.classList.remove('ext-panel-open');
    document.body.classList.remove('ext-panel-open');
    document.querySelectorAll('.ext-icon-btn.active').forEach((b) => b.classList.remove('active'));
  }

  isOpen = true;
  const app = document.getElementById('app');
  const songPane = document.getElementById('song-pane');
  if (app) app.style.display = 'none';
  if (songPane) songPane.style.display = 'none';

  requestAnimationFrame(() => {
    if (panelEl) {
      panelEl.style.opacity = '1';
      panelEl.style.pointerEvents = 'auto';
    }
    requestAnimationFrame(() => {
      resizeCanvases();
      animLoop();
    });
  });

  // Update engine icon
  const btn = document.getElementById('engine-icon-btn');
  if (btn) btn.classList.add('active');
}

export function close(): void {
  if (!isOpen) return;
  isOpen = false;

  if (animFrame) cancelAnimationFrame(animFrame);
  stopDemoOscs();
  // Audio processing stays active — only the UI closes

  if (panelEl) {
    panelEl.style.opacity = '0';
    panelEl.style.pointerEvents = 'none';
  }

  const app = document.getElementById('app');
  const songPane = document.getElementById('song-pane');
  if (app) app.style.display = '';
  if (songPane) songPane.style.display = '';

  const btn = document.getElementById('engine-icon-btn');
  if (btn) btn.classList.remove('active');
}

export function isEngineOpen(): boolean {
  return isOpen;
}

// Handle window resize
if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => {
    if (isOpen) resizeCanvases();
  });
}
