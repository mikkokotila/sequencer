import { test, expect, type Page } from '@playwright/test';

async function ready(page: Page) {
  await page.goto('/');
  await page.waitForSelector('html[data-ready="true"]');
  await page.evaluate(async () => {
    const [p, store, a, w] = await Promise.all([
      import('/src/transport/patterns.ts'),
      import('/src/transport/persistence.ts'),
      import('/src/engine/audio.ts'),
      import('/src/transport/wav.ts'),
    ]);
    const b = a.getAudioContext()!.createBuffer(1, 4800, 48000);
    b.getChannelData(0).forEach(
      (_, i, data) => (data[i] = Math.sin(i * 0.08) * 0.1 * (1 - i / data.length)),
    );
    const sample = { name: 'theory-fixture.wav', data: w.audioBufferToWav24(b).buffer };
    const song = store.collectSongData('Theory QC');
    song.phrases = Array.from({ length: 36 }, () => p.makeEmptyPhrase());
    song.phraseCount = 36;
    song.currentPhrase = 0;
    song.sections = [];
    song.theory = { root: 0, mode: 'major', locked: false, progression: [1, 5, 6, 4] };
    song.variationLocks = Array(9).fill(false);
    song.harmonies = [0, 0, 0];
    song.octaves = [3, 3, 3];
    song.melNames = ['Bass', 'Pad', 'Lead'];
    song.drumSampleData.fill(sample);
    song.melSampleData.fill(sample);
    song.vocalSampleData = sample;
    await store.loadSong(song);
    await store.saveSong();
  });
}
const state = (page: Page) =>
  page.evaluate(async () => JSON.stringify((await import('/src/transport/patterns.ts')).phrases));

test('every root/mode snaps to a nearest allowed pitch; ties descend, including across C/B', async ({
  page,
}) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const t = await import('/src/transport/theory.ts');
    const failures = [];
    for (let root = 0; root < 12; root++)
      for (const mode of Object.keys(t.MODES))
        for (let note = -24; note < 48; note++) {
          const theory = { root, mode: mode as any };
          const actual = t.snapToScale(note, theory);
          const choices = Array.from({ length: 144 }, (_, i) => i - 48)
            .filter((n) => t.inScale(n, theory))
            .sort((a, b) => Math.abs(a - note) - Math.abs(b - note) || a - b);
          if (actual !== choices[0])
            failures.push({ root, mode, note, actual, expected: choices[0] });
        }
    return {
      failures,
      boundary: t.snapToScale(0, { root: 6, mode: 'major' }),
      cSharp: t.snapToScale(1, { root: 0, mode: 'major' }),
      negative: t.snapToScale(-11, { root: 0, mode: 'major' }),
      dorian: t.inScale(9, { root: 0, mode: 'dorian' }),
      minor: t.inScale(9, { root: 0, mode: 'minor' }),
    };
  });
  expect(result).toEqual({
    failures: [],
    boundary: -1,
    cSharp: 0,
    negative: -12,
    dorian: true,
    minor: false,
  });
});

test('diatonic chord names and inversions reflect the chosen mode and conserve motion', async ({
  page,
}) => {
  await ready(page);
  const r = await page.evaluate(async () => {
    const t = await import('/src/transport/theory.ts');
    const key = t.defaultTheory();
    const first = t.voiceChord(t.chordPitches(1, key), [], -5, 18);
    const next = t.voiceChord(t.chordPitches(4, key), first, -5, 18);
    return {
      names: [
        t.chordLabel(1, key, 4),
        t.chordLabel(7, key, 4),
        t.chordLabel(7, { ...key, mode: 'harmonicMinor' }, 4),
      ],
      allScale: next.every((n) => t.inScale(n, key)),
      motion: next.reduce((sum, n, i) => sum + Math.abs(n - first[i]!), 0),
      common: next.filter((n) => first.includes(n)).length,
      phrygian: t.suggestProgression('phrygian', 1),
      independent: t.suggestProgression('dorian', 1) !== t.suggestProgression('dorian', 1),
    };
  });
  expect(r.names).toEqual(['Cmaj7', 'Bm7♭5', 'Bdim7']);
  expect(r.allScale).toBe(true);
  expect(r.motion).toBeLessThanOrEqual(7);
  expect(r.common).toBeGreaterThan(0);
  expect(r.phrygian).toContain(2);
  expect(r.independent).toBe(true);
});

