/**
 * Audio engine contract.
 *
 * The current implementation uses Web Audio API nodes.
 * Phase 2 will swap this for Faust/Wasm AudioWorklets.
 * Neither transport nor UI imports the implementation — only this interface.
 */

import type { Phrase } from '../types';

export interface AudioEngine {
  /** Initialize audio context and nodes */
  init(): Promise<void>;

  /** Tear down all nodes */
  dispose(): void;

  // ── Sample management ──

  /** Load a sample buffer for a track (0-indexed across all track types) */
  loadSample(track: number, buffer: ArrayBuffer): Promise<AudioBuffer>;

  // ── Playback ──

  /** Start playback from the beginning */
  play(startPhrase: number): void;

  /** Stop playback */
  stop(): void;

  /** Whether the engine is currently playing */
  isPlaying(): boolean;

  /** Set tempo */
  setBpm(bpm: number): void;

  // ── Per-track control ──

  /** Set track volume (0-1) */
  setTrackGain(track: number, gain: number): void;

  /** Mute/unmute a track */
  setTrackMute(track: number, muted: boolean): void;

  /** Get current RMS level for metering (0-1) */
  getTrackLevel(track: number): number;

  // ── Pattern data ──

  /**
   * Push pattern data into the engine.
   * Called when patterns change or when loading a song.
   * The engine reads from these to know what to schedule.
   */
  setPatterns(phrases: readonly Phrase[]): void;

  // ── Extension insert point ──

  /**
   * Returns the audio nodes where insert extensions should connect.
   * In Web Audio: masterGain → [extensions] → destination.
   * In Wasm: equivalent worklet nodes.
   */
  getMasterGain(): GainNode | null;
  getTrackGains(): GainNode[];
  getAudioContext(): AudioContext | null;
}
