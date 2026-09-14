import { test, expect, type Page } from '@playwright/test';

async function prepare(page: Page) {
  await page.goto('/');
  await page.waitForSelector('html[data-ready="true"]');
  await page.evaluate(async () => {
    const [patterns, persistence, audio, wav] = await Promise.all([
      import('/src/transport/patterns.ts'),
      import('/src/transport/persistence.ts'),
      import('/src/engine/audio.ts'),
      import('/src/transport/wav.ts'),
    ]);
    const context = audio.getAudioContext()!;
    const buffer = context.createBuffer(1, 4800, 48000);
    buffer.getChannelData(0).forEach((_, i, data) => {
      data[i] = Math.sin(i * 0.1) * 0.15 * (1 - i / data.length);
    });
    const sample = { name: 'fixture.wav', data: wav.audioBufferToWav24(buffer).buffer };
    const song = persistence.collectSongData('Composer QC');
    song.phrases = Array.from({ length: 36 }, () => patterns.makeEmptyPhrase());
    song.sections = [];
    song.phraseCount = 36;
    song.currentPhrase = 0;
    song.drumNames = ['Kick', 'Snare', 'Closed hat', 'Open hat', 'Crash'];
    song.melNames = ['Bass', 'Pad', 'Lead'];
    song.vocalName = 'Clap';
    song.drumSampleData.fill(sample);
    song.melSampleData.fill(sample);
    song.vocalSampleData = sample;
    for (let p = 0; p < 2; p++) {
      const phrase = song.phrases[p]!;
      for (let step = 0; step < 64; step++) {
        phrase.drumPat.forEach((row, track) => {
          row[step] = step % (track === 2 ? 2 : 4) === (track === 1 ? 2 : 0);
        });
        phrase.vocalPat[step] = step % 16 === 4;
        phrase.melPat.forEach((track, t) => {
          if (step % 4 === 0) {
            track[step]![p + 2] = true;
            if (t === 1) track[step]![p + 6] = true;
          }
        });
      }
    }
    await persistence.loadSong(song);
    await persistence.saveSong();
    (window as any).fixtureRevision = (await persistence.dbGet<any>('songs', song.id)).revision;
  });
}

async function patterns(page: Page) {
  return page.evaluate(async () =>
    JSON.stringify((await import('/src/transport/patterns.ts')).phrases),
  );
}

