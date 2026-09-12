import { test, expect, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';

type Step = { step: number; phrase: number; time: number };
type Probe = {
  contexts: AudioContext[];
  starts: { time: number; at: number }[];
  triggers: Step[];
  frames: {
    step: number;
    phrase: number;
    marker: number;
    expectedStep: number;
    expectedPhrase: number;
    output: number;
    time: number;
    lit: number;
    viewed: number;
  }[];
  onsets: { track: number; time: number }[];
  alive: Set<AudioBufferSourceNode>;
  editTimer?: ReturnType<typeof setInterval>;
  stallTimer?: ReturnType<typeof setInterval>;
  tap?: AudioWorkletNode;
  stoppedAt?: number;
};
declare global {
  interface Window {
    __pressure: Probe;
  }
}

async function prepare(page: Page, bpm: number, dense = false) {
  await page.addInitScript(() => {
    const p: Probe = {
      contexts: [],
      starts: [],
      triggers: [],
      frames: [],
      onsets: [],
      alive: new Set(),
    };
    window.__pressure = p;
    const Original = window.AudioContext;
    window.AudioContext = class extends Original {
      constructor(...args: ConstructorParameters<typeof AudioContext>) {
        super(...args);
        p.contexts.push(this);
      }
    };
    const original = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      p.starts.push({ time: args[0] ?? 0, at: this.context.currentTime });
      p.alive.add(this);
      this.addEventListener('ended', () => p.alive.delete(this), { once: true });
      return original.apply(this, args);
    };
  });
  await page.goto('/');
  await page.waitForSelector('html[data-ready="true"]');
  await page.evaluate(
    async ({ bpm, dense }) => {
      const [audio, song, patterns, events, ui] = await Promise.all([
        import('/src/engine/audio.ts'),
        import('/src/transport/song.ts'),
        import('/src/transport/patterns.ts'),
        import('/src/events.ts'),
        import('/src/ui/build.ts'),
      ]);
      const p = window.__pressure;
      const ctx = audio.getAudioContext()!;
      song.setBpm(bpm);
      for (let i = 0; i < patterns.phrases.length; i++)
        patterns.phrases[i] = patterns.makeEmptyPhrase();
      for (const i of [0, 2]) {
        const phrase = patterns.phrases[i]!;
        phrase.drumPat.forEach((row) => row.fill(true));
        phrase.vocalPat.fill(true);
        phrase.melPat.forEach((track, trackIndex) =>
          track.forEach((step) => {
            step[0] = true;
            if (dense && trackIndex > 0) for (const note of [4, 7, 11]) step[note] = true;
          }),
        );
      }
      patterns.octaves.fill(1);
      const pulse = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.008), ctx.sampleRate);
      pulse.getChannelData(0).fill(0.02);
      song.drumBuf.fill(pulse);
      song.melBuf.fill(pulse);
      song.setVocalBuf(pulse);
      patterns.switchToPhrase(0);
      ui.refreshUI();
      ui.updateSongPane();
      events.on('engine:trigger', (e) => {
        if (e.track === 0) p.triggers.push(e);
      });
      events.on('engine:stop', () => {
        p.stoppedAt = ctx.currentTime;
      });
      events.on('engine:step', (e) => {
        // Read after the synchronous phrase-marker listener has finished.
        queueMicrotask(() => {
          const stamp = ctx.getOutputTimestamp();
          const output =
            (stamp.contextTime ?? 0) + (performance.now() - (stamp.performanceTime ?? 0)) / 1000;
          const expected = [...p.triggers].reverse().find((t) => t.time <= output);
          const slots = [...document.querySelectorAll('.phrase-slot')];
          p.frames.push({
            ...e,
            output,
            marker: slots.findIndex((s) => s.classList.contains('playing-phrase')),
            expectedStep: expected?.step ?? -1,
            expectedPhrase: expected?.phrase ?? -1,
            lit: document.querySelectorAll('.playing').length,
            viewed: slots.findIndex((s) => s.classList.contains('active')),
          });
        });
      });
      const code = `class Probe extends AudioWorkletProcessor {
      constructor(){super();this.high=Array(9).fill(false);}
      process(inputs){const events=[];for(let t=0;t<9;t++){const ch=inputs[t][0];if(!ch)continue;for(let i=0;i<ch.length;i++){const high=Math.abs(ch[i])>.001;if(high&&!this.high[t])events.push({track:t,time:(currentFrame+i)/sampleRate});this.high[t]=high;}}if(events.length)this.port.postMessage(events);return true;}
    } registerProcessor('pressure-probe',Probe);`;
      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      p.tap = new AudioWorkletNode(ctx, 'pressure-probe', {
        numberOfInputs: 9,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      audio.getTrackGains().forEach((gain, i) => gain.connect(p.tap!, 0, i));
      p.tap.connect(ctx.destination);
      p.tap.port.onmessage = (e) => p.onsets.push(...e.data);
    },
    { bpm, dense },
  );
}

