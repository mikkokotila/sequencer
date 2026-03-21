/**
 * Extension system — registration API, audio chain management,
 * side panel UI, and icon rendering.
 */

import type { Extension, TrackInfo, TrackType } from '../../types';
import {
  SEQ_EXTENSIONS,
  activeExtensionId,
  setActiveExtensionId,
  seqStopCallbacks,
  playing,
} from '../../state';
import { drumNames, melNames, vocalName } from '../../transport/song';
import {
  getAudioContext,
  getMasterGain,
  getTrackGains,
  getChannelFaders,
  getChannelPans,
  getMixBus,
  getMasterTrim,
  getFinalOutput,
} from '../audio';
import { DRUMS_CFG, MEL_CFG, VOCAL_CFG, TOTAL_TRACKS } from '../../config';
import { el } from '../../ui/helpers';
import { scheduleSave } from '../../transport/persistence';

// ═══════════════════════════════════════════
//  SEQ API (exposed on window for extensions)
// ═══════════════════════════════════════════

export interface SeqAPI {
  register(ext: Extension): void;
  readonly audioContext: AudioContext | null;
  readonly masterGain: GainNode | null;
  readonly trackGains: GainNode[];
  readonly channelFaders: GainNode[];
  readonly channelPans: StereoPannerNode[];
  readonly mixBus: GainNode | null;
  readonly masterTrim: GainNode | null;
  readonly trackCount: number;
  readonly playing: boolean;
  onStop(fn: () => void): void;
  getTrackInfo(i: number): TrackInfo;
  rebuildChain(): void;
  notifyStateChange(): void;
}

declare global {
  interface Window {
    SEQ: SeqAPI;
  }
}

export function installSeqAPI(): void {
  window.SEQ = {
    register(ext: Extension): void {
      SEQ_EXTENSIONS.push(ext);
    },
    get audioContext(): AudioContext | null {
      return getAudioContext();
    },
    get masterGain(): GainNode | null {
      return getMasterGain();
    },
    get trackGains(): GainNode[] {
      return getTrackGains();
    },
    get channelFaders(): GainNode[] {
      return getChannelFaders();
    },
    get channelPans(): StereoPannerNode[] {
      return getChannelPans();
    },
    get mixBus(): GainNode | null {
      return getMixBus();
    },
    get masterTrim(): GainNode | null {
      return getMasterTrim();
    },
    get trackCount(): number {
      return TOTAL_TRACKS;
    },
    get playing(): boolean {
      return playing;
    },
    onStop(fn: () => void): void {
      seqStopCallbacks.push(fn);
    },
    getTrackInfo(i: number): TrackInfo {
      if (i < DRUMS_CFG.length) {
        const c = DRUMS_CFG[i]!;
        return {
          name: drumNames[i] ?? '',
          color: c.color,
          bright: c.bright,
          type: 'drum' as TrackType,
        };
      }
      const mi = i - DRUMS_CFG.length;
      if (mi < MEL_CFG.length) {
        const c = MEL_CFG[mi]!;
        return {
          name: melNames[mi] ?? '',
          color: c.color,
          bright: c.bright,
          type: 'melody' as TrackType,
        };
      }
      return {
        name: vocalName,
        color: VOCAL_CFG.color,
        bright: VOCAL_CFG.bright,
        type: 'vocal' as TrackType,
      };
    },
    rebuildChain(): void {
      rebuildAudioChain();
    },
    notifyStateChange(): void {
      scheduleSave();
    },
  };
}

// ═══════════════════════════════════════════
//  Audio chain rebuild
// ═══════════════════════════════════════════

