import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import { exportFilesPlugin } from '../server/export-files.mjs';

let root: string;
let documents: string;
let server: ViteDevServer;
let base: string;
test.beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'sequencer-kit-'));
  documents = path.join(root, 'Documents');
  await mkdir(documents);
  server = await createServer({ configFile: false, root: process.cwd(),
    plugins: [exportFilesPlugin({ documents, browserDownloads: false })],
    server: { port: 0, host: '127.0.0.1' }, logLevel: 'silent' });
  await server.listen();
  const address = server.httpServer!.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server address');
  base = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  await server?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

// Standard-library ZIP extraction independently validates the central directory and every CRC.
function unzip(bytes: Buffer): Record<string, string> {
  return JSON.parse(execFileSync('python3', ['-c', `
import base64, io, json, sys, zipfile
with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as archive:
    assert archive.testzip() is None
    entries = archive.infolist()
    assert len({e.filename for e in entries}) == len(entries)
    assert all(e.flag_bits & 0x800 for e in entries)
    print(json.dumps({e.filename: base64.b64encode(archive.read(e)).decode() for e in entries}))
`], { input: bytes, encoding: 'utf8' }));
}

async function fixture(page: Page, title: string, names = Array.from({ length: 9 }, (_, i) => `sample-${i}.wav`)) {
  await page.goto(base);
  await page.waitForSelector('html[data-ready="true"]');
  return page.evaluate(async ({ title, names }) => {
    const song = await import('/src/transport/song.ts');
    const audio = await import('/src/engine/audio.ts');
    const wav = await import('/src/transport/wav.ts');
    song.setCurrentSongName(title);
    song.drumSampleData.fill(null); song.melSampleData.fill(null); song.setVocalSampleData(null);
    song.mutedArr.fill(true); // Muted and unused samples still belong in a kit.
    const bytes = names.map((name, index) => {
      const buffer = audio.getAudioContext()!.createBuffer(1, 80 + index, 44100);
      buffer.getChannelData(0).fill((index + 1) / 20);
      const data = wav.audioBufferToWav24(buffer).buffer as ArrayBuffer;
      const sample = { name, data };
      if (index < 5) song.drumSampleData[index] = sample;
      else if (index < 8) song.melSampleData[index - 5] = sample;
      else song.setVocalSampleData(sample);
      return Array.from(new Uint8Array(data));
    });
    return bytes;
  }, { title, names });
}

async function save(page: Page, filename: string) {
  await page.getByRole('button', { name: 'Export Sample Kit', exact: true }).click();
  await expect(page.locator('#kit-export-btn')).toHaveAttribute('title', `Saved to ${path.join(documents, filename)}`);
  await expect(page.locator('#kit-export-btn')).toBeEnabled();
  return unzip(await readFile(path.join(documents, filename)));
}

test('GUI saves every original drum, synth and vocal byte in Documents and preserves prior exports', async ({ page }) => {
  const originals = await fixture(page, 'Fête complète');
  const downloads: string[] = []; page.on('download', d => downloads.push(d.suggestedFilename()));
  const files = await save(page, 'Fête complète-bundle.zip');
  expect(Object.keys(files)).toHaveLength(9);
  for (const [i, bytes] of originals.entries())
    expect(Buffer.from(files[`Fête complète-bundle/sample-${i}.wav`]!, 'base64')).toEqual(Buffer.from(bytes));
  const prior = await readFile(path.join(documents, 'Fête complète-bundle.zip'));
  expect(await save(page, 'Fête complète-bundle (2).zip')).toEqual(files);
  expect(await readFile(path.join(documents, 'Fête complète-bundle.zip'))).toEqual(prior);
  expect(downloads).toEqual([]);
});

test('duplicate, case-equivalent, Unicode-equivalent and unsafe names extract without collisions or traversal', async ({ page }) => {
  const names = ['kick.wav', 'kick.wav', 'kick.wav', 'KICK.wav', 'kick_2.wav', '../é.wav', '..\\e\u0301.wav', 'C:\\tmp\\bad<>:?*.wav', '../../'];
  const originals = await fixture(page, '../Nuit:/ fête', names);
  const files = await save(page, 'Nuit fête-bundle.zip');
  const expected = ['kick.wav', 'kick_2.wav', 'kick_3.wav', 'KICK_4.wav', 'kick_2_2.wav', 'é.wav', 'e\u0301_2.wav', 'bad.wav', 'Untitled'];
  expect(Object.keys(files)).toEqual(expected.map(n => `Nuit fête-bundle/${n}`));
  for (const [i, name] of expected.entries())
    expect(Buffer.from(files[`Nuit fête-bundle/${name}`]!, 'base64')).toEqual(Buffer.from(originals[i]!));
});

