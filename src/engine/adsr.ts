/**
 * ADSR envelope — per-track envelope state and Web Audio gain automation.
 *
 * Each note gets a dedicated GainNode whose gain parameter is automated
 * through Attack → Decay → Sustain → Release phases. For scheduler notes,
 * release is auto-triggered at step end. For MIDI notes, release is
 * triggered on note-off via triggerRelease().
 */

import { TOTAL_TRACKS } from '../config';

// ═══════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════

export interface AdsrParams {
  attack: number; // seconds (0.001–2.0)
  decay: number; // seconds (0.001–2.0)
  sustain: number; // level (0–1)
  release: number; // seconds (0.001–3.0)
}

// ═══════════════════════════════════════════
//  Per-track state
// ═══════════════════════════════════════════

function makeDefault(): AdsrParams {
  return { attack: 0.005, decay: 0.1, sustain: 1.0, release: 0.1 };
}

const trackAdsr: AdsrParams[] = Array.from({ length: TOTAL_TRACKS }, () => makeDefault());

/** Per-track ADSR enabled state — OFF by default (samples play naturally). */
const trackAdsrEnabled: boolean[] = Array.from({ length: TOTAL_TRACKS }, () => false);

// ═══════════════════════════════════════════
//  Public API — state
// ═══════════════════════════════════════════

/** Whether ADSR is enabled for a track. */
export function isAdsrEnabled(trackIndex: number): boolean {
  return trackAdsrEnabled[trackIndex] ?? false;
}

/** Enable or disable ADSR for a track. */
export function setAdsrEnabled(trackIndex: number, on: boolean): void {
  if (trackIndex >= 0 && trackIndex < TOTAL_TRACKS) {
    trackAdsrEnabled[trackIndex] = on;
  }
}

/** Get ADSR parameters for a track. */
export function getTrackAdsr(trackIndex: number): AdsrParams {
  const p = trackAdsr[trackIndex];
  if (!p) return makeDefault();
  return p;
}

/** Update ADSR parameters for a track (partial merge). */
export function setTrackAdsr(trackIndex: number, params: Partial<AdsrParams>): void {
  const p = trackAdsr[trackIndex];
  if (!p) return;
  if (params.attack !== undefined) p.attack = Math.max(0.001, Math.min(2.0, params.attack));
  if (params.decay !== undefined) p.decay = Math.max(0.001, Math.min(2.0, params.decay));
  if (params.sustain !== undefined) p.sustain = Math.max(0, Math.min(1.0, params.sustain));
  if (params.release !== undefined) p.release = Math.max(0.001, Math.min(3.0, params.release));
}

/** Reset all tracks to default ADSR. Called by newSong(). */
export function resetAllAdsr(): void {
  const d = makeDefault();
  for (const p of trackAdsr) {
    p.attack = d.attack;
    p.decay = d.decay;
    p.sustain = d.sustain;
    p.release = d.release;
  }
  trackAdsrEnabled.fill(false);
}

// ═══════════════════════════════════════════
//  Public API — audio
// ═══════════════════════════════════════════

/**
 * Create an envelope GainNode for a note and schedule A/D/S automation.
 *
 * For scheduler notes: pass stepDuration to auto-schedule release at step end.
 * For MIDI notes: omit stepDuration, call triggerRelease() on note-off.
 *
 * Connects: source → envelopeGain → dest
 * Returns the envelopeGain node (needed for MIDI release tracking).
 */
export function applyEnvelope(
  ctx: AudioContext,
  source: AudioBufferSourceNode,
  dest: AudioNode,
  trackIndex: number,
  startTime: number,
  stepDuration?: number,
): GainNode {
  const adsr = getTrackAdsr(trackIndex);
  const env = ctx.createGain();

  // Attack: ramp from 0 to 1
  env.gain.setValueAtTime(0.0001, startTime); // small non-zero avoids log discontinuity
  env.gain.linearRampToValueAtTime(1.0, startTime + adsr.attack);

  // Decay: exponential fall to sustain level
  // setTargetAtTime timeConstant = decay/3 reaches ~95% of target in decay time
  env.gain.setTargetAtTime(
    Math.max(0.0001, adsr.sustain),
    startTime + adsr.attack,
    Math.max(0.001, adsr.decay / 3),
  );

  if (stepDuration !== undefined) {
    // Scheduler: auto-release at step end
    const releaseStart = startTime + Math.max(adsr.attack, stepDuration - adsr.release);
    env.gain.setTargetAtTime(0.0001, releaseStart, Math.max(0.001, adsr.release / 3));
    // Stop source after release tail (4× time constant ≈ 98% decay)
    source.stop(releaseStart + adsr.release * 4);
  }

  source.connect(env);
  env.connect(dest);
  return env;
}

/**
 * Trigger the release phase for a MIDI note.
 * Call on note-off to fade out and schedule source stop.
 */
export function triggerRelease(
  ctx: AudioContext,
  envelopeGain: GainNode,
  source: AudioBufferSourceNode,
  adsr: AdsrParams,
): void {
  const now = ctx.currentTime;
  // Cancel any scheduled ramps and start release from current value
  envelopeGain.gain.cancelScheduledValues(now);
  envelopeGain.gain.setValueAtTime(envelopeGain.gain.value, now);
  envelopeGain.gain.setTargetAtTime(0.0001, now, Math.max(0.001, adsr.release / 3));
  // Stop source after release tail
  try {
    source.stop(now + adsr.release * 4);
  } catch {
    /* already stopped */
  }
}
