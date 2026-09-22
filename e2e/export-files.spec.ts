import { test, expect, type Page } from '@playwright/test';
import { createServer, request } from 'node:http';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer as createViteServer, preview, type ViteDevServer } from 'vite';
import { exportFilesMiddleware, exportFilesPlugin } from '../server/export-files.mjs';

const header = { 'X-Sequencer-Export': '1' };

async function serve(options: Record<string, unknown>, clientAddress?: string) {
  const middleware = exportFilesMiddleware(options);
  const server = createServer((req, res) => {
    const incoming = clientAddress ? Object.create(req) : req;
    if (clientAddress) Object.defineProperty(incoming, 'socket', { value: { remoteAddress: clientAddress } });
    middleware(incoming, res, () => { res.writeHead(404); res.end(); });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No local export address');
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}

function upload(base: string, filename: string, body: string, kind = 'song', headers = header) {
  return fetch(`${base}/api/exports?${new URLSearchParams({ filename, kind })}`, {
    method: 'POST', headers, body,
  });
}

test('local file writes reject traversal, external origins, wrong types, oversized data and symlink escape', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sequencer-export-security-'));
  const documents = path.join(root, 'Documents');
  const outside = path.join(root, 'outside');
  await mkdir(outside);
  const server = await serve({ documents, maxBytes: 64 });
  try {
    for (const name of ['../escape.json', 'folder/file.json', 'folder\\file.json', '.hidden.json', 'file.exe'])
      expect((await upload(server.url, name, '{}')).status).toBe(400);
    expect((await upload(server.url, 'valid.json', '{}', 'song', {})).status).toBe(403);
    expect((await upload(server.url, 'valid.json', '{}', 'song', { ...header, Origin: 'https://attacker.invalid' })).status).toBe(403);
    const badHostStatus = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(`${server.url}/api/exports?kind=song&filename=valid.json`, {
        method: 'POST', headers: { ...header, Host: 'attacker.invalid' },
      }, response => { response.resume(); resolve(response.statusCode); });
      req.on('error', reject); req.end('{}');
    });
    expect(badHostStatus).toBe(403);
    const remote = await serve({ documents }, '203.0.113.1');
    try { expect((await upload(remote.url, 'remote.json', '{}')).status).toBe(403); }
    finally { await remote.close(); }
    expect((await upload(server.url, 'valid.json', 'x'.repeat(65))).status).toBe(413);
    expect((await upload(server.url, 'valid.json', '')).status).toBe(400);
    expect((await upload(server.url, 'valid.json', '{}', 'download')).status).toBe(400);
    await expect.poll(() => readdir(path.join(documents, 'songs'))).toEqual([]);
    await rm(path.join(documents, 'songs'), { recursive: true });
    await symlink(outside, path.join(documents, 'songs'));
    expect((await upload(server.url, 'valid.json', '{}')).status).toBe(403);
    expect(await readdir(outside)).toEqual([]);
  } finally { await server.close(); await rm(root, { recursive: true, force: true }); }
});

test('concurrent exports preserve existing files and each publish complete independent contents', async () => {
  const documents = await mkdtemp(path.join(tmpdir(), 'sequencer-export-collision-'));
  const server = await serve({ documents });
  try {
    await mkdir(path.join(documents, 'songs'));
    await writeFile(path.join(documents, 'songs', 'Fête.json'), 'original');
    const responses = await Promise.all(Array.from({ length: 8 }, (_, i) => upload(server.url, 'Fête.json', JSON.stringify({ take: i }))));
    expect(responses.map(r => r.status)).toEqual(Array(8).fill(201));
    const results = await Promise.all(responses.map(r => r.json()));
    expect(new Set(results.map(r => r.filename)).size).toBe(8);
    expect(await readFile(path.join(documents, 'songs', 'Fête.json'), 'utf8')).toBe('original');
    for (const [i, result] of results.entries())
      expect(JSON.parse(await readFile(result.path, 'utf8'))).toEqual({ take: i });
    await expect.poll(async () => (await readdir(path.join(documents, 'songs'))).filter(n => n.endsWith('.tmp'))).toEqual([]);
  } finally { await server.close(); await rm(documents, { recursive: true, force: true }); }
});

test('permission denial and disconnected uploads leave no partial export and allow recovery', async () => {
  const documents = await mkdtemp(path.join(tmpdir(), 'sequencer-export-recovery-'));
  const songs = path.join(documents, 'songs');
  await mkdir(songs);
  const server = await serve({ documents });
  try {
    await chmod(songs, 0o500);
    const denied = await upload(server.url, 'denied.json', '{}');
    expect(denied.status).toBe(403);
    expect((await denied.json()).error).toContain('Allow the sequencer server access');
    await chmod(songs, 0o700);
    const req = request(`${server.url}/api/exports?kind=song&filename=interrupted.json`, {
      method: 'POST', headers: { ...header, 'Content-Length': '10000' },
    });
    req.on('error', () => {});
    req.write('partial');
    await expect.poll(async () => (await readdir(songs)).filter(n => n.endsWith('.tmp')).length).toBe(1);
    req.destroy();
    await expect.poll(() => readdir(songs)).toEqual([]);
    expect((await upload(server.url, 'recovered.json', '{}')).status).toBe(201);
    expect(await readFile(path.join(songs, 'recovered.json'), 'utf8')).toBe('{}');
  } finally {
    await chmod(songs, 0o700);
    await server.close(); await rm(documents, { recursive: true, force: true });
  }
});

