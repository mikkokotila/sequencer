import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function fixture(page: Page, twoPhrases = true) {
  await page.goto('/');
  await page.waitForSelector('html[data-ready="true"]');
  return page.evaluate(async (two) => {
    const audio = await import('/src/engine/audio.ts');
    const song = await import('/src/transport/song.ts');
    const patterns = await import('/src/transport/patterns.ts');
    const extensions = await import('/src/engine/extensions/store.ts');
    const adsr = await import('/src/engine/adsr.ts');
    const engine = await import('/src/engine/master-controls.ts');
    for (const p of patterns.phrases) {
      p.drumPat.forEach(row => row.fill(false));
      p.melPat.forEach(track => track.forEach(row => row.fill(false)));
      p.vocalPat.fill(false);
    }
    extensions.resetAllExtensions(); adsr.resetAllAdsr();
    engine.setEngineSettings({ cutoff: 1, resonance: 0, saturation: 0, compression: 0 });
    song.setBpm(220); song.setCurrentSongName('Audio Fixture'); song.mutedArr.fill(false);
    const ctx = audio.getAudioContext()!;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.15), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = 0.4 * Math.sin(2 * Math.PI * 220 * i / ctx.sampleRate);
    song.drumBuf.fill(null); song.melBuf.fill(null); song.setVocalBuf(null);
    song.drumBuf[0] = buffer; song.drumBuf[1] = buffer;
    patterns.phrases[0]!.drumPat[0]![0] = true;
    if (two) patterns.phrases[7]!.drumPat[1]![0] = true;
    patterns.switchToPhrase(7);
    const faders = audio.getChannelFaders(), pans = audio.getChannelPans();
    faders.forEach(node => { node.gain.value = 0.8; });
    pans.forEach(node => { node.pan.value = 0; });
    faders[0]!.gain.value = 0.5; pans[0]!.pan.value = -1;
    faders[1]!.gain.value = 0.25; pans[1]!.pan.value = 1;
    audio.getMasterGain()!.gain.value = 0.8;
    audio.getMasterTrim()!.gain.value = 0.9;
    return { phraseSeconds: 64 * 60 / 220 / 4, totalSeconds: (two ? 2 : 1) * 64 * 60 / 220 / 4 };
  }, twoPhrases);
}