// Exercise real painting gestures rather than merely calling the history implementation.
test('a painted stroke is one undoable edit; redo branches and text input shortcuts stay local', async ({
  page,
}) => {
  await prepare(page);
  await page.locator('.phrase-slot').nth(5).click();
  const before = await patterns(page);
  const cells = page.locator('.step-cell[data-type="drum"][data-track="0"]');
  const a = (await cells.nth(1).boundingBox())!;
  const b = (await cells.nth(3).boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
  const painted = await patterns(page);
  expect(painted).not.toBe(before);
  await page.locator('#undo-btn').click();
  expect(await patterns(page)).toBe(before);
  await expect(page.locator('#undo-btn')).toBeDisabled();
  await page.locator('#redo-btn').click();
  expect(await patterns(page)).toBe(painted);
  await page.locator('#undo-btn').click();
  await cells.nth(6).click();
  await expect(page.locator('#redo-btn')).toBeDisabled();
  await page.locator('#bpm-num').fill('150');
  await page.locator('#bpm-num').press('Tab');
  await page.locator('#undo-btn').click();
  await expect(page.locator('#bpm-num')).toHaveValue('120');
  await page.getByRole('button', { name: 'Sections', exact: true }).click();
  const name = page.getByRole('textbox', { name: 'Section name' });
  await name.fill('Draft');
  const state = await patterns(page);
  await name.press('Control+z');
  expect(await patterns(page)).toBe(state);
});

test('sample drop, envelopes and mixer changes restore actual audio state and survive saving an undo', async ({
  page,
}) => {
  await prepare(page);
  await page.evaluate(async () => {
    const song = await import('/src/transport/song.ts');
    (window as any).beforeSample = song.drumBuf[0];
    const data = new DataTransfer();
    data.items.add(
      new File([song.drumSampleData[0]!.data], 'replacement.wav', { type: 'audio/wav' }),
    );
    document
      .querySelector('.melody-track[data-type="drum"]')!
      .dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: data }));
  });
  await expect(page.locator('.melody-track[data-type="drum"] .sample-btn').first()).toHaveAttribute(
    'title',
    'replacement.wav',
  );
  await page.locator('#undo-btn').click();
  expect(
    await page.evaluate(
      async () =>
        (await import('/src/transport/song.ts')).drumBuf[0] === (window as any).beforeSample,
    ),
  ).toBe(true);
  await page.getByRole('button', { name: 'ADSR', exact: true }).nth(5).click();
  await page.getByRole('spinbutton', { name: 'Note length in sixteenth-note steps' }).fill('4');
  await page.locator('#adsr-close').click();
  await page.locator('#undo-btn').click();
  expect(
    await page.evaluate(
      async () => (await import('/src/engine/adsr.ts')).getTrackAdsr(5).gateSteps,
    ),
  ).toBe(1);
  const changes = await page.evaluate(async () => {
    const [history, store, audio, persistence] = await Promise.all([
      import('/src/transport/history.ts'),
      import('/src/engine/extensions/store.ts'),
      import('/src/engine/audio.ts'),
      import('/src/transport/persistence.ts'),
    ]);
    const mixer = store.SEQ_EXTENSIONS.find((ext) => ext.id === 'mixer')!;
    const before = audio.getChannelFaders()[0]!.gain.value;
    history.editDocument('Change mixer', () => mixer.setState({ levels: Array(9).fill(0.25) }));
    const changed = audio.getChannelFaders()[0]!.gain.value;
    history.undo();
    await persistence.saveSong();
    return { before, changed, restored: audio.getChannelFaders()[0]!.gain.value };
  });
  expect(changes.changed).not.toBe(changes.before);
  expect(changes.restored).toBeCloseTo(changes.before, 6);
  await page.reload();
  await page.waitForSelector('html[data-ready="true"]');
  await expect(page.locator('#undo-btn')).toBeDisabled();
  expect(
    await page.evaluate(
      async () => (await import('/src/engine/audio.ts')).getChannelFaders()[0]!.gain.value,
    ),
  ).toBeCloseTo(changes.before, 6);
});

test('bulk GUI copy/paste spans phrases and all track types, with a single undo', async ({
  page,
}) => {
  await prepare(page);
  const before = await patterns(page);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Last phrase', exact: true })
    .selectOption({ value: '1' });
  await page.getByRole('combobox', { name: 'Last bar', exact: true }).selectOption({ value: '1' });
  await expect(page.getByRole('combobox', { name: 'Last bar', exact: true })).toHaveValue('1');
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(page.locator('.composer-status')).toContainText('2 phrase(s), 2 bar(s)');
  await page
    .getByRole('combobox', { name: 'First phrase', exact: true })
    .selectOption({ value: '4' });
  await page.getByRole('button', { name: 'Paste copied tracks', exact: true }).click();
  expect(
    await page.evaluate(async () => {
      const [p, c] = await Promise.all([
        import('/src/transport/patterns.ts'),
        import('/src/transport/composer.ts'),
      ]);
      return [0, 1].every((source) =>
        Array.from({ length: 9 }, (_, t) => t).every(
          (t) =>
            JSON.stringify(c.readTrack(p.phrases[source]!, t).slice(0, 32)) ===
            JSON.stringify(c.readTrack(p.phrases[source + 4]!, t).slice(0, 32)),
        ),
      );
    }),
  ).toBe(true);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('#undo-btn').click();
  expect(await patterns(page)).toBe(before);
  await expect(page.locator('#undo-btn')).toBeDisabled();
});