for (const style of ['sparse', 'driving', 'syncopated', 'answer'] as const)
  test(`${style} generation obeys all keys/modes, shared harmony and instrument polyphony`, async ({
    page,
  }) => {
    await ready(page);
    const result = await page.evaluate(async (style) => {
      const t = await import('/src/transport/theory.ts'),
        g = await import('/src/transport/musical-generator.ts');
      const failures = [];
      let events = 0;
      for (let root = 0; root < 12; root++)
        for (const mode of Object.keys(t.MODES))
          for (const role of ['bass', 'melody', 'chords', 'arpeggio'] as const) {
            const key = { ...t.defaultTheory(), root, mode: mode as any };
            const options = {
              seed: 17,
              roles: ['bass', 'chords', 'melody'] as any,
              chordSize: 4 as const,
            };
            const part = g.generatePart(key, role, style, 2, 1, options);
            part.forEach((notes, step) => {
              events += notes.length;
              const chord = t
                .chordPitches(key.progression[Math.floor(step / 16) % 4]!, key, 4)
                .map(t.pitchClass);
              if (notes.some((n) => !t.inScale(n, key))) failures.push('out of key');
              if (role !== 'chords' && notes.length > 1) failures.push('polyphonic single voice');
              if (
                (role === 'chords' || role === 'arpeggio') &&
                notes.some((n) => !chord.includes(t.pitchClass(n)))
              )
                failures.push('wrong chord');
              if (
                role === 'bass' &&
                notes.length &&
                step % 16 === 0 &&
                t.pitchClass(notes[0]!) !== chord[0]
              )
                failures.push('bass anchor');
            });
            if (
              JSON.stringify(part) !==
              JSON.stringify(g.generatePart(key, role, style, 2, 1, options))
            )
              failures.push('not deterministic');
          }
      return { failures, events };
    }, style);
    expect(result.failures).toEqual([]);
    expect(result.events).toBeGreaterThan(1000);
  });

test('ideas differ, motifs repeat, and driving parts are denser than sparse parts', async ({
  page,
}) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const t = await import('/src/transport/theory.ts'),
      g = await import('/src/transport/musical-generator.ts');
    const key = t.defaultTheory();
    const options = { seed: 1, roles: g.DEFAULT_ROLES, chordSize: 3 as const };
    return ['bass', 'melody', 'chords', 'arpeggio'].map((role) => {
      const sparse = g.generatePart(key, role as any, 'sparse', 0, 1, options),
        driving = g.generatePart(key, role as any, 'driving', 0, 1, options);
      return {
        role,
        denser: driving.flat().length > sparse.flat().length,
        repeat:
          JSON.stringify(driving) ===
          JSON.stringify(g.generatePart(key, role as any, 'driving', 1, 1, options)),
        ideas: new Set(
          Array.from({ length: 12 }, (_, i) =>
            JSON.stringify(
              g.generatePart(key, role as any, 'syncopated', 0, 1, { ...options, seed: i + 1 }),
            ),
          ),
        ).size,
      };
    });
  });
  for (const item of result) {
    expect(item.denser).toBe(true);
    expect(item.repeat).toBe(true);
    expect(item.ideas).toBeGreaterThan(1);
  }
});

