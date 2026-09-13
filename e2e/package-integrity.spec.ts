import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function ready(page: Page) {
  await page.goto('/');
  await page.waitForSelector('html[data-ready="true"]');
}
async function fixture(page: Page) {
  return page.evaluate(async () => {
    const p = await import('/src/transport/persistence.ts');
    const s = await import('/src/transport/song.ts');
    const a = await import('/src/engine/audio.ts');
    const patterns = await import('/src/transport/patterns.ts');
    const wav = await import('/src/transport/wav.ts');
    const ctx = a.getAudioContext()!;
    const b = ctx.createBuffer(1, ctx.sampleRate / 4, ctx.sampleRate);
    b.getChannelData(0).forEach((_, i, data) => { data[i] = 0.1 * Math.sin(2 * Math.PI * 440 * i / ctx.sampleRate); });
    s.drumBuf[0] = b;
    s.drumSampleData[0] = { name: 'portable-tone.wav', data: wav.audioBufferToWav24(b).buffer };
    s.setCurrentSongName('Local original');
    patterns.phrases[0]!.drumPat[0]!.fill(true);
    await p.saveSong();
    return s.currentSongId!;
  });
}
async function importFile(page: Page, value: string) {
  const chooser = page.waitForEvent('filechooser');
  await page.evaluate(async () => (await import('/src/transport/persistence.ts')).loadPatternFile());
  await (await chooser).setFiles({ name: 'song.json', mimeType: 'application/json', buffer: Buffer.from(value) });
}

test('portable JSON retains sample bytes and decoded audio after file import and reload', async ({ page }) => {
  await ready(page);
  await fixture(page);
  const download = page.waitForEvent('download');
  await page.evaluate(async () => (await import('/src/transport/persistence.ts')).savePatternFile());
  const path = await (await download).path();
  const json = await readFile(path!, 'utf8');
  expect(JSON.parse(json).drumSampleData[0].encoding).toBe('base64');
  await page.evaluate(async () => (await import('/src/transport/persistence.ts')).newSong());
  await importFile(page, json);
  await expect(page.locator('#song-name')).toHaveText('Local original');
  await page.evaluate(async () => (await import('/src/transport/persistence.ts')).saveSong());
  await page.reload();
  await page.waitForSelector('html[data-ready="true"]');
  const audio = await page.evaluate(async () => {
    const s = await import('/src/transport/song.ts');
    const data = s.drumBuf[0]!.getChannelData(0);
    return { bytes: s.drumSampleData[0]!.data.byteLength, rms: Math.sqrt(data.reduce((n, v) => n + v*v, 0) / data.length), name: s.drumNames[0] };
  });
  expect(audio.bytes).toBeGreaterThan(30000);
  expect(audio.rms).toBeCloseTo(Math.sqrt(0.005), 5);
  // Real playback must consume the restored sample, not merely retain an encoded blob.
  await page.evaluate(async () => {
    const audio = await import('/src/engine/audio.ts');
    const ctx = audio.getAudioContext()!;
    const analyser = ctx.createAnalyser(); analyser.fftSize = 2048;
    audio.getMasterGain()!.connect(analyser);
    (window as any).integrityAnalyser = analyser;
  });
  await page.locator('#play-btn').click();
  await expect.poll(() => page.evaluate(() => {
    const analyser = (window as any).integrityAnalyser as AnalyserNode;
    const data = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(data);
    return Math.max(...data.map(Math.abs));
  })).toBeGreaterThan(0.01);
  await page.locator('#play-btn').click();
});

