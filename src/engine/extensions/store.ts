/**
 * Extension state — the canonical home for extension-related shared state.
 * Extracted from state.ts to give clear ownership and avoid circular
 * dependencies between registry.ts and persistence.ts.
 */

import type { Extension } from '../../types';

/** Registered extensions (ordered: inserts first, then aux/utility) */
export const SEQ_EXTENSIONS: Extension[] = [];

/** Currently active (open) extension panel, or null */
export let activeExtensionId: string | null = null;

export function setActiveExtensionId(v: string | null): void {
  activeExtensionId = v;
}

/** Callbacks to run when playback stops (registered by extensions) */
export const seqStopCallbacks: (() => void)[] = [];

// ═══════════════════════════════════════════
//  Deterministic reset — canonical defaults for new-song flow
// ═══════════════════════════════════════════

/** Canonical default state per extension ID. Matches the initial `state` in each factory. */
const CANONICAL_DEFAULTS: Record<string, Record<string, unknown>> = {
  compressor: {
    drive: 0,
    compress: 0,
    ratio: 1,
    knee: 30,
    speed: 1,
    mix: 1.0,
    output: 1.0,
    model: 0,
  },
  'pultec-eq': {
    lowBoost: 0,
    lowAtten: 0,
    lowFreq: 60,
    highBoost: 0,
    highBandwidth: 0.5,
    highAtten: 0,
    highBoostFreq: 5000,
    highAttenFreq: 10000,
    tubeColor: 0.0,
  },
  transformer: {
    drive: 0.15,
    color: 0.1,
    air: 0.5,
  },
  mixer: {
    levels: null,
  },
  reverb: {
    decay: 0.6,
    damping: 0.5,
    mix: 0.3,
    sends: null,
  },
  delay: {
    time: 0.375,
    feedback: 0.45,
    tone: 0.55,
    mix: 0.25,
    sends: null,
  },
};

/**
 * Reset every extension to canonical default parameters with _enabled=false.
 * Called by newSong() to prevent prior tone carryover.
 */
export function resetAllExtensions(): void {
  for (const ext of SEQ_EXTENSIONS) {
    const defaults = CANONICAL_DEFAULTS[ext.id];
    if (defaults) {
      ext.setState(defaults);
    }
    ext._enabled = false;
    if (ext.setEnabled) ext.setEnabled(false);
  }
}