test('bulk bounds and mono violations reject atomically; nudge, repeat and transpose preserve their scope', async ({
  page,
}) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const [c, p, h] = await Promise.all([
      import('/src/transport/composer.ts'),
      import('/src/transport/patterns.ts'),
      import('/src/transport/history.ts'),
    ]);
    const before = JSON.stringify(p.phrases);
    const region = { from: 0, to: 1, startStep: 0, endStep: 15, tracks: [2, 5, 6, 8] };
    c.nudgeRegion(region, 1);
    c.nudgeRegion(region, -1);
    const inverse = JSON.stringify(p.phrases) === before;
    h.undo();
    h.undo();
    c.transposeRegion(region, 1);
    c.transposeRegion(region, -1);
    const transpose = JSON.stringify(p.phrases) === before;
    h.undo();
    h.undo();
    const errors = [];
    for (const action of [
      () => c.transposeRegion(region, 12),
      () => c.clearRegion({ ...region, to: 48 }),
      () => c.pasteRegion(c.copyRegion(region), 35),
      () => c.previewVariation(region, 'invalid' as any),
    ]) {
      try {
        action();
        errors.push(false);
      } catch {
        errors.push(JSON.stringify(p.phrases) === before);
      }
    }
    const clip = c.copyRegion({ ...region, tracks: [5] });
    clip.data[0]![0]![8] = true;
    try {
      c.pasteRegion(clip, 5);
      errors.push(false);
    } catch {
      errors.push(JSON.stringify(p.phrases) === before);
    }
    c.repeatRegion(region);
    const repeated = [0, 1].every((phrase) =>
      region.tracks.every((track) => {
        const rows = c.readTrack(p.phrases[phrase]!, track);
        return rows.every(
          (row, i) => i < 16 || JSON.stringify(row) === JSON.stringify(rows[i % 16]),
        );
      }),
    );
    const untouched =
      JSON.stringify(p.phrases.slice(2)) === JSON.stringify(JSON.parse(before).slice(2));
    h.undo();
    return {
      inverse,
      transpose,
      errors,
      repeated,
      untouched,
      undo: JSON.stringify(p.phrases) === before,
    };
  });
  expect(result).toEqual({
    inverse: true,
    transpose: true,
    errors: [true, true, true, true, true],
    repeated: true,
    untouched: true,
    undo: true,
  });
});

for (const kind of ['sparse', 'driving', 'syncopated', 'answer'] as const) {
  test(`${kind} variation preserves protected tracks and pitches; preview is pure and Apply is undoable`, async ({
    page,
  }) => {
    await prepare(page);
    const result = await page.evaluate(async (kind) => {
      const [c, p, h] = await Promise.all([
        import('/src/transport/composer.ts'),
        import('/src/transport/patterns.ts'),
        import('/src/transport/history.ts'),
      ]);
      const before = JSON.stringify(p.phrases);
      const region = { from: 0, to: 1, startStep: 0, endStep: 63, tracks: [0, 1, 2, 5, 6, 7, 8] };
      const preview = c.previewVariation(region, kind);
      const pure = JSON.stringify(p.phrases) === before && !h.getHistoryState().canUndo;
      const preserved = preview.result.every((phrase, i) =>
        [0, 3, 4, 7].every(
          (track) =>
            JSON.stringify(c.readTrack(phrase, track)) ===
            JSON.stringify(c.readTrack(preview.original[i]!, track)),
        ),
      );
      const pitches = preview.result.every((phrase, i) =>
        [5, 6, 7].every((track) => {
          const allowed = new Set(
            c
              .readTrack(preview.original[i]!, track)
              .flatMap((notes) => notes.flatMap((hit, n) => (hit ? [n] : []))),
          );
          return c
            .readTrack(phrase, track)
            .every(
              (notes) =>
                notes.every((hit, n) => !hit || allowed.has(n)) &&
                (track !== 5 || notes.filter(Boolean).length <= 1),
            );
        }),
      );
      c.applyVariation(preview);
      const applied = JSON.stringify(p.phrases.slice(0, 2)) === JSON.stringify(preview.result);
      h.undo();
      return {
        pure,
        preserved,
        pitches,
        applied,
        undo: JSON.stringify(p.phrases) === before,
        changed: preview.added + preview.removed,
      };
    }, kind);
    expect(result).toMatchObject({
      pure: true,
      preserved: true,
      pitches: true,
      applied: true,
      undo: true,
    });
    expect(result.changed).toBeGreaterThan(0);
  });
}

