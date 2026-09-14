import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function ready(page: Page) {
  await page.goto('/');
  await page.waitForSelector('html[data-ready="true"]');
}

test('GUI note length survives export/import and reload, resets on New Song, and rejects invalid lengths', async ({ page }) => {
  await ready(page);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const track of [0, 5, 7, 8]) {
    const button = page.locator('.adsr-btn').nth(track);
    await button.evaluate(el => el.scrollIntoView({ block: 'center' }));
    await button.click();
    const length = page.getByRole('spinbutton', { name: 'Note length in sixteenth-note steps' });
    await length.fill('2');
    await expect(length).toHaveValue('2');
    const box = await length.boundingBox();
    expect(box!.y + box!.height).toBeLessThan(844);
    expect(box!.x + box!.width).toBeLessThan(390);
    await page.locator('#adsr-close').click();
  }
  await page.evaluate(async () => (await import('/src/transport/persistence.ts')).saveSong());
  await page.reload(); await page.waitForSelector('html[data-ready="true"]');
  const getLengths = () => page.evaluate(async () => {
    const a = await import('/src/engine/adsr.ts');
    return Array.from({ length: 9 }, (_, i) => a.getTrackAdsr(i).gateSteps);
  });
  expect(await getLengths()).toEqual([2, 1, 1, 1, 1, 2, 1, 2, 2]);
  const download = page.waitForEvent('download');
  await page.locator('#save-btn').click();
  const file = await download;
  const exported = JSON.parse(await readFile((await file.path())!, 'utf8'));
  expect(exported.sound.adsr[7].gateSteps).toBe(2);
  await page.locator('#song-new').click();
  await expect.poll(getLengths).toEqual(Array(9).fill(1));
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#load-btn').click();
  await (await chooser).setFiles((await file.path())!);
  await expect.poll(getLengths).toEqual([2, 1, 1, 1, 1, 2, 1, 2, 2]);
  const validation = await page.evaluate(async () => {
    const a = await import('/src/engine/adsr.ts');
    const p = await import('/src/transport/persistence.ts');
    const { normalizeSong } = await import('/src/transport/song-format.ts');
    let rejected = 0;
    for (const gateSteps of [0, -1, 65, 1.5, NaN, Infinity]) {
      try { a.setTrackAdsr(7, { gateSteps }); } catch { rejected++; }
      const song = p.collectSongData('invalid');
      song.sound!.adsr[7]!.gateSteps = gateSteps;
      try { normalizeSong(song); } catch { rejected++; }
    }
    const preserved = a.getTrackAdsr(7).gateSteps;
    const legacy = p.collectSongData('legacy');
    legacy.sound!.adsr.forEach(env => { delete env.gateSteps; });
    await p.loadSong(legacy);
    return { rejected, preserved, legacy: a.getTrackAdsr(7).gateSteps };
  });
  expect(validation).toEqual({ rejected: 12, preserved: 2, legacy: 1 });
});

