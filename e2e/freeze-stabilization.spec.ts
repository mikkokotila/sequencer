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
    const buffer = a.getAudioContext()!.createBuffer(1, 4800, 48000);
    buffer
      .getChannelData(0)
      .forEach((_, i, data) => (data[i] = Math.sin(i * 0.05) * 0.1 * (1 - i / data.length)));
    const sample = { name: 'freeze.wav', data: w.audioBufferToWav24(buffer).buffer };
    const song = store.collectSongData('Freeze QC');
    song.phrases = Array.from({ length: 36 }, () => p.makeEmptyPhrase());
    song.phraseCount = 36;
    song.currentPhrase = 0;
    song.sections = [];
    song.harmonies = [0, 2, 1];
    song.octaves = [3, 3, 3];
    song.variationLocks = Array(9).fill(false);
    song.theory = { root: 0, mode: 'major', locked: false, progression: [1, 5, 6, 4] };
    song.melSampleData.fill(sample);
    song.drumSampleData.fill(sample);
    song.vocalSampleData = sample;
    await store.loadSong(song);
    await store.saveSong();
  });
}

test('generating one bar preserves other bars, phrases, protected tracks and their rendered harmony', async ({
  page,
}) => {
  await ready(page);
  const r = await page.evaluate(async () => {
    const [p, c, h, renderer] = await Promise.all([
      import('/src/transport/patterns.ts'),
      import('/src/transport/composer.ts'),
      import('/src/transport/history.ts'),
      import('/src/transport/render-song.ts'),
    ]);
    h.editDocument('Fixture', () => {
      p.phrases[0]!.melPat[1]![32]![0] = true;
      p.phrases[0]!.melPat[2]![0]![7] = true;
      p.phrases[1]!.melPat[1]![0]![0] = true;
      p.variationLocks[7] = true;
    });
    const source = JSON.stringify(p.phrases);
    const before = await renderer.renderSongToBuffer({ phraseOverride: [p.phrases[1]!] });
    const v = c.previewMusicalVariation(
      { from: 0, to: 0, startStep: 0, endStep: 15, tracks: [6, 7] },
      'driving',
      { seed: 7, roles: ['bass', 'arpeggio', 'melody'], chordSize: 3 },
    );
    const pure = source === JSON.stringify(p.phrases);
    c.applyVariation(v);
    const after = await renderer.renderSongToBuffer({ phraseOverride: [p.phrases[1]!] });
    let difference = 0;
    for (let ch = 0; ch < 2; ch++) {
      const a = before.buffer.getChannelData(ch),
        b = after.buffer.getChannelData(ch);
      for (let i = 0; i < a.length; i++) difference = Math.max(difference, Math.abs(a[i]! - b[i]!));
    }
    const previous = JSON.parse(source);
    const outside =
      JSON.stringify(previous[0].melPat[1].slice(16)) ===
      JSON.stringify(p.phrases[0]!.melPat[1]!.slice(16));
    const protectedSame =
      JSON.stringify(previous[0].melPat[2]) === JSON.stringify(p.phrases[0]!.melPat[2]);
    const untouched = JSON.stringify(previous[1]) === JSON.stringify(p.phrases[1]);
    const scoped =
      p.phrases[0]!.melHarmDisabled?.[1]?.[0] && !p.phrases[0]!.melHarmDisabled?.[1]?.[32];
    h.undo();
    return {
      pure,
      outside,
      protectedSame,
      untouched,
      scoped,
      difference,
      frames: before.buffer.length === after.buffer.length,
      harmonies: [...p.harmonies],
      undoExact: source === JSON.stringify(p.phrases),
    };
  });
  expect(r).toMatchObject({
    pure: true,
    outside: true,
    protectedSame: true,
    untouched: true,
    scoped: true,
    frames: true,
    harmonies: [0, 2, 1],
    undoExact: true,
  });
  expect(r.difference).toBeLessThan(1e-6);
});

