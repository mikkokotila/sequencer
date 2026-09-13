import { chromium } from 'playwright';
import { writeFile, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { preview } from 'vite';
const server = await preview({ root: process.cwd(), logLevel: 'error', preview: { host: '127.0.0.1', port: 5176, strictPort: true } });
const browser = await chromium.launch({ headless: false });
try {
  const page = await browser.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    window.qcSources = 0; window.qcActive = new Set(); window.qcContexts = [];
    const Context = AudioContext;
    window.AudioContext = class extends Context { constructor(...args) { super(...args); window.qcContexts.push(this); } };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function(...args) { window.qcSources++; window.qcActive.add(this); this.addEventListener('ended', () => window.qcActive.delete(this)); return start.apply(this, args); };
  });
  await page.goto('http://127.0.0.1:5176'); await page.waitForSelector('html[data-ready="true"]');
  const sr = 48000, frames = sr / 4, wav = Buffer.alloc(44 + frames * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(sr, 24); wav.writeUInt32LE(sr * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) wav.writeInt16LE(Math.round(2000 * Math.sin(2 * Math.PI * 220 * i / sr)), 44 + i * 2);
  const song = { formatVersion: 1, name: 'Production roundtrip', bpm: 180, phrases: [{ drumPat: [Array(64).fill(true)] }], drumSampleData: [{ name: 'tone.wav', encoding: 'base64', data: wav.toString('base64') }] };
  const chooser = page.waitForEvent('filechooser'); await page.locator('#load-btn').click();
  await (await chooser).setFiles({ name: 'production.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(song)) });
  await page.waitForFunction(() => document.querySelector('#song-name').textContent === 'Production roundtrip');
  await page.locator('#play-btn').click(); await page.waitForFunction(() => window.qcSources >= 10, null, { polling: 50 });
  await page.locator('#stop-btn').click(); await page.waitForFunction(() => window.qcActive.size === 0, null, { polling: 50 });
  const download = page.waitForEvent('download'); await page.locator('#save-btn').click();
  const exported = JSON.parse(await readFile(await (await download).path(), 'utf8'));
  assert.equal(exported.drumSampleData[0].data, wav.toString('base64'));
  await page.reload(); await page.waitForSelector('html[data-ready="true"]');
  assert.equal(await page.locator('#song-name').textContent(), song.name);
  await page.locator('#play-btn').click(); await page.waitForFunction(() => window.qcSources >= 10, null, { polling: 50 }); await page.locator('#stop-btn').click();
  await page.waitForFunction(() => window.qcActive.size === 0, null, { polling: 50 });
  const r = await page.evaluate(() => ({ sourcesAfterReload: window.qcSources, active: window.qcActive.size, audioTime: window.qcContexts[0].currentTime }));
  assert.deepEqual(errors, []); assert.ok(r.audioTime > 0);
  const result = { status: 'PASS', bundle: true, importedAndExportedSampleBytes: wav.length, ...r, errors };
  await writeFile(new URL('production-results.json', import.meta.url), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await browser.close(); server.httpServer.closeAllConnections(); await new Promise(resolve => server.httpServer.close(resolve)); }