test('doubling tempo and note length preserves actual envelope PCM for every track', async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const a = await import('/src/engine/adsr.ts');
    const settings = [
      { attack: .001, decay: .04, sustain: .6, release: .05 },
      { attack: .002, decay: .12, sustain: .8, release: .05 },
      { attack: .002, decay: .14, sustain: .9, release: .12 },
      { attack: .02, decay: .3, sustain: .65, release: .55 },
    ];
    const render = async (track: number, bpm: number, gateSteps: number) => {
      const ctx = new OfflineAudioContext(1, 44100 * 3, 44100);
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 44100 * 3, 44100);
      const data = src.buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = .2 * Math.sin(i * 2 * Math.PI * 137 / 44100);
      a.setTrackAdsr(track, { ...settings[track % 4], gateSteps });
      const { stopAt } = a.applyEnvelope(ctx, src, ctx.destination, track, .1, 60 / bpm / 4);
      src.start(.1); src.stop(stopAt);
      return { data: (await ctx.startRendering()).getChannelData(0), stopAt };
    };
    const results = [];
    for (let track = 0; track < 9; track++) {
      const old = await render(track, 65, 1);
      const converted = await render(track, 130, 2);
      const wrong = await render(track, 130, 1);
      let maxDelta = 0, wrongDelta = 0;
      for (let i = 0; i < old.data.length; i++) {
        maxDelta = Math.max(maxDelta, Math.abs(old.data[i]! - converted.data[i]!));
        wrongDelta = Math.max(wrongDelta, Math.abs(old.data[i]! - wrong.data[i]!));
      }
      results.push({ maxDelta, wrongDelta, stopDelta: old.stopAt - converted.stopAt });
    }
    // MIDI must remain held until explicit note-off even with a long sequenced gate.
    const ctx = new OfflineAudioContext(1, 44100, 44100);
    a.setTrackAdsr(0, { gateSteps: 64 });
    const midi = a.applyEnvelope(ctx, ctx.createBufferSource(), ctx.destination, 0, 0);
    return { results, midiStopAt: midi.stopAt };
  });
  expect(result.midiStopAt).toBe(0);
  expect(result.results.every(r => r.maxDelta === 0 && r.stopDelta === 0)).toBe(true);
  expect(result.results.filter(r => r.wrongDelta > .01).length).toBeGreaterThanOrEqual(6);
});

test('live sequencer and full song bounce preserve timing and sound after splitting a 65 BPM phrase', async ({ page }) => {
  test.setTimeout(90000);
  await ready(page);
  await page.locator('#play-btn').click();
  await page.locator('#stop-btn').click();
  await page.waitForFunction(async () => (await import('/src/engine/audio.ts')).getAudioContext()!.state === 'running');
  const result = await page.evaluate(async () => {
    const audio = await import('/src/engine/audio.ts');
    const song = await import('/src/transport/song.ts');
    const patterns = await import('/src/transport/patterns.ts');
    const a = await import('/src/engine/adsr.ts');
    const { renderSongToBuffer } = await import('/src/transport/render-song.ts');
    (await import('/src/engine/extensions/store.ts')).resetAllExtensions();
    a.resetAllAdsr();
    const ctx = audio.getAudioContext()!;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = .08 * Math.sin(2 * Math.PI * 137 * i / ctx.sampleRate);
    song.drumBuf.fill(buffer); song.melBuf.fill(buffer); song.setVocalBuf(buffer);
    song.mutedArr.fill(false); patterns.octaves.fill(1); patterns.harmonies.fill(0);
    patterns.phrases.forEach(p => {
      p.drumPat.forEach(r => r.fill(false));
      p.melPat.forEach(t => t.forEach(r => r.fill(false))); p.vocalPat.fill(false);
    });
    for (let t = 0; t < 9; t++) {
      a.setAdsrEnabled(t, true);
      a.setTrackAdsr(t, { attack: .002, decay: .12, sustain: .8, release: .05, gateSteps: 1 });
    }
    for (const step of [0, 7, 31, 32, 48, 63]) {
      patterns.phrases[0]!.drumPat.forEach(row => { row[step] = true; });
      patterns.phrases[0]!.melPat.forEach(track => { track[step]![4] = true; });
      patterns.phrases[0]!.vocalPat[step] = true;
    }
    song.setBpm(65);
    const original = (await renderSongToBuffer());
    const phrase = structuredClone(patterns.phrases[0]!);
    patterns.phrases[0] = patterns.makeEmptyPhrase();
    for (let step = 0; step < 64; step++) {
      const target = patterns.phrases[Math.floor(step / 32)]!, pos = step * 2 % 64;
      phrase.drumPat.forEach((r, t) => { target.drumPat[t]![pos] = r[step]!; });
      phrase.melPat.forEach((t, i) => { target.melPat[i]![pos] = [...t[step]!]; });
      target.vocalPat[pos] = phrase.vocalPat[step]!;
    }
    song.setBpm(130);
    for (let t = 0; t < 9; t++) a.setTrackAdsr(t, { gateSteps: 2 });
    // Rendering captures note lengths before asynchronous work.
    const pending = renderSongToBuffer();
    for (let t = 0; t < 9; t++) a.setTrackAdsr(t, { gateSteps: 64 });
    const converted = await pending;
    let maxDelta = 0;
    for (let c = 0; c < 2; c++) {
      const old = original.buffer.getChannelData(c), now = converted.buffer.getChannelData(c);
      for (let i = 0; i < old.length; i++) maxDelta = Math.max(maxDelta, Math.abs(old[i]! - (now[i] ?? 0)));
    }
    for (let t = 0; t < 9; t++) a.setTrackAdsr(t, { gateSteps: 2 });
    const starts = new WeakMap<AudioBufferSourceNode, number>();
    const durations: number[] = [];
    const start = AudioBufferSourceNode.prototype.start, stop = AudioBufferSourceNode.prototype.stop;
    AudioBufferSourceNode.prototype.start = function(time = 0) { starts.set(this, time); start.call(this, time); };
    AudioBufferSourceNode.prototype.stop = function(time = 0) {
      if (starts.has(this)) durations.push(time - starts.get(this)!);
      stop.call(this, time);
    };
    const scheduler = await import('/src/engine/scheduler.ts');
    try {
      await scheduler.startPlayback();
      await new Promise(resolve => setTimeout(resolve, 100));
    } finally {
      AudioBufferSourceNode.prototype.start = start; AudioBufferSourceNode.prototype.stop = stop;
      scheduler.stopPlayback();
    }
    return { maxDelta, sameLength: original.buffer.length === converted.buffer.length,
      arrangementSeconds: [original.arrangementSeconds, converted.arrangementSeconds], durations };
  });
  expect(result.sameLength).toBe(true);
  expect(result.maxDelta).toBeLessThan(1e-6);
  expect(result.arrangementSeconds[0]).toBe(result.arrangementSeconds[1]);
  expect(result.durations.length).toBeGreaterThanOrEqual(9);
  for (const duration of result.durations) expect(duration).toBeCloseTo(60 / 65 / 4 - .05 + .05 * 4, 10);
});

