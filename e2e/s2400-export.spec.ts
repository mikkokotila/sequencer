import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { readZip, records, field, blob, blocks, events } from './s2400-files';

async function fixture(page: Page) {
  await page.goto('/');
  await page.waitForSelector('html[data-ready="true"]');
  await page.evaluate(async () => {
    const song = await import('/src/transport/song.ts');
    const p = await import('/src/transport/patterns.ts');
    const audio = await import('/src/engine/audio.ts');
    p.phrases.forEach(phrase => {
      phrase.drumPat.forEach(row => row.fill(false));
      phrase.melPat.forEach(track => track.forEach(row => row.fill(false)));
      phrase.vocalPat.fill(false);
    });
    song.drumBuf.fill(null); song.mutedArr.fill(false);
    song.setBpm(123.4); song.setCurrentSongName('../Fête: test');
    song.setDrumNames(['../duplicate', 'x', 'y', 'z', '../duplicate']);
    const mono = new AudioBuffer({ length: 6864, numberOfChannels: 1, sampleRate: 48000 });
    mono.getChannelData(0).fill(0.25);
    const stereo = new AudioBuffer({ length: 4410, numberOfChannels: 2, sampleRate: 44100 });
    stereo.getChannelData(0).fill(0.5); stereo.getChannelData(1).fill(-0.25);
    song.drumBuf[0] = mono; song.drumBuf[4] = stereo;
    song.setMuted(4, true);
    audio.getChannelFaders()[0]!.gain.value = 0.5;
    audio.getChannelFaders()[4]!.gain.value = 0.25;
    p.phrases[0]!.drumPat[0]![0] = true;
    p.phrases[0]!.drumPat[0]![4] = true;
    p.phrases[0]!.drumPat[4]![63] = true;
    p.phrases[7]!.drumPat[4]![2] = true;
    p.phrases[11]!.melPat[0]![0]![0] = true;
    p.phrases[11]!.vocalPat[0] = true;
    p.switchToPhrase(7);
  });
}
async function exportFiles(page: Page) {
  const output = await page.evaluate(async () => {
    const api = await import('/src/transport/s2400.ts');
    const result = await api.exportS2400Drums();
    return { bytes: Array.from(new Uint8Array(await result.blob.arrayBuffer())),
      filename: result.filename, patterns: result.patternCount, tracks: result.trackCount, warnings: result.warnings };
  });
  return { ...output, files: readZip(Buffer.from(output.bytes)) };
}

test('S2400 project preserves phrase order, final steps, pad gaps, mutes, levels and stereo PCM', async ({ page }) => {
  await fixture(page);
  const result = await exportFiles(page);
  expect(result.patterns).toBe(2); expect(result.tracks).toBe(2);
  expect(result.filename).toBe('Fete-test-S2400.zip');
  const manifest = JSON.parse(result.files.get('export.json')!.toString());
  expect(manifest.hardwareVerified).toBe(false);
  expect(manifest.patterns).toEqual([
    { number: 1, sourcePhrase: 1, bars: 4, hits: 3 }, { number: 2, sourcePhrase: 8, bars: 4, hits: 1 },
  ]);
  const prefix = `PROJECTS/${manifest.project}/`;
  const kit = records(result.files.get(`${prefix}${manifest.project}.KIT`)!);
  expect(field(kit, 0)).toBe(0x20002); expect(field(kit, 1)).toBe(2);
  const tracks = blocks(kit, 2);
  expect(tracks.map(t => field(t, 2))).toEqual([0, 4]);
  for (const [i, t] of tracks.entries()) {
    const name = blob(t, 10).toString('ascii').split('\0')[0];
    const wav = result.files.get(`${prefix}${name}.wav`)!;
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.readUInt32LE(4) + 8).toBe(wav.length);
    expect(wav.readUInt16LE(20)).toBe(1); expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.readUInt32LE(24)).toBe(48000);
    expect(wav.readUInt16LE(22)).toBe(i === 0 ? 1 : 2);
    const slices = blocks(t, 11);
    expect(slices).toHaveLength(9);
    const main = slices[8]!;
    expect(field(main, 12)).toBe(i === 0 ? 128 : 64);
    expect(field(main, 18)).toBe(i === 0 ? 6863 : 4799);
    expect(field(t, 8)).toBe(i === 0 ? 1 : 3);
    expect(field(t, 5)).toBe(i === 0 ? 0 : 1);
    if (i === 0) expect(wav.readInt16LE(244)).toBe(8192);
    else { expect(wav.readInt16LE(444)).toBeCloseTo(16384, -1); expect(wav.readInt16LE(446)).toBeCloseTo(-8192, -1); }
  }
  const project = records(result.files.get(`${prefix}${manifest.project}.S24`)!);
  expect(field(project, 0)).toBe(0x30003); expect(field(project, 4)).toBe(1234);
  expect(field(project, 33)).toBe(0xfffffffe);
  const patterns = blocks(project, 16);
  expect(patterns).toHaveLength(2);
  patterns.forEach(pattern => { expect(field(pattern, 17)).toBe(1536); expect(field(pattern, 18)).toBe(384); });
  expect(blob(patterns[0]!, 22).toString('ascii').split('\0')[0]).toBe('Phrase 01');
  expect(blob(patterns[1]!, 22).toString('ascii').split('\0')[0]).toBe('Phrase 08');
  expect(events(patterns[0]!)).toEqual([
    { tick: 0, track: 0, parameters: [0x001acf08] },
    { tick: 96, track: 0, parameters: [] },
    { tick: 1512, track: 4, parameters: [(4799 << 8) | 8] },
  ]);
  expect(events(patterns[1]!)).toEqual([{ tick: 48, track: 4, parameters: [(4799 << 8) | 8] }]);
  // First trigger + end parameter exactly match the hardware-saved Project002 fixture.
  expect(blob(patterns[0]!, 23).subarray(0, 8).toString('hex')).toBe('010c000008cf1a00');
  expect(result.files.size).toBe(6);
});