for (const track of [0, 1, 2])
  test(`Scale Lock painting on synth ${track} snaps below C, stays mono where required, and undoes exactly`, async ({
    page,
  }) => {
    await ready(page);
    await page.getByRole('combobox', { name: 'Song root', exact: true }).selectOption('6');
    await page.getByRole('checkbox', { name: 'Scale Lock', exact: true }).check();
    const before = await state(page);
    await page
      .locator(`.melody-cell[data-track="${track}"][data-step="3"][data-note="11"]`)
      .click();
    const notes = await page.evaluate(
      async (track) => (await import('/src/transport/patterns.ts')).getMelNotes(track, 3),
      track,
    );
    expect(notes).toEqual([-1]);
    await expect(
      page.locator(`.melody-track[data-type="melody"][data-track="${track}"] .pitch-view-range`),
    ).toHaveText('B2–A#3');
    await expect(
      page.locator(`.melody-cell[data-track="${track}"][data-step="3"][data-note="11"]`),
    ).toHaveClass(/active/);
    await page.locator('#undo-btn').click();
    expect(await state(page)).toBe(before);
    await page.locator('#redo-btn').click();
    expect(
      await page.evaluate(
        async (track) => (await import('/src/transport/patterns.ts')).getMelNotes(track, 3),
        track,
      ),
    ).toEqual([-1]);
  });

test('song key, lock, progression and adjacent pitches persist through JSON, reload and undo', async ({
  page,
}) => {
  await ready(page);
  const r = await page.evaluate(async () => {
    const [c, p, store, format, h] = await Promise.all([
      import('/src/transport/composer.ts'),
      import('/src/transport/patterns.ts'),
      import('/src/transport/persistence.ts'),
      import('/src/transport/song-format.ts'),
      import('/src/transport/history.ts'),
    ]);
    c.setSongTheory({ root: 6, mode: 'major', locked: true, progression: [1, 4, 5, 1] });
    h.editDocument('Wide melody', () => {
      p.setMelStep(1, 0, 0, true);
      p.setMelStep(1, 8, 13, true);
    });
    const before = JSON.stringify(p.phrases);
    await store.saveSong();
    const file = JSON.parse(format.encodeSongFile(store.collectSongData('Roundtrip')));
    await store.loadSong({ ...file, id: store.collectSongData('x').id });
    const same = JSON.stringify(p.phrases) === before;
    const restored = { ...p.theory, progression: [...p.theory.progression] };
    await store.saveSong();
    return {
      version: file.formatVersion,
      same,
      restored,
      notes: p.getMelNotes(1, 0),
      upper: p.getMelNotes(1, 8),
    };
  });
  expect(r).toMatchObject({
    version: 2,
    same: true,
    restored: { root: 6, mode: 'major', locked: true, progression: [1, 4, 5, 1] },
    notes: [-1],
    upper: [13],
  });
  await page.reload();
  await page.waitForSelector('html[data-ready="true"]');
  await expect(page.getByRole('checkbox', { name: 'Scale Lock', exact: true })).toBeChecked();
  expect(
    await page.evaluate(async () => (await import('/src/transport/patterns.ts')).getMelNotes(1, 8)),
  ).toEqual([13]);
});

test('scale changes preserve existing notes until Fit; new paste and transpose snap without changing unselected bars', async ({
  page,
}) => {
  await ready(page);
  const r = await page.evaluate(async () => {
    const [p, c, h] = await Promise.all([
      import('/src/transport/patterns.ts'),
      import('/src/transport/composer.ts'),
      import('/src/transport/history.ts'),
    ]);
    h.editDocument('Outside notes', () => {
      p.setMelStep(1, 0, 1, true);
      p.setMelStep(1, 20, 1, true);
    });
    c.setSongTheory({ ...p.theory, locked: true });
    const kept = p.getMelNotes(1, 0)[0] === 1;
    const clip = c.copyRegion({ from: 0, to: 0, startStep: 0, endStep: 15, tracks: [6] });
    c.pasteRegion(clip, 1);
    const pasted = p.phrases[1]!.melPat[1]![0]!.flatMap((hit, n) => (hit ? [n] : []));
    c.transposeRegion({ from: 0, to: 0, startStep: 0, endStep: 15, tracks: [6] }, 1);
    const untouched = p.getMelNotes(1, 20)[0] === 1;
    const beforeFit = JSON.stringify(p.phrases);
    c.fitSongToScale();
    const fitted = p.getMelNotes(1, 20)[0] === 0;
    h.undo();
    return { kept, pasted, untouched, fitted, undo: JSON.stringify(p.phrases) === beforeFit };
  });
  expect(r).toEqual({ kept: true, pasted: [0], untouched: true, fitted: true, undo: true });
});

