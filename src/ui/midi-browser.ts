/**
 * MIDI device browser modal — UI layer.
 *
 * Shows available MIDI input devices and allows connecting
 * them to melody/synth tracks for live play.
 */

import { MEL_CFG } from '../config';
import { melNames } from '../transport/song';
import { on } from '../events';
import { el } from './helpers';
import {
  initMidi,
  isMidiSupported,
  isMidiPermissionDenied,
  getMidiInputs,
  connectMidiToTrack,
  disconnectMidiFromTrack,
  getMidiTrackBinding,
} from '../engine/midi';

// ═══════════════════════════════════════════
//  Module state
// ═══════════════════════════════════════════

let overlay: HTMLElement | null = null;
let listContainer: HTMLElement | null = null;
let statusEl: HTMLElement | null = null;
let titleEl: HTMLElement | null = null;
let activeTrackIndex = -1;

// ═══════════════════════════════════════════
//  DOM construction
// ═══════════════════════════════════════════

/** Create the MIDI browser overlay DOM and append to document.body. */
export function buildMidiBrowserDOM(): void {
  overlay = el('div', 'midi-overlay');
  overlay.id = 'midi-overlay';

  const panel = el('div', 'midi-panel');

  const header = el('div', 'midi-header');
  titleEl = el('div', 'midi-title');
  titleEl.textContent = 'MIDI Input';
  header.appendChild(titleEl);

  const closeBtn = el('button', 'midi-close');
  closeBtn.id = 'midi-close';
  closeBtn.textContent = '\u00D7';
  closeBtn.onclick = closeMidiBrowser;
  header.appendChild(closeBtn);
  panel.appendChild(header);

  listContainer = el('div', 'midi-list');
  panel.appendChild(listContainer);

  statusEl = el('div', 'midi-status');
  statusEl.id = 'midi-status';
  panel.appendChild(statusEl);

  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  // Close on click outside panel
  overlay.addEventListener('mousedown', (e: MouseEvent) => {
    if (e.target === overlay) closeMidiBrowser();
  });
}

// ═══════════════════════════════════════════
//  Open / Close
// ═══════════════════════════════════════════

/** Open the MIDI browser for a specific melody track. */
export async function openMidiBrowser(trackIndex: number): Promise<void> {
  if (!overlay) return;
  activeTrackIndex = trackIndex;

  const name = melNames[trackIndex] ?? `Synth ${trackIndex + 1}`;
  if (titleEl) titleEl.textContent = `${name} \u2014 MIDI Input`;

  // Initialize MIDI if not done yet
  await initMidi();

  renderMidiList();
  overlay.classList.add('open');
}

/** Close the MIDI browser. */
export function closeMidiBrowser(): void {
  if (!overlay) return;
  overlay.classList.remove('open');
  activeTrackIndex = -1;
}

/** Whether the MIDI browser is currently open. */
export function isMidiBrowserOpen(): boolean {
  return overlay?.classList.contains('open') ?? false;
}

// ═══════════════════════════════════════════
//  Render device list
// ═══════════════════════════════════════════

function renderMidiList(): void {
  if (!listContainer || !statusEl) return;
  listContainer.innerHTML = '';

  // Error states
  if (!isMidiSupported()) {
    renderEmptyState('Your browser does not support the Web MIDI API.');
    statusEl.textContent = 'MIDI not available';
    return;
  }

  if (isMidiPermissionDenied()) {
    renderEmptyState(
      'MIDI access was denied. Please allow MIDI access in your browser settings and reload.',
    );
    statusEl.textContent = 'Permission denied';
    return;
  }

  const inputs = getMidiInputs();

  if (inputs.length === 0) {
    renderEmptyState('No MIDI devices found. Connect a MIDI controller and try again.');
    statusEl.textContent = 'No devices';
    return;
  }

  // Render each device
  for (const input of inputs) {
    const row = el('div', 'midi-device-item');

    // State dot
    const dot = el('span', 'midi-state-dot');
    dot.classList.toggle('connected', input.state === 'connected');
    row.appendChild(dot);

    // Device info
    const info = el('div', 'midi-device-info');
    const nameEl = el('div', 'midi-device-name');
    nameEl.textContent = input.name;
    info.appendChild(nameEl);
    if (input.manufacturer) {
      const mfr = el('div', 'midi-device-mfr');
      mfr.textContent = input.manufacturer;
      info.appendChild(mfr);
    }
    row.appendChild(info);

    // Action button
    const currentBinding = getMidiTrackBinding(activeTrackIndex);
    const isBoundToThis = currentBinding?.inputId === input.id;

    // Check if this device is bound to a different track
    let boundToOther: string | null = null;
    for (let t = 0; t < MEL_CFG.length; t++) {
      if (t === activeTrackIndex) continue;
      const otherBinding = getMidiTrackBinding(t);
      if (otherBinding?.inputId === input.id) {
        boundToOther = melNames[t] ?? `Synth ${t + 1}`;
        break;
      }
    }

    if (isBoundToThis) {
      const btn = el('button', 'midi-disconnect-btn');
      btn.textContent = 'DISCONNECT';
      btn.onclick = () => {
        disconnectMidiFromTrack(activeTrackIndex);
        renderMidiList();
      };
      row.appendChild(btn);
    } else if (boundToOther) {
      const label = el('span', 'midi-in-use');
      label.textContent = `In use by: ${boundToOther}`;
      row.appendChild(label);
    } else {
      const btn = el('button', 'midi-connect-btn');
      btn.textContent = 'CONNECT';
      btn.onclick = () => {
        connectMidiToTrack(input.id, activeTrackIndex);
        renderMidiList();
      };
      row.appendChild(btn);
    }

    listContainer.appendChild(row);
  }

  statusEl.textContent = `${inputs.length} device${inputs.length !== 1 ? 's' : ''} available`;
}

function renderEmptyState(message: string): void {
  if (!listContainer) return;
  const empty = el('div', 'midi-empty');
  empty.textContent = message;
  listContainer.appendChild(empty);
}

// ═══════════════════════════════════════════
//  Event wiring
// ═══════════════════════════════════════════

/** Wire event subscriptions for the MIDI browser. */
export function wireMidiBrowserEvents(): void {
  // Re-render device list when devices change (hot-plug)
  on('midi:devicesChanged', () => {
    if (overlay?.classList.contains('open')) {
      renderMidiList();
    }
  });

  // Re-render on connect/disconnect to update button states
  on('midi:connected', () => {
    if (overlay?.classList.contains('open')) {
      renderMidiList();
    }
  });

  on('midi:disconnected', () => {
    if (overlay?.classList.contains('open')) {
      renderMidiList();
    }
  });
}