test('stale previews reject later edits and forged preview data cannot change protected tracks', async ({
  page,
}) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const [c, p, h] = await Promise.all([
      import('/src/transport/composer.ts'),
      import('/src/transport/patterns.ts'),
      import('/src/transport/history.ts'),
    ]);
    const region = { from: 0, to: 0, startStep: 0, endStep: 63, tracks: [0, 2, 7] };
    const candidate = c.previewVariation(region, 'sparse');
    c.nudgeRegion({ ...region, tracks: [1] }, 1);
    const changed = JSON.stringify(p.phrases);
    let rejected = false;
    try {
      c.applyVariation(candidate);
    } catch {
      rejected = true;
    }
    const kept = JSON.stringify(p.phrases) === changed;
    h.undo();
    const fresh = c.previewVariation(region, 'driving');
    const kick = JSON.stringify(p.phrases[0]!.drumPat[0]);
    fresh.result[0]!.drumPat[0]!.fill(false);
    c.applyVariation(fresh);
    return { rejected, kept, protected: JSON.stringify(p.phrases[0]!.drumPat[0]) === kick };
  });
  expect(result).toEqual({ rejected: true, kept: true, protected: true });
});

test('named sections move, duplicate and resize notes together, with exact undo and capacity protection', async ({
  page,
}) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const [c, p, h] = await Promise.all([
      import('/src/transport/composer.ts'),
      import('/src/transport/patterns.ts'),
      import('/src/transport/history.ts'),
    ]);
    const first = c.nameSection(0, 1, 'Intro');
    const second = c.nameSection(1, 1, 'Main');
    const before = JSON.stringify({ phrases: p.phrases, sections: p.sections });
    const copy = c.duplicateSection(first.id);
    const duplicate =
      JSON.stringify(p.phrases[0]) === JSON.stringify(p.phrases[1]) &&
      p.sections.find((s) => s.id === second.id)!.start === 2;
    c.resizeSection(copy.id, 3);
    const resized =
      JSON.stringify(p.phrases[1]) === JSON.stringify(p.phrases[3]) &&
      p.sections.find((s) => s.id === second.id)!.start === 4;
    c.moveSection(second.id, 0);
    const moved =
      p.sections[0]!.id === second.id &&
      JSON.stringify(p.phrases[0]) === JSON.stringify(JSON.parse(before).phrases[1]);
    h.undo();
    h.undo();
    h.undo();
    const undo = JSON.stringify({ phrases: p.phrases, sections: p.sections }) === before;
    let overlap = false;
    try {
      c.nameSection(0, 2, 'Overlap');
    } catch {
      overlap = JSON.stringify({ phrases: p.phrases, sections: p.sections }) === before;
    }
    p.setPhraseCount(48);
    p.phrases[47]!.drumPat[0]![63] = true;
    const full = JSON.stringify(p.phrases);
    let overflow = false;
    try {
      c.duplicateSection(first.id);
    } catch {
      overflow = JSON.stringify(p.phrases) === full;
    }
    return { duplicate, resized, moved, undo, overlap, overflow };
  });
  expect(result).toEqual({
    duplicate: true,
    resized: true,
    moved: true,
    undo: true,
    overlap: true,
    overflow: true,
  });
});