test('overflow-only parts survive copy, nudge, repeat, section duplication and clear with undo', async ({
  page,
}) => {
  await ready(page);
  const r = await page.evaluate(async () => {
    const [p, c, h, n] = await Promise.all([
      import('/src/transport/patterns.ts'),
      import('/src/transport/composer.ts'),
      import('/src/transport/history.ts'),
      import('/src/transport/notes.ts'),
    ]);
    h.editDocument('Low note', () => p.setMelStep(0, 0, -1, true));
    const original = JSON.stringify(p.phrases);
    const region = { from: 0, to: 0, startStep: 0, endStep: 15, tracks: [5] };
    const nonempty = !p.isPhraseEmpty(0);
    c.nudgeRegion(region, 1);
    const nudged = p.getMelNotes(0, 1);
    h.undo();
    c.repeatRegion(region);
    const repeated = [0, 16, 32, 48].every((step) => p.getMelNotes(0, step)[0] === -1);
    h.undo();
    c.pasteRegion(c.copyRegion(region), 1);
    const copied = n.melodyNotes(p.phrases[1]!, 0, 0);
    h.undo();
    const section = c.nameSection(0, 1, 'Low');
    c.duplicateSection(section.id);
    const duplicated = n.melodyNotes(p.phrases[1]!, 0, 0);
    h.undo();
    h.undo();
    c.clearRegion(region);
    const empty = p.isPhraseEmpty(0);
    h.undo();
    return {
      nonempty,
      nudged,
      repeated,
      copied,
      duplicated,
      empty,
      undo: JSON.stringify(p.phrases) === original,
    };
  });
  expect(r).toEqual({
    nonempty: true,
    nudged: [-1],
    repeated: true,
    copied: [-1],
    duplicated: [-1],
    empty: true,
    undo: true,
  });
});

test('invalid theory, generator inputs, MIDI bounds and overflow files reject atomically', async ({
  page,
}) => {
  await ready(page);
  const r = await page.evaluate(async () => {
    const [p, c, f, store, g] = await Promise.all([
      import('/src/transport/patterns.ts'),
      import('/src/transport/composer.ts'),
      import('/src/transport/song-format.ts'),
      import('/src/transport/persistence.ts'),
      import('/src/transport/musical-generator.ts'),
    ]);
    const before = JSON.stringify(store.collectSongData('x'), (key, value) =>
      key === 'updatedAt' ? undefined : value,
    );
    const errors = [];
    const region = { from: 0, to: 0, startStep: 0, endStep: 63, tracks: [5] };
    for (const operation of [
      () => c.setSongTheory({ ...p.theory, root: 12 }),
      () => c.setSongTheory({ ...p.theory, mode: '__proto__' as any }),
      () => c.setSongTheory({ ...p.theory, progression: [0] }),
      () => c.setSongTheory({ ...p.theory, locked: 'true' as any }),
      () =>
        c.previewMusicalVariation(region, 'driving', {
          seed: NaN,
          roles: g.DEFAULT_ROLES,
          chordSize: 3,
        }),
      () =>
        c.previewMusicalVariation(region, 'driving', {
          seed: 1,
          roles: ['chords', 'chords', 'melody'],
          chordSize: 3,
        }),
      () => p.setMelStep(0, 0, -49, true),
      () => p.setMelStep(0, 0, 80, true),
    ]) {
      try {
        operation();
        errors.push(false);
      } catch {
        errors.push(
          JSON.stringify(store.collectSongData('x'), (key, value) =>
            key === 'updatedAt' ? undefined : value,
          ) === before,
        );
      }
    }
    const file = store.collectSongData('x');
    file.phrases[0]!.melExtra = Array.from({ length: 3 }, () =>
      Array.from({ length: 64 }, () => []),
    );
    file.phrases[0]!.melExtra![0]![0] = [-49];
    let invalidFile = false;
    try {
      f.normalizeSong(file);
    } catch {
      invalidFile = true;
    }
    return { errors, invalidFile };
  });
  expect(r.errors).toEqual(Array(8).fill(true));
  expect(r.invalidFile).toBe(true);
});