for (const [label, invalid] of [
  ['negative BPM', { bpm: -4, phrases: [] }], ['phrase index', { currentPhrase: 99, phrases: [] }],
  ['object name', { name: {}, phrases: [] }], ['wrong pattern type', { phrases: [{ drumPat: true }] }],
  ['unsafe effect', { phrases: [], extensions: { delay: { feedback: 8 } } }],
  ['invalid sample', { phrases: [], drumSampleData: [{ name: 'broken', data: {} }] }],
  ['corrupt encoded audio', { phrases: [], drumSampleData: [{ name: 'broken', data: 'YWJj', encoding: 'base64' }] }],
  ['unknown version', { formatVersion: 9, phrases: [] }], ['not a song', { name: 'metadata only' }],
  ['malformed JSON', '{'],
] as const) {
  test(`failed import preserves live and saved song: ${label}`, async ({ page }) => {
    await ready(page);
    const id = await fixture(page);
    const before = await page.evaluate(async () => JSON.stringify((await import('/src/transport/persistence.ts')).collectSongData('Local original'), (k, v) => k === 'updatedAt' ? undefined : v));
    await importFile(page, typeof invalid === 'string' ? invalid : JSON.stringify(invalid));
    await expect(page.locator('#persistence-status')).toBeVisible();
    const after = await page.evaluate(async () => JSON.stringify((await import('/src/transport/persistence.ts')).collectSongData('Local original'), (k, v) => k === 'updatedAt' ? undefined : v));
    expect(after).toBe(before);
    await page.reload(); await page.waitForSelector('html[data-ready="true"]');
    expect(await page.evaluate(async () => (await import('/src/transport/song.ts')).currentSongId)).toBe(id);
    await expect(page.locator('#song-name')).toHaveText('Local original');
  });
}

test('transaction abort after request success rejects and autosave visibly reports failure', async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const p = await import('/src/transport/persistence.ts');
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(...args: Parameters<IDBObjectStore['put']>) {
      const req = original.apply(this, args);
      req.addEventListener('success', () => this.transaction.abort());
      return req;
    };
    let rejected = false;
    try { await p.dbPut('meta', 'never persisted', 'aborted'); } catch { rejected = true; }
    const exists = await p.dbGet('meta', 'aborted');
    (await import('/src/transport/song.ts')).setBpm(133);
    p.scheduleSave();
    return { rejected, exists };
  });
  expect(result).toEqual({ rejected: true, exists: undefined });
  await expect(page.locator('#persistence-status')).toContainText('aborted');
  await expect(page.getByRole('button', { name: 'Export local copy' })).toBeVisible();
});

test('overlapping sample decodes commit only the latest complete song', async ({ page }) => {
  await ready(page); await fixture(page);
  const result = await page.evaluate(async () => {
    const p = await import('/src/transport/persistence.ts');
    const a = await import('/src/engine/audio.ts');
    const s = await import('/src/transport/song.ts');
    const song = p.collectSongData('slow');
    const ctx = a.getAudioContext()!;
    const decode = ctx.decodeAudioData.bind(ctx);
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    let count = 0;
    ctx.decodeAudioData = async (data: ArrayBuffer) => { if (++count === 1) await blocked; return decode(data); };
    const old = p.loadSong({ ...song, id: 'old', bpm: 70 });
    const latest = await p.loadSong({ ...song, id: 'new', name: 'latest', bpm: 180 });
    release();
    const appliedOld = await old;
    ctx.decodeAudioData = decode;
    return { latest, appliedOld, id: s.currentSongId, name: s.currentSongName, bpm: s.bpm, decoded: !!s.drumBuf[0] };
  });
  expect(result).toEqual({ latest: true, appliedOld: false, id: 'new', name: 'latest', bpm: 180, decoded: true });
});

test('two tabs reject stale edits and preserve both versions through Save as new song', async ({ context, page }) => {
  await ready(page); const id = await fixture(page);
  const other = await context.newPage(); await ready(other);
  await page.evaluate(async () => {
    (await import('/src/transport/song.ts')).setCurrentSongName('Saved in tab A');
    await (await import('/src/transport/persistence.ts')).saveSong();
  });
  await other.evaluate(async () => {
    (await import('/src/transport/song.ts')).setBpm(190);
    (await import('/src/transport/persistence.ts')).scheduleSave();
  });
  await expect(other.locator('#persistence-status')).toContainText('another tab');
  const saved = await page.evaluate(async id => (await import('/src/transport/persistence.ts')).dbGet<any>('songs', id), id);
  expect(saved.name).toBe('Saved in tab A'); expect(saved.bpm).toBe(120);
  await other.getByRole('button', { name: 'Save as new song' }).click();
  await expect(other.locator('#persistence-status')).toBeHidden();
  const songs = await other.evaluate(async () => (await import('/src/transport/persistence.ts')).dbGetAll<any>('songs'));
  expect(songs).toHaveLength(2);
  expect(songs.find(s => s.id !== id).bpm).toBe(190);
  expect(songs.find(s => s.id !== id).name).toBe('Local original (copy)');
});

