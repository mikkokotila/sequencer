/**
 * Persistence — IndexedDB operations, song save/load, file import/export.
 */

import type { ExtensionState, Phrase, SampleData, SongData } from '../types';
import { DRUMS_CFG, MEL_CFG, STEPS } from '../config';
import {
  phrases,
  makeEmptyPhrase,
  octaves,
  harmonies,
  currentPhrase,
  setCurrentPhrase,
  setDrumPat,
  setMelPat,
  setVocalPat,
} from './patterns';
import {
  db,
  bpm,
  setBpm,
  currentSongId,
  setCurrentSongId,
  currentSongName,
  setCurrentSongName,
  saveTimer,
  setSaveTimer,
  drumNames,
  setDrumNames,
  melNames,
  setMelNames,
  vocalName,
  setVocalName,
  mutedArr,
  drumBuf,
  melBuf,
  setVocalBuf,
  drumSampleData,
  melSampleData,
  vocalSampleData,
  setVocalSampleData,
} from './song';
import { SEQ_EXTENSIONS, resetAllExtensions } from '../engine/extensions/store';
import { getAudioContext } from '../engine/audio';
import { emit } from '../events';

// ═══════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export { openDB, dbPut, dbGet, dbGetAll, dbDelete } from './database';
import { dbPut, dbGet, dbGetAll, transactionResult } from './database';
import { normalizeSong, encodeSongFile, MAX_SONG_FILE_BYTES } from './song-format';
import { getMasterGain } from '../engine/audio';
import { getTrackAdsr, isAdsrEnabled, setTrackAdsr, setAdsrEnabled } from '../engine/adsr';
import { getEngineSettings, setEngineSettings } from '../engine/master-controls';

// ═══════════════════════════════════════════
//  Song serialization
// ═══════════════════════════════════════════

export function collectSongData(name: string): SongData {
  return {
    id: currentSongId || genId(),
    name: name || 'Untitled',
    bpm,
    phraseCount: phrases.length,
    phrases: phrases.map((p: Phrase) => ({
      drumPat: p.drumPat.map((r) => [...r]),
      melPat: p.melPat.map((t) => t.map((s) => [...s])),
      vocalPat: [...p.vocalPat],
    })),
    currentPhrase,
    octaves: [...octaves],
    harmonies: [...harmonies],
    drumNames: [...drumNames],
    melNames: [...melNames],
    vocalName,
    mutedArr: [...mutedArr],
    drumSampleData: drumSampleData.map((d) => (d ? { name: d.name, data: d.data } : null)),
    melSampleData: melSampleData.map((d) => (d ? { name: d.name, data: d.data } : null)),
    vocalSampleData: vocalSampleData
      ? { name: vocalSampleData.name, data: vocalSampleData.data }
      : null,
    extensions: SEQ_EXTENSIONS.reduce<Record<string, ExtensionState>>((o, ext) => {
      const s = structuredClone(ext.getState());
      s._enabled = !!ext._enabled;
      o[ext.id] = s;
      return o;
    }, {}),
    sound: {
      masterGain: getMasterGain()?.gain.value ?? 0.8,
      engine: getEngineSettings(),
      adsr: mutedArr.map((_, i) => ({ ...getTrackAdsr(i), enabled: isAdsrEnabled(i) })),
    },
    updatedAt: Date.now(),
  };
}

// ═══════════════════════════════════════════
//  Save / schedule
// ═══════════════════════════════════════════

export class SaveConflictError extends Error {
  constructor() {
    super(
      'This song was changed or deleted in another tab. Export your local copy, then reload the saved song.',
    );
    this.name = 'SaveConflictError';
  }
}

export function reportPersistenceError(error: unknown): void {
  emit('persistence:status', {
    message:
      error instanceof Error ? error.message : 'Song storage failed. Export a copy and retry.',
    conflict: error instanceof SaveConflictError,
  });
}

let loadGeneration = 0;
let stateGeneration = 0;
let saveQueue: Promise<void> = Promise.resolve();
let baseline: SongData | null = null;
const revisions = new Map<string, number>();

