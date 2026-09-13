import { test, expect, type Page } from '@playwright/test';

async function probe(page: Page, id: string, scenario: string) {
  await page.goto('/');
  await page.waitForSelector('html[data-ready="true"]');
  await page.locator('#play-btn').click();
  await page.locator('#stop-btn').click();
  return page.evaluate(async ({ id, scenario }) => {
    const ctx = (await import('/src/engine/audio.ts')).getAudioContext()!;
    const factory = await import(`/src/engine/extensions/${id}.ts`);
    const extension = id === 'reverb' ? factory.createReverb() : factory.createDelay();
    const mixBus = ctx.createGain(), masterGain = ctx.createGain();
    const channelFaders = Array.from({ length: 9 }, () => ctx.createGain());
    const channelPans = channelFaders.map(() => ctx.createStereoPanner());
    const stops: Array<() => void> = [];
    const host = { channelFaders, channelPans, mixBus, masterGain, trackCount: 9,
      onStop: (f: () => void) => stops.push(f),
      getTrackInfo: () => ({ name: 'QC', type: 'melody', color: '#888', bright: '#ccc' }), notifyStateChange() {} };
    let wet!: GainNode;
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function(...args: any[]) {
      if (args[0] === mixBus && this instanceof GainNode) wet = this;
      return connect.apply(this, args as any);
    } as any;
    try { extension.init(ctx, host); } finally { AudioNode.prototype.connect = connect; }
    const analyser = ctx.createAnalyser(); analyser.fftSize = 2048;
    mixBus.connect(analyser); const quiet = ctx.createGain(); quiet.gain.value = 0.001;
    analyser.connect(quiet); quiet.connect(ctx.destination);
    const until = async (predicate: () => boolean) => {
      const deadline = performance.now() + 8000;
      while (!predicate()) {
        if (performance.now() > deadline) throw new Error('Audio progress/acknowledgement deadline');
        await new Promise(r => setTimeout(r, 10));
      }
    };
    const advance = async (seconds: number) => { const target = ctx.currentTime + seconds; await until(() => ctx.currentTime >= target); };
    const peak = () => { const data = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(data); return Math.max(...data.map(Math.abs)); };
    try {
      if (scenario === 'disabled') {
        extension.setEnabled(false); extension.setState({ mix: 0.7 });
        const afterState = wet.gain.value;
        extension.setEnabled(true); await until(() => wet.gain.value > 0.69);
        stops[0]!(); extension.setEnabled(false);
        await new Promise(r => setTimeout(r, 750));
        return { afterState, afterTimer: wet.gain.value };
      }
      extension.setState({ decay: 1, damping: 0, time: 0.04, feedback: 0.95, mix: 1, sends: Array(9).fill(0.8) });
      extension.setEnabled(true); await until(() => wet.gain.value === 1);
      if (scenario === 'memory') {
        const source = ctx.createBufferSource(); const buffer = ctx.createBuffer(1, ctx.sampleRate / 10, ctx.sampleRate);
        buffer.getChannelData(0).forEach((_, i, data) => { data[i] = 0.1 * Math.sin(2 * Math.PI * 440 * i / ctx.sampleRate); });
        source.buffer = buffer; source.connect(channelPans[0]!); source.start();
        await advance(0.3); const before = peak();
        extension.setEnabled(false); extension.setEnabled(true);
        await until(() => wet.gain.value === 1); await advance(0.1);
        return { before, after: peak() };
      }
      await advance(0.1); stops[0]!(); await advance(0.05);
      const post = MessagePort.prototype.postMessage; let resets = 0;
      MessagePort.prototype.postMessage = function(message: any, ...args: any[]) {
        if (message?.type === 'reset') resets++;
        return post.call(this, message, ...args as [any]);
      };
      try {
        (await import('/src/events.ts')).emit('engine:start');
        await advance(0.1); const afterStart = resets;
        await new Promise(r => setTimeout(r, 750));
        return { afterStart, afterOldTimer: resets, wet: wet.gain.value };
      } finally { MessagePort.prototype.postMessage = post; }
    } finally { extension.destroy(); quiet.disconnect(); }
  }, { id, scenario });
}

for (const id of ['reverb', 'delay']) {
  test(`${id}: disabled state and stale stop callback cannot restore wet audio`, async ({ page }) => {
    expect(await probe(page, id, 'disabled')).toEqual({ afterState: 0, afterTimer: 0 });
  });
  test(`${id}: disabling clears audible processor memory before re-enable`, async ({ page }) => {
    const result = await probe(page, id, 'memory');
    expect(result.before).toBeGreaterThan(0.00001);
    expect(result.after).toBeLessThan(0.0000001);
  });
  test(`${id}: rapid playback restart cancels delayed stop reset`, async ({ page }) => {
    const result = await probe(page, id, 'restart');
    expect(result.afterStart).toBeGreaterThan(0);
    expect(result.afterOldTimer).toBe(result.afterStart);
    expect(result.wet).toBeGreaterThan(0);
  });
}

test('loading the current song during a queued save does not create a false conflict', async ({ page }) => {
  await page.goto('/'); await page.waitForSelector('html[data-ready="true"]');
  expect(await page.evaluate(async () => {
    const p = await import('/src/transport/persistence.ts');
    const song = await import('/src/transport/song.ts');
    const id = song.currentSongId!;
    song.setBpm(133); const pending = p.saveSong();
    await p.loadSong({ id, name: 'Imported during save', bpm: 188, phrases: [] });
    await pending; await p.saveSong();
    const saved = await p.dbGet<any>('songs', id);
    return { name: saved.name, bpm: saved.bpm };
  })).toEqual({ name: 'Imported during save', bpm: 188 });
  await expect(page.locator('#persistence-status')).toBeHidden();
});