test('pending same-tab saves and new-song action preserve the last edit without a false conflict', async ({ page }) => {
  await ready(page);
  expect(await page.evaluate(async () => {
    const p = await import('/src/transport/persistence.ts');
    const s = await import('/src/transport/song.ts');
    const id = s.currentSongId!;
    s.setBpm(133); const a = p.saveSong();
    s.setBpm(144); const b = p.saveSong();
    const next = p.newSong(); await Promise.all([a, b, next]);
    return { old: (await p.dbGet<any>('songs', id)).bpm, current: s.bpm, count: (await p.dbGetAll('songs')).length };
  })).toEqual({ old: 144, current: 120, count: 2 });
});

test('deleting the only song cannot resurrect it locally or from a stale tab', async ({ context, page }) => {
  await ready(page); const id = await fixture(page);
  const other = await context.newPage(); await ready(other);
  await page.evaluate(async () => (await import('/src/transport/persistence.ts')).deleteSong());
  expect(await page.evaluate(async id => (await import('/src/transport/persistence.ts')).dbGet('songs', id), id)).toBeUndefined();
  await other.evaluate(async () => {
    (await import('/src/transport/song.ts')).setBpm(180);
    (await import('/src/transport/persistence.ts')).scheduleSave();
  });
  await expect(other.locator('#persistence-status')).toContainText('deleted');
  await page.reload(); await page.waitForSelector('html[data-ready="true"]');
  expect(await page.evaluate(async () => (await import('/src/transport/persistence.ts')).dbGetAll('songs'))).toHaveLength(1);
});

test('ADSR, master gain and permanent engine sound survive reload and reset on New Song', async ({ page }) => {
  await ready(page);
  const state = await page.evaluate(async () => {
    const a = await import('/src/engine/adsr.ts');
    a.setAdsrEnabled(5, true); a.setTrackAdsr(5, { attack: 0.32, decay: 0.42, sustain: 0.25, release: 0.75 });
    (await import('/src/engine/audio.ts')).getMasterGain()!.gain.value = 0.23;
    (await import('/src/engine/master-controls.ts')).setEngineSettings({ cutoff: 0, resonance: 0.2, saturation: 0.3, compression: 0.4 });
    const p = await import('/src/transport/persistence.ts'); await p.saveSong();
    return p.collectSongData('x').sound;
  });
  await page.reload(); await page.waitForSelector('html[data-ready="true"]');
  expect(await page.evaluate(async () => (await import('/src/transport/persistence.ts')).collectSongData('x').sound)).toEqual(state);
  await page.evaluate(async () => (await import('/src/transport/persistence.ts')).newSong());
  const reset = await page.evaluate(async () => (await import('/src/transport/persistence.ts')).collectSongData('x').sound);
  expect(reset!.masterGain).toBeCloseTo(0.8);
  expect(reset!.engine).toEqual({ cutoff: 1, resonance: 0, saturation: 0, compression: 0 });
  expect(reset!.adsr.every(a => !a.enabled && a.attack === 0.005)).toBe(true);
});

test('Space respects modal buttons and contenteditable without starting transport', async ({ page }) => {
  await ready(page);
  await page.locator('.sample-btn').first().click();
  await page.locator('#browser-close').focus(); await page.keyboard.press('Space');
  await expect(page.locator('#browser-overlay')).not.toHaveClass(/open/);
  await expect(page.locator('#play-btn')).not.toHaveClass(/active/);
  await page.evaluate(() => { const e = document.createElement('div'); e.contentEditable = 'true'; e.id = 'editable-test'; document.body.append(e); e.focus(); });
  await page.keyboard.press('Space');
  expect(await page.evaluate(async () => (await import('/src/engine/scheduler.ts')).isPlaying())).toBeFalsy();
});