test('live, phrase WAV and full-song render agree on step-local harmony', async ({ page }) => {
  await ready(page);
  await page.locator('#play-btn').click();
  await page.locator('#stop-btn').click();
  const r = await page.evaluate(async () => {
    const [p, n, s, renderer, phrase, engine] = await Promise.all([
      import('/src/transport/patterns.ts'),
      import('/src/transport/notes.ts'),
      import('/src/transport/song.ts'),
      import('/src/transport/render-song.ts'),
      import('/src/transport/render.ts'),
      import('/src/engine/scheduler.ts'),
    ]);
    p.setMelStep(1, 0, 0, true);
    n.setHarmonyDisabled(p.phrases[0]!, 1, 0, true);
    p.setMelStep(1, 1, 0, true);
    const start = AudioBufferSourceNode.prototype.start,
      rates: number[] = [];
    AudioBufferSourceNode.prototype.start = function (...args) {
      if (this.buffer === s.melBuf[1]) rates.push(this.playbackRate.value);
      return start.apply(this, args);
    };
    try {
      await renderer.renderSongToBuffer();
      const full = [...rates];
      rates.length = 0;
      await phrase.renderPhraseToBuffer(0);
      const wav = [...rates];
      rates.length = 0;
      engine.startPlayback();
      await new Promise((resolve) => setTimeout(resolve, 250));
      engine.stopPlayback();
      return { full, wav, live: rates.slice(0, 3) };
    } finally {
      AudioBufferSourceNode.prototype.start = start;
      engine.stopPlayback();
    }
  });
  for (const rates of [r.full, r.wav, r.live]) {
    expect(rates).toHaveLength(3);
    expect(rates[0]).toBeCloseTo(4, 6);
    expect(rates[1]).toBeCloseTo(4, 6);
    expect(rates[2]).toBeCloseTo(2 ** (34 / 12), 5);
  }
});

test('step harmony survives portable JSON, saved reload and history, with version-safe validation', async ({
  page,
}) => {
  await ready(page);
  const r = await page.evaluate(async () => {
    const [p, c, f, store, h] = await Promise.all([
      import('/src/transport/patterns.ts'),
      import('/src/transport/composer.ts'),
      import('/src/transport/song-format.ts'),
      import('/src/transport/persistence.ts'),
      import('/src/transport/history.ts'),
    ]);
    const v = c.previewMusicalVariation(
      { from: 0, to: 0, startStep: 0, endStep: 15, tracks: [6] },
      'sparse',
      { seed: 1, roles: ['bass', 'melody', 'melody'], chordSize: 3 },
    );
    c.applyVariation(v);
    // Object key order is not song data; compare every phrase field in a stable order.
    const snapshot = () =>
      JSON.stringify(
        p.phrases.map((phrase) =>
          Object.fromEntries(Object.entries(phrase).sort(([a], [b]) => a.localeCompare(b))),
        ),
      );
    const before = snapshot();
    h.undo();
    const undoEmpty = p.isPhraseEmpty(0);
    h.redo();
    const redoExact = before === snapshot();
    const file = JSON.parse(f.encodeSongFile(store.collectSongData('Roundtrip')));
    const errors = [];
    for (const mutate of [
      (x: any) => (x.phrases[0].melHarmDisabled[1][0] = 'true'),
      (x: any) => (x.phrases[0].melHarmDisabled[0][0] = true),
      (x: any) => x.phrases[0].melHarmDisabled[1].push(false),
    ]) {
      const bad = structuredClone(file);
      mutate(bad);
      try {
        await store.loadSong(bad);
        errors.push(false);
      } catch {
        errors.push(before === snapshot());
      }
    }
    const id = store.collectSongData('id').id;
    await store.loadSong({ ...file, id });
    const roundtrip = before === snapshot();
    await store.saveSong();
    const saved = await store.dbGet<any>('songs', id);
    return {
      version: file.formatVersion,
      savedVersion: saved.formatVersion,
      undoEmpty,
      redoExact,
      roundtrip,
      errors,
      before,
      file,
    };
  });
  expect(r).toMatchObject({
    version: 3,
    savedVersion: 3,
    undoEmpty: true,
    redoExact: true,
    roundtrip: true,
    errors: [true, true, true],
  });
  // Exercise the same portable import a user performs, then reload its saved record.
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#load-btn').click();
  await (
    await chooser
  ).setFiles({
    name: 'written-harmony.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...r.file, name: 'Imported harmony' })),
  });
  await expect(page.locator('#song-name')).toHaveText('Imported harmony');
  await page.evaluate(async () => (await import('/src/transport/persistence.ts')).saveSong());
  await page.reload();
  await page.waitForSelector('html[data-ready="true"]');
  expect(
    await page.evaluate(async () =>
      JSON.stringify(
        (await import('/src/transport/patterns.ts')).phrases.map((phrase) =>
          Object.fromEntries(Object.entries(phrase).sort(([a], [b]) => a.localeCompare(b))),
        ),
      ),
    ),
  ).toBe(r.before);
});