async function finish(page: Page) {
  await page.evaluate(() => {
    clearInterval(window.__pressure.editTimer);
    clearInterval(window.__pressure.stallTimer);
  });
  await page.locator('#stop-btn').click();
  await page.waitForTimeout(400);
  const result = await page.evaluate(() => {
    const p = window.__pressure;
    return {
      starts: p.starts,
      stoppedAt: p.stoppedAt,
      triggers: p.triggers,
      frames: p.frames,
      onsets: p.onsets,
      contexts: p.contexts.length,
      alive: p.alive.size,
      lit: document.querySelectorAll('.playing').length,
      marked: document.querySelectorAll('.playing-phrase').length,
      sampleRate: p.contexts[0]!.sampleRate,
    };
  });
  const observations = test.info().outputPath('observations.json');
  writeFileSync(observations, JSON.stringify(result));
  await test.info().attach('observations', { path: observations, contentType: 'application/json' });
  return result;
}

for (const bpm of [40, 120, 220]) {
  test(`phrase markers follow device playback through boundaries at ${bpm} BPM`, async ({
    page,
  }) => {
    test.setTimeout(45000);
    await prepare(page, bpm);
    await page.locator('#play-btn').click();
    await page.evaluate(() => {
      let i = 0;
      window.__pressure.editTimer = setInterval(
        () => (document.querySelectorAll('.phrase-slot')[(i++ * 5) % 12] as HTMLElement).click(),
        157,
      );
    });
    const steps = bpm === 40 ? 67 : bpm === 120 ? 131 : 195;
    await page.waitForFunction((n) => window.__pressure.frames.length >= n, steps, {
      timeout: 35000,
    });
    const result = await finish(page);
    expect(result.contexts).toBe(1);
    expect(result.frames.some((f) => f.phrase === 2)).toBe(true);
    for (const frame of result.frames) {
      expect(frame.marker).toBe(frame.phrase);
      expect(frame.phrase).toBe(frame.expectedPhrase);
      expect(frame.step).toBe(frame.expectedStep);
      expect(frame.time - frame.output).toBeLessThanOrEqual(0.001);
      expect(frame.lit).toBe(frame.viewed === frame.phrase ? 42 : 0);
    }
    expect(result.alive).toBe(0);
    expect(result.lit).toBe(0);
    expect(result.marked).toBe(0);
  });
}

test('dense polyphony and 180ms main-thread stalls preserve real sample alignment and recover to the current audible step', async ({
  page,
}) => {
  test.setTimeout(30000);
  await prepare(page, 220, true);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.locator('#play-btn').click();
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    window.__pressure.stallTimer = setInterval(() => {
      const until = performance.now() + 180;
      while (performance.now() < until) Math.sqrt(performance.now());
    }, 500);
  });
  await page.waitForTimeout(12000);
  const result = await finish(page);
  const observations = test.info().outputPath('pressure-observations.json');
  writeFileSync(observations, JSON.stringify(result));
  await test.info().attach('pressure-observations', {
    path: observations,
    contentType: 'application/json',
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  expect(result.starts.length).toBeGreaterThan(1000);
  expect(result.starts.filter((s) => s.time < s.at).length).toBe(0);
  const first = result.onsets.filter((e) => e.track === 0);
  expect(first.length).toBeGreaterThan(140);
  for (let t = 1; t < 9; t++) {
    const track = result.onsets.filter((e) => e.track === t);
    expect(track.length).toBe(first.length);
    for (let i = 0; i < track.length; i++)
      expect(Math.abs(track[i]!.time - first[i]!.time)).toBeLessThanOrEqual(1 / result.sampleRate);
  }
  // These observations occur only on frames the browser can actually draw.
  // After a blocked frame, obsolete steps must not be replayed onto the UI.
  for (const frame of result.frames) {
    expect(frame.marker).toBe(frame.expectedPhrase);
    expect(frame.step).toBe(frame.expectedStep);
  }
  expect(result.alive).toBe(0);
  expect(result.lit).toBe(0);
  expect(result.marked).toBe(0);
});