test('long final notes retain their tails in phrase WAVs and full-song exports', async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const audio = await import('/src/engine/audio.ts');
    const song = await import('/src/transport/song.ts');
    const p = await import('/src/transport/patterns.ts');
    const a = await import('/src/engine/adsr.ts');
    (await import('/src/engine/extensions/store.ts')).resetAllExtensions();
    a.resetAllAdsr(); song.setBpm(220); song.mutedArr.fill(false);
    p.phrases[0]!.drumPat[0]![63] = true;
    const live = audio.getAudioContext()!;
    song.drumBuf[0] = live.createBuffer(1, 5 * live.sampleRate, live.sampleRate);
    song.drumBuf[0]!.getChannelData(0).fill(.1);
    a.setAdsrEnabled(0, true);
    a.setTrackAdsr(0, { attack: .001, decay: .01, sustain: 1, release: .05, gateSteps: 32 });
    const loop = (await (await import('/src/transport/render.ts')).renderPhraseToBuffer(0))!;
    const full = (await (await import('/src/transport/render-song.ts')).renderSongToBuffer()).buffer;
    const time = 63 * 60 / 220 / 4 + 1.5;
    return { loopDuration: loop.duration, fullDuration: full.duration,
      loopTail: Math.abs(loop.getChannelData(0)[Math.floor(time * loop.sampleRate)]!),
      fullTail: Math.abs(full.getChannelData(0)[Math.floor(time * full.sampleRate)]!) };
  });
  expect(result.loopDuration).toBeGreaterThan(6);
  expect(result.fullDuration).toBeGreaterThan(6);
  expect(result.loopTail).toBeGreaterThan(.001);
  expect(result.fullTail).toBeGreaterThan(.001);
});