test('copy, nudge, transpose, repeat and sections carry step harmony; clearing and legacy paste remove it', async ({
  page,
}) => {
  await ready(page);
  const r = await page.evaluate(async () => {
    const [p, c, n, h] = await Promise.all([
      import('/src/transport/patterns.ts'),
      import('/src/transport/composer.ts'),
      import('/src/transport/notes.ts'),
      import('/src/transport/history.ts'),
    ]);
    h.editDocument('Written fixture', () => {
      p.setMelStep(1, 0, 0, true);
      n.setHarmonyDisabled(p.phrases[0]!, 1, 0, true);
    });
    const region = { from: 0, to: 0, startStep: 0, endStep: 15, tracks: [6] };
    const clip = c.copyRegion(region);
    c.pasteRegion(clip, 1);
    const paste = n.isHarmonyDisabled(p.phrases[1]!, 1, 0);
    c.nudgeRegion(region, 1);
    const nudge =
      n.isHarmonyDisabled(p.phrases[0]!, 1, 1) && !n.isHarmonyDisabled(p.phrases[0]!, 1, 0);
    c.transposeRegion(region, 1);
    const transpose = n.isHarmonyDisabled(p.phrases[0]!, 1, 1);
    c.repeatRegion(region);
    const repeat = [1, 17, 33, 49].every((step) => n.isHarmonyDisabled(p.phrases[0]!, 1, step));
    p.fillWithPrev(1);
    const fill = JSON.stringify(p.phrases[1]) === JSON.stringify(p.phrases[0]);
    const section = c.nameSection(0, 2, 'Written');
    const copy = c.duplicateSection(section.id);
    const sectionCopy = JSON.stringify(p.phrases[copy.start]) === JSON.stringify(p.phrases[0]);
    c.moveSection(copy.id, 0);
    const moved = n.isHarmonyDisabled(p.phrases[0]!, 1, 1);
    c.clearRegion({ ...region, endStep: 63 });
    const cleared = p.phrases[0]!.melHarmDisabled === undefined;
    h.undo();
    const restored = n.isHarmonyDisabled(p.phrases[0]!, 1, 1);
    const legacy = structuredClone(clip);
    delete legacy.harmonyDisabled;
    c.pasteRegion(legacy, 0);
    const legacyClears =
      !n.isHarmonyDisabled(p.phrases[0]!, 1, 0) && !n.isHarmonyDisabled(p.phrases[0]!, 1, 1);
    const bad = structuredClone(clip);
    bad.harmonyDisabled![0]![0] = 'bad' as any;
    const before = JSON.stringify(p.phrases);
    let rejects = false;
    try {
      c.pasteRegion(bad, 0);
    } catch {
      rejects = before === JSON.stringify(p.phrases);
    }
    return {
      paste,
      nudge,
      transpose,
      repeat,
      fill,
      sectionCopy,
      moved,
      cleared,
      restored,
      legacyClears,
      rejects,
    };
  });
  expect(Object.values(r).every(Boolean)).toBe(true);
});

