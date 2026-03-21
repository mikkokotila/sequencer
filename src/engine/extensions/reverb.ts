/**
 * Plate Reverb — Freeverb-based reverb with per-channel aux sends.
 *
 * Uses AudioWorklet processor:
 *   - freeverb-processor (roomSize, damping, wet, dry)
 */

import type { Extension, ExtensionState, NodePair } from '../../types';
import { makeSlider } from '../../ui/helpers';

// ═══════════════════════════════════════════
//  Internal types
// ═══════════════════════════════════════════

interface ReverbState {
  decay: number;
  damping: number;
  mix: number;
  sends: number[] | null;
}

interface ReverbNodes {
  sendBus: GainNode;
  freeverb: AudioWorkletNode;
  wetGain: GainNode;
  ctx: AudioContext;
}

const TRACK_COUNT = 9;

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

export function createReverb(): Extension {
  let state: ReverbState = {
    decay: 0.6,
    damping: 0.5,
    mix: 0.3,
    sends: null,
  };

  function defaultSends(): number[] {
    return Array(TRACK_COUNT).fill(0.15) as number[];
  }
  function getSends(): number[] {
    return state.sends ?? defaultSends();
  }

  let nodes: ReverbNodes | null = null;
  let sendGains: GainNode[] = [];

  function applyState(): void {
    if (!nodes) return;
    // Map decay (0-1) to roomSize for freeverb
    setWorkletParam(nodes.freeverb, 'roomSize', state.decay);
    setWorkletParam(nodes.freeverb, 'damping', state.damping);
    setWorkletParam(nodes.freeverb, 'wet', 1);
    setWorkletParam(nodes.freeverb, 'dry', 0);
    nodes.wetGain.gain.value = state.mix;
    const sends = getSends();
    for (let i = 0; i < sendGains.length; i++) {
      const sg = sendGains[i];
      if (sg) sg.gain.value = sends[i] ?? 0.4;
    }
  }

  return {
    id: 'reverb',
    name: 'Plate Reverb',
    icon: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8c0-3 2-5 5-5s5 2 5 5-2 5-5 5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M5 8c0-2 1.3-3 3-3s3 1 3 3-1.3 3-3 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" opacity="0.6"/><circle cx="8" cy="8" r="1" fill="currentColor" opacity="0.4"/></svg>',

    init(ctx: AudioContext): NodePair {
      const freeverb = new AudioWorkletNode(ctx, 'freeverb-processor');

      const wetGain = ctx.createGain();
      wetGain.gain.value = state.mix;

      const sendBus = ctx.createGain();
      sendBus.gain.value = 1 / Math.sqrt(TRACK_COUNT);

      sendGains = [];
      const trackGainsArr = window.SEQ.trackGains;
      const sends = getSends();
      for (let i = 0; i < trackGainsArr.length; i++) {
        const tg = trackGainsArr[i];
        if (!tg) continue;
        const sg = ctx.createGain();
        sg.gain.value = sends[i] ?? 0.4;
        tg.connect(sg);
        sg.connect(sendBus);
        sendGains.push(sg);
      }

      sendBus.connect(freeverb);
      freeverb.connect(wetGain);

      nodes = { sendBus, freeverb, wetGain, ctx };
      applyState();

      const masterGain = window.SEQ.masterGain;
      if (masterGain) wetGain.connect(masterGain);

      window.SEQ.onStop(() => {
        if (!nodes) return;
        const now = nodes.ctx.currentTime;
        nodes.wetGain.gain.setValueAtTime(nodes.wetGain.gain.value, now);
        nodes.wetGain.gain.linearRampToValueAtTime(0, now + 0.3);
        setTimeout(() => {
          if (!nodes) return;
          nodes.wetGain.gain.cancelScheduledValues(0);
          nodes.wetGain.gain.value = state.mix;
        }, 500);
      });

      const pass = ctx.createGain();
      return { input: pass, output: pass };
    },

    createUI(container: HTMLElement): void {
      container.innerHTML = '';

      const title = document.createElement('div');
      title.style.cssText =
        'font-size:8px;font-weight:700;letter-spacing:2px;color:#666;margin-bottom:20px;padding-bottom:8px;border-bottom:1px solid #2a2a32;';
      title.textContent = 'FREEVERB PLATE REVERB';
      container.appendChild(title);

      makeSlider(
        container,
        'DECAY',
        state.decay,
        0,
        1,
        0.01,
        (v) => `${Math.round(v * 100)}%`,
        (v) => {
          state.decay = v;
          applyState();
          window.SEQ.notifyStateChange();
        },
      );

      makeSlider(
        container,
        'DAMPING',
        state.damping,
        0,
        1,
        0.01,
        (v) => `${Math.round(v * 100)}%`,
        (v) => {
          state.damping = v;
          applyState();
          window.SEQ.notifyStateChange();
        },
      );

      makeSlider(
        container,
        'WET LEVEL',
        state.mix,
        0,
        1,
        0.01,
        (v) => `${Math.round(v * 100)}%`,
        (v) => {
          state.mix = v;
          applyState();
          window.SEQ.notifyStateChange();
        },
      );

      // Per-channel aux sends
      const auxSec = document.createElement('div');
      auxSec.style.cssText = 'margin-top:20px;padding-top:14px;border-top:1px solid #2a2a32;';

      const auxTitle = document.createElement('div');
      auxTitle.style.cssText =
        'font-size:8px;font-weight:700;letter-spacing:2px;color:#666;margin-bottom:12px;';
      auxTitle.textContent = 'AUX SENDS';
      auxSec.appendChild(auxTitle);

      const sends = getSends();
      const count = window.SEQ.trackCount;

      for (let i = 0; i < count; i++) {
        const info = window.SEQ.getTrackInfo(i);
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:8px;';

        const dot = document.createElement('div');
        dot.style.cssText = `width:4px;height:14px;border-radius:2px;flex-shrink:0;background:${info.color};`;
        row.appendChild(dot);

        const name = document.createElement('div');
        name.style.cssText =
          'font-size:8px;font-weight:700;color:#999;width:52px;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;letter-spacing:0.3px;';
        name.textContent = info.name;
        name.title = info.name;
        row.appendChild(name);

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = '0';
        slider.max = '1';
        slider.step = '0.01';
        slider.value = String(sends[i] ?? 0.4);
        slider.style.cssText = 'flex:1;accent-color:#888;cursor:pointer;height:3px;';
        const idx = i;
        const val = document.createElement('div');
        val.style.cssText =
          'font-size:9px;font-weight:700;color:#777;width:20px;text-align:right;flex-shrink:0;font-variant-numeric:tabular-nums;';
        val.textContent = String(Math.round((sends[i] ?? 0.4) * 100));

        slider.oninput = () => {
          const v = parseFloat(slider.value);
          if (!state.sends) state.sends = defaultSends();
          state.sends[idx] = v;
          val.textContent = String(Math.round(v * 100));
          const sg = sendGains[idx];
          if (sg) sg.gain.value = v;
          window.SEQ.notifyStateChange();
        };

        row.appendChild(slider);
        row.appendChild(val);
        auxSec.appendChild(row);
      }

      container.appendChild(auxSec);
    },

    getState(): ExtensionState {
      return { ...state, sends: getSends() };
    },

    setState(s: ExtensionState): void {
      state = { ...state, ...(s as Partial<ReverbState>) };
      applyState();
    },

    setEnabled(on: boolean): void {
      if (!nodes) return;
      if (on) {
        applyState();
      } else {
        nodes.wetGain.gain.value = 0;
        for (const sg of sendGains) sg.gain.value = 0;
      }
    },

    destroy(): void {
      sendGains.forEach((sg) => {
        try {
          sg.disconnect();
        } catch {
          /* already disconnected */
        }
      });
      sendGains = [];
      if (nodes) {
        const { sendBus, freeverb, wetGain } = nodes;
        const allNodes: AudioNode[] = [sendBus, freeverb, wetGain];
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
