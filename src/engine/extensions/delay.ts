/**
 * Tape Delay — delay with per-channel aux sends.
 *
 * Uses AudioWorklet processor:
 *   - delay-processor (delayTime, feedback, tone, mix)
 */

import type { Extension, ExtensionState, NodePair } from '../../types';
import { makeSlider } from '../../ui/helpers';

// ═══════════════════════════════════════════
//  Internal types
// ═══════════════════════════════════════════

interface DelayState {
  time: number;
  feedback: number;
  tone: number;
  mix: number;
  sends: number[] | null;
}

interface DelayNodes {
  sendBus: GainNode;
  delay: AudioWorkletNode;
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

export function createDelay(): Extension {
  let state: DelayState = {
    time: 0.375,
    feedback: 0.45,
    tone: 0.55,
    mix: 0.25,
    sends: null,
  };

  function defaultSends(): number[] {
    return Array(TRACK_COUNT).fill(0.12) as number[];
  }
  function getSends(): number[] {
    return state.sends ?? defaultSends();
  }

  let nodes: DelayNodes | null = null;
  let sendGains: GainNode[] = [];

  function applyState(): void {
    if (!nodes) return;
    setWorkletParam(nodes.delay, 'delayTime', state.time);
    setWorkletParam(nodes.delay, 'feedback', Math.min(state.feedback, 0.95));
    setWorkletParam(nodes.delay, 'tone', state.tone);
    setWorkletParam(nodes.delay, 'mix', 1); // mix is handled by wetGain externally
    nodes.wetGain.gain.value = state.mix;
    const sends = getSends();
    for (let i = 0; i < sendGains.length; i++) {
      const sg = sendGains[i];
      if (sg) sg.gain.value = sends[i] ?? 0.35;
    }
  }

  return {
    id: 'delay',
    name: 'Tape Delay',
    icon: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="5" cy="8" r="3.5" stroke="currentColor" stroke-width="1.3"/><circle cx="11" cy="8" r="3.5" stroke="currentColor" stroke-width="1.3"/><line x1="5" y1="4.5" x2="11" y2="4.5" stroke="currentColor" stroke-width="1" opacity="0.4"/><line x1="5" y1="11.5" x2="11" y2="11.5" stroke="currentColor" stroke-width="1" opacity="0.4"/></svg>',

    init(ctx: AudioContext): NodePair {
      const sendBus = ctx.createGain();
      sendBus.gain.value = 1 / Math.sqrt(TRACK_COUNT);

      const delay = new AudioWorkletNode(ctx, 'delay-processor');

      const wetGain = ctx.createGain();
      wetGain.gain.value = state.mix;

      sendBus.connect(delay);
      delay.connect(wetGain);

      sendGains = [];
      // Post-fader post-pan sends: tap from channelPan outputs
      const channelPans = window.SEQ.channelPans;
      const sends = getSends();
      for (let i = 0; i < channelPans.length; i++) {
        const pan = channelPans[i];
        if (!pan) continue;
        const sg = ctx.createGain();
        sg.gain.value = sends[i] ?? 0.12;
        pan.connect(sg);
        sg.connect(sendBus);
        sendGains.push(sg);
      }

      // Wet return goes to mixBus (not masterGain)
      const mixBus = window.SEQ.mixBus;
      if (mixBus) wetGain.connect(mixBus);

      nodes = { sendBus, delay, wetGain, ctx };
      applyState();

      window.SEQ.onStop(() => {
        if (!nodes) return;
        const now = nodes.ctx.currentTime;
        // Ramp down feedback and wet to stop repeats
        setWorkletParam(nodes.delay, 'feedback', 0);
        nodes.wetGain.gain.setValueAtTime(nodes.wetGain.gain.value, now);
        nodes.wetGain.gain.linearRampToValueAtTime(0, now + 0.15);
        setTimeout(() => {
          if (!nodes) return;
          setWorkletParam(nodes.delay, 'feedback', Math.min(state.feedback, 0.95));
          nodes.wetGain.gain.cancelScheduledValues(0);
          nodes.wetGain.gain.value = state.mix;
        }, 300);
      });

      const pass = ctx.createGain();
      return { input: pass, output: pass };
    },

    createUI(container: HTMLElement): void {
      container.innerHTML = '';

      const title = document.createElement('div');
      title.style.cssText =
        'font-size:8px;font-weight:700;letter-spacing:2px;color:#666;margin-bottom:20px;padding-bottom:8px;border-bottom:1px solid #2a2a32;';
      title.textContent = 'TAPE DELAY';
      container.appendChild(title);

      makeSlider(
        container,
        'TIME',
        state.time,
        0.04,
        0.8,
        0.001,
        (v) => `${Math.round(v * 1000)}ms`,
        (v) => {
          state.time = v;
          applyState();
          window.SEQ.notifyStateChange();
        },
      );

      makeSlider(
        container,
        'FEEDBACK',
        state.feedback,
        0,
        0.95,
        0.01,
        (v) => `${Math.round(v * 100)}%`,
        (v) => {
          state.feedback = v;
          applyState();
          window.SEQ.notifyStateChange();
        },
      );

      makeSlider(
        container,
        'TONE',
        state.tone,
        0,
        1,
        0.01,
        (v) => {
          const hz = 800 + v * 6000;
          return hz < 1000 ? `${Math.round(hz)}Hz` : `${(hz / 1000).toFixed(1)}kHz`;
        },
        (v) => {
          state.tone = v;
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
        slider.value = String(sends[i] ?? 0.35);
        slider.style.cssText = 'flex:1;accent-color:#888;cursor:pointer;height:3px;';
        const idx = i;
        const val = document.createElement('div');
        val.style.cssText =
          'font-size:9px;font-weight:700;color:#777;width:20px;text-align:right;flex-shrink:0;font-variant-numeric:tabular-nums;';
        val.textContent = String(Math.round((sends[i] ?? 0.35) * 100));

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
      state = { ...state, ...(s as Partial<DelayState>) };
      applyState();
    },

    setEnabled(on: boolean): void {
      if (!nodes) return;
      if (on) {
        applyState();
      } else {
        nodes.wetGain.gain.value = 0;
        setWorkletParam(nodes.delay, 'feedback', 0);
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
        const { sendBus, delay, wetGain } = nodes;
        const allNodes: AudioNode[] = [sendBus, delay, wetGain];
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