test('snapshot is isolated from callbacks, live playback, buffer mutation and phrase edits', async ({ page }) => {
  await fixture(page);
  await page.locator('#play-btn').click();
  await expect.poll(() => page.evaluate(async () => (await import('/src/engine/scheduler.ts')).isPlaying())).toBe(true);
  const result = await page.evaluate(async () => {
    const api = await import('/src/transport/s2400.ts');
    const song = await import('/src/transport/song.ts');
    const p = await import('/src/transport/patterns.ts');
    let changed = false;
    const result = await api.exportS2400Drums({ onProgress: () => {
      if (changed) return; changed = true;
      song.setBpm(40); song.setCurrentSongName('Changed');
      song.drumBuf[0]!.getChannelData(0).fill(0);
      p.phrases[0]!.drumPat[0]!.fill(false);
    } });
    return { filename: result.filename, bytes: Array.from(new Uint8Array(await result.blob.arrayBuffer())), phrase: p.currentPhrase };
  });
  expect(result.filename).toBe('Fete-test-S2400.zip'); expect(result.phrase).toBe(7);
  const files = readZip(Buffer.from(result.bytes));
  const wav = [...files].find(([name]) => name.endsWith('A1_duplicate.wav'))![1];
  expect(wav.readInt16LE(244)).toBe(8192);
  const project = records([...files].find(([name]) => name.endsWith('.S24'))![1]);
  expect(field(project, 4)).toBe(1234); expect(events(blocks(project, 16)[0]!)).toHaveLength(3);
  await expect.poll(() => page.evaluate(async () => (await import('/src/engine/scheduler.ts')).isPlaying())).toBe(true);
  await page.locator('#stop-btn').click();
});

for (const stage of ['samples', 'packaging'] as const) {
  test(`cancel during ${stage} rejects and the next export succeeds`, async ({ page }) => {
    await fixture(page);
    const result = await page.evaluate(async (stage) => {
      const api = await import('/src/transport/s2400.ts');
      const controller = new AbortController();
      let error = '';
      try { await api.exportS2400Drums({ signal: controller.signal, onProgress: p => {
        if (p.stage === stage && (stage === 'samples' || p.fraction > 0)) controller.abort();
      } }); } catch (e) { error = (e as Error).name; }
      return { error, size: (await api.exportS2400Drums()).blob.size };
    }, stage);
    expect(result.error).toBe('AbortError'); expect(result.size).toBeGreaterThan(1000);
  });
}

test('missing samples, empty percussion, invalid tempo/audio/level and oversize fail explicitly', async ({ page }) => {
  await fixture(page);
  const errors = await page.evaluate(async () => {
    const api = await import('/src/transport/s2400.ts');
    const song = await import('/src/transport/song.ts');
    const p = await import('/src/transport/patterns.ts');
    const audio = await import('/src/engine/audio.ts');
    const attempt = async () => { try { await api.exportS2400Drums(); return 'unexpected success'; } catch (e) { return (e as Error).message; } };
    const saved = song.drumBuf[0]; const messages = [];
    song.drumBuf[0] = null; messages.push(await attempt()); song.drumBuf[0] = saved;
    song.setBpm(NaN); messages.push(await attempt()); song.setBpm(120);
    audio.getChannelFaders()[0]!.gain.value = 1.5; messages.push(await attempt()); audio.getChannelFaders()[0]!.gain.value = 0.5;
    saved!.getChannelData(0)[100] = NaN; messages.push(await attempt()); saved!.getChannelData(0)[100] = 0;
    song.drumBuf[0] = new AudioBuffer({ length: 48000 * 61, numberOfChannels: 1, sampleRate: 48000 }); messages.push(await attempt());
    p.phrases.forEach(phrase => phrase.drumPat.forEach(row => row.fill(false))); messages.push(await attempt());
    return messages;
  });
  expect(errors[0]).toContain('Load a sample for drum 1'); expect(errors[1]).toContain('tempo');
  expect(errors[2]).toContain('level'); expect(errors[3]).toContain('invalid audio');
  expect(errors[4]).toContain('60 seconds'); expect(errors[5]).toContain('Add drum steps');
});

