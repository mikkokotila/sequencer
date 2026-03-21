/**
 * Sample browser modal — manifest loading, browsing, preview, and sample
 * loading for drum/melody/vocal tracks.
 */

import type { TrackType, BrowserItem } from '../types';
import {
  sampleManifest,
  setSampleManifest,
  drumBuf,
  melBuf,
  drumSampleData,
  melSampleData,
  vocalSampleData,
  drumNames,
  melNames,
  setVocalBuf,
  setVocalSampleData,
} from '../transport/song';
import { drumPat, melPat, vocalPat } from '../transport/patterns';
import { playing } from '../state';
import { fetchAndDecode, playPreviewSample, loadAudioFile, getAudioContext } from '../engine/audio';
import { el, truncName } from './helpers';
import { scheduleSave } from '../transport/persistence';

// ═══════════════════════════════════════════
//  Module state
// ═══════════════════════════════════════════

let browserType: TrackType | '' = '';
let browserIdx = 0;
let browserItems: BrowserItem[] = [];
let browserSelected: number | null = null;
let browserPreviewBuf: AudioBuffer | null = null;
let browserPreviewBufIdx = -1;
let previewingIdx = -1;
let prevPreviewSource: AudioBufferSourceNode | null = null;

// ═══════════════════════════════════════════
//  Callbacks (set by main/build)
// ═══════════════════════════════════════════

// ═══════════════════════════════════════════
//  Manifest loading
// ═══════════════════════════════════════════

/** Synths manifest shape (different from drum entries). */
interface SynthsManifest {
  basePath: string;
  groups: Record<string, string[]>;
}

/**
 * The raw manifest from samples.json. Drum keys (kick, snare, ch, oh, crash)
 * have {path, files}; the synths key has {basePath, groups}.
 */
type RawManifest = Record<string, unknown>;

export async function loadManifest(): Promise<void> {
  try {
    const r = await fetch('samples.json');
    const raw: RawManifest = (await r.json()) as RawManifest;
    setSampleManifest(raw as ReturnType<typeof _getSampleManifest>);
  } catch {
    console.warn('No samples.json found — browser will use file picker fallback');
  }
}

/** Type-safe helper to read sampleManifest. */
function _getSampleManifest(): typeof sampleManifest {
  return sampleManifest;
}

// ═══════════════════════════════════════════
//  Name formatting
// ═══════════════════════════════════════════

function prettySynthName(filename: string): string {
  let n = filename.replace(/\.wav$/i, '');
  n = n.replace(/\s*C1$/i, '');
  return n;
}

function prettyDrumName(filename: string): string {
  return filename.replace(/\.wav$/i, '');
}

// ═══════════════════════════════════════════
//  Fallback file-picker loading
// ═══════════════════════════════════════════

function loadSampleFallback(type: TrackType, idx: number): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'audio/*';
  input.onchange = async (e: Event) => {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;
    try {
      const res = await loadAudioFile(file);
      if (type === 'drum') {
        drumBuf[idx] = res.buffer;
        drumSampleData[idx] = { name: res.name, data: res.data };
      } else if (type === 'melody') {
        melBuf[idx] = res.buffer;
        melSampleData[idx] = { name: res.name, data: res.data };
      } else {
        setVocalBuf(res.buffer);
        setVocalSampleData({ name: res.name, data: res.data });
      }
      updateSampleBtn(type, idx, res.name);
      scheduleSave();
    } catch (err) {
      console.error('Load failed:', err);
    }
  };
  input.click();
}

// ═══════════════════════════════════════════
//  Drag-and-drop setup
// ═══════════════════════════════════════════

