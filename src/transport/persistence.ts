/**
 * Persistence — IndexedDB operations, song save/load, file import/export.
 */

import type { ExtensionState, Phrase, SampleData, SongData } from '../types';
import {
  DRUMS_CFG,
  MEL_CFG,
  STEPS,
  NUM_PHRASES,
  DEFAULT_DRUM_NAMES,
  DEFAULT_MEL_NAMES,
  DEFAULT_VOCAL_NAME,
} from '../config';
import {
  phrases,
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
  setDb,
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
import {
  SEQ_EXTENSIONS,
} from '../state';
import { getAudioContext, initAudio } from '../engine/audio';

// ═══════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ═══════════════════════════════════════════
//  IndexedDB primitives
// ═══════════════════════════════════════════

type StoreName = 'songs' | 'meta';

export function openDB(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('sequencer-db', 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('songs')) {
        d.createObjectStore('songs', { keyPath: 'id' });
      }
      if (!d.objectStoreNames.contains('meta')) {
        d.createObjectStore('meta');
      }
    };
    req.onsuccess = () => {
      setDb(req.result);
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
}

export function dbPut(store: StoreName, val: unknown, key?: IDBValidKey): Promise<IDBValidKey> {
  return new Promise<IDBValidKey>((res, rej) => {
    if (!db) { rej(new Error('DB not open')); return; }
    const tx = db.transaction(store, 'readwrite');
    const s = tx.objectStore(store);
    const r = key !== undefined ? s.put(val, key) : s.put(val);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export function dbGet<T = unknown>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  return new Promise<T | undefined>((res, rej) => {
    if (!db) { rej(new Error('DB not open')); return; }
    const tx = db.transaction(store, 'readonly');
    const r = tx.objectStore(store).get(key);
    r.onsuccess = () => res(r.result as T | undefined);
    r.onerror = () => rej(r.error);
  });
}

export function dbGetAll<T = unknown>(store: StoreName): Promise<T[]> {
  return new Promise<T[]>((res, rej) => {
    if (!db) { rej(new Error('DB not open')); return; }
    const tx = db.transaction(store, 'readonly');
    const r = tx.objectStore(store).getAll();
    r.onsuccess = () => res(r.result as T[]);
    r.onerror = () => rej(r.error);
  });
}

export function dbDelete(store: StoreName, key: IDBValidKey): Promise<void> {
  return new Promise<void>((res, rej) => {
    if (!db) { rej(new Error('DB not open')); return; }
    const tx = db.transaction(store, 'readwrite');
    const r = tx.objectStore(store).delete(key);
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}

// ═══════════════════════════════════════════
//  Song serialization
// ═══════════════════════════════════════════

export function collectSongData(name: string): SongData {
  return {
    id: currentSongId || genId(),
    name: name || 'Untitled',
    bpm,
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
    drumSampleData: drumSampleData.map((d) =>
      d ? { name: d.name, data: d.data } : null,
    ),
    melSampleData: melSampleData.map((d) =>
      d ? { name: d.name, data: d.data } : null,
    ),
    vocalSampleData: vocalSampleData
      ? { name: vocalSampleData.name, data: vocalSampleData.data }
      : null,
    extensions: SEQ_EXTENSIONS.reduce<Record<string, ExtensionState>>(
      (o, ext) => {
        const s = ext.getState();
        s['_enabled'] = !!ext._enabled;
        o[ext.id] = s;
        return o;
      },
      {},
    ),
    updatedAt: Date.now(),
  };
}

// ═══════════════════════════════════════════
//  Save / schedule
// ═══════════════════════════════════════════

export async function saveSong(): Promise<void> {
  if (!db || !currentSongId) return;
  const data = collectSongData(currentSongName);
  data.id = currentSongId;
  await dbPut('songs', data);
  await dbPut('meta', currentSongId, 'currentSongId');
}

export function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  setSaveTimer(setTimeout(() => { void saveSong(); }, 500));
}

// ═══════════════════════════════════════════
//  Load song
// ═══════════════════════════════════════════

/**
 * Partial song data coming from the DB or a file import.
 * Uses loose types for backward compatibility with older song formats
 * where phrases may not exist (flat drumPat/melPat/vocalPat on root).
 */
interface LegacySongInput {
  id?: string;
  name?: string;
  bpm?: number;
  phrases?: Phrase[];
  /** Legacy flat patterns (pre-phrase format) */
  drumPat?: boolean[][];
  melPat?: boolean[][][];
  vocalPat?: boolean[];
  currentPhrase?: number;
  octaves?: number[];
  harmonies?: number[];
  drumNames?: string[];
  melNames?: string[];
  vocalName?: string;
  mutedArr?: boolean[];
  drumSampleData?: (SampleData | null)[];
  melSampleData?: (SampleData | null)[];
  vocalSampleData?: SampleData | null;
  extensions?: Record<string, ExtensionState>;
}

export async function loadSong(song: LegacySongInput): Promise<void> {
  setBpm(song.bpm ?? 120);

  // Load phrases (backward-compat: old songs have flat drumPat/melPat/vocalPat)
  for (let pi = 0; pi < NUM_PHRASES; pi++) {
    const sp = song.phrases?.[pi];
    const p = phrases[pi];
    if (!p) continue;
    const sd = sp ? sp.drumPat : pi === 0 ? song.drumPat : null;
    const sm = sp ? sp.melPat : pi === 0 ? song.melPat : null;
    const sv = sp ? sp.vocalPat : pi === 0 ? song.vocalPat : null;

    for (let t = 0; t < DRUMS_CFG.length; t++) {
      for (let s = 0; s < STEPS; s++) {
        const row = p.drumPat[t];
        if (row) row[s] = !!(sd?.[t]?.[s]);
      }
    }
    for (let t = 0; t < MEL_CFG.length; t++) {
      for (let s = 0; s < STEPS; s++) {
        for (let n = 0; n < 12; n++) {
          const step = p.melPat[t]?.[s];
          if (step) step[n] = !!(sm?.[t]?.[s]?.[n]);
        }
      }
    }
    for (let s = 0; s < STEPS; s++) {
      p.vocalPat[s] = !!(sv?.[s]);
    }
  }

  const phraseIdx = song.currentPhrase ?? 0;
  setCurrentPhrase(phraseIdx);
  const activePhrase = phrases[phraseIdx];
  if (activePhrase) {
    setDrumPat(activePhrase.drumPat);
    setMelPat(activePhrase.melPat);
    setVocalPat(activePhrase.vocalPat);
  }

  for (let t = 0; t < MEL_CFG.length; t++) {
    octaves[t] = song.octaves?.[t] ?? 3;
    harmonies[t] = song.harmonies?.[t] ?? 0;
  }

  setDrumNames(song.drumNames ?? [...DEFAULT_DRUM_NAMES]);
  setMelNames(song.melNames ?? [...DEFAULT_MEL_NAMES]);
  setVocalName(song.vocalName ?? DEFAULT_VOCAL_NAME);

  for (let i = 0; i < mutedArr.length; i++) {
    mutedArr[i] = !!(song.mutedArr?.[i]);
  }

  // Ensure audio context is ready for decoding
  initAudio();
  const ctx = getAudioContext();

  // Decode drum samples
  for (let t = 0; t < DRUMS_CFG.length; t++) {
    const sd = song.drumSampleData?.[t];
    if (sd?.data) {
      drumSampleData[t] = sd;
      try {
        drumBuf[t] = ctx ? await ctx.decodeAudioData(sd.data.slice(0)) : null;
      } catch (_e) {
        drumBuf[t] = null;
      }
    } else {
      drumBuf[t] = null;
      drumSampleData[t] = null;
    }
  }

  // Decode melody samples
  for (let t = 0; t < MEL_CFG.length; t++) {
    const sd = song.melSampleData?.[t];
    if (sd?.data) {
      melSampleData[t] = sd;
      try {
        melBuf[t] = ctx ? await ctx.decodeAudioData(sd.data.slice(0)) : null;
      } catch (_e) {
        melBuf[t] = null;
      }
    } else {
      melBuf[t] = null;
      melSampleData[t] = null;
    }
  }

  // Decode vocal sample
  const vsd = song.vocalSampleData;
  if (vsd?.data) {
    setVocalSampleData(vsd);
    try {
      setVocalBuf(ctx ? await ctx.decodeAudioData(vsd.data.slice(0)) : null);
    } catch (_e) {
      setVocalBuf(null);
    }
  } else {
    setVocalBuf(null);
    setVocalSampleData(null);
  }

  // Restore extension states
  if (song.extensions) {
    SEQ_EXTENSIONS.forEach((ext) => {
      const s = song.extensions?.[ext.id];
      if (s) {
        ext.setState(s);
        ext._enabled = !!s['_enabled'];
        if (ext.setEnabled) ext.setEnabled(ext._enabled);
      }
    });
  }

  setCurrentSongId(song.id ?? null);
  setCurrentSongName(song.name ?? 'Untitled');
}

// ═══════════════════════════════════════════
//  New / delete song
// ═══════════════════════════════════════════

/**
 * UI callbacks that main.ts wires up so persistence can trigger
 * UI refreshes without importing UI code directly.
 */
export interface PersistenceCallbacks {
  refreshUI: () => void;
  refreshSongName: () => void;
  updateSongPane: () => void;
  stopPlayback: () => void;
}

let _callbacks: PersistenceCallbacks | null = null;

/** Call once from main.ts to provide UI callback hooks. */
export function setPersistenceCallbacks(cb: PersistenceCallbacks): void {
  _callbacks = cb;
}

export async function newSong(): Promise<void> {
  await saveSong();
  _callbacks?.stopPlayback();

  // Clear all phrases
  for (let pi = 0; pi < NUM_PHRASES; pi++) {
    const p = phrases[pi];
    if (!p) continue;
    p.drumPat.forEach((r) => r.fill(false));
    p.melPat.forEach((t) => t.forEach((s) => s.fill(false)));
    p.vocalPat.fill(false);
  }

  // Reset phrase pointers
  setCurrentPhrase(0);
  const p0 = phrases[0];
  if (p0) {
    setDrumPat(p0.drumPat);
    setMelPat(p0.melPat);
    setVocalPat(p0.vocalPat);
  }

  // Reset track metadata
  octaves.fill(3);
  harmonies.fill(0);
  setDrumNames([...DEFAULT_DRUM_NAMES]);
  setMelNames([...DEFAULT_MEL_NAMES]);
  setVocalName(DEFAULT_VOCAL_NAME);
  mutedArr.fill(false);

  // Clear buffers
  drumBuf.fill(null);
  melBuf.fill(null);
  setVocalBuf(null);
  drumSampleData.fill(null);
  melSampleData.fill(null);
  setVocalSampleData(null);

  // Reset BPM and song identity
  setBpm(120);
  setCurrentSongId(genId());
  setCurrentSongName('Untitled');

  await saveSong();
  _callbacks?.refreshUI();
  _callbacks?.refreshSongName();
  _callbacks?.updateSongPane();
}

export async function deleteSong(): Promise<boolean> {
  if (!currentSongId) return false;
  await dbDelete('songs', currentSongId);

  const songs = await dbGetAll<SongData>('songs');
  if (songs.length > 0) {
    const last = songs[songs.length - 1];
    if (last) {
      await loadSong(last);
      _callbacks?.refreshUI();
      _callbacks?.refreshSongName();
    }
  } else {
    await newSong();
    return true;
  }

  await dbPut('meta', currentSongId, 'currentSongId');
  return true;
}

// ═══════════════════════════════════════════
//  File import / export
// ═══════════════════════════════════════════

export function savePatternFile(): void {
  const data = collectSongData(currentSongName);
  // Strip DB-only fields for a clean export
  const exportData: Record<string, unknown> = { ...data };
  delete exportData['id'];
  delete exportData['updatedAt'];

  const blob = new Blob([JSON.stringify(exportData)], {
    type: 'application/json',
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download =
    currentSongName.replace(/[^a-zA-Z0-9\-_ ]/g, '') + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

export function loadPatternFile(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async (e: Event) => {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text) as LegacySongInput;
      const merged: LegacySongInput = { ...data };
      if (currentSongId) merged.id = currentSongId;
      await loadSong(merged);
      _callbacks?.refreshUI();
      scheduleSave();
    } catch (err) {
      console.error('Load failed:', err);
    }
  };
  input.click();
}

// ═══════════════════════════════════════════
//  Switch song (used by song pane)
// ═══════════════════════════════════════════

export async function switchSong(id: string): Promise<void> {
  if (id === currentSongId) return;
  await saveSong();
  const song = await dbGet<SongData>('songs', id);
  if (!song) return;
  _callbacks?.stopPlayback();
  await loadSong(song);
  _callbacks?.refreshUI();
  _callbacks?.refreshSongName();
  await dbPut('meta', currentSongId, 'currentSongId');
}
