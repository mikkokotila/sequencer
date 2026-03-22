/**
 * MIDI input management — engine layer, no DOM access.
 *
 * Connects MIDI input devices to melody/synth tracks for live play.
 * MIDI note-on events trigger the track's loaded sample at the
 * corresponding pitch via Web Audio API.
 */

import { MEL_CFG, DRUMS_CFG } from '../config';
import { melBuf } from '../transport/song';
import { getAudioContext, getTrackGains } from './audio';
import { applyEnvelope, triggerRelease, getTrackAdsr, isAdsrEnabled } from './adsr';
import { emit } from '../events';

// ═══════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════

export interface MidiInputInfo {
  id: string;
  name: string;
  manufacturer: string;
  state: string;
}

interface MidiTrackBinding {
  inputId: string;
  inputName: string;
  listener: (e: Event) => void;
  activeSources: Map<number, { source: AudioBufferSourceNode; envelope: GainNode | null }>;
}

// ═══════════════════════════════════════════
//  Module state
// ═══════════════════════════════════════════

let midiAccess: MIDIAccess | null = null;
let midiSupported = true;
let midiPermissionDenied = false;

const trackBindings: (MidiTrackBinding | null)[] = Array.from(
  { length: MEL_CFG.length },
  () => null,
);

const MAX_POLYPHONY = 8;

// MIDI note 24 = C1 = rate 1.0 (original sample pitch).
// This matches the scheduler's rate formula: rate = 2^((oct-1)*12 + n)/12
// where oct=1, n=0 gives rate=1.0.
const MIDI_ROOT_NOTE = 24;

// ═══════════════════════════════════════════
//  Public API
// ═══════════════════════════════════════════

/** Initialize Web MIDI API. Non-blocking — call once at startup. */
export async function initMidi(): Promise<boolean> {
  if (midiAccess) return true;

  if (!('requestMIDIAccess' in navigator)) {
    midiSupported = false;
    return false;
  }

  try {
    midiAccess = await navigator.requestMIDIAccess();
    midiAccess.onstatechange = onMidiStateChange;
    return true;
  } catch {
    midiPermissionDenied = true;
    return false;
  }
}

/** Whether the browser supports Web MIDI API. */
export function isMidiSupported(): boolean {
  return midiSupported;
}

/** Whether the user denied MIDI permission. */
export function isMidiPermissionDenied(): boolean {
  return midiPermissionDenied;
}

/** List available MIDI input devices. */
export function getMidiInputs(): MidiInputInfo[] {
  if (!midiAccess) return [];
  const result: MidiInputInfo[] = [];
  midiAccess.inputs.forEach((input) => {
    result.push({
      id: input.id,
      name: input.name ?? 'Unknown Device',
      manufacturer: input.manufacturer ?? '',
      state: input.state,
    });
  });
  return result;
}

/** Connect a MIDI input device to a melody track. */
export function connectMidiToTrack(inputId: string, trackIndex: number): boolean {
  if (!midiAccess) return false;
  if (trackIndex < 0 || trackIndex >= MEL_CFG.length) return false;

  const input = midiAccess.inputs.get(inputId);
  if (!input) return false;

  // Disconnect existing binding on this track
  disconnectMidiFromTrack(trackIndex);

  const listener = (e: Event): void => {
    const midiEvent = e as MIDIMessageEvent;
    const data = midiEvent.data;
    if (!data || data.length < 3) return;

    const status = data[0]! & 0xf0; // strip channel nibble
    const note = data[1]!;
    const velocity = data[2]!;

    if (status === 0x90 && velocity > 0) {
      handleNoteOn(trackIndex, note, velocity);
    } else if (status === 0x80 || (status === 0x90 && velocity === 0)) {
      handleNoteOff(trackIndex, note);
    }
  };

  input.addEventListener('midimessage', listener);

  trackBindings[trackIndex] = {
    inputId,
    inputName: input.name ?? 'Unknown Device',
    listener,
    activeSources: new Map(),
  };

  emit('midi:connected', {
    trackIndex,
    inputId,
    inputName: input.name ?? 'Unknown Device',
  });

  return true;
}

/** Disconnect MIDI input from a melody track. */
export function disconnectMidiFromTrack(trackIndex: number): void {
  const binding = trackBindings[trackIndex];
  if (!binding) return;

  // Stop all active voices
  for (const [, entry] of binding.activeSources) {
    try {
      entry.source.stop();
    } catch {
      /* already stopped */
    }
  }
  binding.activeSources.clear();

  // Remove listener from MIDI input
  if (midiAccess) {
    const input = midiAccess.inputs.get(binding.inputId);
    if (input) {
      input.removeEventListener('midimessage', binding.listener);
    }
  }

  trackBindings[trackIndex] = null;
  emit('midi:disconnected', { trackIndex });
}