for (const fault of ['storage', 'worklet']) {
  test(`startup ${fault} failure has a successful fresh-document retry`, async ({ page }) => {
    if (fault === 'storage') {
      await page.addInitScript(() => {
        if (!sessionStorage.getItem('storage-failed-once')) {
          sessionStorage.setItem('storage-failed-once', 'true');
          indexedDB.open = () => { throw new DOMException('Storage denied', 'SecurityError'); };
        }
      });
    } else await page.addInitScript(() => {
      if (!sessionStorage.getItem('worklet-failed-once')) {
        sessionStorage.setItem('worklet-failed-once', 'true');
        AudioWorklet.prototype.addModule = async () => { throw new DOMException('Worklet download failed', 'AbortError'); };
      }
    });
    await page.goto('/');
    await expect(page.locator('#startup-error')).toContainText('could not start');
    await expect(page.locator('#play-btn')).toBeDisabled();
    await page.getByRole('button', { name: 'Retry startup' }).click();
    await page.waitForSelector('html[data-ready="true"]');
    await page.locator('#play-btn').click(); await expect.poll(() => page.evaluate(async () => (await import('/src/engine/scheduler.ts')).isPlaying())).toBe(true);
  });
}

test('mobile melody toolbar keeps every control reachable without clipping', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await ready(page);
  const overflow = await page.locator('.melody-track-header').evaluateAll(headers => headers.flatMap(header => [...header.children].filter(el => {
    const r = el.getBoundingClientRect(), h = header.getBoundingClientRect();
    return r.right > h.right + 1 || r.left < h.left - 1;
  }).map(el => el.textContent)));
  expect(overflow).toEqual([]);
});

for (const [track, release] of [[0, false], [1, false], [1, true]] as const) {
  test(`MIDI same-pitch retriggers retain ownership on track ${track}, release ${release}`, async ({ page }) => {
    await page.addInitScript(() => {
      const input = new EventTarget();
      Object.assign(input, { id: 'qc-midi', name: 'QC MIDI', state: 'connected' });
      const access = { inputs: new Map([['qc-midi', input]]), onstatechange: null };
      Object.defineProperty(navigator, 'requestMIDIAccess', { value: async () => access });
      (window as any).qcMidi = { input, access, voices: new Set() };
      const start = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function(...args) {
        (window as any).qcMidi.voices.add(this);
        this.addEventListener('ended', () => (window as any).qcMidi.voices.delete(this));
        return start.apply(this, args);
      };
    });
    await ready(page);
    await page.locator('#play-btn').click(); await page.locator('#stop-btn').click();
    await page.waitForFunction(async () => (await import('/src/engine/audio.ts')).getAudioContext()!.currentTime > 0.35, null, { polling: 50 });
    const result = await page.evaluate(async ({ track, release }) => {
      const audio = await import('/src/engine/audio.ts');
      const midi = await import('/src/engine/midi.ts');
      const song = await import('/src/transport/song.ts');
      const adsr = await import('/src/engine/adsr.ts');
      const ctx = audio.getAudioContext()!;
      const startedAt = ctx.currentTime;
      const sample = ctx.createBuffer(1, ctx.sampleRate * 10, ctx.sampleRate);
      sample.getChannelData(0).fill(0.01); song.melBuf[track] = sample;
      adsr.setAdsrEnabled(5 + track, release); adsr.setTrackAdsr(5 + track, { release: 3 });
      midi.connectMidiToTrack('qc-midi', track);
      const q = (window as any).qcMidi;
      const note = (status: number, pitch = 24) => { const event = new Event('midimessage'); (event as any).data = new Uint8Array([status, pitch, status === 0x90 ? 100 : 0]); q.input.dispatchEvent(event); };
      const sleep = async (ms: number) => {
        const target = ctx.currentTime + ms / 1000;
        const deadline = performance.now() + 5000;
        while (ctx.currentTime < target) {
          if (performance.now() > deadline) throw new Error('Audio clock stopped advancing');
          await new Promise(resolve => setTimeout(resolve, 20));
        }
      };
      note(0x90); await sleep(30); note(0x90); await sleep(150);
      note(0x80); await sleep(150);
      const afterOff = q.voices.size;
      // Release tails also remain owned and must stop on physical device removal.
      for (let i = 0; i < 24; i++) note(0x90, 24 + i);
      await sleep(150); const bounded = q.voices.size;
      q.input.state = 'disconnected'; q.access.onstatechange(); await sleep(150);
      return { afterOff, bounded, afterDisconnect: q.voices.size, clock: ctx.currentTime - startedAt };
    }, { track, release });
    expect(result.clock).toBeGreaterThan(0.4);
    expect(result.afterOff).toBe(release ? 1 : 0);
    expect(result.bounded).toBeLessThanOrEqual(8);
    expect(result.afterDisconnect).toBe(0);
  });
}