test('empty kit reports a useful error without any export request and can recover', async ({ page }) => {
  await fixture(page, 'Empty', []);
  const requests: string[] = []; page.on('request', req => { if (req.url().includes('/api/exports')) requests.push(req.url()); });
  await page.locator('#kit-export-btn').click();
  await expect(page.locator('#kit-export-btn')).toHaveAttribute('title', /Load at least one sample/);
  await expect(page.locator('#kit-export-btn')).toBeEnabled();
  expect(requests).toEqual([]);
  await page.evaluate(async () => {
    const song = await import('/src/transport/song.ts');
    song.drumSampleData[0] = { name: 'recovered.wav', data: new Uint8Array([1, 2, 3]).buffer };
  });
  expect(Object.keys(await save(page, 'Empty-bundle.zip'))).toEqual(['Empty-bundle/recovered.wav']);
  await expect(page.locator('#kit-export-btn')).not.toHaveClass(/export-error/);
});

test('failed save reports the server error, writes no ZIP and allows retry', async ({ page }) => {
  await fixture(page, 'Retry');
  await page.route('**/api/exports?**', route => route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Cannot save to Documents. Allow access and retry.' }) }));
  await page.locator('#kit-export-btn').click();
  await expect(page.locator('#kit-export-btn')).toHaveAttribute('title', /Cannot save to Documents/);
  await expect(page.locator('#kit-export-btn')).toBeEnabled();
  expect((await readdir(documents)).filter(n => n.startsWith('Retry'))).toEqual([]);
  await page.unroute('**/api/exports?**');
  expect(Object.keys(await save(page, 'Retry-bundle.zip'))).toHaveLength(9);
  await expect(page.locator('#kit-export-btn')).not.toHaveClass(/export-error/);
});

test('static-host fallback downloads an extractable ZIP with the same samples', async ({ page }) => {
  const originals = await fixture(page, 'Static Kit');
  await page.route('**/api/exports', route => route.fulfill({ status: 404 }));
  const pending = page.waitForEvent('download');
  await page.locator('#kit-export-btn').click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe('Static Kit-bundle.zip');
  const files = unzip(await readFile((await download.path())!));
  expect(Object.values(files).map(b => Buffer.from(b, 'base64'))).toEqual(originals.map(b => Buffer.from(b)));
  await expect(page.locator('#kit-export-btn')).toHaveAttribute('title', 'Static Kit-bundle.zip downloaded.');
});

test('in-flight GUI export prevents duplicate clicks and snapshots names and bytes before edits', async ({ page }) => {
  const originals = await fixture(page, 'Snapshot');
  let release!: () => void;
  const paused = new Promise<void>(resolve => { release = resolve; });
  let reached!: () => void;
  const intercepted = new Promise<void>(resolve => { reached = resolve; });
  await page.route('**/api/exports', async route => { reached(); await paused; await route.continue(); });
  await page.locator('#kit-export-btn').click();
  await intercepted;
  await expect(page.locator('#kit-export-btn')).toBeDisabled();
  await page.evaluate(async () => {
    document.getElementById('kit-export-btn')!.click();
    const song = await import('/src/transport/song.ts');
    song.setCurrentSongName('Changed');
    new Uint8Array(song.drumSampleData[0]!.data).fill(0);
    song.drumSampleData.fill(null); song.melSampleData.fill(null); song.setVocalSampleData(null);
  });
  release();
  await expect(page.locator('#kit-export-btn')).toHaveAttribute('title', `Saved to ${path.join(documents, 'Snapshot-bundle.zip')}`);
  const files = unzip(await readFile(path.join(documents, 'Snapshot-bundle.zip')));
  expect(Object.values(files).map(b => Buffer.from(b, 'base64'))).toEqual(originals.map(b => Buffer.from(b)));
  expect((await readdir(documents)).filter(n => /Snapshot|Changed/.test(n))).toEqual(['Snapshot-bundle.zip']);
});

test('programmatic export returns the actual saved location and rejects empty kits', async ({ page }) => {
  await fixture(page, 'API Kit', ['source.wav']);
  const result = await page.evaluate(async () => (await import('/src/transport/kit-export.ts')).exportKit());
  expect(result).toEqual({ filename: 'API Kit-bundle.zip', path: path.join(documents, 'API Kit-bundle.zip') });
  expect(Object.keys(unzip(await readFile(result.path!)))).toEqual(['API Kit-bundle/source.wav']);
  const error = await page.evaluate(async () => {
    const song = await import('/src/transport/song.ts'); song.drumSampleData.fill(null);
    try { await (await import('/src/transport/kit-export.ts')).exportKit(); return ''; }
    catch (e) { return (e as Error).message; }
  });
  expect(error).toContain('Load at least one sample');
});