test('musical previews preserve protected tracks, reject stale plans and cannot accept forged notes', async ({
  page,
}) => {
  await ready(page);
  const r = await page.evaluate(async () => {
    const [c, p, h, g] = await Promise.all([
      import('/src/transport/composer.ts'),
      import('/src/transport/patterns.ts'),
      import('/src/transport/history.ts'),
      import('/src/transport/musical-generator.ts'),
    ]);
    c.setVariationLock(7, true);
    const before = JSON.stringify(p.phrases),
      region = { from: 0, to: 1, startStep: 0, endStep: 63, tracks: [5, 6, 7] };
    const options = { seed: 13, roles: g.DEFAULT_ROLES, chordSize: 4 as const };
    const candidate = c.previewMusicalVariation(region, 'driving', options);
    const pure = JSON.stringify(p.phrases) === before;
    candidate.result[0]!.melPat[2]![0]![4] = true;
    c.applyVariation(candidate);
    const protectedTrack = p.phrases
      .slice(0, 2)
      .every(
        (phrase) =>
          phrase.melPat[2]!.every((step) => step.every((hit) => !hit)) &&
          !phrase.melExtra?.[2]?.some((step) => step.length),
      );
    h.undo();
    const undo = JSON.stringify(p.phrases) === before;
    const stale = c.previewMusicalVariation(region, 'sparse', options);
    c.setSongTheory({ ...p.theory, root: 2 });
    let rejected = false;
    try {
      c.applyVariation(stale);
    } catch {
      rejected = true;
    }
    return { pure, protectedTrack, undo, rejected };
  });
  expect(r).toEqual({ pure: true, protectedTrack: true, undo: true, rejected: true });
});

test('GUI composes voices, auditions an empty original and candidate, then applies as one undoable edit', async ({
  page,
}) => {
  await ready(page);
  const before = await state(page);
  await page.getByRole('button', { name: 'Vary', exact: true }).click();
  await page.getByRole('button', { name: 'Compose synths', exact: true }).click();
  await page.getByRole('combobox', { name: 'Role for Lead', exact: true }).selectOption('arpeggio');
  await page.getByRole('button', { name: 'Driving', exact: true }).click();
  await expect(page.locator('.composer-preview-summary')).toContainText('notes added');
  expect(await state(page)).toBe(before);
  await page.getByRole('button', { name: 'Hear original', exact: true }).click();
  await expect(page.locator('.composer-status').first()).toContainText(
    /Playing original|Audition finished/,
  );
  await page.getByRole('button', { name: 'Hear variation', exact: true }).click();
  await expect(page.locator('.composer-status').first()).toContainText(
    /Playing variation|Audition finished/,
  );
  expect(await state(page)).toBe(before);
  await page.getByRole('button', { name: 'Apply variation', exact: true }).click();
  expect(await state(page)).not.toBe(before);
  await page
    .getByRole('dialog', { name: 'Controlled variations' })
    .getByRole('button', { name: 'Undo', exact: true })
    .click();
  expect(await state(page)).toBe(before);
});