test('section metadata and variation locks survive JSON and reload; invalid metadata preserves the document', async ({
  page,
}) => {
  await prepare(page);
  await page.getByRole('button', { name: 'Sections', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Last phrase', exact: true })
    .selectOption({ value: '1' });
  await page.getByRole('textbox', { name: 'Section name' }).fill('Intro <img src=x>');
  await page.getByRole('button', { name: 'Create section', exact: true }).click();
  await expect(page.locator('.composer-section-strip')).toContainText('Intro <img src=x>');
  await expect(page.locator('.composer-section-strip img')).toHaveCount(0);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  const result = await page.evaluate(async () => {
    const [c, p, store, format] = await Promise.all([
      import('/src/transport/composer.ts'),
      import('/src/transport/patterns.ts'),
      import('/src/transport/persistence.ts'),
      import('/src/transport/song-format.ts'),
    ]);
    c.setVariationLock(2, true);
    const song = store.collectSongData('Composer QC');
    const encoded = format.encodeSongFile(song);
    const restored = format.normalizeSong(JSON.parse(encoded), true);
    const equal =
      JSON.stringify(restored.sections) === JSON.stringify(song.sections) &&
      JSON.stringify(restored.variationLocks) === JSON.stringify(song.variationLocks);
    const before = JSON.stringify(p.sections);
    let invalid = false;
    try {
      await store.loadSong({
        ...song,
        sections: [{ id: 'bad', name: 'Bad', start: 35, length: 3 }],
      });
    } catch {
      invalid = JSON.stringify(p.sections) === before;
    }
    await store.saveSong();
    return { equal, invalid };
  });
  expect(result).toEqual({ equal: true, invalid: true });
  await page.reload();
  await page.waitForSelector('html[data-ready="true"]');
  await expect(page.locator('.composer-section-strip')).toContainText('Intro <img src=x>');
  await expect(page.locator('#undo-btn')).toBeDisabled();
  expect(
    await page.evaluate(async () => (await import('/src/transport/patterns.ts')).variationLocks[2]),
  ).toBe(true);
  await page.getByRole('button', { name: 'New Song', exact: true }).click();
  await expect(page.locator('.composer-section-strip')).toBeHidden();
  await expect(page.locator('#undo-btn')).toBeDisabled();
});

test('audition renders real audio without saving patterns; Discard cancels sound and Apply commits once', async ({
  page,
}) => {
  await prepare(page);
  const before = await patterns(page);
  await page.evaluate(() => {
    (window as any).auditionStarts = 0;
    (window as any).auditionAlive = 0;
    const original = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      if (this.context instanceof AudioContext) {
        (window as any).auditionStarts++;
        (window as any).auditionAlive++;
        this.addEventListener(
          'ended',
          () => {
            (window as any).auditionAlive--;
          },
          { once: true },
        );
      }
      return original.apply(this, args);
    };
  });
  await page.getByRole('button', { name: 'Vary', exact: true }).click();
  await page.getByRole('button', { name: 'Sparse', exact: true }).click();
  await page.getByRole('button', { name: 'Hear variation', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).auditionStarts)).toBe(1);
  expect(await patterns(page)).toBe(before);
  const saved = await page.evaluate(async () => {
    const [store, song] = await Promise.all([
      import('/src/transport/persistence.ts'),
      import('/src/transport/song.ts'),
    ]);
    return (await store.dbGet<any>('songs', song.currentSongId!)).revision;
  });
  expect(saved).toBe(await page.evaluate(() => (window as any).fixtureRevision));
  await page.getByRole('button', { name: 'Discard variation', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).auditionAlive)).toBe(0);
  expect(await patterns(page)).toBe(before);
  await page.getByRole('button', { name: 'Driving', exact: true }).click();
  await page.getByRole('button', { name: 'Apply variation', exact: true }).click();
  expect(await patterns(page)).not.toBe(before);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('#undo-btn').click();
  expect(await patterns(page)).toBe(before);
});

