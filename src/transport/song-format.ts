/** Validate untrusted songs completely before touching live state. */
import type { ExtensionState, Phrase, SampleData, SongData, SongSection } from '../types';
import {
  STEPS,
  DEFAULT_PHRASES,
  MAX_PHRASES,
  PHRASE_COUNTS,
  TOTAL_TRACKS,
  DRUMS_CFG,
  MEL_CFG,
  DEFAULT_DRUM_NAMES,
  DEFAULT_MEL_NAMES,
  DEFAULT_VOCAL_NAME,
  HARMONY_SEMITONES,
} from '../config';

import { normalizeTheory } from './theory';
import { MIN_RELATIVE_PITCH, MAX_RELATIVE_PITCH, midiBase } from './notes';

export const MAX_SONG_FILE_BYTES = 128 * 1024 * 1024;
const MAX_SAMPLE_BYTES = 64 * 1024 * 1024;

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid ${field}: expected an object.`);
  }
  return value as Record<string, unknown>;
}
function number(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  field: string,
  integer = false,
): number {
  if (value === undefined) return fallback;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  ) {
    throw new Error(
      `Invalid ${field}: expected ${integer ? 'an integer' : 'a number'} from ${min} to ${max}.`,
    );
  }
  return value;
}
function string(value: unknown, fallback: string, field: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.length > 1024)
    throw new Error(`Invalid ${field}: expected text (up to 1024 characters).`);
  return value;
}
function boolean(value: unknown, field: string): boolean {
  if (value === undefined) return false;
  if (typeof value !== 'boolean') throw new Error(`Invalid ${field}: expected true or false.`);
  return value;
}
function array(value: unknown, length: number, field: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > length)
    throw new Error(`Invalid ${field}: expected at most ${length} entries.`);
  return value as unknown[];
}
function map<T>(
  value: unknown,
  length: number,
  field: string,
  fn: (item: unknown, index: number) => T,
): T[] {
  const items = array(value, length, field);
  return Array.from({ length }, (_, i) => fn(items[i], i));
}
export function normalizePhrase(value: unknown): Phrase {
  const p = value === undefined ? {} : record(value, 'phrase');
  const phrase: Phrase = {
    drumPat: map(p.drumPat, DRUMS_CFG.length, 'drum tracks', (t) =>
      map(t, STEPS, 'drum steps', (v) => boolean(v, 'step')),
    ),
    melPat: map(p.melPat, MEL_CFG.length, 'melody tracks', (t) =>
      map(t, STEPS, 'melody steps', (s) => map(s, 12, 'notes', (v) => boolean(v, 'note'))),
    ),
    vocalPat: map(p.vocalPat, STEPS, 'vocal steps', (v) => boolean(v, 'step')),
  };
  if (p.melExtra !== undefined) {
    const extra = map(p.melExtra, MEL_CFG.length, 'extra melody tracks', (t) =>
      map(t, STEPS, 'extra melody steps', (raw) => {
        const notes = array(raw, 128, 'extra notes').map((v) =>
          number(v, 0, MIN_RELATIVE_PITCH, MAX_RELATIVE_PITCH, 'extra pitch', true),
        );
        if (notes.some((n) => n >= 0 && n < 12) || new Set(notes).size !== notes.length)
          throw new Error('Extra notes must be unique pitches outside the base octave.');
        return notes.sort((a, b) => a - b);
      }),
    );
    if (extra.some((t) => t.some((s) => s.length))) phrase.melExtra = extra;
  }
  return phrase;
}

export function normalizeSections(value: unknown, phraseCount: number): SongSection[] {
  const ids = new Set<string>();
  const sections = array(value, phraseCount, 'sections')
    .map((item) => {
      const section = record(item, 'section');
      const id = string(section.id, '', 'section id').trim();
      const name = string(section.name, '', 'section name').trim();
      if (!id || ids.has(id) || !name || name.length > 32)
        throw new Error('Sections need unique IDs and names of 1–32 characters.');
      ids.add(id);
      const start = number(section.start, -1, 0, phraseCount - 1, 'section start', true);
      const length = number(section.length, 0, 1, phraseCount, 'section length', true);
      if (start < 0 || length < 1 || start + length > phraseCount)
        throw new Error('Section extends outside the song.');
      return { id, name, start, length };
    })
    .sort((a, b) => a.start - b.start);
  if (
    sections.some(
      (section, i) => i > 0 && section.start < sections[i - 1]!.start + sections[i - 1]!.length,
    )
  )
    throw new Error('Sections cannot overlap.');
  return sections;
}

const EXTENSION_RANGES: Record<string, Record<string, readonly number[]>> = {
  compressor: {
    drive: [0, 1],
    compress: [-50, 0],
    ratio: [1, 20],
    knee: [0, 40],
    speed: [0, 3, 1],
    mix: [0, 1],
    output: [0, 1],
    model: [0, 2, 1],
  },
  'pultec-eq': {
    lowBoost: [0, 10],
    lowAtten: [0, 10],
    lowFreq: [20, 100],
    highBoost: [0, 10],
    highBandwidth: [0, 1],
    highAtten: [0, 10],
    highBoostFreq: [3000, 16000],
    highAttenFreq: [5000, 20000],
    tubeColor: [0, 1],
  },
  transformer: { drive: [0, 1], color: [0, 1], air: [0, 1] },
  mixer: {},
  reverb: { decay: [0, 1], damping: [0, 1], mix: [0, 1] },
  delay: { time: [0.04, 0.8], feedback: [0, 0.95], tone: [0, 1], mix: [0, 1] },
};
function extensions(value: unknown): Record<string, ExtensionState> {
  if (value === undefined) return {};
  const input = record(value, 'effects');
  const result: Record<string, ExtensionState> = {};
  for (const [id, ranges] of Object.entries(EXTENSION_RANGES)) {
    if (input[id] === undefined) continue;
    const state = record(input[id], id);
    const output: ExtensionState = { _enabled: boolean(state._enabled, `${id} enabled`) };
    for (const [key, range] of Object.entries(ranges)) {
      if (state[key] !== undefined)
        output[key] = number(state[key], 0, range[0]!, range[1]!, `${id} ${key}`, range[2] === 1);
    }
    const vector = id === 'mixer' ? 'levels' : id === 'reverb' || id === 'delay' ? 'sends' : null;
    if (vector && state[vector] !== null && state[vector] !== undefined) {
      output[vector] = map(state[vector], TOTAL_TRACKS, `${id} ${vector}`, (v) =>
        number(v, id === 'mixer' ? 0.8 : 0, 0, 1, vector),
      );
    }
    result[id] = output;
  }
  return result;
}

export function normalizeSong(value: unknown, requirePatterns = false): SongData {
  const input = record(value, 'song');
  if (input.formatVersion !== undefined && input.formatVersion !== 1 && input.formatVersion !== 2)
    throw new Error('Unsupported song file version.');
  if (
    requirePatterns &&
    input.phrases === undefined &&
    input.drumPat === undefined &&
    input.melPat === undefined &&
    input.vocalPat === undefined
  ) {
    throw new Error('This file contains no song patterns. Choose a sequencer JSON export.');
  }
  let sampleBytes = 0;
  function sample(value: unknown): SampleData | null {
    if (value === null || value === undefined) return null;
    const s = record(value, 'sample');
    let data: ArrayBuffer;
    if (s.data instanceof ArrayBuffer) {
      data = s.data;
    } else {
      if (
        s.encoding !== 'base64' ||
        typeof s.data !== 'string' ||
        s.data.length > (MAX_SAMPLE_BYTES * 4) / 3 + 4 ||
        /[^A-Za-z0-9+/=]/.test(s.data)
      ) {
        throw new Error(
          'Invalid sample audio. Export again from the original song or reload the missing sample.',
        );
      }
      const binary = atob(s.data);
      data = Uint8Array.from(binary, (c) => c.charCodeAt(0)).buffer;
    }
    sampleBytes += data.byteLength;
    if (data.byteLength === 0 || sampleBytes > MAX_SAMPLE_BYTES)
      throw new Error('Song audio must contain at most 64 MiB of sample data.');
    return { name: string(s.name, 'Sample', 'sample name'), data };
  }
  const sound = input.sound === undefined ? {} : record(input.sound, 'sound settings');
  const engine = sound.engine === undefined ? {} : record(sound.engine, 'engine settings');
  const storedPhrases = array(input.phrases, MAX_PHRASES, 'phrases');
  const inferredCount = Math.max(DEFAULT_PHRASES, Math.ceil(storedPhrases.length / 12) * 12);
  const phraseCount = number(
    input.phraseCount,
    inferredCount,
    12,
    MAX_PHRASES,
    'phrase count',
    true,
  );
  if (!PHRASE_COUNTS.includes(phraseCount)) throw new Error('Choose 12, 24, 36, or 48 phrases.');
  const phrases =
    input.phrases === undefined
      ? [
          normalizePhrase(input),
          ...Array.from({ length: phraseCount - 1 }, () => normalizePhrase(undefined)),
        ]
      : map(input.phrases, phraseCount, 'phrases', (v) => normalizePhrase(v));
  const normalized: SongData = {
    id: string(input.id, '', 'song id'),
    name: string(input.name, 'Untitled', 'song name'),
    bpm: number(input.bpm, 120, 40, 220, 'BPM'),
    phrases,
    phraseCount,
    theory: normalizeTheory(input.theory),
    sections: normalizeSections(input.sections, phraseCount),
    variationLocks: map(input.variationLocks, TOTAL_TRACKS, 'variation locks', (v, i) =>
      v === undefined ? i === 0 || i === 7 : boolean(v, 'variation lock'),
    ),
    currentPhrase: number(input.currentPhrase, 0, 0, phraseCount - 1, 'current phrase', true),
    octaves: map(input.octaves, MEL_CFG.length, 'octaves', (v) =>
      number(v, 3, 1, 7, 'octave', true),
    ),
    harmonies: map(input.harmonies, MEL_CFG.length, 'harmonies', (v) =>
      number(v, 0, 0, HARMONY_SEMITONES.length - 1, 'harmony', true),
    ),
    drumNames: map(input.drumNames, DRUMS_CFG.length, 'drum names', (v, i) =>
      string(v, DEFAULT_DRUM_NAMES[i]!, 'drum name'),
    ),
    melNames: map(input.melNames, MEL_CFG.length, 'melody names', (v, i) =>
      string(v, DEFAULT_MEL_NAMES[i]!, 'melody name'),
    ),
    vocalName: string(input.vocalName, DEFAULT_VOCAL_NAME, 'vocal name'),
    mutedArr: map(input.mutedArr, TOTAL_TRACKS, 'mutes', (v) => boolean(v, 'mute')),
    drumSampleData: map(input.drumSampleData, DRUMS_CFG.length, 'drum audio', sample),
    melSampleData: map(input.melSampleData, MEL_CFG.length, 'melody audio', sample),
    vocalSampleData: sample(input.vocalSampleData),
    extensions: extensions(input.extensions),
    updatedAt: number(input.updatedAt, 0, 0, Number.MAX_SAFE_INTEGER, 'updated time'),
    revision: number(input.revision, 0, 0, Number.MAX_SAFE_INTEGER, 'revision', true),
    sound: {
      masterGain: number(sound.masterGain, 0.8, 0, 1, 'master gain'),
      engine: {
        cutoff: number(engine.cutoff, 1, 0, 1, 'cutoff'),
        resonance: number(engine.resonance, 0, 0, 1, 'resonance'),
        saturation: number(engine.saturation, 0, 0, 1, 'saturation'),
        compression: number(engine.compression, 0, 0, 1, 'compression'),
      },
      adsr: map(sound.adsr, TOTAL_TRACKS, 'envelopes', (v) => {
        const a = v === undefined ? {} : record(v, 'envelope');
        return {
          enabled: boolean(a.enabled, 'envelope enabled'),
          attack: number(a.attack, 0.005, 0.001, 2, 'attack'),
          decay: number(a.decay, 0.1, 0.001, 2, 'decay'),
          sustain: number(a.sustain, 1, 0, 1, 'sustain'),
          release: number(a.release, 0.1, 0.001, 3, 'release'),
          gateSteps: number(a.gateSteps, 1, 1, 64, 'note length', true),
        };
      }),
    },
  };
  for (const phrase of normalized.phrases)
    phrase.melExtra?.forEach((track, t) => {
      const base = midiBase(normalized.octaves[t]!);
      if (track.some((notes) => notes.some((note) => note + base < 0 || note + base > 127)))
        throw new Error('Extra notes exceed the track MIDI range.');
    });
  return normalized;
}

/** Self-contained JSON; binary encoding is explicit and versioned. */
export function encodeSongFile(song: SongData): string {
  return JSON.stringify(
    {
      ...song,
      id: undefined,
      revision: undefined,
      updatedAt: undefined,
      formatVersion: song.phrases.some((phrase) => phrase.melExtra) ? 2 : 1,
    },
    (_key, value: unknown) => {
      if (
        value &&
        typeof value === 'object' &&
        'data' in value &&
        value.data instanceof ArrayBuffer
      ) {
        const bytes = new Uint8Array(value.data);
        let binary = '';
        for (let i = 0; i < bytes.length; i += 8192)
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        return { ...value, encoding: 'base64', data: btoa(binary) };
      }
      return value;
    },
  );
}