test('all 12 dense phrases retain all 3840 hits and deterministic bytes', async ({ page }) => {
  await fixture(page);
  await page.evaluate(async () => {
    const song = await import('/src/transport/song.ts'); const p = await import('/src/transport/patterns.ts');
    song.drumBuf.fill(song.drumBuf[0]!); song.mutedArr.fill(false);
    p.phrases.forEach(phrase => phrase.drumPat.forEach(row => row.fill(true)));
  });
  const one = await exportFiles(page), two = await exportFiles(page);
  expect(Buffer.from(one.bytes).equals(Buffer.from(two.bytes))).toBe(true);
  const project = records([...one.files].find(([name]) => name.endsWith('.S24'))![1]);
  const patterns = blocks(project, 16); expect(patterns).toHaveLength(12);
  patterns.forEach(pattern => {
    const hits = events(pattern); expect(hits).toHaveLength(320);
    expect(hits.at(-1)!.tick).toBe(1512); expect(hits.at(-1)!.track).toBe(4);
    expect(hits.map(e => e.tick)).toEqual(hits.map(e => e.tick).sort((a, b) => a - b));
  });
});

test('Chrome GUI downloads an S2400 ZIP and recovers after a missing sample error', async ({ page }) => {
  await fixture(page);
  await page.evaluate(async () => { const song = await import('/src/transport/song.ts'); song.drumBuf[0] = null; });
  await page.locator('#export-song-btn').click();
  await page.locator('#export-s2400-btn').click();
  await expect(page.locator('#song-export-status')).toContainText('Load a sample');
  await page.evaluate(async () => { const song = await import('/src/transport/song.ts'); song.drumBuf[0] = song.drumBuf[4]; });
  const download = page.waitForEvent('download');
  await page.locator('#export-s2400-btn').click();
  const file = await download;
  const files = readZip(await readFile((await file.path())!));
  expect([...files.keys()].filter(name => name.endsWith('.S24'))).toHaveLength(1);
  await expect(page.locator('#song-export-status')).toContainText('downloaded');
  await expect(page.locator('#export-s2400-btn')).toBeEnabled();
  await page.locator('#song-export-close').click();
  await expect(page.locator('#export-song-btn')).toBeFocused();
});

test('sample budget rejects before copying oversized projects', async ({ page }) => {
  await fixture(page);
  const error = await page.evaluate(async () => {
    const song = await import('/src/transport/song.ts'); const p = await import('/src/transport/patterns.ts');
    const api = await import('/src/transport/s2400.ts');
    const sample = new AudioBuffer({ length: 48000 * 60, numberOfChannels: 2, sampleRate: 48000 });
    song.drumBuf.fill(sample); p.phrases[0]!.drumPat.forEach(row => row[0] = true);
    try { await api.exportS2400Drums(); return 'unexpected success'; } catch (e) { return (e as Error).message; }
  });
  expect(error).toContain('32 MiB');
});

test('GUI cancel during resampling produces no download and permits retry', async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => {
    const original = OfflineAudioContext.prototype.startRendering;
    OfflineAudioContext.prototype.startRendering = function () {
      const context = this;
      return new Promise(resolve => setTimeout(() => { void original.call(context).then(resolve); }, 1000));
    };
  });
  let downloads = 0; page.on('download', () => downloads++);
  await page.locator('#export-song-btn').click();
  await page.locator('#export-s2400-btn').click();
  await expect(page.locator('#song-export-close')).toHaveText('Cancel');
  await page.locator('#song-export-close').click();
  await expect(page.locator('#song-export-status')).toHaveText('Export cancelled.');
  expect(downloads).toBe(0);
  const download = page.waitForEvent('download');
  await page.locator('#export-s2400-btn').click(); await download;
  await expect(page.locator('#song-export-status')).toContainText('downloaded');
  expect(downloads).toBe(1);
});