test('preview serves the same Documents export route', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sequencer-export-preview-'));
  const documents = path.join(root, 'Documents');
  await mkdir(path.join(root, 'dist'));
  await writeFile(path.join(root, 'dist/index.html'), 'preview');
  const server = await preview({ configFile: false, root, plugins: [exportFilesPlugin({ documents, browserDownloads: false })], preview: { port: 0, host: '127.0.0.1' }, logLevel: 'silent' });
  try {
    const address = server.httpServer.address();
    if (!address || typeof address === 'string') throw new Error('No preview address');
    const response = await upload(`http://127.0.0.1:${address.port}`, 'preview.json', '{}');
    expect(response.status).toBe(201);
    expect(await readFile(path.join(documents, 'songs', 'preview.json'), 'utf8')).toBe('{}');
  } finally {
    server.httpServer.closeAllConnections();
    await new Promise<void>(resolve => server.httpServer.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test.describe('real GUI saves into isolated Documents', () => {
  let root: string;
  let documents: string;
  let server: ViteDevServer;
  let base: string;
  test.beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'sequencer-export-gui-'));
    documents = path.join(root, 'Documents');
    server = await createViteServer({ configFile: false, root: process.cwd(),
      plugins: [exportFilesPlugin({ documents, browserDownloads: false })],
      server: { port: 0, host: '127.0.0.1' }, logLevel: 'silent' });
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === 'string') throw new Error('No GUI server address');
    base = `http://127.0.0.1:${address.port}`;
  });
  test.afterAll(async () => {
    await server?.close();
    if (root) await rm(root, { recursive: true, force: true });
  });

  async function fixture(page: Page, name: string) {
    await page.goto(base);
    await page.waitForSelector('html[data-ready="true"]');
    await page.evaluate(async name => {
      const song = await import('/src/transport/song.ts');
      const p = await import('/src/transport/patterns.ts');
      const audio = await import('/src/engine/audio.ts');
      const wav = await import('/src/transport/wav.ts');
      for (const phrase of p.phrases) {
        phrase.drumPat.forEach(row => row.fill(false));
        phrase.melPat.forEach(track => track.forEach(row => row.fill(false)));
        phrase.vocalPat.fill(false);
      }
      song.setBpm(220); song.setCurrentSongName(name); song.mutedArr.fill(false);
      const buffer = audio.getAudioContext()!.createBuffer(1, 4410, 44100);
      buffer.getChannelData(0).forEach((_, i, data) => { data[i] = Math.sin(i * 0.1) * 0.1; });
      song.drumBuf.fill(null); song.melBuf.fill(null); song.setVocalBuf(null);
      song.drumBuf[0] = buffer;
      song.drumSampleData.fill(null);
      song.drumSampleData[0] = { name: 'fixture.wav', data: wav.audioBufferToWav24(buffer).buffer as ArrayBuffer };
      p.phrases[0]!.drumPat[0]![0] = true;
      p.switchToPhrase(0);
      const store = await import('/src/engine/extensions/store.ts'); store.resetAllExtensions();
    }, name);
  }

  test('editing does not write JSON; explicit export saves embedded samples and uses a numbered retry', async ({ page }) => {
    await fixture(page, 'Location JSON');
    await page.evaluate(async () => {
      const persistence = await import('/src/transport/persistence.ts');
      await persistence.saveSong();
    });
    await expect(readFile(path.join(documents, 'songs', 'Location JSON.json'))).rejects.toThrow();
    const downloads: string[] = []; page.on('download', d => downloads.push(d.suggestedFilename()));
    await page.locator('#save-btn').click();
    await expect(page.locator('#save-btn')).toHaveAttribute('title', `Saved to ${path.join(documents, 'songs', 'Location JSON.json')}`);
    const saved = JSON.parse(await readFile(path.join(documents, 'songs', 'Location JSON.json'), 'utf8'));
    expect(saved.bpm).toBe(220); expect(saved.phrases[0].drumPat[0][0]).toBe(true);
    expect(Buffer.from(saved.drumSampleData[0].data, 'base64').toString('ascii', 0, 4)).toBe('RIFF');
    await page.locator('#save-btn').click();
    await expect(page.locator('#save-btn')).toHaveAttribute('title', /Location JSON \(2\)\.json/);
    expect(JSON.parse(await readFile(path.join(documents, 'songs', 'Location JSON (2).json'), 'utf8')).phrases).toEqual(saved.phrases);
    expect(downloads).toEqual([]);
  });

  for (const format of ['wav', 'mp3', 's2400'] as const) {
    test(`${format} saves an actual audio or project file in Documents`, async ({ page }) => {
      await fixture(page, `Location ${format}`);
      await page.locator('#export-song-btn').click();
      await page.locator(`#export-${format}-btn`).click();
      await expect(page.locator('#song-export-status')).toContainText(`Saved to ${documents}`);
      const files = await readdir(documents);
      const filename = files.find(n => n.startsWith(`Location${format === 's2400' ? '-' : ' '}${format}`))!;
      const bytes = await readFile(path.join(documents, filename));
      if (format === 'wav') { expect(bytes.toString('ascii', 0, 4)).toBe('RIFF'); expect(bytes.readUInt16LE(34)).toBe(24); }
      else if (format === 'mp3') expect(bytes[0]).toBe(0xff);
      else expect(bytes.toString('ascii', 0, 2)).toBe('PK');
    });
  }

  test('loop ZIP saves in Documents', async ({ page }) => {
    await fixture(page, 'Location Loops');
    await page.locator('#export-loops-btn').click();
    await expect(page.locator('#export-loops-btn')).toHaveAttribute('title', `Saved to ${path.join(documents, 'Location Loops-loops.zip')}`);
    expect((await readFile(path.join(documents, 'Location Loops-loops.zip'))).toString('ascii', 0, 2)).toBe('PK');
  });

  test('long Unicode song names remain readable and valid on disk', async ({ page }) => {
    await fixture(page, 'Fête ' + '音'.repeat(90));
    await page.locator('#save-btn').click();
    await expect(page.locator('#save-btn')).toHaveAttribute('title', /Saved to .*Fête/);
    const names = (await readdir(path.join(documents, 'songs'))).filter(n => n.startsWith('Fête'));
    expect(names).toHaveLength(1);
    expect(Buffer.byteLength(names[0]!)).toBeLessThanOrEqual(220);
    expect(JSON.parse(await readFile(path.join(documents, 'songs', names[0]!), 'utf8')).name).toBe('Fête ' + '音'.repeat(90));
  });

  for (const response of [{ status: 404, body: 'missing', contentType: 'text/plain' }, { status: 200, body: '<html>static host</html>', contentType: 'text/html' }]) {
    test(`static host without the export endpoint (${response.status}) retains normal JSON downloads`, async ({ page }) => {
      await fixture(page, `Static ${response.status}`);
      await page.route('**/api/exports', route => route.fulfill(response));
      const pending = page.waitForEvent('download');
      await page.locator('#save-btn').click();
      const file = await pending;
      expect(file.suggestedFilename()).toBe(`Static ${response.status}.json`);
      expect(JSON.parse(await readFile((await file.path())!, 'utf8')).bpm).toBe(220);
    });
  }

  test('cancel while saving prevents file delivery and allows another export', async ({ page }) => {
    await fixture(page, 'Save Cancel');
    let reached!: () => void;
    const requestReached = new Promise<void>(resolve => { reached = resolve; });
    let release!: () => void;
    const released = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/exports?**', async route => {
      reached(); await released; await route.abort().catch(() => {});
    });
    await page.locator('#export-song-btn').click();
    await page.locator('#export-wav-btn').click();
    await requestReached;
    await expect(page.locator('#song-export-status')).toHaveText('Saving export…');
    await page.locator('#song-export-close').click();
    await expect(page.locator('#song-export-status')).toHaveText('Export cancelled.');
    release();
    await page.unroute('**/api/exports?**');
    await expect(readFile(path.join(documents, 'Save Cancel.wav'))).rejects.toThrow();
    await page.locator('#export-wav-btn').click();
    await expect(page.locator('#song-export-status')).toContainText('Saved to');
    expect((await readFile(path.join(documents, 'Save Cancel.wav'))).toString('ascii', 0, 4)).toBe('RIFF');
  });

  test('disk failure stays visible, leaves the song intact and retries after the directory is repaired', async ({ page }) => {
    await fixture(page, 'Location Retry');
    await rm(path.join(documents, 'songs'), { recursive: true, force: true });
    await writeFile(path.join(documents, 'songs'), 'blocked-directory');
    await page.locator('#save-btn').click();
    await expect(page.locator('#persistence-status')).toContainText('Could not save the export');
    expect(await page.evaluate(async () => (await import('/src/transport/song.ts')).currentSongName)).toBe('Location Retry');
    await rm(path.join(documents, 'songs'));
    await page.locator('#persistence-status').getByRole('button', { name: 'Dismiss' }).click();
    await page.locator('#save-btn').click();
    await expect(page.locator('#save-btn')).toHaveAttribute('title', /Saved to .*Location Retry.json/);
    expect(JSON.parse(await readFile(path.join(documents, 'songs', 'Location Retry.json'), 'utf8')).bpm).toBe(220);
  });
});