function unchanged(a: SongData, b: SongData | null): boolean {
  if (a.id !== b?.id) return false;
  const samples = (s: SongData): (SampleData | null)[] => [
    ...s.drumSampleData,
    ...s.melSampleData,
    s.vocalSampleData,
  ];
  const before = samples(b);
  if (samples(a).some((s, i) => s?.data !== before[i]?.data || s?.name !== before[i]?.name))
    return false;
  const metadata = (s: SongData): string =>
    JSON.stringify({
      ...s,
      updatedAt: undefined,
      revision: undefined,
      drumSampleData: undefined,
      melSampleData: undefined,
      vocalSampleData: undefined,
    });
  return metadata(a) === metadata(b);
}

async function writeSnapshot(data: SongData, generation: number): Promise<void> {
  if (!db) throw new Error('Song storage is not open. Export a copy before closing this tab.');
  if (unchanged(data, baseline)) return;
  const expected = revisions.get(data.id);
  const tx = db.transaction(['songs', 'meta'], 'readwrite');
  const songs = tx.objectStore('songs');
  const read = songs.get(data.id) as IDBRequest<SongData | undefined>;
  const result = { conflict: false };
  const committed = transactionResult(tx, () => undefined);
  read.onsuccess = () => {
    const saved = read.result;
    if (
      (saved && (expected === undefined || (saved.revision ?? 0) !== expected)) ||
      (!saved && expected !== undefined)
    ) {
      result.conflict = true;
      tx.abort();
      return;
    }
    data.revision = (expected ?? 0) + 1;
    songs.put(data);
    if (data.id === currentSongId) tx.objectStore('meta').put(data.id, 'currentSongId');
  };
  try {
    await committed;
  } catch (error) {
    throw result.conflict ? new SaveConflictError() : error;
  }
  // A load that completed while the transaction was pending owns its own revision.
  if (generation === stateGeneration) {
    revisions.set(data.id, data.revision!);
    if (currentSongId === data.id) baseline = data;
    emit('persistence:status', { message: '', conflict: false });
  }
}

export function saveSong(): Promise<void> {
  if (!currentSongId) return Promise.resolve();
  const data = collectSongData(currentSongName);
  const generation = stateGeneration;
  const pending = saveQueue.then(() => writeSnapshot(data, generation));
  saveQueue = pending.catch(() => undefined);
  return pending;
}

export function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  setSaveTimer(
    setTimeout(() => {
      void saveSong().catch(reportPersistenceError);
    }, 500),
  );
}

