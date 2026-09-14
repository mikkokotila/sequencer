import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { readZip } from './s2400-files';

async function ready(page: Page) {
  await page.goto('/');
  await page.waitForSelector('html[data-ready="true"]');
}

async function clearPhrases(page: Page) {
  await page.evaluate(async () => {
    const p = await import('/src/transport/patterns.ts');
    p.phrases.forEach((phrase) => {
      phrase.drumPat.forEach((row) => row.fill(false));
      phrase.melPat.forEach((track) => track.forEach((row) => row.fill(false)));
      phrase.vocalPat.fill(false);
    });
  });
}

test('phrase selector lays out twelve per row, persists each choice, and defaults new songs to 36', async ({
  page,
}) => {
  await ready(page);
  await expect(page.getByRole('combobox', { name: 'Song phrases' })).toHaveValue('36');
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const count of [48, 12, 24, 36]) {
      await page.getByRole('combobox', { name: 'Song phrases' }).selectOption(String(count));
      await expect(page.locator('.phrase-slot:visible')).toHaveCount(count);
      const rows = await page.locator('.phrase-slot:visible').evaluateAll((slots) => {
        const rows = new Map<number, number>();
        for (const slot of slots) {
          const y = slot.getBoundingClientRect().top;
          rows.set(y, (rows.get(y) ?? 0) + 1);
        }
        return [...rows.values()];
      });
      expect(rows).toEqual(Array(count / 12).fill(12));
      await page.evaluate(async () => {
        const p = await import('/src/transport/persistence.ts');
        await p.saveSong();
      });
      await page.reload();
      await page.waitForSelector('html[data-ready="true"]');
      await expect(page.getByRole('combobox', { name: 'Song phrases' })).toHaveValue(String(count));
      await expect(page.locator('.phrase-slot:visible')).toHaveCount(count);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await expect
        .poll(() =>
          page.evaluate(() => {
            const content = document
              .querySelector('#app')!
              .lastElementChild!.getBoundingClientRect();
            const pane = document.querySelector('#song-pane')!.getBoundingClientRect();
            return Math.round(pane.top - content.bottom);
          }),
        )
        .toBeGreaterThanOrEqual(0);
    }
  }
  await page.getByRole('combobox', { name: 'Song phrases' }).selectOption('12');
  await page.getByRole('button', { name: 'New Song', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Song phrases' })).toHaveValue('36');
});

test('shrinking protects every track type and rebinds an empty out-of-range editing phrase', async ({
  page,
}) => {
  await ready(page);
  await clearPhrases(page);
  await page.getByRole('combobox', { name: 'Song phrases' }).selectOption('48');
  await page.locator('.phrase-slot[data-phrase="47"]').click();
  for (const type of ['drum', 'melody', 'vocal']) {
    await page.evaluate(async (type) => {
      const p = await import('/src/transport/patterns.ts');
      if (type === 'drum') p.setDrumStep(4, 63, true);
      else if (type === 'melody') p.setMelStep(2, 63, 11, true);
      else p.setVocalStep(63, true);
    }, type);
    await page.getByRole('combobox', { name: 'Song phrases' }).selectOption('12');
    await expect(page.locator('.phrase-count-error')).toContainText('Phrase 48 contains notes');
    await expect(page.getByRole('combobox', { name: 'Song phrases' })).toHaveValue('48');
    expect(
      await page.evaluate(async () => {
        const p = await import('/src/transport/patterns.ts');
        return p.isPhraseEmpty(47);
      }),
    ).toBe(false);
    await clearPhrases(page);
  }
  await page.getByRole('combobox', { name: 'Song phrases' }).selectOption('12');
  await expect(page.locator('.phrase-slot.active')).toHaveAttribute('data-phrase', '11');
  await page.locator('.step-cell[data-type="drum"][data-track="0"][data-step="63"]').click();
  expect(
    await page.evaluate(async () => {
      const p = await import('/src/transport/patterns.ts');
      return p.phrases[11]!.drumPat[0]![63];
    }),
  ).toBe(true);
  await page.getByRole('combobox', { name: 'Song phrases' }).selectOption('48');
  expect(
    await page.evaluate(async () => {
      const p = await import('/src/transport/patterns.ts');
      return p.isPhraseEmpty(47);
    }),
  ).toBe(true);
});

