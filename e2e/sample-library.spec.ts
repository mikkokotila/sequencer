import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm, open, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { sampleLibraryMiddleware, sampleLibraryPlugin } from '../server/sample-library.mjs';
import { createServer as createViteServer, preview } from 'vite';

test('sample read failures, permission errors, and disconnects never terminate the server', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sequencer-library-'));
  await mkdir(path.join(root, 'samples', 'drums'), { recursive: true });
  for (const name of ['ok.wav', 'denied.wav', 'read-error.wav']) {
    await writeFile(path.join(root, 'samples', 'drums', name), Buffer.from('RIFFsample'));
  }
  const middleware = sampleLibraryMiddleware(root, async (file: string, flags: string) => {
    if (file.endsWith('denied.wav')) throw Object.assign(new Error('denied'), { code: 'EPERM' });
    if (file.endsWith('read-error.wav'))
      return {
        stat: async () => ({ isFile: () => true, size: 10 }),
        createReadStream: () =>
          new Readable({
            read() {
              this.destroy(new Error('disk disconnected'));
            },
          }),
        close: async () => {},
      };
    return open(file, flags);
  });
  const server = createServer((req, res) =>
    middleware(req, res, () => {
      res.end('healthy');
    }),
  );
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No server address');
    const base = `http://127.0.0.1:${address.port}`;
    const denied = await fetch(`${base}/samples/drums/denied.wav`);
    expect(denied.status).toBe(403);
    expect(await denied.text()).toContain('Allow access');
    expect((await fetch(`${base}/samples/%64rums/denied.wav`)).status).toBe(403);
    const missing = await fetch(`${base}/samples/drums/missing.wav`);
    expect(missing.status).toBe(404);
    await expect(
      fetch(`${base}/samples/drums/read-error.wav`).then((r) => r.arrayBuffer()),
    ).rejects.toThrow();
    const valid = await fetch(`${base}/samples/drums/ok.wav`);
    expect(valid.status).toBe(200);
    expect(await valid.text()).toBe('RIFFsample');
    const head = await fetch(`${base}/samples/drums/ok.wav`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    expect(await (await fetch(`${base}/`)).text()).toBe('healthy');
    const outside = path.join(root, 'outside.wav');
    await writeFile(outside, 'private');
    await symlink(outside, path.join(root, 'samples', 'drums', 'escape.wav'));
    expect((await fetch(`${base}/samples/drums/escape.wav`)).status).toBe(403);
    expect((await fetch(`${base}/samples/drums/..%2foutside.wav`)).status).toBe(403);
    expect((await fetch(`${base}/samples/private.wav`)).status).toBe(404);
    expect((await fetch(`${base}/samples/drums/notes.txt`)).status).toBe(404);
    expect((await fetch(`${base}/samples/DRUMS/ok.wav`)).status).toBe(404);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test('sample access denial gives actionable feedback and permits retry', async ({ page }) => {
  await page.route('**/*.wav', (route) =>
    route.fulfill({ status: 403, body: 'Sample library access denied.' }),
  );
  await page.goto('/');
  await page.waitForSelector('html[data-ready="true"]');
  await page.locator('.melody-track[data-type="drum"][data-track="0"] .sample-btn').click();
  await page.locator('.browser-item').first().click();
  await page.locator('#browser-load').click();
  await expect(page.locator('#browser-load')).toHaveClass(/load-error/);
  await expect(page.locator('#browser-load')).toHaveAttribute(
    'title',
    /Allow access to its folder/,
  );
  await expect(page.locator('#browser-overlay')).toHaveClass(/open/);
  await page.keyboard.press('Escape');
  await page.locator('#play-btn').click();
  await expect(page.locator('.playing').first()).toBeVisible();
  await page.locator('#stop-btn').click();
});

for (const mode of ['dev', 'preview'] as const) {
  test(`${mode} serves package-local drums and nested synths without external library links`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sequencer-local-samples-'));
    const drum = 'samples/drums/01. Individual Hits/01. Bass Drum/Kick.wav';
    const synth = 'samples/synths/Mirage From Mars/Fuzz Bass/Fuzz Bass Mirage C1.wav';
    for (const file of [drum, synth, 'dist/index.html']) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await writeFile(path.join(root, file), file.endsWith('.wav') ? 'RIFFfixture' : 'fixture');
    }
    const config = {
      root,
      configFile: false as const,
      logLevel: 'silent' as const,
      plugins: [sampleLibraryPlugin()],
    };
    const server =
      mode === 'dev'
        ? await createViteServer({ ...config, server: { host: '127.0.0.1', port: 0 } })
        : await preview({ ...config, preview: { host: '127.0.0.1', port: 0 } });
    try {
      if ('listen' in server) await server.listen();
      const address = server.httpServer?.address();
      if (!address || typeof address === 'string') throw new Error('No sample server address');
      for (const file of [drum, synth]) {
        const url = `http://127.0.0.1:${address.port}/${file.split('/').map(encodeURIComponent).join('/')}`;
        const response = await fetch(url);
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('audio/wav');
        expect(await response.text()).toBe('RIFFfixture');
      }
    } finally {
      server.httpServer?.closeAllConnections();
      if ('close' in server) await server.close();
      else await new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  });
}

test('nested library synths display a clean name and load from the tracked local manifest', async ({
  page,
}) => {
  const wav = Buffer.alloc(44 + 882);
  wav.write('RIFF');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(44100, 24);
  wav.writeUInt32LE(88200, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(882, 40);
  const requests: string[] = [];
  await page.route('**/samples/synths/**', (route) => {
    requests.push(decodeURIComponent(new URL(route.request().url()).pathname));
    return route.fulfill({ status: 200, contentType: 'audio/wav', body: wav });
  });
  await page.goto('/');
  await page.waitForSelector('html[data-ready="true"]');
  const sampleButton = page.locator(
    '.melody-track[data-type="melody"][data-track="0"] .sample-btn',
  );
  await sampleButton.click();
  await page.locator('#browser-search').fill('Fuzz Bass Mirage');
  await expect(page.locator('.browser-item-name')).toHaveText(['Fuzz Bass Mirage']);
  await page.locator('.browser-item-name').click();
  await page.locator('#browser-load').click();
  await expect(page.locator('#browser-overlay')).not.toHaveClass(/open/);
  await expect(sampleButton).toHaveAttribute('title', 'Fuzz Bass Mirage.wav');
  expect(requests).toEqual(['/samples/synths/Mirage From Mars/Fuzz Bass/Fuzz Bass Mirage C1.wav']);
});
