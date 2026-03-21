/**
 * Vari-Mu — Tube bus compressor extension.
 *
 * Uses AudioWorklet processors:
 *   - saturation-processor (drive, mix)
 *   - compressor-processor (threshold, ratio, knee, attack, release, makeupGain)
 */

import type { Extension, ExtensionState, NodePair } from '../../types';
import { makeSlider, formatPct } from '../../ui/helpers';

// ═══════════════════════════════════════════
//  Internal types
// ═══════════════════════════════════════════

interface VariMuState {
  drive: number;
  compress: number;
  ratio: number;
  knee: number;
  speed: number;
  mix: number;
  output: number;
}

interface VariMuNodes {
  inputGain: GainNode;
  saturation: AudioWorkletNode;
  compressor: AudioWorkletNode;
  wetGain: GainNode;
  dryGain: GainNode;
  outputGain: GainNode;
  ctx: AudioContext;
}

interface SpeedPreset {
  readonly attack: number;
  readonly release: number;
  readonly label: string;
}

// ═══════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════

function setWorkletParam(node: AudioWorkletNode, name: string, value: number): void {
  const param = node.parameters.get(name);
  if (param) param.value = value;
}

// ═══════════════════════════════════════════
//  Factory
// ═══════════════════════════════════════════

export function createVariMu(): Extension {
  let state: VariMuState = {
    drive: 0.15,
    compress: -18,
    ratio: 4,
    knee: 30,
    speed: 2,
    mix: 1.0,
    output: 0.55,
  };

  const SPEED_PRESETS: readonly SpeedPreset[] = [
    { attack: 0.002, release: 0.05, label: 'FAST' },
    { attack: 0.01, release: 0.15, label: 'MED' },
    { attack: 0.05, release: 0.4, label: 'SLOW' },
    { attack: 0.1, release: 0.8, label: 'HOLD' },
  ];

  let nodes: VariMuNodes | null = null;
  let grFill: HTMLElement | null = null;
  let grVal: HTMLElement | null = null;
  let grRAF: number | null = null;

  // ═══════════════════════════════════════════
  //  APPLY STATE
  // ═══════════════════════════════════════════
  function applyState(): void {
    if (!nodes) return;
    const { inputGain, saturation, compressor, wetGain, dryGain, outputGain } = nodes;

    inputGain.gain.value = 1 + state.drive * 1.5;
    setWorkletParam(saturation, 'drive', state.drive);
    setWorkletParam(saturation, 'mix', 1);

    setWorkletParam(compressor, 'threshold', state.compress);
    setWorkletParam(compressor, 'ratio', state.ratio);
    setWorkletParam(compressor, 'knee', state.knee);
    setWorkletParam(compressor, 'makeupGain', 1);

    const preset = SPEED_PRESETS[state.speed] ?? SPEED_PRESETS[2]!;
    setWorkletParam(compressor, 'attack', preset.attack);
    setWorkletParam(compressor, 'release', preset.release);

    wetGain.gain.value = state.mix;
    dryGain.gain.value = 1 - state.mix;

    outputGain.gain.value = state.output * 1.5;
  }

  // ═══════════════════════════════════════════
  //  GR METER (visual only — reads no native compressor)
  // ═══════════════════════════════════════════
  function startGRMeter(): void {
    if (grRAF !== null) cancelAnimationFrame(grRAF);
    function tick(): void {
      // AudioWorklet compressor doesn't expose .reduction —
      // show placeholder until a message-port solution is added.
      if (grFill && grVal) {
        grFill.style.width = '0%';
        grVal.textContent = '0.0 dB';
      }
      grRAF = requestAnimationFrame(tick);
    }
    tick();
  }

  // ═══════════════════════════════════════════
  //  EXTENSION OBJECT
  // ═══════════════════════════════════════════
  return {
    id: 'vari-mu',
    name: 'Vari-Mu',
    icon: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 12L5 4L8 10L11 2L14 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',

    init(ctx: AudioContext): NodePair {
      const inputGain = ctx.createGain();
      const saturation = new AudioWorkletNode(ctx, 'saturation-processor');
      const compressor = new AudioWorkletNode(ctx, 'compressor-processor');
      const wetGain = ctx.createGain();
      const dryGain = ctx.createGain();
      const outputGain = ctx.createGain();

      inputGain.connect(saturation);
      saturation.connect(compressor);
      compressor.connect(wetGain);
      wetGain.connect(outputGain);

      inputGain.connect(dryGain);
      dryGain.connect(outputGain);

      nodes = { inputGain, saturation, compressor, wetGain, dryGain, outputGain, ctx };
      applyState();

      return { input: inputGain, output: outputGain };
    },

    createUI(container: HTMLElement): void {
      container.innerHTML = '';
      grFill = null;
      grVal = null;

      const title = document.createElement('div');
      title.style.cssText =
        'font-size:8px;font-weight:700;letter-spacing:2px;color:#666;margin-bottom:20px;padding-bottom:8px;border-bottom:1px solid #2a2a32;';
      title.textContent = 'TUBE BUS COMPRESSOR';
      container.appendChild(title);

      makeSlider(
        container,
        'DRIVE',
        state.drive,
        0,
        1,
        0.01,
        (v) => formatPct(v),
        (v) => {
          state.drive = v;
          applyState();
          window.SEQ.notifyStateChange();
        },
      );

      makeSlider(
        container,
        'COMPRESS',
        state.compress,
        -50,
        0,
        1,
        (v) => `${Math.round(v)} dB`,
        (v) => {
          state.compress = v;
          applyState();
          window.SEQ.notifyStateChange();
        },
      );

      makeSlider(
        container,
        'RATIO',
        state.ratio,
        1,
        20,
        0.5,
        (v) => v.toFixed(1) + ':1',
        (v) => {
          state.ratio = v;
          applyState();
          window.SEQ.notifyStateChange();
        },
      );

      makeSlider(
        container,
        'KNEE',
        state.knee,
        0,
        40,
        1,
        (v) => `${Math.round(v)} dB`,
        (v) => {
          state.knee = v;
          applyState();
          window.SEQ.notifyStateChange();
        },
      );

      makeSlider(
        container,
        'SPEED',
        state.speed,
        0,
        3,
        1,
        (v) => SPEED_PRESETS[Math.round(v)]?.label ?? '',
        (v) => {
          state.speed = Math.round(v);
          applyState();
          window.SEQ.notifyStateChange();
        },
      );

      makeSlider(
        container,
        'MIX',
        state.mix,
        0,
        1,
        0.01,
        (v) => formatPct(v),
        (v) => {
          state.mix = v;
          applyState();
          window.SEQ.notifyStateChange();
        },
      );

      makeSlider(
        container,
        'OUTPUT',
        state.output,
        0,
        1,
        0.01,
        (v) => formatPct(v),
        (v) => {
          state.output = v;
          applyState();
          window.SEQ.notifyStateChange();
        },
      );

      // GR Meter
      const grSec = document.createElement('div');
      grSec.style.cssText = 'margin-top:24px;padding-top:16px;border-top:1px solid #2a2a32;';

      const grLabel = document.createElement('div');
      grLabel.style.cssText =
        'font-size:8px;font-weight:800;letter-spacing:2px;color:#666;margin-bottom:8px;';
      grLabel.textContent = 'GAIN REDUCTION';
      grSec.appendChild(grLabel);

      const grTrack = document.createElement('div');
      grTrack.style.cssText =
        'height:6px;background:#111320;border-radius:3px;overflow:hidden;border:1px solid #2a2a32;';
      const fillEl = document.createElement('div');
      fillEl.style.cssText =
        'height:100%;width:0%;background:linear-gradient(90deg,#ff8c38,#ff3b5c);border-radius:3px;transition:width 0.06s linear;';
      grTrack.appendChild(fillEl);
      grSec.appendChild(grTrack);

      const valEl = document.createElement('div');
      valEl.style.cssText =
        'font-size:10px;font-weight:700;color:#ff8c38;margin-top:4px;text-align:right;font-variant-numeric:tabular-nums;';
      valEl.textContent = '0.0 dB';
      grSec.appendChild(valEl);
      container.appendChild(grSec);

      grFill = fillEl;
      grVal = valEl;
      startGRMeter();
    },

    getState(): ExtensionState {
      return { ...state };
    },

    setState(s: ExtensionState): void {
      state = { ...state, ...(s as Partial<VariMuState>) };
      applyState();
    },

    setEnabled(on: boolean): void {
      if (!nodes) return;
      if (on) {
        applyState();
      } else {
        nodes.wetGain.gain.value = 0;
        nodes.dryGain.gain.value = 1;
        nodes.inputGain.gain.value = 1;
        // Bypass saturation: drive=0 means identity
        setWorkletParam(nodes.saturation, 'drive', 0);
        // Bypass compressor: threshold=0 means no compression
        setWorkletParam(nodes.compressor, 'threshold', 0);
      }
    },

    destroy(): void {
      if (grRAF !== null) cancelAnimationFrame(grRAF);
      if (nodes) {
        const { inputGain, saturation, compressor, wetGain, dryGain, outputGain } = nodes;
        const allNodes: AudioNode[] = [
          inputGain,
          saturation,
          compressor,
          wetGain,
          dryGain,
          outputGain,
        ];
        for (const n of allNodes) {
          try {
            n.disconnect();
          } catch {
            /* already disconnected */
          }
        }
        nodes = null;
      }
    },
  };
}