test('an older file read cannot overwrite a newer UI import', async ({ page }) => {
  await ready(page); await fixture(page);
  await page.evaluate(() => {
    const text = File.prototype.text;
    let calls = 0;
    File.prototype.text = async function() {
      const contents = await text.call(this);
      if (++calls === 1) await new Promise<void>(resolve => { (window as any).releaseOldFile = resolve; });
      return contents;
    };
  });
  await importFile(page, JSON.stringify({ name: 'old file', bpm: 77, phrases: [] }));
  await page.waitForFunction(() => !!(window as any).releaseOldFile);
  await importFile(page, JSON.stringify({ name: 'new file', bpm: 188, phrases: [] }));
  await expect(page.locator('#song-name')).toHaveText('new file');
  await page.evaluate(() => (window as any).releaseOldFile());
  await page.evaluate(async () => (await import('/src/transport/persistence.ts')).saveSong());
  await page.reload(); await page.waitForSelector('html[data-ready="true"]');
  await expect(page.locator('#song-name')).toHaveText('new file');
  expect(await page.evaluate(async () => (await import('/src/transport/song.ts')).bpm)).toBe(188);
});

test('restored ADSR and master controls produce the same audible envelope', async ({ page }) => {
  await ready(page);
  await page.evaluate(async () => {
    const adsr = await import('/src/engine/adsr.ts');
    adsr.setAdsrEnabled(0, true); adsr.setTrackAdsr(0, { attack: 0.2, decay: 0.1, sustain: 0.3, release: 0.05 });
    (await import('/src/engine/audio.ts')).getMasterGain()!.gain.value = 0.23;
    await (await import('/src/transport/persistence.ts')).saveSong();
  });
  const render = () => page.evaluate(async () => {
    const adsr = await import('/src/engine/adsr.ts');
    const ctx = new OfflineAudioContext(1, 44100, 44100);
    const buffer = ctx.createBuffer(1, 44100, 44100); buffer.getChannelData(0).fill(0.1);
    const source = ctx.createBufferSource(); source.buffer = buffer;
    const gain = ctx.createGain(); gain.gain.value = (await import('/src/engine/audio.ts')).getMasterGain()!.gain.value;
    gain.connect(ctx.destination);
    if (adsr.isAdsrEnabled(0)) adsr.applyEnvelope(ctx, source, gain, 0, 0, 0.5);
    else source.connect(gain);
    source.start();
    const data = (await ctx.startRendering()).getChannelData(0);
    return { early: data[441]!, peak: Math.max(...data), tail: data[40000]!, hash: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data.buffer))) };
  });
  const before = await render();
  expect(before.peak).toBeGreaterThan(0.02);
  expect(before.early).toBeLessThan(0.002); expect(before.tail).toBeLessThan(0.00001);
  await page.reload(); await page.waitForSelector('html[data-ready="true"]');
  expect(await render()).toEqual(before);
});