test('closing while audition renders prevents late audio and leaves the document unchanged', async ({
  page,
}) => {
  await prepare(page);
  const before = await patterns(page);
  await page.evaluate(() => {
    const original = AudioWorklet.prototype.addModule;
    let held = false;
    AudioWorklet.prototype.addModule = async function (...args) {
      if (!held) {
        held = true;
        await new Promise<void>((resolve) => {
          (window as any).releaseRender = resolve;
        });
      }
      return original.apply(this, args);
    };
    (window as any).starts = 0;
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      if (this.context instanceof AudioContext) (window as any).starts++;
      return start.apply(this, args);
    };
  });
  await page.getByRole('button', { name: 'Vary', exact: true }).click();
  await page.getByRole('button', { name: 'Driving', exact: true }).click();
  await page.getByRole('button', { name: 'Hear variation', exact: true }).click();
  await page.waitForFunction(() => typeof (window as any).releaseRender === 'function');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.evaluate(() => (window as any).releaseRender());
  await page.waitForTimeout(250);
  expect(await patterns(page)).toBe(before);
  expect(await page.evaluate(() => (window as any).starts)).toBe(0);
});

test('undo invalidates pending sample decoding so late completion cannot overwrite the restored song', async ({
  page,
}) => {
  await prepare(page);
  await page.locator('#bpm-num').fill('140');
  await page.locator('#bpm-num').press('Tab');
  await page.evaluate(async () => {
    const [song, audio] = await Promise.all([
      import('/src/transport/song.ts'),
      import('/src/engine/audio.ts'),
    ]);
    const context = audio.getAudioContext()!;
    const original = context.decodeAudioData.bind(context);
    context.decodeAudioData = async (...args) => {
      await new Promise<void>((resolve) => {
        (window as any).releaseDecode = resolve;
      });
      return original(...args);
    };
    const data = new DataTransfer();
    data.items.add(new File([song.drumSampleData[0]!.data], 'late.wav', { type: 'audio/wav' }));
    document
      .querySelector('.melody-track[data-type="drum"]')!
      .dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: data }));
  });
  await page.waitForFunction(() => typeof (window as any).releaseDecode === 'function');
  await page.locator('#undo-btn').click();
  await page.evaluate(() => (window as any).releaseDecode());
  await page.waitForTimeout(150);
  await expect(page.locator('#bpm-num')).toHaveValue('120');
  expect(
    await page.evaluate(
      async () => (await import('/src/transport/song.ts')).drumSampleData[0]!.name,
    ),
  ).toBe('fixture.wav');
});

test('composer dialogs remain usable at 390px and Escape dismisses a preview', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page);
  for (const title of ['Edit', 'Sections', 'Vary']) {
    await page.getByRole('button', { name: title, exact: true }).click();
    const size = await page.locator('#composer-dialog').evaluate((element) => ({
      scroll: element.scrollWidth,
      width: element.clientWidth,
      rect: element.getBoundingClientRect().toJSON(),
    }));
    expect(size.scroll).toBeLessThanOrEqual(size.width + 1);
    expect(size.rect.x).toBeGreaterThanOrEqual(0);
    expect(size.rect.right).toBeLessThanOrEqual(390);
    if (title === 'Vary') {
      await page.getByRole('button', { name: 'Sparse', exact: true }).click();
      await expect(
        page.getByRole('button', { name: 'Apply variation', exact: true }),
      ).toBeEnabled();
    }
    await page.keyboard.press('Escape');
    await expect(page.locator('#composer-dialog')).not.toBeVisible();
  }
});