/** Decode everything off to the side. An older operation never partially mutates live state. */
async function applySong(song: SongData, generation: number, persisted: boolean): Promise<boolean> {
  const ctx = getAudioContext();
  const decode = async (sample: SampleData | null): Promise<AudioBuffer | null> => {
    if (!sample) return null;
    if (!ctx) throw new Error('Audio is not ready. Retry loading the song.');
    try {
      return await ctx.decodeAudioData(sample.data.slice(0));
    } catch {
      throw new Error(
        `Could not decode sample "${sample.name}". The current song has been preserved.`,
      );
    }
  };
  const buffers = await Promise.all(
    [...song.drumSampleData, ...song.melSampleData, song.vocalSampleData].map(decode),
  );
  await saveQueue;
  if (generation !== loadGeneration) return false;
  if (saveTimer) clearTimeout(saveTimer);
  stateGeneration++;
  emit('persistence:beforeLoad', {});
  setBpm(song.bpm);
  while (phrases.length < song.phrases.length) phrases.push(makeEmptyPhrase());
  phrases.splice(song.phrases.length);
  for (let i = 0; i < phrases.length; i++) {
    const target = phrases[i]!;
    const source = song.phrases[i]!;
    target.drumPat.forEach((row, t) => row.splice(0, STEPS, ...source.drumPat[t]!));
    target.melPat.forEach((track, t) =>
      track.forEach((step, j) => step.splice(0, 12, ...source.melPat[t]![j]!)),
    );
    target.vocalPat.splice(0, STEPS, ...source.vocalPat);
  }
  setCurrentPhrase(song.currentPhrase);
  const active = phrases[song.currentPhrase]!;
  setDrumPat(active.drumPat);
  setMelPat(active.melPat);
  setVocalPat(active.vocalPat);
  octaves.splice(0, octaves.length, ...song.octaves);
  harmonies.splice(0, harmonies.length, ...song.harmonies);
  setDrumNames(song.drumNames);
  setMelNames(song.melNames);
  setVocalName(song.vocalName);
  mutedArr.splice(0, mutedArr.length, ...song.mutedArr);
  drumSampleData.splice(0, drumSampleData.length, ...song.drumSampleData);
  melSampleData.splice(0, melSampleData.length, ...song.melSampleData);
  setVocalSampleData(song.vocalSampleData);
  drumBuf.splice(0, drumBuf.length, ...buffers.slice(0, DRUMS_CFG.length));
  melBuf.splice(
    0,
    melBuf.length,
    ...buffers.slice(DRUMS_CFG.length, DRUMS_CFG.length + MEL_CFG.length),
  );
  setVocalBuf(buffers[buffers.length - 1] ?? null);
  resetAllExtensions();
  for (const ext of SEQ_EXTENSIONS) {
    const state = song.extensions[ext.id];
    if (!state) continue;
    ext.setState(state);
    ext._enabled = !!state._enabled;
    ext.setEnabled?.(ext._enabled);
  }
  const sound = song.sound!;
  sound.adsr.forEach((params, i) => {
    setTrackAdsr(i, params);
    setAdsrEnabled(i, params.enabled);
  });
  const master = getMasterGain();
  if (master) master.gain.value = sound.masterGain;
  setEngineSettings(sound.engine);
  setCurrentSongId(song.id || null);
  setCurrentSongName(song.name);
  baseline = persisted ? collectSongData(song.name) : null;
  if (persisted) revisions.set(song.id, song.revision ?? 0);
  emit('persistence:status', { message: '', conflict: false });
  emit('transport:songLoaded', {});
  return true;
}

export async function loadSong(value: unknown, persisted = false): Promise<boolean> {
  const generation = ++loadGeneration;
  return applySong(normalizeSong(value), generation, persisted);
}

export async function newSong(): Promise<void> {
  const generation = ++loadGeneration;
  await saveSong();
  if (generation !== loadGeneration) return;
  // applySong resets all extensions, envelopes, engine controls and samples together.
  if (!(await applySong(normalizeSong({ id: genId() }), generation, false))) return;
  await saveSong();
  if (generation === loadGeneration) emit('persistence:songCreated', {});
}

export async function deleteSong(): Promise<boolean> {
  if (!currentSongId || !db) return false;
  const generation = ++loadGeneration;
  if (saveTimer) clearTimeout(saveTimer);
  await saveQueue;
  if (generation !== loadGeneration) return false;
  const id = currentSongId;
  const tx = db.transaction(['songs', 'meta'], 'readwrite');
  const read = tx.objectStore('songs').get(id) as IDBRequest<SongData | undefined>;
  const result = { conflict: false };
  const committed = transactionResult(tx, () => undefined);
  read.onsuccess = () => {
    if (!read.result || (read.result.revision ?? 0) !== revisions.get(id)) {
      result.conflict = true;
      tx.abort();
      return;
    }
    tx.objectStore('songs').delete(id);
    tx.objectStore('meta').delete('currentSongId');
  };
  try {
    await committed;
  } catch (error) {
    throw result.conflict ? new SaveConflictError() : error;
  }
  const songs = await dbGetAll<SongData>('songs');
  if (generation !== loadGeneration) return false;
  const replacement = songs[songs.length - 1];
  if (!(await applySong(normalizeSong(replacement ?? { id: genId() }), generation, !!replacement)))
    return false;
  if (replacement) await dbPut('meta', replacement.id, 'currentSongId');
  else await saveSong();
  emit('persistence:songDeleted', {});
  return true;
}

