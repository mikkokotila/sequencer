/**
 * Transformer coloring extension — analog core saturation on master bus.
 * Even-harmonic warmth, LF thickening, gentle HF rolloff.
 * Level-dependent: quiet signals pass clean, loud signals get colored.
 */

import type { Extension, ExtensionHost, ExtensionState, NodePair } from '../../types';
import { makeSlider, formatPct } from '../../ui/helpers';

interface TransformerState {
  drive: number;
  color: number;
  air: number;
}

interface TransformerNodes {
  transformer: AudioWorkletNode;
  ctx: AudioContext;
}

function setWorkletParam(node: AudioWorkletNode, name: string, value: number): void {
  const param = node.parameters.get(name);
  if (param) param.value = value;
}

export function createTransformer(): Extension {
  let hostRef: ExtensionHost | null = null;

  let state: TransformerState = {
    drive: 0.15, // gentle push into the core
    color: 0.1, // subtle even-harmonic warmth
    air: 0.5, // neutral HF (18kHz rolloff)
  };

  let nodes: TransformerNodes | null = null;
  let enabled = false;

  function applyState(): void {
    if (!nodes) return;
    setWorkletParam(nodes.transformer, 'drive', state.drive);
    setWorkletParam(nodes.transformer, 'color', state.color);
    setWorkletParam(nodes.transformer, 'air', state.air);
  }

  return {
    id: 'transformer',
    name: 'Transformer',
    icon: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="3" y="4" width="10" height="8" rx="1" stroke="currentColor" stroke-width="1.3"/><path d="M6 4V2M10 4V2M6 12v2M10 12v2M1 7h2M13 7h2M1 9h2M13 9h2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',

    init(ctx: AudioContext, host: ExtensionHost): NodePair | null {
      hostRef = host;
      const transformer = new AudioWorkletNode(ctx, 'transformer-processor');
      nodes = { transformer, ctx };
      applyState();
      return { input: transformer, output: transformer };
    },

    createUI(container: HTMLElement): void {
      container.innerHTML = '';

      const title = document.createElement('div');
      title.style.cssText =
        'font-size:8px;font-weight:700;letter-spacing:2px;color:#666;margin-bottom:6px;padding-bottom:8px;border-bottom:1px solid #2a2a32;';
      title.textContent = 'TRANSFORMER';
      container.appendChild(title);

      const sub = document.createElement('div');
      sub.style.cssText = 'font-size:7px;letter-spacing:1.5px;color:#444;margin-bottom:16px;';
      sub.textContent = 'ANALOG CORE SATURATION';
      container.appendChild(sub);

      makeSlider(container, 'DRIVE', state.drive, 0, 1, 0.01, formatPct, (v) => {
        state.drive = v;
        if (enabled) applyState();
        hostRef!.notifyStateChange();
      });

      makeSlider(container, 'COLOR', state.color, 0, 1, 0.01, formatPct, (v) => {
        state.color = v;
        if (enabled) applyState();
        hostRef!.notifyStateChange();
      });

      makeSlider(container, 'AIR', state.air, 0, 1, 0.01, formatPct, (v) => {
        state.air = v;
        if (enabled) applyState();
        hostRef!.notifyStateChange();
      });
    },

    getState(): ExtensionState {
      return { ...state };
    },

    setState(s: ExtensionState): void {
      state = { ...state, ...(s as Partial<TransformerState>) };
      if (enabled) applyState();
    },

    setEnabled(on: boolean): void {
      enabled = on;
      if (!nodes) return;
      if (on) {
        applyState();
      } else {
        // Full bypass: drive=0 and color=0 triggers identity in worklet
        setWorkletParam(nodes.transformer, 'drive', 0);
        setWorkletParam(nodes.transformer, 'color', 0);
      }
    },

    destroy(): void {
      if (nodes) {
        try {
          nodes.transformer.disconnect();
        } catch {
          /* */
        }
        nodes = null;
      }
    },
  };
}