test('audition override produces the same PCM as a committed phrase through the full effect chain', async ({
  page,
}) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const [p, persistence, renderer] = await Promise.all([
      import('/src/transport/patterns.ts'),
      import('/src/transport/persistence.ts'),
      import('/src/transport/render-song.ts'),
    ]);
    const song = persistence.collectSongData('Mix comparison');
    for (let i = 1; i < song.phrases.length; i++) song.phrases[i] = p.makeEmptyPhrase();
    song.extensions['reverb'] = {
      _enabled: true,
      decay: 0.4,
      damping: 0.6,
      mix: 0.2,
      sends: Array(9).fill(0.4),
    };
    song.extensions['delay'] = {
      _enabled: true,
      time: 0.125,
      feedback: 0.25,
      tone: 0.6,
      mix: 0.1,
      sends: Array(9).fill(0.2),
    };
    song.extensions['compressor'] = {
      ...song.extensions['compressor'],
      _enabled: true,
      compress: -12,
      ratio: 2,
    };
    await persistence.loadSong(song);
    const before = JSON.stringify(p.phrases);
    const preview = await renderer.renderSongToBuffer({ phraseOverride: [p.phrases[0]!] });
    const committed = await renderer.renderSongToBuffer();
    let maximum = 0;
    for (let ch = 0; ch < 2; ch++) {
      const a = preview.buffer.getChannelData(ch),
        b = committed.buffer.getChannelData(ch);
      for (let i = 0; i < a.length; i++) maximum = Math.max(maximum, Math.abs(a[i]! - b[i]!));
    }
    return {
      maximum,
      frames: preview.buffer.length === committed.buffer.length,
      unchanged: JSON.stringify(p.phrases) === before,
    };
  });
  expect(result).toMatchObject({ frames: true, unchanged: true });
  // Native compressor rendering can differ by a few float32 ULPs between contexts.
  expect(result.maximum).toBeLessThan(1e-6);
});

test('history retains fifty edits, rejects a partial transaction, and preserves redo snapshots', async ({
  page,
}) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const [h, song] = await Promise.all([
      import('/src/transport/history.ts'),
      import('/src/transport/song.ts'),
    ]);
    const original = song.currentSongName;
    let rolledBack = false;
    try {
      h.editDocument('Failed edit', () => {
        song.setCurrentSongName('Partial');
        throw new Error('Injected failure');
      });
    } catch {
      rolledBack = song.currentSongName === original && !h.getHistoryState().canUndo;
    }
    for (let i = 1; i <= 55; i++)
      h.editDocument('Rename', () => song.setCurrentSongName(`Version ${i}`));
    let undos = 0;
    while (h.undo()) undos++;
    const earliest = song.currentSongName;
    let redos = 0;
    while (h.redo()) redos++;
    return { rolledBack, undos, redos, earliest, latest: song.currentSongName };
  });
  expect(result).toEqual({
    rolledBack: true,
    undos: 50,
    redos: 50,
    earliest: 'Version 5',
    latest: 'Version 55',
  });
});

test('undo in a stale tab never overwrites another tab’s section edit', async ({
  page,
  context,
}) => {
  await prepare(page);
  const other = await context.newPage();
  await other.goto('/');
  await other.waitForSelector('html[data-ready="true"]');
  await page.evaluate(async () => {
    const [c, store] = await Promise.all([
      import('/src/transport/composer.ts'),
      import('/src/transport/persistence.ts'),
    ]);
    c.nameSection(0, 2, 'Remote winner');
    await store.saveSong();
  });
  const result = await other.evaluate(async () => {
    const [c, store, h, song] = await Promise.all([
      import('/src/transport/composer.ts'),
      import('/src/transport/persistence.ts'),
      import('/src/transport/history.ts'),
      import('/src/transport/song.ts'),
    ]);
    c.nameSection(0, 1, 'Local draft');
    let conflicted = false;
    try {
      await store.saveSong();
    } catch (error) {
      conflicted = (error as Error).name === 'SaveConflictError';
    }
    h.undo();
    await store.saveSong();
    const saved = await store.dbGet<any>('songs', song.currentSongId!);
    return { conflicted, names: saved.sections.map((section: any) => section.name) };
  });
  expect(result).toEqual({ conflicted: true, names: ['Remote winner'] });
  await other.close();
});