for (const style of ['sparse', 'driving', 'syncopated', 'answer'] as const)
  test(`${style} rhythm variations preserve the harmony provenance of copied events`, async ({
    page,
  }) => {
    await ready(page);
    const r = await page.evaluate(async (style) => {
      const [p, c, n] = await Promise.all([
        import('/src/transport/patterns.ts'),
        import('/src/transport/composer.ts'),
        import('/src/transport/notes.ts'),
      ]);
      p.setMelStep(1, 0, 0, true);
      n.setHarmonyDisabled(p.phrases[0]!, 1, 0, true);
      p.setMelStep(1, 8, 4, true);
      c.applyVariation(
        c.previewVariation({ from: 0, to: 0, startStep: 0, endStep: 63, tracks: [6] }, style),
      );
      const written: number[] = [],
        manual: number[] = [];
      for (let step = 0; step < 64; step++)
        if (n.melodyNotes(p.phrases[0]!, 1, step).length)
          (n.isHarmonyDisabled(p.phrases[0]!, 1, step) ? written : manual).push(step);
      return { written, manual };
    }, style);
    expect(r).toEqual(
      {
        sparse: { written: [0], manual: [] },
        driving: { written: [0, 2], manual: [8, 10] },
        syncopated: { written: [2], manual: [10] },
        answer: { written: [0, 34], manual: [8, 42] },
      }[style],
    );
  });

async function fakeMidi(page: Page) {
  await page.addInitScript(() => {
    const input = new EventTarget();
    Object.assign(input, { id: 'freeze-midi', name: 'Freeze MIDI', state: 'connected' });
    const access = { inputs: new Map([['freeze-midi', input]]), onstatechange: null };
    Object.defineProperty(navigator, 'requestMIDIAccess', { value: async () => access });
    const q = { input, access, voices: new Set<AudioBufferSourceNode>(), starts: 0 };
    (window as any).freezeMidi = q;
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      q.voices.add(this);
      q.starts++;
      this.addEventListener('ended', () => q.voices.delete(this));
      return start.apply(this, args);
    };
  });
  await ready(page);
  await page.locator('#play-btn').click();
  await page.locator('#stop-btn').click();
  await page.evaluate(async () => {
    const [a, m, s, adsr, h] = await Promise.all([
      import('/src/engine/audio.ts'),
      import('/src/engine/midi.ts'),
      import('/src/transport/song.ts'),
      import('/src/engine/adsr.ts'),
      import('/src/transport/history.ts'),
    ]);
    const ctx = a.getAudioContext()!;
    s.melBuf[1] = ctx.createBuffer(1, ctx.sampleRate * 10, ctx.sampleRate);
    adsr.setAdsrEnabled(6, true);
    adsr.setTrackAdsr(6, { release: 3 });
    h.resetHistory();
    await m.initMidi();
    m.connectMidiToTrack('freeze-midi', 1);
    const q = (window as any).freezeMidi;
    q.send = (status: number, note = 48) => {
      const e = new Event('midimessage');
      (e as any).data = new Uint8Array([status, note, status === 0x90 ? 100 : 0]);
      q.input.dispatchEvent(e);
    };
  });
}