export async function saveSongCopy(): Promise<void> {
  const generation = ++loadGeneration;
  await saveQueue;
  if (generation !== loadGeneration) return;
  stateGeneration++;
  setCurrentSongId(genId());
  setCurrentSongName(`${currentSongName} (copy)`);
  baseline = null;
  await saveSong();
  emit('persistence:songSwitched', {});
}

/** Explicit recovery discards local edits only after the user chooses Reload saved. */
export async function reloadSavedSong(): Promise<void> {
  const generation = ++loadGeneration;
  if (!currentSongId) return;
  if (saveTimer) clearTimeout(saveTimer);
  await saveQueue;
  if (generation !== loadGeneration) return;
  const saved = await dbGet<SongData>('songs', currentSongId);
  if (!saved)
    throw new Error(
      'The saved song was deleted. Export your local copy before creating a new song.',
    );
  if (await applySong(normalizeSong(saved), generation, true)) emit('persistence:songSwitched', {});
}

// ═══════════════════════════════════════════
//  File import / export
// ═══════════════════════════════════════════

export function savePatternFile(): void {
  const data = collectSongData(currentSongName);
  let encoded: string;
  try {
    normalizeSong(data, true);
    encoded = encodeSongFile(data);
  } catch (error) {
    reportPersistenceError(error);
    return;
  }
  const blob = new Blob([encoded], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = currentSongName.replace(/[^a-zA-Z0-9\-_ ]/g, '') + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

/**
 * Render every non-empty phrase to a 24-bit PCM WAV and bundle the lot into
 * an uncompressed ZIP, then trigger a download.
 */
export async function exportLoopsZip(): Promise<void> {
  const { renderPhraseToBuffer } = await import('./render');
  const { audioBufferToWav24 } = await import('./wav');
  const { buildStoreZip } = await import('./zip');
  const { isPhraseEmpty } = await import('./patterns');
  type Entry = import('./zip').ZipEntry;

  const entries: Entry[] = [];
  for (let p = 0; p < phrases.length; p++) {
    if (isPhraseEmpty(p)) continue;
    const buf = await renderPhraseToBuffer(p);
    if (!buf) continue;
    const wav = audioBufferToWav24(buf);
    entries.push({ name: `phrase-${String(p + 1).padStart(2, '0')}.wav`, data: wav });
  }

  if (entries.length === 0) {
    console.warn('Export Loops: no non-empty phrases to render.');
    return;
  }

  const zip = buildStoreZip(entries);
  const blob = new Blob([zip.buffer as ArrayBuffer], { type: 'application/zip' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = currentSongName.replace(/[^a-zA-Z0-9\-_ ]/g, '') + '-loops.zip';
  a.click();
  URL.revokeObjectURL(a.href);
}

export function loadPatternFile(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    const generation = ++loadGeneration;
    const id = currentSongId;
    try {
      if (file.size > MAX_SONG_FILE_BYTES) throw new Error('Song file exceeds the 128 MiB limit.');
      const text = await file.text();
      if (generation !== loadGeneration) return;
      const song = normalizeSong(JSON.parse(text) as unknown, true);
      song.id = id ?? genId();
      if (await applySong(song, generation, false)) {
        emit('persistence:fileLoaded', {});
        scheduleSave();
      }
    } catch (error) {
      if (generation === loadGeneration) reportPersistenceError(error);
    }
  };
  input.click();
}

export async function switchSong(id: string): Promise<void> {
  if (id === currentSongId) return;
  const generation = ++loadGeneration;
  await saveSong();
  if (generation !== loadGeneration) return;
  const song = await dbGet<SongData>('songs', id);
  if (!song) throw new Error('This song no longer exists. Refresh the song list.');
  if (await applySong(normalizeSong(song), generation, true)) {
    emit('persistence:songSwitched', {});
    await dbPut('meta', id, 'currentSongId');
  }
}
