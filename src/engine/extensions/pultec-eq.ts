/**
 * Pultec EQ — EQP-1A Program Equalizer emulation.
 *
 * EQ bands use native BiquadFilterNodes.
 * Tube coloration uses AudioWorklet processor:
 *   - saturation-processor (drive, mix)
 */

import type { Extension, ExtensionState, NodePair } from '../../types';
import { makeSlider } from '../../ui/helpers';

// ═══════════════════════════════════════════
//  Internal types
// ═══════════════════════════════════════════

interface PultecState {
  lowBoost: number;
  lowAtten: number;
  lowFreq: number;
  highBoost: number;
  highBandwidth: number;
  highAtten: number;
  highBoostFreq: number;
  highAttenFreq: number;
  tubeColor: number;
}

interface PultecNodes {
  lowBoostFilter: BiquadFilterNode;
  lowAttenFilter: BiquadFilterNode;
  highBoostFilter: BiquadFilterNode;
  highAttenFilter: BiquadFilterNode;
  tubeSat: AudioWorkletNode;
  outputGain: GainNode;
  ctx: AudioContext;
}

interface SelectOption {
  readonly v: number;
  readonly l: string;
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

export function createPultecEq(): Extension {
  let state: PultecState = {
    lowBoost: 0,
    lowAtten: 0,
    lowFreq: 60,
    highBoost: 0,
    highBandwidth: 0.5,
    highAtten: 0,
    highBoostFreq: 5000,
    highAttenFreq: 10000,
    tubeColor: 0.0, // off by default — user adds warmth intentionally
  };

  let nodes: PultecNodes | null = null;
  let enabled = false;

  function applyState(): void {
    if (!nodes) return;
    const { lowBoostFilter, lowAttenFilter, highBoostFilter, highAttenFilter, tubeSat } = nodes;

    lowBoostFilter.frequency.value = state.lowFreq;
    lowBoostFilter.gain.value = state.lowBoost;

    lowAttenFilter.frequency.value = state.lowFreq;
    lowAttenFilter.gain.value = -state.lowAtten;

    highBoostFilter.frequency.value = state.highBoostFreq;
    highBoostFilter.gain.value = state.highBoost;
    highBoostFilter.Q.value = 0.5 + state.highBandwidth * 3;

    highAttenFilter.frequency.value = state.highAttenFreq;
    highAttenFilter.gain.value = -state.highAtten;

    setWorkletParam(tubeSat, 'drive', state.tubeColor);
    setWorkletParam(tubeSat, 'mix', 1);
  }

  // ═══════════════════════════════════════════
  //  Local UI helpers
  // ═══════════════════════════════════════════
  function sectionLabel(container: HTMLElement, text: string): void {
    const s = document.createElement('div');
    s.style.cssText =
      'font-size:7px;font-weight:800;letter-spacing:2px;color:#666;margin-top:16px;margin-bottom:10px;padding-top:10px;border-top:1px solid #2a2a32;';
    s.textContent = text;
    container.appendChild(s);
  }

  function makeSelect(
    container: HTMLElement,
    label: string,
    currentVal: number,
    options: readonly SelectOption[],
    onChange: (v: number) => void,
  ): void {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:12px;';
    const lbl = document.createElement('div');
    lbl.style.cssText =
      'font-size:8px;font-weight:800;letter-spacing:1.5px;color:#999;width:70px;flex-shrink:0;';
    lbl.textContent = label;
    wrap.appendChild(lbl);
    const sel = document.createElement('select');
    sel.style.cssText =
      'flex:1;background:#181a2a;border:1px solid #2a2a32;border-radius:4px;color:#ddd;padding:3px 6px;font-size:10px;font-family:inherit;cursor:pointer;';
    options.forEach((o) => {
      const opt = document.createElement('option');
      opt.value = String(o.v);
      opt.textContent = o.l;
      if (o.v === currentVal) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.onchange = () => onChange(parseFloat(sel.value));
    wrap.appendChild(sel);
    container.appendChild(wrap);
  }

  return {
    id: 'pultec-eq',
    name: 'Pultec EQ',
    icon: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M1 10 Q4 4 8 8 Q12 12 15 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="1" y1="13" x2="15" y2="13" stroke="currentColor" stroke-width="0.8" opacity="0.3"/></svg>',

    init(ctx: AudioContext): NodePair {
      const lowBoostFilter = ctx.createBiquadFilter();
      lowBoostFilter.type = 'lowshelf';
      lowBoostFilter.frequency.value = state.lowFreq;
      lowBoostFilter.gain.value = state.lowBoost;

      const lowAttenFilter = ctx.createBiquadFilter();
      lowAttenFilter.type = 'lowshelf';
      lowAttenFilter.frequency.value = state.lowFreq;
      lowAttenFilter.gain.value = -state.lowAtten;

      const highBoostFilter = ctx.createBiquadFilter();
      highBoostFilter.type = 'peaking';
      highBoostFilter.frequency.value = state.highBoostFreq;
      highBoostFilter.gain.value = state.highBoost;
      highBoostFilter.Q.value = 0.5 + state.highBandwidth * 3;

      const highAttenFilter = ctx.createBiquadFilter();
      highAttenFilter.type = 'highshelf';
      highAttenFilter.frequency.value = state.highAttenFreq;
      highAttenFilter.gain.value = -state.highAtten;

      const tubeSat = new AudioWorkletNode(ctx, 'saturation-processor');

      const outputGain = ctx.createGain();
      outputGain.gain.value = 1;

      lowBoostFilter.connect(lowAttenFilter);
      lowAttenFilter.connect(highBoostFilter);
      highBoostFilter.connect(highAttenFilter);
      highAttenFilter.connect(tubeSat);
      tubeSat.connect(outputGain);

      nodes = {
        lowBoostFilter,
        lowAttenFilter,
        highBoostFilter,
        highAttenFilter,
        tubeSat,
        outputGain,
        ctx,
      };
      applyState();

      return { input: lowBoostFilter, output: outputGain };
    },

    createUI(container: HTMLElement): void {
      container.innerHTML = '';

      const title = document.createElement('div');
      title.style.cssText =
        'font-size:8px;font-weight:700;letter-spacing:2px;color:#666;margin-bottom:20px;padding-bottom:8px;border-bottom:1px solid #2a2a32;';
      title.textContent = 'PULTEC EQP-1A PROGRAM EQ';
      container.appendChild(title);

      // LOW section
      sectionLabel(container, 'LOW FREQUENCY');

      makeSlider(
        container,
        'BOOST',
        state.lowBoost,
        0,
        10,
        0.1,
        (v) => v.toFixed(1) + ' dB',
        (v) => {
          state.lowBoost = v;
          if (enabled) applyState();
          window.SEQ.notifyStateChange();
        },
      );

      makeSlider(
        container,
        'ATTEN',
        state.lowAtten,
        0,
        10,
        0.1,
        (v) => v.toFixed(1) + ' dB',
        (v) => {
          state.lowAtten = v;
          if (enabled) applyState();
          window.SEQ.notifyStateChange();
        },
      );

      makeSelect(
        container,
        'FREQ',
        state.lowFreq,
        [
          { v: 20, l: '20 Hz' },
          { v: 30, l: '30 Hz' },
          { v: 60, l: '60 Hz' },
          { v: 100, l: '100 Hz' },
        ],
        (v) => {
          state.lowFreq = v;
          if (enabled) applyState();
          window.SEQ.notifyStateChange();
        },
      );

      // HIGH section
      sectionLabel(container, 'HIGH FREQUENCY');

      makeSlider(
        container,
        'BOOST',
        state.highBoost,
        0,
        10,
        0.1,
        (v) => v.toFixed(1) + ' dB',
        (v) => {
          state.highBoost = v;
          if (enabled) applyState();
          window.SEQ.notifyStateChange();
        },
      );

      makeSlider(
        container,
        'BANDWIDTH',
        state.highBandwidth,
        0,
        1,
        0.01,
        (v) => (v < 0.33 ? 'BROAD' : v < 0.66 ? 'MEDIUM' : 'SHARP'),
        (v) => {
          state.highBandwidth = v;
          if (enabled) applyState();
          window.SEQ.notifyStateChange();
        },
      );

      makeSelect(
        container,
        'BOOST FREQ',
        state.highBoostFreq,
        [
          { v: 3000, l: '3 kHz' },
          { v: 4000, l: '4 kHz' },
          { v: 5000, l: '5 kHz' },
          { v: 8000, l: '8 kHz' },
          { v: 10000, l: '10 kHz' },
          { v: 12000, l: '12 kHz' },
          { v: 16000, l: '16 kHz' },
        ],
        (v) => {
          state.highBoostFreq = v;
          if (enabled) applyState();
          window.SEQ.notifyStateChange();
        },
      );

      makeSlider(
        container,
        'ATTEN',
        state.highAtten,
        0,
        10,
        0.1,
        (v) => v.toFixed(1) + ' dB',
        (v) => {
          state.highAtten = v;
          if (enabled) applyState();
          window.SEQ.notifyStateChange();
        },
      );

      makeSelect(
        container,
        'ATTEN FREQ',
        state.highAttenFreq,
        [
          { v: 5000, l: '5 kHz' },
          { v: 10000, l: '10 kHz' },
          { v: 20000, l: '20 kHz' },
        ],
        (v) => {
          state.highAttenFreq = v;
          if (enabled) applyState();
          window.SEQ.notifyStateChange();
        },
      );

      // TUBE section
      sectionLabel(container, 'AMPLIFIER');

      makeSlider(
        container,
        'TUBE COLOR',
        state.tubeColor,
        0,
        1,
        0.01,
        (v) => `${Math.round(v * 100)}%`,
        (v) => {
          state.tubeColor = v;
          if (enabled) applyState();
          window.SEQ.notifyStateChange();
        },
      );
    },

    getState(): ExtensionState {
      return { ...state };
    },

    setState(s: ExtensionState): void {
      state = { ...state, ...(s as Partial<PultecState>) };
      applyState();
    },

    setEnabled(on: boolean): void {
      enabled = on;
      if (!nodes) return;
      if (on) {
        applyState();
      } else {
        nodes.lowBoostFilter.gain.value = 0;
        nodes.lowAttenFilter.gain.value = 0;
        nodes.highBoostFilter.gain.value = 0;
        nodes.highAttenFilter.gain.value = 0;
        // Bypass saturation: drive=0 means identity
        setWorkletParam(nodes.tubeSat, 'drive', 0);
      }
    },

    destroy(): void {
      if (nodes) {
        const {
          lowBoostFilter,
          lowAttenFilter,
          highBoostFilter,
          highAttenFilter,
          tubeSat,
          outputGain,
        } = nodes;
        const allNodes: AudioNode[] = [
          lowBoostFilter,
          lowAttenFilter,
          highBoostFilter,
          highAttenFilter,
          tubeSat,
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