test('key edits and undo retain MIDI devices, stop held/releasing voices, and never duplicate listeners', async ({
  page,
}) => {
  await fakeMidi(page);
  await page.evaluate(() => {
    const q = (window as any).freezeMidi;
    q.send(0x90, 48);
    q.send(0x90, 50);
    q.send(0x80, 50);
  });
  await page.getByRole('combobox', { name: 'Song root', exact: true }).selectOption('6');
  await page.waitForFunction(() => (window as any).freezeMidi.voices.size === 0);
  await page.getByRole('checkbox', { name: 'Scale Lock', exact: true }).check();
  const r = await page.evaluate(async () => {
    const [m, p, c, h] = await Promise.all([
      import('/src/engine/midi.ts'),
      import('/src/transport/patterns.ts'),
      import('/src/transport/composer.ts'),
      import('/src/transport/history.ts'),
    ]);
    const q = (window as any).freezeMidi;
    const binding = m.getMidiTrackBinding(1);
    const checks = [];
    for (const action of [
      () => c.setSongTheory({ ...p.theory, mode: 'dorian' }),
      () => c.clearRegion({ from: 0, to: 0, startStep: 0, endStep: 15, tracks: [6] }),
      () => c.fitSongToScale(),
      () => h.undo(),
      () => h.redo(),
    ]) {
      q.send(0x90, 48);
      action();
      const before = q.starts;
      q.send(0x90, 48);
      await new Promise((resolve) => setTimeout(resolve, 100));
      checks.push(
        m.getMidiTrackBinding(1)?.inputId === 'freeze-midi' &&
          q.starts - before === 1 &&
          q.voices.size === 1,
      );
    }
    m.silenceAllMidi();
    await new Promise((resolve) => setTimeout(resolve, 100));
    return { binding, checks, voices: q.voices.size };
  });
  expect(r.binding?.inputId).toBe('freeze-midi');
  expect(r.checks).toEqual([true, true, true, true, true]);
  expect(r.voices).toBe(0);
});

for (const boundary of ['load', 'unplug'] as const)
  test(`${boundary} still disconnects MIDI and stops release tails`, async ({ page }) => {
    await fakeMidi(page);
    const r = await page.evaluate(async (boundary) => {
      const [m, store] = await Promise.all([
        import('/src/engine/midi.ts'),
        import('/src/transport/persistence.ts'),
      ]);
      const q = (window as any).freezeMidi;
      q.send(0x90);
      q.send(0x80);
      if (boundary === 'load') await store.loadSong(store.collectSongData('Other song'));
      else {
        q.input.state = 'disconnected';
        q.access.onstatechange();
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
      const before = q.starts;
      q.send(0x90);
      return {
        binding: m.getMidiTrackBinding(1),
        voices: q.voices.size,
        listenerRemoved: before === q.starts,
      };
    }, boundary);
    expect(r).toEqual({ binding: null, voices: 0, listenerRemoved: true });
  });

test('both repeat paths retain complete voicings; clearing the last note restores manual harmony', async ({
  page,
}) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const [p, n, ui, state] = await Promise.all([
      import('/src/transport/patterns.ts'),
      import('/src/transport/notes.ts'),
      import('/src/ui/painting.ts'),
      import('/src/state.ts'),
    ]);
    p.setMelStep(1, 0, 0, true);
    n.setHarmonyDisabled(p.phrases[0]!, 1, 0, true);
    p.setMelStep(1, 2, 4, true);
    state.setSelection({ track: 1, start: 0, end: 3 });
    ui.replicateSelection(1);
    const selectionRepeat = Array.from({ length: 16 }, (_, i) => i * 4).every(
      (step) =>
        n.isHarmonyDisabled(p.phrases[0]!, 1, step) &&
        !n.isHarmonyDisabled(p.phrases[0]!, 1, step + 2),
    );
    p.clearMelTrack(1);
    p.setMelStep(1, 0, 0, true);
    n.setHarmonyDisabled(p.phrases[0]!, 1, 0, true);
    p.replicateTrack('melody', 1);
    const trackRepeat = [0, 16, 32, 48].every((step) =>
      n.isHarmonyDisabled(p.phrases[0]!, 1, step),
    );
    p.setMelStep(1, 0, 0, false);
    p.setMelStep(1, 0, 4, true);
    const freshManual = !n.isHarmonyDisabled(p.phrases[0]!, 1, 0);
    p.clearMelTrack(1);
    return {
      selectionRepeat,
      trackRepeat,
      freshManual,
      cleared: p.phrases[0]!.melHarmDisabled === undefined,
    };
  });
  expect(result).toEqual({
    selectionRepeat: true,
    trackRepeat: true,
    freshManual: true,
    cleared: true,
  });
});