test('legacy songs gain capacity and JSON round trips preserve choice, phrase 48, tempo and samples', async ({
  page,
}) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const p = await import('/src/transport/patterns.ts');
    const files = await import('/src/transport/song-format.ts');
    const persistence = await import('/src/transport/persistence.ts');
    const legacy = files.normalizeSong({
      bpm: 65,
      phrases: Array.from({ length: 12 }, () => p.makeEmptyPhrase()),
      currentPhrase: 11,
    });
    const sizes = [12, 24, 36, 48].map((count) => {
      const song = files.normalizeSong({ phraseCount: count });
      song.phrases[count - 1]!.drumPat[4]![63] = true;
      song.currentPhrase = count - 1;
      song.drumSampleData[4] = { name: 'test.wav', data: new Uint8Array([1, 2, 3]).buffer };
      const decoded = files.normalizeSong(JSON.parse(files.encodeSongFile(song)), true);
      return {
        count: decoded.phraseCount,
        length: decoded.phrases.length,
        selected: decoded.currentPhrase,
        note: decoded.phrases[count - 1]!.drumPat[4]![63],
        bytes: [...new Uint8Array(decoded.drumSampleData[4]!.data)],
      };
    });
    const bad = [
      { phraseCount: 13 },
      { phraseCount: 49 },
      { phraseCount: 12.5 },
      { phraseCount: 12, phrases: Array.from({ length: 13 }, () => ({})) },
      { phrases: Array.from({ length: 49 }, () => ({})) },
      { phraseCount: 36, currentPhrase: 36 },
    ].map((value) => {
      try {
        files.normalizeSong(value);
        return false;
      } catch {
        return true;
      }
    });
    const full = files.normalizeSong({ phraseCount: 48, currentPhrase: 47, bpm: 130 });
    full.phrases[47]!.melPat[2]![63]![11] = true;
    await persistence.loadSong(JSON.parse(files.encodeSongFile(full)));
    return {
      legacy: { count: legacy.phraseCount, selected: legacy.currentPhrase, bpm: legacy.bpm },
      sizes,
      bad,
    };
  });
  expect(result.legacy).toEqual({ count: 36, selected: 11, bpm: 65 });
  expect(result.sizes).toEqual(
    [12, 24, 36, 48].map((count) => ({
      count,
      length: count,
      selected: count - 1,
      note: true,
      bytes: [1, 2, 3],
    })),
  );
  expect(result.bad).toEqual(Array(6).fill(true));
  await expect(page.getByRole('combobox', { name: 'Song phrases' })).toHaveValue('48');
  await expect(page.locator('.phrase-slot.active')).toHaveAttribute('data-phrase', '47');
  await expect(
    page.locator('.melody-cell[data-track="2"][data-step="63"][data-note="0"]'),
  ).toHaveClass(/active/);
  await expect(page.locator('#bpm-num')).toHaveValue('130');
});

test('playback crosses every twelve-phrase boundary and wraps from phrase 48 without timing gaps', async ({
  page,
}) => {
  test.setTimeout(50000);
  await ready(page);
  await clearPhrases(page);
  await page.evaluate(async () => {
    const p = await import('/src/transport/patterns.ts');
    const song = await import('/src/transport/song.ts');
    const events = await import('/src/events.ts');
    song.setBpm(220);
    for (const i of [11, 12, 23, 24, 35]) {
      p.phrases[i]!.drumPat[0]![0] = true;
      p.phrases[i]!.drumPat[0]![63] = true;
    }
    const w = window as unknown as {
      capacityTriggers: { phrase: number; step: number; time: number }[];
    };
    w.capacityTriggers = [];
    events.on('engine:trigger', (e) => {
      if (e.track === 0) w.capacityTriggers.push(e);
    });
  });
  await page.locator('#play-btn').click();
  await page.waitForFunction(
    () => (window as unknown as { capacityTriggers: unknown[] }).capacityTriggers.length > 0,
  );
  await page.getByRole('combobox', { name: 'Song phrases' }).selectOption('48');
  await page.evaluate(async () => {
    const p = await import('/src/transport/patterns.ts');
    for (const i of [36, 47]) {
      p.phrases[i]!.drumPat[0]![0] = true;
      p.phrases[i]!.drumPat[0]![63] = true;
    }
  });
  expect(
    await page.evaluate(async () => (await import('/src/engine/scheduler.ts')).isPlaying()),
  ).toBe(true);
  await page.waitForFunction(
    () => (window as unknown as { capacityTriggers: unknown[] }).capacityTriggers.length >= 15,
    {},
    { timeout: 40000 },
  );
  const triggers = await page.evaluate(() =>
    (
      window as unknown as { capacityTriggers: { phrase: number; step: number; time: number }[] }
    ).capacityTriggers.slice(0, 15),
  );
  expect(triggers.filter((t) => t.step === 0).map((t) => t.phrase)).toEqual([
    11, 12, 23, 24, 35, 36, 47, 11,
  ]);
  for (let i = 2; i < triggers.length; i += 2)
    expect(triggers[i]!.time - triggers[i - 1]!.time).toBeCloseTo(60 / 220 / 4, 7);
  await clearPhrases(page);
  await page.getByRole('combobox', { name: 'Song phrases' }).selectOption('12');
  expect(
    await page.evaluate(async () => {
      const s = await import('/src/engine/scheduler.ts');
      return s.isPlaying();
    }),
  ).toBe(false);
  await expect(page.locator('.playing, .playing-phrase')).toHaveCount(0);
});