export function setupDragDrop(elem: HTMLElement, type: TrackType, idx: number): void {
  elem.addEventListener('dragover', (e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    elem.classList.add('drag-over');
  });
  elem.addEventListener('dragleave', () => elem.classList.remove('drag-over'));
  elem.addEventListener('drop', (e: DragEvent) => {
    e.preventDefault();
    elem.classList.remove('drag-over');
    const file = e.dataTransfer?.files[0];
    if (!file) return;
    void (async () => {
      try {
        const res = await loadAudioFile(file);
        if (type === 'drum') {
          drumBuf[idx] = res.buffer;
          drumSampleData[idx] = { name: res.name, data: res.data };
        } else if (type === 'melody') {
          melBuf[idx] = res.buffer;
          melSampleData[idx] = { name: res.name, data: res.data };
        } else {
          setVocalBuf(res.buffer);
          setVocalSampleData({ name: res.name, data: res.data });
        }
        updateSampleBtn(type, idx, res.name);
        scheduleSave();
      } catch (err) {
        console.error('Drop failed:', err);
      }
    })();
  });
}

// ═══════════════════════════════════════════
//  Sample button UI update
// ═══════════════════════════════════════════

export function updateSampleBtn(type: TrackType | '', idx: number, name: string): void {
  let sel: string;
  if (type === 'drum') sel = `.melody-track[data-type="drum"][data-track="${idx}"] .sample-btn`;
  else if (type === 'melody')
    sel = `.melody-track[data-type="melody"][data-track="${idx}"] .sample-btn`;
  else sel = `.melody-track[data-type="vocal"] .sample-btn`;
  const btn = document.querySelector<HTMLElement>(sel);
  if (!btn) return;
  btn.textContent = truncName(name);
  btn.title = name;
  btn.classList.add('loaded');
}

// ═══════════════════════════════════════════
//  Browser open / close
// ═══════════════════════════════════════════

export function openBrowser(type: TrackType, idx: number): void {
  const manifest = sampleManifest as RawManifest | null;
  if (!manifest) {
    loadSampleFallback(type, idx);
    return;
  }

  browserType = type;
  browserIdx = idx;
  browserSelected = null;
  previewingIdx = -1;
  browserItems = [];

  if (type === 'drum') {
    const keys = ['kick', 'snare', 'ch', 'oh', 'crash'] as const;
    const key: string = keys[idx] ?? 'kick';
    const entry = manifest[key] as { path: string; files: string[] } | undefined;
    if (!entry) {
      loadSampleFallback(type, idx);
      return;
    }
    const items: BrowserItem[] = [];
    for (const f of entry.files) {
      items.push({
        name: prettyDrumName(f),
        displayName: prettyDrumName(f),
        url: entry.path + '/' + encodeURIComponent(f),
        group: '',
      });
    }
    // Group by prefix (machine name)
    const groups: Record<string, BrowserItem[]> = {};
    for (const item of items) {
      const parts = item.name.split(' ');
      const g = parts.length >= 3 ? parts.slice(0, 2).join(' ') : (parts[0] ?? '');
      if (!groups[g]) groups[g] = [];
      groups[g].push(item);
    }
    browserItems = [];
    for (const g of Object.keys(groups).sort()) {
      const groupItems = groups[g];
      if (!groupItems) continue;
      for (const item of groupItems) {
        item.group = g;
        browserItems.push(item);
      }
    }
  } else {
    // melody or vocal — use synths
    const synths = manifest.synths as SynthsManifest | undefined;
    if (!synths) {
      loadSampleFallback(type, idx);
      return;
    }
    for (const group of Object.keys(synths.groups).sort()) {
      const files = synths.groups[group];
      if (!files) continue;
      for (const f of files) {
        browserItems.push({
          name: prettySynthName(f),
          displayName: prettySynthName(f),
          url: synths.basePath + '/' + encodeURIComponent(group) + '/' + encodeURIComponent(f),
          group,
        });
      }
    }
  }

  const titleEl = document.getElementById('browser-title');
  if (titleEl) {
    titleEl.textContent =
      type === 'drum'
        ? (drumNames[idx] ?? 'Drum') + ' \u2014 Select Sample'
        : type === 'melody'
          ? (melNames[idx] ?? 'Synth') + ' \u2014 Select Sample'
          : 'Vocal \u2014 Select Sample';
  }
  const searchEl = document.getElementById('browser-search') as HTMLInputElement | null;
  if (searchEl) searchEl.value = '';
  renderBrowserList('');
  const overlay = document.getElementById('browser-overlay');
  if (overlay) overlay.classList.add('open');
  setTimeout(() => {
    const s = document.getElementById('browser-search') as HTMLInputElement | null;
    s?.focus();
  }, 50);
}