test('overflow pitch rates agree in live playback, phrase WAV and full-song render', async ({
  page,
}) => {
  await ready(page);
  const rates = await page.evaluate(async () => {
    const [p, a, s, render, full] = await Promise.all([
      import('/src/transport/patterns.ts'),
      import('/src/engine/audio.ts'),
      import('/src/transport/song.ts'),
      import('/src/transport/render.ts'),
      import('/src/transport/render-song.ts'),
    ]);
    p.setMelStep(0, 0, -1, true);
    p.setMelStep(0, 1, 13, true);
    const buffer = s.melBuf[0];
    const start = AudioBufferSourceNode.prototype.start;
    const result: any = { phrase: [], song: [], live: [] };
    let phase = 'phrase';
    AudioBufferSourceNode.prototype.start = function (...args) {
      if (this.buffer === buffer) result[phase].push(this.playbackRate.value);
      return start.apply(this, args);
    };
    await render.renderPhraseToBuffer(0);
    phase = 'song';
    await full.renderSongToBuffer();
    phase = 'live';
    (window as any).pitchRateResult = result;
    (window as any).restoreStart = () => {
      AudioBufferSourceNode.prototype.start = start;
    };
    return result;
  });
  const expected = [2 ** (23 / 12), 2 ** (37 / 12)];
  for (const kind of ['phrase', 'song'])
    expected.forEach((value, i) => expect(rates[kind][i]).toBeCloseTo(value, 5));
  await page.locator('#play-btn').click();
  await expect
    .poll(() => page.evaluate(() => (window as any).pitchRateResult.live.length))
    .toBeGreaterThanOrEqual(2);
  const live = await page.evaluate(() => (window as any).pitchRateResult.live);
  expected.forEach((value, i) => expect(live[i]).toBeCloseTo(value, 5));
  await page.locator('#stop-btn').click();
  await page.evaluate(() => (window as any).restoreStart());
});

test('Follow Playhead defaults off and tracks audible boundaries only when enabled', async ({
  page,
}) => {
  await ready(page);
  await page.evaluate(async () => {
    const p = await import('/src/transport/patterns.ts');
    const s = await import('/src/transport/song.ts');
    p.phrases[0]!.drumPat[0]![0] = true;
    p.phrases[2]!.drumPat[0]![0] = true;
    s.setBpm(220);
  });
  const follow = page.getByRole('checkbox', { name: 'Follow playhead', exact: true });
  await expect(follow).not.toBeChecked();
  await page.locator('.phrase-slot').nth(5).click();
  await page.locator('#play-btn').click();
  await expect
    .poll(() =>
      page.evaluate(async () => (await import('/src/engine/scheduler.ts')).getPlayingPhrase()),
    )
    .toBe(0);
  expect(
    await page.evaluate(async () => (await import('/src/transport/patterns.ts')).currentPhrase),
  ).toBe(5);
  await follow.check();
  expect(
    await page.evaluate(async () => (await import('/src/transport/patterns.ts')).currentPhrase),
  ).toBe(0);
  await expect
    .poll(
      () => page.evaluate(async () => (await import('/src/transport/patterns.ts')).currentPhrase),
      { timeout: 8000 },
    )
    .toBe(2);
  expect(
    await page.evaluate(async () => (await import('/src/engine/scheduler.ts')).getPlayingPhrase()),
  ).toBe(2);
  await follow.uncheck();
  await page.locator('.phrase-slot').nth(5).click();
  await page.waitForTimeout(250);
  expect(
    await page.evaluate(async () => (await import('/src/transport/patterns.ts')).currentPhrase),
  ).toBe(5);
  await page.locator('#stop-btn').click();
  await expect(page.locator('.playing')).toHaveCount(0);
  await follow.check();
  await page.reload();
  await page.waitForSelector('html[data-ready="true"]');
  await expect(follow).toBeChecked();
});