test('full 48-phrase audio render includes the last hit at the real BPM', async ({ page }) => {
  test.setTimeout(90000);
  await ready(page);
  await clearPhrases(page);
  const result = await page.evaluate(async () => {
    const p = await import('/src/transport/patterns.ts');
    const song = await import('/src/transport/song.ts');
    const audio = await import('/src/engine/audio.ts');
    const render = await import('/src/transport/render-song.ts');
    p.setPhraseCount(48);
    song.setBpm(130);
    const ctx = audio.getAudioContext()!;
    const pulse = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.01), ctx.sampleRate);
    pulse.getChannelData(0).fill(0.2);
    song.drumBuf[0] = pulse;
    p.phrases.forEach((phrase) => {
      phrase.drumPat[0]![0] = true;
      phrase.drumPat[0]![63] = true;
    });
    const output = await render.renderSongToBuffer();
    const samples = output.buffer.getChannelData(0);
    const peak = (time: number) => {
      const start = Math.floor(time * output.buffer.sampleRate);
      return Math.max(...samples.subarray(start, start + 1000).map(Math.abs));
    };
    return {
      duration: output.arrangementSeconds,
      first: peak(0),
      lastPhrase: peak((47 * 16 * 60) / 130),
      lastHit: peak(((48 * 64 - 1) * 60) / 130 / 4),
    };
  });
  expect(result.duration).toBeCloseTo(354.461538, 5);
  expect(result.first).toBeGreaterThan(0.001);
  expect(result.lastPhrase).toBeGreaterThan(0.001);
  expect(result.lastHit).toBeGreaterThan(0.001);
});

test('two-tab conflicts retain a phrase-48 edit and its capacity in a separate saved copy', async ({
  page,
  context,
}) => {
  await ready(page);
  await clearPhrases(page);
  await page.getByRole('combobox', { name: 'Song phrases' }).selectOption('48');
  const id = await page.evaluate(async () => {
    const persistence = await import('/src/transport/persistence.ts');
    await persistence.saveSong();
    return (await import('/src/transport/song.ts')).currentSongId!;
  });
  const other = await context.newPage();
  await ready(other);
  await page.evaluate(async () => {
    const p = await import('/src/transport/patterns.ts');
    const persistence = await import('/src/transport/persistence.ts');
    p.setPhraseCount(12);
    await persistence.saveSong();
  });
  await other.locator('.phrase-slot[data-phrase="47"]').click();
  await other.locator('.step-cell[data-type="drum"][data-track="0"][data-step="63"]').click();
  await expect(other.locator('#persistence-status')).toContainText('another tab');
  await other.getByRole('button', { name: 'Save as new song' }).click();
  await expect(other.locator('#persistence-status')).toBeHidden();
  const songs = await other.evaluate(async () => {
    const persistence = await import('/src/transport/persistence.ts');
    const songs = await persistence.dbGetAll<any>('songs');
    return songs.map((song) => ({
      id: song.id,
      count: song.phraseCount,
      last: song.phrases[47]?.drumPat[0][63] ?? false,
    }));
  });
  expect(songs.find((song) => song.id === id)).toEqual({ id, count: 12, last: false });
  expect(songs.find((song) => song.id !== id)).toMatchObject({ count: 48, last: true });
  await other.reload();
  await other.waitForSelector('html[data-ready="true"]');
  await expect(other.getByRole('combobox', { name: 'Song phrases' })).toHaveValue('48');
  await expect(other.locator('.phrase-slot.active')).toHaveAttribute('data-phrase', '47');
});

test('loop ZIP includes phrase 48 with a complete WAV', async ({ page }) => {
  await ready(page);
  await clearPhrases(page);
  await page.evaluate(async () => {
    const p = await import('/src/transport/patterns.ts');
    const song = await import('/src/transport/song.ts');
    p.setPhraseCount(48);
    song.setBpm(130);
    const pulse = new AudioBuffer({ numberOfChannels: 1, sampleRate: 44100, length: 441 });
    pulse.getChannelData(0).fill(0.1);
    song.drumBuf[0] = pulse;
    p.phrases[47]!.drumPat[0]![63] = true;
  });
  const downloading = page.waitForEvent('download');
  await page.locator('#export-loops-btn').click();
  const download = await downloading;
  const files = readZip(await readFile((await download.path())!));
  expect([...files.keys()]).toEqual(['phrase-48.wav']);
  const wav = files.get('phrase-48.wav')!;
  expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
  expect(wav.readUInt32LE(40)).toBe(wav.length - 44);
  expect(wav.readUInt16LE(34)).toBe(24);
});