/** Get current MIDI binding for a track. */
export function getMidiTrackBinding(
  trackIndex: number,
): { inputId: string; inputName: string } | null {
  const binding = trackBindings[trackIndex];
  if (!binding) return null;
  return { inputId: binding.inputId, inputName: binding.inputName };
}

/** Disconnect all MIDI bindings. Called on song switch/create. */
export function disconnectAllMidi(): void {
  for (let i = 0; i < trackBindings.length; i++) {
    disconnectMidiFromTrack(i);
  }
}

// ═══════════════════════════════════════════
//  Internal handlers
// ═══════════════════════════════════════════

function handleNoteOn(trackIndex: number, note: number, velocity: number): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const buffer = melBuf[trackIndex];
  if (!buffer) return; // no sample loaded

  // Resume AudioContext if suspended (user gesture requirement)
  if (ctx.state === 'suspended') void ctx.resume();

  const binding = trackBindings[trackIndex];
  if (!binding) return;

  const cfg = MEL_CFG[trackIndex];

  const globalTrackIdx = DRUMS_CFG.length + trackIndex;

  // Mono tracks: release existing note first
  if (cfg?.mono) {
    for (const [existingNote, existing] of binding.activeSources) {
      if (existing.envelope) {
        triggerRelease(ctx, existing.envelope, existing.source, getTrackAdsr(globalTrackIdx));
      } else {
        try {
          existing.source.stop();
        } catch {
          /* already stopped */
        }
      }
      binding.activeSources.delete(existingNote);
    }
  }

  // Poly tracks: enforce MAX_POLYPHONY via voice stealing
  if (binding.activeSources.size >= MAX_POLYPHONY) {
    const oldest = binding.activeSources.entries().next();
    if (!oldest.done) {
      const [oldestNote, oldestEntry] = oldest.value;
      if (oldestEntry.envelope) {
        triggerRelease(ctx, oldestEntry.envelope, oldestEntry.source, getTrackAdsr(globalTrackIdx));
      } else {
        try {
          oldestEntry.source.stop();
        } catch {
          /* already stopped */
        }
      }
      binding.activeSources.delete(oldestNote);
    }
  }

  // Calculate playback rate from MIDI note number
  const rate = Math.pow(2, (note - MIDI_ROOT_NOTE) / 12);

  // Create per-note velocity gain
  const velocityGain = ctx.createGain();
  velocityGain.gain.value = velocity / 127;

  // Get destination: trackGains[DRUMS_CFG.length + trackIndex]
  const trackGains = getTrackGains();
  const dest = trackGains[globalTrackIdx];
  if (!dest) return;

  // Create source
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = rate;

  // Connect source: with ADSR envelope if enabled, direct otherwise
  const startAt = ctx.currentTime;
  let envelope: GainNode | null = null;
  if (isAdsrEnabled(globalTrackIdx)) {
    envelope = applyEnvelope(ctx, src, velocityGain, globalTrackIdx, startAt);
  } else {
    src.connect(velocityGain);
  }
  velocityGain.connect(dest);
  src.start(startAt);

  // Store source + envelope for note-off release
  binding.activeSources.set(note, { source: src, envelope });

  // Auto-cleanup when sample ends naturally
  src.onended = () => {
    binding.activeSources.delete(note);
    try {
      velocityGain.disconnect();
    } catch {
      /* already disconnected */
    }
  };
}

function handleNoteOff(trackIndex: number, note: number): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  const binding = trackBindings[trackIndex];
  if (!binding) return;

  const entry = binding.activeSources.get(note);
  if (entry) {
    if (entry.envelope) {
      const globalTrackIdx = DRUMS_CFG.length + trackIndex;
      triggerRelease(ctx, entry.envelope, entry.source, getTrackAdsr(globalTrackIdx));
    } else {
      try {
        entry.source.stop();
      } catch {
        /* already stopped */
      }
    }
    binding.activeSources.delete(note);
  }
}

function onMidiStateChange(): void {
  if (!midiAccess) return;

  // Check if any bound device was disconnected
  for (let i = 0; i < trackBindings.length; i++) {
    const binding = trackBindings[i];
    if (!binding) continue;

    const input = midiAccess.inputs.get(binding.inputId);
    if (!input || input.state === 'disconnected') {
      disconnectMidiFromTrack(i);
    }
  }

  emit('midi:devicesChanged', {});
}