test('rapid restarts and tempo edits retain one transport and clear all pending visuals', async ({
  page,
}) => {
  test.setTimeout(30000);
  await prepare(page, 220);
  await page.locator('#play-btn').click();
  await page.evaluate(async () => {
    const tempos = [40, 220, 120, 219, 41];
    for (let i = 0; i < 40; i++) {
      const input = document.querySelector('#bpm-range') as HTMLInputElement;
      input.value = String(tempos[i % tempos.length]);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      (document.querySelector('#stop-btn') as HTMLElement).click();
      (document.querySelector('#play-btn') as HTMLElement).click();
      await new Promise((r) => setTimeout(r, 30 + (i % 5) * 23));
    }
  });
  await page.waitForTimeout(800);
  const result = await finish(page);
  expect(result.contexts).toBe(1);
  expect(result.starts.filter((s) => s.time < s.at).length).toBe(0);
  expect(result.alive).toBe(0);
  expect(result.lit).toBe(0);
  expect(result.marked).toBe(0);
  const after = await page.evaluate(() => window.__pressure.frames.length);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__pressure.frames.length)).toBe(after);
});

test('stop cancels all tracks together when its loop crosses an audio block', async ({ page }) => {
  test.setTimeout(30000);
  await prepare(page, 220);
  await page.locator('#play-btn').click();
  await page.waitForTimeout(500);
  await page.evaluate(async () => {
    const p = window.__pressure;
    const ctx = p.contexts[0]!;
    const original = AudioBufferSourceNode.prototype.stop;
    let delayNext = false;
    AudioBufferSourceNode.prototype.stop = function (...args) {
      const result = original.apply(this, args);
      if (delayNext) {
        delayNext = false;
        // One GC-like interruption during cancellation, not during playback.
        const until = performance.now() + 12;
        while (performance.now() < until) Math.sqrt(performance.now());
      }
      return result;
    };
    try {
      for (let i = 0; i < 12; i++) {
        const next = p.triggers.find((s) => s.time > ctx.currentTime + 0.03)!;
        await new Promise((r) =>
          setTimeout(r, Math.max(0, (next.time - ctx.currentTime - 0.004) * 1000)),
        );
        delayNext = true;
        (document.querySelector('#stop-btn') as HTMLElement).click();
        await new Promise((r) => setTimeout(r, 100));
        (document.querySelector('#play-btn') as HTMLElement).click();
        await new Promise((r) => setTimeout(r, 180));
      }
    } finally {
      AudioBufferSourceNode.prototype.stop = original;
    }
  });
  const result = await finish(page);
  const observations = test.info().outputPath('stop-boundary-observations.json');
  writeFileSync(observations, JSON.stringify(result));
  await test
    .info()
    .attach('stop-boundary-observations', { path: observations, contentType: 'application/json' });
  const first = result.onsets.filter((e) => e.track === 0);
  expect(first.length).toBeGreaterThan(30);
  for (let t = 1; t < 9; t++) {
    const track = result.onsets.filter((e) => e.track === t);
    expect(track.length).toBe(first.length);
    for (let i = 0; i < track.length; i++)
      expect(Math.abs(track[i]!.time - first[i]!.time)).toBeLessThanOrEqual(1 / result.sampleRate);
  }
  expect(result.alive).toBe(0);
});