export function rebuildAudioChain(): void {
  const masterGain = getMasterGain();
  const audioCtx = getAudioContext();
  const output = getFinalOutput();
  if (!masterGain || !audioCtx || !output) return;

  masterGain.disconnect();
  if (SEQ_EXTENSIONS.length === 0) {
    masterGain.connect(output);
    return;
  }

  // Ensure all extensions have their nodes initialised
  for (const ext of SEQ_EXTENSIONS) {
    if (!ext._nodes) ext._nodes = ext.init(audioCtx);
  }

  let prev: AudioNode = masterGain;
  for (const ext of SEQ_EXTENSIONS) {
    const nodes = ext._nodes;
    if (!nodes) continue;
    try {
      nodes.output.disconnect();
    } catch {
      /* already disconnected */
    }
    prev.connect(nodes.input);
    prev = nodes.output;

    // Re-apply enabled/disabled state after reconnecting
    if (ext.setEnabled) {
      ext.setEnabled(ext._enabled ?? false);
    }
  }
  prev.connect(output);
}

// ═══════════════════════════════════════════
//  Extension panel toggle
// ═══════════════════════════════════════════

export function toggleExtension(extId: string): void {
  const panel = document.getElementById('ext-panel');
  const body = document.getElementById('ext-panel-body');
  const title = document.getElementById('ext-panel-title');
  const app = document.getElementById('app');
  if (!panel || !body || !title) return;

  if (activeExtensionId === extId) {
    panel.classList.remove('open');
    app?.classList.remove('ext-panel-open');
    document.body.classList.remove('ext-panel-open');
    setActiveExtensionId(null);
    updateExtIcons();
    return;
  }

  const ext = SEQ_EXTENSIONS.find((e) => e.id === extId);
  if (!ext) return;

  title.textContent = ext.name.toUpperCase();
  body.innerHTML = '';

  // Build extension UI first into a wrapper
  const extContent = el('div', '');
  ext.createUI(extContent);

  // On/off toggle (prepended above extension content)
  const toggleRow = el('div', 'ext-toggle-row');
  const toggleLabel = el('div', 'ext-toggle-label');
  const isOn = ext._enabled ?? false;
  toggleLabel.textContent = isOn ? 'ON' : 'OFF';
  if (isOn) toggleLabel.classList.add('on');
  const toggle = el('div', 'ext-toggle');
  if (isOn) toggle.classList.add('on');
  toggle.onclick = () => {
    ext._enabled = !ext._enabled;
    toggle.classList.toggle('on', ext._enabled ?? false);
    toggleLabel.textContent = ext._enabled ? 'ON' : 'OFF';
    toggleLabel.classList.toggle('on', ext._enabled ?? false);
    if (ext.setEnabled) ext.setEnabled(ext._enabled ?? false);
    scheduleSave();
  };
  toggleRow.appendChild(toggleLabel);
  toggleRow.appendChild(toggle);
  body.appendChild(toggleRow);
  body.appendChild(extContent);

  panel.classList.add('open');
  app?.classList.add('ext-panel-open');
  document.body.classList.add('ext-panel-open');
  setActiveExtensionId(extId);
  updateExtIcons();
}

// ═══════════════════════════════════════════
//  Extension icon buttons
// ═══════════════════════════════════════════

export function buildExtIcons(): void {
  const container = document.getElementById('ext-icons');
  if (!container) return;
  container.innerHTML = '';
  for (const ext of SEQ_EXTENSIONS) {
    const btn = el('button', 'ext-icon-btn');
    btn.dataset.extId = ext.id;
    btn.innerHTML = ext.icon;
    btn.title = ext.name;
    btn.onclick = () => toggleExtension(ext.id);
    container.appendChild(btn);
  }
}

export function updateExtIcons(): void {
  document.querySelectorAll('.ext-icon-btn').forEach((b) => {
    const btn = b as HTMLElement;
    btn.classList.toggle('active', btn.dataset.extId === activeExtensionId);
  });
}

// ═══════════════════════════════════════════
//  Init extensions (called from main after scripts load)
// ═══════════════════════════════════════════

export function initExtensions(): void {
  if (SEQ_EXTENSIONS.length > 0) rebuildAudioChain();
  buildExtIcons();

  const closeBtn = document.getElementById('ext-panel-close');
  if (closeBtn) {
    closeBtn.onclick = () => {
      if (activeExtensionId) toggleExtension(activeExtensionId);
    };
  }
}