test('Shift-click keeps its anchor and dialog selections remain selected after closing', async ({
  page,
}) => {
  await prepare(page);
  const slots = page.locator('.phrase-slot');
  await slots.nth(3).click();
  await slots.nth(1).click({ modifiers: ['Shift'] });
  await slots.nth(5).click({ modifiers: ['Shift'] });
  expect(
    await page
      .locator('.phrase-slot.edit-selected')
      .evaluateAll((nodes) => nodes.map((node) => Number((node as HTMLElement).dataset.phrase))),
  ).toEqual([3, 4, 5]);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'First phrase', exact: true })
    .selectOption({ value: '7' });
  await page
    .getByRole('combobox', { name: 'Last phrase', exact: true })
    .selectOption({ value: '9' });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'First phrase', exact: true })).toHaveValue('7');
  await expect(page.getByRole('combobox', { name: 'Last phrase', exact: true })).toHaveValue('9');
  // Start again from a plain click: no prior Shift-selection may be required.
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await slots.nth(0).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Last phrase', exact: true })
    .selectOption({ value: '2' });
  await page
    .getByRole('combobox', { name: 'First phrase', exact: true })
    .selectOption({ value: '1' });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('.phrase-slot.edit-selected')).toHaveCount(2);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'First phrase', exact: true })).toHaveValue('1');
  await expect(page.getByRole('combobox', { name: 'Last phrase', exact: true })).toHaveValue('2');
});

test('a recovery copy starts fresh history and undo cannot return to the original song', async ({
  page,
}) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const [c, store, h, song] = await Promise.all([
      import('/src/transport/composer.ts'),
      import('/src/transport/persistence.ts'),
      import('/src/transport/history.ts'),
      import('/src/transport/song.ts'),
    ]);
    const originalId = song.currentSongId!;
    const original = await store.dbGet<any>('songs', originalId);
    c.nameSection(0, 2, 'Local arrangement');
    await store.saveSongCopy();
    const copyId = song.currentSongId!;
    const fresh = !h.getHistoryState().canUndo && !h.getHistoryState().canRedo;
    c.nameSection(3, 1, 'Copy-only edit');
    h.undo();
    await store.saveSong();
    const copy = await store.dbGet<any>('songs', copyId);
    const originalAfter = await store.dbGet<any>('songs', originalId);
    return {
      fresh,
      separate: originalId !== copyId,
      sameCopy: song.currentSongId === copyId,
      originalIntact: JSON.stringify(original) === JSON.stringify(originalAfter),
      copySections: copy.sections.map((section: any) => section.name),
      noMoreUndo: !h.undo(),
    };
  });
  expect(result).toEqual({
    fresh: true,
    separate: true,
    sameCopy: true,
    originalIntact: true,
    copySections: ['Local arrangement'],
    noMoreUndo: true,
  });
});

test('undo also enforces the retained sample memory limit on redo history', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const [h, song] = await Promise.all([
      import('/src/transport/history.ts'),
      import('/src/transport/song.ts'),
    ]);
    // A real raw sample buffer over the retention budget: never copied or decoded.
    const previous = song.drumSampleData[0];
    h.editDocument('Large replacement', () => {
      song.drumSampleData[0] = { name: 'large.wav', data: new ArrayBuffer(129 * 1024 * 1024) };
    });
    const undone = h.undo();
    return {
      undone,
      restored: song.drumSampleData[0]?.data === previous?.data,
      canRedo: h.getHistoryState().canRedo,
    };
  });
  expect(result).toEqual({ undone: true, restored: true, canRedo: false });
});