for (const format of ['wav', 'mp3'] as const) {
  test(`${format.toUpperCase()} API produces decodable stereo song audio in phrase order with the captured mix`, async ({ page }) => {
    const timing = await fixture(page);
    const result = await page.evaluate(async ({ format, phraseSeconds }) => {
      const audio = await import('/src/engine/audio.ts');
      const store = await import('/src/engine/extensions/store.ts');
      const song = await import('/src/transport/song.ts');
      const ctx = audio.getAudioContext()!;
      const callbacks = store.seqStopCallbacks.length;
      const states = JSON.stringify(store.SEQ_EXTENSIONS.map(ext => ext.getState()));
      const sampleBefore = Array.from(song.drumBuf[0]!.getChannelData(0));
      const api = await import('/src/transport/song-audio.ts');
      const output = await api.exportSongAudio(format);
      const bytes = await output.blob.arrayBuffer();
      const decoded = await ctx.decodeAudioData(bytes.slice(0));
      const energy = (channel: number, start: number, end: number) => {
        const data = decoded.getChannelData(channel).subarray(Math.floor(start * decoded.sampleRate), Math.floor(end * decoded.sampleRate));
        return data.reduce((sum, n) => sum + n*n, 0) / data.length;
      };
      return {
        filename: output.filename, type: output.blob.type, size: bytes.byteLength,
        duration: decoded.duration, renderDuration: output.duration, channels: decoded.numberOfChannels,
        first: [energy(0, 0.05, 0.12), energy(1, 0.05, 0.12)],
        second: [energy(0, phraseSeconds + 0.05, phraseSeconds + 0.12), energy(1, phraseSeconds + 0.05, phraseSeconds + 0.12)],
        gap: energy(0, 1, 2) + energy(1, 1, 2),
        sameContext: ctx === audio.getAudioContext(), callbacksUnchanged: callbacks === store.seqStopCallbacks.length,
        statesUnchanged: states === JSON.stringify(store.SEQ_EXTENSIONS.map(ext => ext.getState())),
        samplesUnchanged: sampleBefore.every((n, i) => n === song.drumBuf[0]!.getChannelData(0)[i]),
        wav: format === 'wav' ? { bits: new DataView(bytes).getUint16(34, true), rate: new DataView(bytes).getUint32(24, true) } : null,
      };
    }, { format, phraseSeconds: timing.phraseSeconds });
    expect(result.filename).toBe(`Audio Fixture.${format}`);
    expect(result.type).toBe(format === 'wav' ? 'audio/wav' : 'audio/mpeg');
    expect(result.channels).toBe(2);
    expect(result.size).toBeGreaterThan(1000);
    expect(result.duration).toBeGreaterThanOrEqual(timing.totalSeconds);
    expect(result.duration).toBeLessThan(timing.totalSeconds + 0.2);
    expect(result.first[0]).toBeGreaterThan(0.008);
    expect(result.first[1]).toBeLessThan(0.000001);
    expect(result.second[0]).toBeLessThan(0.000001);
    expect(result.second[1]).toBeGreaterThan(0.002);
    expect(result.first[0]! / result.second[1]!).toBeCloseTo(4, 0);
    expect(result.gap).toBeLessThan(1e-8);
    expect(result.sameContext && result.callbacksUnchanged && result.statesUnchanged && result.samplesUnchanged).toBe(true);
    if (format === 'wav') expect(result.wav).toEqual({ bits: 24, rate: 44100 });
  });

  test(`Download ${format.toUpperCase()} button saves a real audio file and supports another export`, async ({ page }) => {
    await fixture(page, false);
    await page.getByRole('button', { name: 'Download song audio', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Download song', exact: true })).toBeVisible();
    const download = page.waitForEvent('download');
    await page.locator(`#export-${format}-btn`).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe(`Audio Fixture.${format}`);
    const bytes = await readFile((await file.path())!);
    if (format === 'wav') {
      expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
      expect(bytes.toString('ascii', 8, 12)).toBe('WAVE');
      expect(bytes.readUInt16LE(34)).toBe(24);
      expect(bytes.readUInt32LE(40)).toBe(bytes.length - 44);
    } else {
      expect(bytes[0]).toBe(0xff);
      expect(bytes[1]! & 0xe0).toBe(0xe0);
    }
    await expect(page.locator('#song-export-status')).toContainText('downloaded');
    await expect(page.locator('#export-wav-btn')).toBeEnabled();
    await expect(page.locator('#export-mp3-btn')).toBeEnabled();
    await page.locator('#song-export-close').click();
    await expect(page.locator('#export-song-btn')).toBeFocused();
    expect(await page.evaluate(async () => (await import('/src/engine/scheduler.ts')).isPlaying())).toBe(false);
  });
}

const effects: [string, Record<string, unknown>][] = [
  ['pultec-eq', { lowBoost: 10, lowFreq: 200, tubeColor: 0.5 }],
  ['compressor', { compress: -30, ratio: 8, drive: 0.5, model: 1, mix: 1 }],
  ['transformer', { drive: 0.8, color: 0.6, air: 0.3 }],
  ['reverb', { decay: 0.6, damping: 0.3, mix: 0.8, sends: Array(9).fill(0.8) }],
  ['delay', { time: 0.2, feedback: 0.5, mix: 0.8, sends: Array(9).fill(0.8) }],
];
for (const [id, state] of effects) {
  test(`song bounce includes ${id} and repeats deterministically without changing the live extension`, async ({ page }) => {
    await fixture(page, false);
    const result = await page.evaluate(async ({ id, state }) => {
      const { renderSongToBuffer } = await import('/src/transport/render-song.ts');
      const { SEQ_EXTENSIONS } = await import('/src/engine/extensions/store.ts');
      const baseline = (await renderSongToBuffer()).buffer;
      const ext = SEQ_EXTENSIONS.find(ext => ext.id === id)!;
      ext.setState(state); ext._enabled = true; ext.setEnabled?.(true);
      const saved = JSON.stringify(ext.getState());
      const first = (await renderSongToBuffer()).buffer;
      const second = (await renderSongToBuffer()).buffer;
      let delta = 0, repeatDelta = 0, tail = 0;
      for (let c = 0; c < 2; c++) {
        const a = baseline.getChannelData(c), b = first.getChannelData(c), d = second.getChannelData(c);
        for (let i = 0; i < b.length; i++) {
          delta += (b[i]! - (a[i] ?? 0)) ** 2;
          repeatDelta = Math.max(repeatDelta, Math.abs(b[i]! - (d[i] ?? 0)));
          if (i > first.sampleRate * 0.3) tail += b[i]! ** 2;
        }
      }
      return { delta, repeatDelta, tail, unchanged: saved === JSON.stringify(ext.getState()), sameLength: first.length === second.length };
    }, { id, state });
    expect(result.delta).toBeGreaterThan(0.0001);
    expect(result.repeatDelta).toBeLessThan(1e-6);
    expect(result.sameLength && result.unchanged).toBe(true);
    if (id === 'reverb' || id === 'delay') expect(result.tail).toBeGreaterThan(0.0001);
  });
}

test('export captures envelopes, engine controls, and mutes before asynchronous rendering', async ({ page }) => {
  await fixture(page, false);
  const result = await page.evaluate(async () => {
    const { renderSongToBuffer } = await import('/src/transport/render-song.ts');
    const audio = await import('/src/engine/audio.ts');
    const song = await import('/src/transport/song.ts');
    const patterns = await import('/src/transport/patterns.ts');
    const adsr = await import('/src/engine/adsr.ts');
    const engine = await import('/src/engine/master-controls.ts');
    const baseline = (await renderSongToBuffer()).buffer;
    adsr.setAdsrEnabled(0, true); adsr.setTrackAdsr(0, { attack: 0.02, decay: 0.02, sustain: 0.3, release: 0.015 });
    engine.setEngineSettings({ cutoff: 0, resonance: 0.3, saturation: 0.5, compression: 0.5 });
    const expected = (await renderSongToBuffer()).buffer;
    const pending = renderSongToBuffer();
    song.setBpm(40); song.setCurrentSongName('Changed while exporting'); song.mutedArr.fill(true);
    patterns.phrases[0]!.drumPat[0]!.fill(false);
    audio.getChannelFaders()[0]!.gain.value = 0;
    engine.setEngineSettings({ cutoff: 1, resonance: 0, saturation: 0, compression: 0 });
    adsr.resetAllAdsr();
    const captured = await pending;
    let difference = 0, mismatch = 0;
    for (let c = 0; c < 2; c++) {
      const a = baseline.getChannelData(c), b = expected.getChannelData(c), d = captured.buffer.getChannelData(c);
      for (let i = 0; i < b.length; i++) {
        difference += (b[i]! - (a[i] ?? 0)) ** 2;
        mismatch = Math.max(mismatch, Math.abs(b[i]! - (d[i] ?? 0)));
      }
    }
    return { difference, mismatch, name: captured.name, bpm: song.bpm, muted: song.mutedArr.every(Boolean), fader: audio.getChannelFaders()[0]!.gain.value };
  });
  expect(result.difference).toBeGreaterThan(0.01);
  expect(result.mismatch).toBeLessThan(1e-6);
  expect(result.name).toBe('Audio Fixture');
  expect(result.bpm).toBe(40); expect(result.muted).toBe(true); expect(result.fader).toBe(0);
});

test('final notes retain sample and delay tails beyond the last phrase', async ({ page }) => {
  const timing = await fixture(page, false);
  const result = await page.evaluate(async () => {
    const patterns = await import('/src/transport/patterns.ts');
    patterns.phrases[0]!.drumPat[0]!.fill(false); patterns.phrases[0]!.drumPat[0]![63] = true;
    const { SEQ_EXTENSIONS } = await import('/src/engine/extensions/store.ts');
    const delay = SEQ_EXTENSIONS.find(ext => ext.id === 'delay')!;
    delay.setState({ time: 0.2, feedback: 0.5, mix: 1, sends: Array(9).fill(1) });
    delay._enabled = true; delay.setEnabled?.(true);
    const rendered = await (await import('/src/transport/render-song.ts')).renderSongToBuffer();
    const tail = rendered.buffer.getChannelData(0).slice(Math.floor((rendered.arrangementSeconds + 0.2) * rendered.buffer.sampleRate));
    return { duration: rendered.buffer.duration, tailEnergy: tail.reduce((sum, n) => sum + n*n, 0) };
  });
  expect(result.duration).toBeGreaterThan(timing.totalSeconds + 1);
  expect(result.tailEnergy).toBeGreaterThan(0.001);
});

test('empty sample setup fails visibly, and encoder failure permits a successful retry', async ({ page }) => {
  await fixture(page, false);
  await page.evaluate(async () => { (await import('/src/transport/song.ts')).drumBuf.fill(null); });
  await page.locator('#export-song-btn').click(); await page.locator('#export-wav-btn').click();
  await expect(page.locator('#song-export-status')).toContainText('Load samples');
  await expect(page.locator('#export-wav-btn')).toBeEnabled();
  await fixture(page, false);
  await page.evaluate(() => {
    let first = true;
    window.Worker = new Proxy(window.Worker, { construct(target, args) {
      if (first) { first = false; throw new Error('Encoder unavailable'); }
      return Reflect.construct(target, args);
    } });
  });
  await page.locator('#export-song-btn').click(); await page.locator('#export-mp3-btn').click();
  await expect(page.locator('#song-export-status')).toContainText('Encoder unavailable');
  await expect(page.locator('#export-mp3-btn')).toBeEnabled();
  const download = page.waitForEvent('download'); await page.locator('#export-mp3-btn').click();
  expect((await download).suggestedFilename()).toBe('Audio Fixture.mp3');
});

test('cancel during graph setup prevents download and permits retry', async ({ page }) => {
  await fixture(page, false);
  const downloads: string[] = []; page.on('download', file => downloads.push(file.suggestedFilename()));
  await page.route('**/src/engine/worklets/**', async route => {
    await new Promise(resolve => setTimeout(resolve, 200)); await route.continue();
  });
  await page.locator('#export-song-btn').click(); await page.locator('#export-wav-btn').click();
  await expect(page.locator('#export-mp3-btn')).toBeDisabled();
  await page.locator('#song-export-close').click();
  await expect(page.locator('#song-export-status')).toHaveText('Export cancelled.');
  await expect(page.locator('#export-wav-btn')).toBeEnabled();
  await expect(page.locator('#song-export-close')).toBeEnabled();
  expect(downloads).toEqual([]);
  await page.unroute('**/src/engine/worklets/**');
  const download = page.waitForEvent('download'); await page.locator('#export-wav-btn').click();
  expect((await download).suggestedFilename()).toBe('Audio Fixture.wav');
});

test('MP3 encoding cancellation releases the worker and returns AbortError', async ({ page }) => {
  await fixture(page, false);
  const result = await page.evaluate(async () => {
    const controller = new AbortController();
    try {
      await (await import('/src/transport/song-audio.ts')).exportSongAudio('mp3', {
        signal: controller.signal,
        onProgress: ({ stage }) => { if (stage === 'encoding') controller.abort(); },
      });
      return 'unexpected success';
    } catch (error) { return (error as Error).name; }
  });
  expect(result).toBe('AbortError');
});

test('export leaves ongoing playback and its AudioContext running', async ({ page }) => {
  await fixture(page, false);
  await page.locator('#play-btn').click();
  await expect.poll(() => page.evaluate(async () => (await import('/src/engine/scheduler.ts')).isPlaying())).toBe(true);
  await page.locator('#export-song-btn').click();
  const download = page.waitForEvent('download');
  await page.locator('#export-wav-btn').click(); await download;
  await page.locator('#song-export-close').click();
  await expect.poll(() => page.evaluate(async () => (await import('/src/engine/scheduler.ts')).isPlaying())).toBe(true);
  expect(await page.evaluate(async () => (await import('/src/engine/audio.ts')).getAudioContext()!.state)).toBe('running');
  await page.locator('#stop-btn').click();
});

test('song export renders melody octaves, polyphonic harmony, and vocal timing', async ({ page }) => {
  await fixture(page, false);
  const result = await page.evaluate(async () => {
    const audio = await import('/src/engine/audio.ts');
    const song = await import('/src/transport/song.ts');
    const patterns = await import('/src/transport/patterns.ts');
    const { HARMONY_SEMITONES } = await import('/src/config.ts');
    const ctx = audio.getAudioContext()!;
    const tone = (frequency: number) => {
      const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i=0; i<data.length; i++) data[i] = 0.25 * Math.sin(2*Math.PI*frequency*i/ctx.sampleRate);
      return buffer;
    };
    patterns.phrases[0]!.drumPat[0]!.fill(false);
    song.melBuf[0] = tone(220); song.melBuf[1] = tone(110); song.setVocalBuf(tone(55));
    patterns.octaves[0] = 2; patterns.octaves[1] = 1;
    patterns.harmonies[1] = HARMONY_SEMITONES.findIndex(n => n === 7);
    patterns.phrases[0]!.melPat[0]![0]![0] = true;
    patterns.phrases[0]!.melPat[1]![0]![0] = true;
    patterns.phrases[0]!.vocalPat[1] = true;
    audio.getChannelPans()[5]!.pan.value = -1;
    audio.getChannelPans()[6]!.pan.value = -1;
    audio.getChannelPans()[8]!.pan.value = 1;
    const { buffer } = await (await import('/src/transport/render-song.ts')).renderSongToBuffer();
    const magnitude = (channel: number, frequency: number, start: number, end: number) => {
      const data = buffer.getChannelData(channel);
      let re=0, im=0;
      const first=Math.floor(start*buffer.sampleRate), last=Math.floor(end*buffer.sampleRate);
      for(let i=first;i<last;i++) {
        re+=data[i]!*Math.cos(2*Math.PI*frequency*i/buffer.sampleRate);
        im+=data[i]!*Math.sin(2*Math.PI*frequency*i/buffer.sampleRate);
      }
      return Math.hypot(re,im)/(last-first);
    };
    return {
      octave: magnitude(0,440,0.15,0.4), root:magnitude(0,110,0.15,0.4),
      harmony:magnitude(0,110*2**(7/12),0.15,0.4),
      vocal:magnitude(1,55,0.15,0.4), beforeVocal:magnitude(1,55,0.01,0.05),
      absent:magnitude(0,700,0.15,0.4),
    };
  });
  expect(result.octave).toBeGreaterThan(0.05);
  expect(result.root).toBeGreaterThan(0.05);
  expect(result.harmony).toBeGreaterThan(0.05);
  expect(result.vocal).toBeGreaterThan(0.05);
  expect(result.beforeVocal).toBeLessThan(1e-8);
  expect(result.absent).toBeLessThan(0.005);
});

for (const format of ['wav', 'mp3'] as const) {
  test(`${format.toUpperCase()} processor load failure is reported as a failure and retries without reloading the song`, async ({ page }) => {
    await fixture(page, false);
    const downloads: string[] = [];
    page.on('download', file => downloads.push(file.suggestedFilename()));
    // Chromium can serve worklet modules from its own cache, bypassing page routes.
    // Reject the five processor registrations with the browser's native failure type.
    await page.evaluate(() => {
      const original = AudioWorklet.prototype.addModule;
      let remainingFailures = 5;
      AudioWorklet.prototype.addModule = function (...args) {
        if (remainingFailures-- > 0)
          return Promise.reject(new DOMException('Unable to load a worklet module', 'AbortError'));
        return original.apply(this, args);
      };
    });
    await page.locator('#export-song-btn').click();
    await page.locator(`#export-${format}-btn`).click();
    await expect(page.locator('#song-export-status')).toContainText('Could not load audio processors');
    await expect(page.locator('#song-export-status')).toHaveClass(/export-error/);
    await expect(page.locator('#song-export-status')).not.toContainText('cancelled');
    await expect(page.locator(`#export-${format}-btn`)).toBeEnabled();
    expect(downloads).toEqual([]);
    const download = page.waitForEvent('download');
    await page.locator(`#export-${format}-btn`).click();
    expect((await download).suggestedFilename()).toBe(`Audio Fixture.${format}`);
    await expect(page.locator('#song-export-status')).not.toHaveClass(/export-error/);
    expect(await page.evaluate(async () => {
      const song = await import('/src/transport/song.ts');
      const patterns = await import('/src/transport/patterns.ts');
      return { name: song.currentSongName, bpm: song.bpm, note: patterns.phrases[0]!.drumPat[0]![0] };
    })).toEqual({ name: 'Audio Fixture', bpm: 220, note: true });
  });
}

test('a native rendering AbortError without user cancellation is a failure and permits retry', async ({ page }) => {
  await fixture(page, false);
  await page.evaluate(() => {
    const original = OfflineAudioContext.prototype.startRendering;
    let first = true;
    OfflineAudioContext.prototype.startRendering = function () {
      if (first) {
        first = false;
        return Promise.reject(new DOMException('Rendering unavailable', 'AbortError'));
      }
      return original.call(this);
    };
  });
  await page.locator('#export-song-btn').click();
  await page.locator('#export-wav-btn').click();
  await expect(page.locator('#song-export-status')).toContainText('Rendering unavailable');
  await expect(page.locator('#song-export-status')).toHaveClass(/export-error/);
  await expect(page.locator('#song-export-status')).not.toContainText('cancelled');
  const download = page.waitForEvent('download');
  await page.locator('#export-wav-btn').click();
  expect((await download).suggestedFilename()).toBe('Audio Fixture.wav');
});
