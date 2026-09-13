import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm, open, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { sampleLibraryMiddleware } from '../server/sample-library.mjs';

test('sample read failures, permission errors, and disconnects never terminate the server', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sequencer-library-'));
  await mkdir(path.join(root, 'DRUMS'));
  for (const name of ['ok.wav', 'denied.wav', 'read-error.wav']) {
    await writeFile(path.join(root, 'DRUMS', name), Buffer.from('RIFFsample'));
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
    const denied = await fetch(`${base}/DRUMS/denied.wav`);
    expect(denied.status).toBe(403);
    expect(await denied.text()).toContain('Allow access');
    expect((await fetch(`${base}/%44RUMS/denied.wav`)).status).toBe(403);
    const missing = await fetch(`${base}/DRUMS/missing.wav`);
    expect(missing.status).toBe(404);
    await expect(
      fetch(`${base}/DRUMS/read-error.wav`).then((r) => r.arrayBuffer()),
    ).rejects.toThrow();
    const valid = await fetch(`${base}/DRUMS/ok.wav`);
    expect(valid.status).toBe(200);
    expect(await valid.text()).toBe('RIFFsample');
    const head = await fetch(`${base}/DRUMS/ok.wav`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    expect(await (await fetch(`${base}/`)).text()).toBe('healthy');
    const outside = path.join(root, 'outside.wav');
    await writeFile(outside, 'private');
    await symlink(outside, path.join(root, 'DRUMS', 'escape.wav'));
    expect((await fetch(`${base}/DRUMS/escape.wav`)).status).toBe(403);
    expect((await fetch(`${base}/DRUMS/..%2foutside.wav`)).status).toBe(403);
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