export function closeBrowser(): void {
  const overlay = document.getElementById('browser-overlay');
  if (overlay) overlay.classList.remove('open');
  previewingIdx = -1;
  // Stop any playing preview
  if (prevPreviewSource) {
    try {
      prevPreviewSource.stop();
    } catch {
      /* already stopped */
    }
    prevPreviewSource = null;
  }
}

// ═══════════════════════════════════════════
//  Browser list rendering
// ═══════════════════════════════════════════

export function renderBrowserList(filter: string): void {
  const list = document.getElementById('browser-list');
  if (!list) return;
  list.innerHTML = '';
  const lf = filter.toLowerCase();
  let lastGroup = '';
  let count = 0;

  browserItems.forEach((item, i) => {
    if (lf && !item.name.toLowerCase().includes(lf) && !item.group.toLowerCase().includes(lf))
      return;
    // Group header
    if (item.group !== lastGroup) {
      lastGroup = item.group;
      const gl = el('div', 'browser-group-label');
      gl.textContent = item.group.toUpperCase();
      list.appendChild(gl);
    }
    const row = el('div', 'browser-item');
    if (browserSelected === i) row.classList.add('selected');
    row.dataset.index = String(i);

    const prev = el('button', 'browser-item-preview');
    prev.innerHTML = '&#9654;';
    prev.title = 'Preview';
    if (previewingIdx === i) prev.classList.add('previewing');
    prev.onclick = (e: MouseEvent) => {
      e.stopPropagation();
      void previewSample(i);
    };
    prev.ondblclick = (e: MouseEvent) => {
      e.stopPropagation();
      void previewSample(i);
    };

    const nameSpan = el('div', 'browser-item-name');
    nameSpan.textContent = item.name;

    row.appendChild(prev);
    row.appendChild(nameSpan);
    row.onclick = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.browser-item-preview')) selectBrowserItem(i);
    };
    row.ondblclick = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.browser-item-preview')) {
        selectBrowserItem(i);
        void confirmBrowserLoad();
      }
    };
    list.appendChild(row);
    count++;
  });

  const countEl = document.getElementById('browser-count');
  if (countEl) countEl.textContent = `${count} sample${count !== 1 ? 's' : ''}`;
  const loadBtn = document.getElementById('browser-load') as HTMLButtonElement | null;
  if (loadBtn) loadBtn.disabled = browserSelected === null;
}

// ═══════════════════════════════════════════
//  Selection
// ═══════════════════════════════════════════

function selectBrowserItem(i: number): void {
  browserSelected = i;
  document.querySelectorAll('.browser-item').forEach((r) => {
    const row = r as HTMLElement;
    row.classList.toggle('selected', Number(row.dataset.index) === i);
  });
  const loadBtn = document.getElementById('browser-load') as HTMLButtonElement | null;
  if (loadBtn) loadBtn.disabled = false;
}

// ═══════════════════════════════════════════
//  Track content detection
// ═══════════════════════════════════════════

function trackHasContent(type: TrackType | '', idx: number): boolean {
  if (type === 'drum') {
    const row = drumPat[idx];
    return row ? row.some((v) => v) : false;
  }
  if (type === 'melody') {
    const track = melPat[idx];
    return track ? track.some((s) => s.some((n) => n)) : false;
  }
  return vocalPat.some((v) => v);
}

// ═══════════════════════════════════════════
//  Buffer restore (for sequence-mode preview cancel)
// ═══════════════════════════════════════════

function restoreOriginalBuffer(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  if (browserType === 'drum') {
    const sd = drumSampleData[browserIdx];
    if (sd?.data) {
      void ctx
        .decodeAudioData(sd.data.slice(0))
        .then((b) => {
          drumBuf[browserIdx] = b;
        })
        .catch(() => {
          /* noop */
        });
    } else {
      drumBuf[browserIdx] = null;
    }
  } else if (browserType === 'melody') {
    const sd = melSampleData[browserIdx];
    if (sd?.data) {
      void ctx
        .decodeAudioData(sd.data.slice(0))
        .then((b) => {
          melBuf[browserIdx] = b;
        })
        .catch(() => {
          /* noop */
        });
    } else {
      melBuf[browserIdx] = null;
    }
  } else {
    if (vocalSampleData?.data) {
      void ctx
        .decodeAudioData(vocalSampleData.data.slice(0))
        .then((b) => {
          setVocalBuf(b);
        })
        .catch(() => {
          /* noop */
        });
    } else {
      setVocalBuf(null);
    }
  }
}