test('following ends a held painting gesture instead of painting the next phrase', async ({
  page,
}) => {
  await ready(page);
  await page.getByRole('checkbox', { name: 'Follow playhead', exact: true }).check();
  const cell = page.locator('.step-cell[data-type="drum"][data-track="0"]').nth(3);
  const box = (await cell.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.evaluate(async () =>
    (await import('/src/events.ts')).emit('engine:step', { step: 0, phrase: 1, time: 0 }),
  );
  await page.mouse.move(box.x + box.width * 3, box.y + box.height / 2);
  await page.mouse.up();
  const result = await page.evaluate(async () => {
    const p = await import('/src/transport/patterns.ts'),
      h = await import('/src/transport/history.ts');
    const nextEmpty = p.isPhraseEmpty(1);
    h.undo();
    return { nextEmpty, originalEmpty: p.isPhraseEmpty(0) };
  });
  expect(result).toEqual({ nextEmpty: true, originalEmpty: true });
});

test('mobile song-theory, pitch view and composition controls remain usable; invalid progression is visible', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  const bad = await page
    .locator('.song-theory-controls')
    .evaluate((element) => element.scrollWidth > element.clientWidth + 1);
  expect(bad).toBe(false);
  await page.getByRole('button', { name: 'Harmony', exact: true }).click();
  await page.getByRole('textbox', { name: 'Progression degrees', exact: true }).fill('1 9 4');
  await page.getByRole('button', { name: 'Use progression', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Song harmony' }).getByRole('status'),
  ).toContainText('1–7');
  await page.getByRole('button', { name: 'New progression', exact: true }).click();
  await expect(page.locator('.theory-chords')).toContainText('1: C');
  await page
    .getByRole('dialog', { name: 'Song harmony' })
    .getByRole('button', { name: 'Close', exact: true })
    .click();
  await page.getByRole('button', { name: 'Vary', exact: true }).click();
  await page.getByRole('button', { name: 'Compose synths', exact: true }).click();
  expect(
    await page
      .getByRole('dialog', { name: 'Controlled variations' })
      .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
  ).toBe(true);
});

test('Scale Lock MIDI preserves ownership when two keys quantize to the same pitch', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const input = new EventTarget();
    Object.assign(input, { id: 'theory-midi', name: 'Theory MIDI', state: 'connected' });
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      value: async () => ({ inputs: new Map([['theory-midi', input]]) }),
    });
    (window as any).theoryMidi = { input, voices: new Set(), rates: [] };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      const q = (window as any).theoryMidi;
      q.voices.add(this);
      q.rates.push(this.playbackRate.value);
      this.addEventListener('ended', () => q.voices.delete(this));
      return start.apply(this, args);
    };
  });
  await ready(page);
  await page.locator('#play-btn').click();
  await page.locator('#stop-btn').click();
  const result = await page.evaluate(async () => {
    const [a, m, s, adsr, c, p] = await Promise.all([
      import('/src/engine/audio.ts'),
      import('/src/engine/midi.ts'),
      import('/src/transport/song.ts'),
      import('/src/engine/adsr.ts'),
      import('/src/transport/composer.ts'),
      import('/src/transport/patterns.ts'),
    ]);
    const ctx = a.getAudioContext()!;
    c.setSongTheory({ ...p.theory, root: 6, locked: true });
    s.melBuf[1] = ctx.createBuffer(1, ctx.sampleRate * 10, ctx.sampleRate);
    adsr.setAdsrEnabled(6, false);
    await m.initMidi();
    m.connectMidiToTrack('theory-midi', 1);
    const q = (window as any).theoryMidi;
    q.rates.length = 0;
    const send = (status: number, pitch: number) => {
      const event = new Event('midimessage');
      (event as any).data = new Uint8Array([status, pitch, status === 0x90 ? 100 : 0]);
      q.input.dispatchEvent(event);
    };
    send(0x90, 48);
    send(0x90, 47);
    const rates = [...q.rates];
    send(0x80, 48);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const remaining = q.voices.size;
    send(0x80, 47);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const ended = q.voices.size;
    send(0x90, 48);
    c.setSongTheory({ ...p.theory, root: 0 });
    await new Promise((resolve) => setTimeout(resolve, 150));
    return { rates, remaining, ended, afterKeyChange: q.voices.size };
  });
  expect(result.rates).toHaveLength(2);
  expect(result.rates[0]).toBeCloseTo(2 ** ((47 - 24) / 12), 5);
  expect(result.rates[1]).toBeCloseTo(result.rates[0], 6);
  expect(result).toMatchObject({ remaining: 1, ended: 0, afterKeyChange: 0 });
});