// ═══════════════════════════════════════════
//  Preview
// ═══════════════════════════════════════════

export async function previewSample(i: number): Promise<void> {
  const item = browserItems[i];
  if (!item) return;

  const hasContent = trackHasContent(browserType, browserIdx);
  const isSequenceMode = playing && hasContent;

  // In sequence mode, clicking same item toggles the swap off
  if (isSequenceMode && previewingIdx === i) {
    previewingIdx = -1;
    restoreOriginalBuffer();
    document
      .querySelectorAll('.browser-item-preview')
      .forEach((b) => b.classList.remove('previewing'));
    return;
  }

  previewingIdx = i;
  document
    .querySelectorAll('.browser-item-preview')
    .forEach((b) => b.classList.remove('previewing'));
  const btn = document.querySelector(`.browser-item[data-index="${i}"] .browser-item-preview`);
  if (btn) btn.classList.add('previewing');

  try {
    let buffer: AudioBuffer;
    if (browserPreviewBuf && browserPreviewBufIdx === i) {
      buffer = browserPreviewBuf;
    } else {
      const result = await fetchAndDecode(item.url);
      buffer = result.buffer;
      browserPreviewBufIdx = i;
      browserPreviewBuf = buffer;
    }

    if (isSequenceMode) {
      // Swap buffer so the playing sequence uses this sound
      if (browserType === 'drum') drumBuf[browserIdx] = buffer;
      else if (browserType === 'melody') melBuf[browserIdx] = buffer;
      else setVocalBuf(buffer);
    } else {
      // Simple playback: always play on click (repeatable), soft cutoff previous
      prevPreviewSource = playPreviewSample(
        buffer,
        browserType === 'melody' ? 1 : undefined,
        prevPreviewSource,
      );
    }
  } catch (e) {
    console.error('Preview failed:', e);
  }

  selectBrowserItem(i);
}

// ═══════════════════════════════════════════
//  Confirm load
// ═══════════════════════════════════════════

export async function confirmBrowserLoad(): Promise<void> {
  if (browserSelected === null) return;
  const item = browserItems[browserSelected];
  if (!item) return;
  try {
    const { buffer, data } = await fetchAndDecode(item.url);
    const fname = item.name + '.wav';
    if (browserType === 'drum') {
      drumBuf[browserIdx] = buffer;
      drumSampleData[browserIdx] = { name: fname, data };
    } else if (browserType === 'melody') {
      melBuf[browserIdx] = buffer;
      melSampleData[browserIdx] = { name: fname, data };
    } else {
      setVocalBuf(buffer);
      setVocalSampleData({ name: fname, data });
    }
    updateSampleBtn(browserType, browserIdx, fname);
    scheduleSave();
    closeBrowser();
  } catch (e) {
    console.error('Load failed:', e);
  }
}

// ═══════════════════════════════════════════
//  Wire browser DOM events (called from buildUI)
// ═══════════════════════════════════════════

export function wireBrowserEvents(): void {
  const closeBtn = document.getElementById('browser-close');
  if (closeBtn) closeBtn.onclick = closeBrowser;

  const overlay = document.getElementById('browser-overlay');
  if (overlay) {
    overlay.addEventListener('click', (e: MouseEvent) => {
      if (e.target === e.currentTarget) closeBrowser();
    });
  }

  const searchEl = document.getElementById('browser-search') as HTMLInputElement | null;
  if (searchEl) {
    searchEl.oninput = () => renderBrowserList(searchEl.value);
  }

  const loadBtn = document.getElementById('browser-load');
  if (loadBtn)
    loadBtn.onclick = () => {
      void confirmBrowserLoad();
    };
}