test('generated preview PCM equals Apply with scoped harmony; track settings remain unchanged', async ({
  page,
}) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const [c, p, h, renderer] = await Promise.all([
      import('/src/transport/composer.ts'),
      import('/src/transport/patterns.ts'),
      import('/src/transport/history.ts'),
      import('/src/transport/render-song.ts'),
    ]);
    p.harmonies.splice(0, 3, 2, 3, 1);
    c.setSongTheory({ root: 6, mode: 'dorian', locked: true, progression: [1, 4, 1, 7] });
    const region = { from: 0, to: 0, startStep: 0, endStep: 63, tracks: [5, 6, 7] };
    const preview = c.previewMusicalVariation(region, 'sparse', {
      seed: 19,
      roles: ['bass', 'chords', 'arpeggio'],
      chordSize: 4,
    });
    const a = await renderer.renderSongToBuffer({
      phraseOverride: preview.result,
    });
    const isolated = p.isPhraseEmpty(0) && p.harmonies.join() === '2,3,1';
    c.applyVariation(preview);
    const b = await renderer.renderSongToBuffer();
    const appliedHarmony = [...p.harmonies];
    let max = 0,
      energy = 0;
    for (let ch = 0; ch < 2; ch++) {
      const x = a.buffer.getChannelData(ch),
        y = b.buffer.getChannelData(ch);
      for (let i = 0; i < x.length; i++) {
        max = Math.max(max, Math.abs(x[i]! - y[i]!));
        energy += x[i]! ** 2;
      }
    }
    h.undo();
    return {
      isolated,
      frames: a.buffer.length === b.buffer.length,
      max,
      energy,
      appliedHarmony,
      restoredHarmony: [...p.harmonies],
      empty: p.isPhraseEmpty(0),
    };
  });
  expect(result).toMatchObject({
    isolated: true,
    frames: true,
    appliedHarmony: [2, 3, 1],
    restoredHarmony: [2, 3, 1],
    empty: true,
  });
  expect(result.max).toBeLessThan(1e-6);
  expect(result.energy).toBeGreaterThan(0.001);
});

test('transpose crosses octaves but rejects MIDI overflow atomically; base-only exports stay version one', async ({
  page,
}) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const [p, c, f, store] = await Promise.all([
      import('/src/transport/patterns.ts'),
      import('/src/transport/composer.ts'),
      import('/src/transport/song-format.ts'),
      import('/src/transport/persistence.ts'),
    ]);
    p.setMelStep(1, 0, 11, true);
    const legacy = JSON.parse(f.encodeSongFile(store.collectSongData('Bounds QC'))).formatVersion;
    const region = { from: 0, to: 0, startStep: 0, endStep: 0, tracks: [6] };
    c.transposeRegion(region, 1);
    const crossed = p.getMelNotes(1, 0);
    p.setMelStep(1, 0, 79, true);
    const before = JSON.stringify(p.phrases);
    let rejected = false;
    try {
      c.transposeRegion(region, 1);
    } catch {
      rejected = true;
    }
    return { legacy, crossed, rejected, unchanged: before === JSON.stringify(p.phrases) };
  });
  expect(result).toEqual({ legacy: 1, crossed: [12], rejected: true, unchanged: true });
});
