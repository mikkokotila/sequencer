import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readZip, records, field, blocks, events, expectCompleteS2400Project } from './s2400-files';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { preview, type PreviewServer } from 'vite';

let server: PreviewServer;
let documents: string;
async function startPreview(mode: 'browser' | 'local', port: number) {
  const previousMode = process.env.SEQUENCER_DOWNLOAD_MODE;
  const previousDocuments = process.env.SEQUENCER_DOCUMENTS_DIR;
  process.env.SEQUENCER_DOWNLOAD_MODE = mode;
  process.env.SEQUENCER_DOCUMENTS_DIR = documents;
  try {
    return await preview({ root: process.cwd(), logLevel: 'error',
      preview: { host: '127.0.0.1', port, strictPort: true } });
  } finally {
    if (previousMode === undefined) delete process.env.SEQUENCER_DOWNLOAD_MODE;
    else process.env.SEQUENCER_DOWNLOAD_MODE = previousMode;
    if (previousDocuments === undefined) delete process.env.SEQUENCER_DOCUMENTS_DIR;
    else process.env.SEQUENCER_DOCUMENTS_DIR = previousDocuments;
  }
}
test.beforeAll(async () => {
  documents = await mkdtemp(path.join(tmpdir(), 'sequencer-production-documents-'));
  execFileSync('npm', ['run', 'build'], { cwd: process.cwd(), stdio: 'pipe' });
  server = await startPreview('browser', 5177);
});
test.afterAll(async () => {
  if (server) {
    server.httpServer.closeAllConnections();
    await new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
  }
  if (documents) await rm(documents, { recursive: true, force: true });
});

test('production build initializes worklets, plays samples, and downloads sample kits, WAV, MP3 and S2400', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    const w = window as unknown as { __contexts: AudioContext[]; __starts: number[] };
    w.__contexts = [];
    w.__starts = [];
    const Original = window.AudioContext;
    window.AudioContext = class extends Original {
      constructor(...args: ConstructorParameters<typeof AudioContext>) {
        super(...args);
        w.__contexts.push(this);
      }
    };
    const original = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      w.__starts.push(args[0] ?? 0);
      return original.apply(this, args);
    };
  });
  const samples = 4410;
  const wav = Buffer.alloc(44 + samples * 2);
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
  wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    wav.writeInt16LE(Math.round(Math.sin((i * 2 * Math.PI * 220) / 44100) * 1000), 44 + i * 2);
  await page.route(url => url.pathname.endsWith('.wav'), (route) =>
    route.fulfill({ status: 200, contentType: 'audio/wav', body: wav }),
  );
  await page.goto('http://127.0.0.1:5177/');
  await page.waitForSelector('html[data-ready="true"]');
  await expect(page.locator('.ext-icon-btn')).toHaveCount(7);
  await page.locator('.melody-track[data-type="drum"][data-track="0"] .sample-btn').click();
  await page.locator('.browser-item').first().click();
  await page.locator('#browser-load').click();
  await expect(page.locator('#browser-overlay')).not.toHaveClass(/open/);
  await page.locator('#play-btn').click();
  await expect(page.locator('.playing').first()).toBeVisible();
  await page.waitForFunction(
    () => (window as unknown as { __starts: number[] }).__starts.length >= 2,
  );
  await page.locator('#stop-btn').click();
  await expect(page.locator('.playing')).toHaveCount(0);
  expect(
    await page.evaluate(
      () => (window as unknown as { __contexts: AudioContext[] }).__contexts.length,
    ),
  ).toBe(1);
  const kitDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Sample Kit', exact: true }).click();
  const kit = await kitDownload;
  expect(kit.suggestedFilename()).toBe('Untitled-bundle.zip');
  const kitFiles = readZip(await readFile((await kit.path())!));
  expect(kitFiles.size).toBe(1);
  expect([...kitFiles.values()][0]).toEqual(wav); // Original 16-bit source, not rendered audio.
  await expect(page.locator('#kit-export-btn')).toHaveAttribute('title', 'Untitled-bundle.zip downloaded.');
  await page.locator('#export-song-btn').click();
  for (const format of ['wav', 'mp3', 'zip']) {
    const download = page.waitForEvent('download');
    await page.locator(`#export-${format === 'zip' ? 's2400' : format}-btn`).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(new RegExp(`\\.${format}$`));
    const bytes = await readFile((await file.path())!);
    expect(bytes.length).toBeGreaterThan(1000);
    if (format === 'wav') expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
    else if (format === 'mp3') expect(bytes[0]).toBe(0xff);
    else {
      const files = readZip(bytes);
      expectCompleteS2400Project(files);
      const project = records([...files].find(([name]) => name.endsWith('.S24'))![1]);
      expect(field(project, 0)).toBe(0x30003);
      expect(events(blocks(project, 16)[0]!)).toHaveLength(4);
      expect([...files.keys()].filter(name => name.endsWith('.wav'))).toHaveLength(1);
    }
    await expect(page.locator('#song-export-status')).toContainText('downloaded');
  }
  await page.locator('#song-export-close').click();
  expect(errors).toEqual([]);
});

test('production GUI preserves phrase 48 through JSON export/import and freezes its note labels', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('http://127.0.0.1:5177/');
  await page.waitForSelector('html[data-ready="true"]');
  await expect(page.getByRole('combobox', { name: 'Song phrases' })).toHaveValue('36');
  await page.getByRole('combobox', { name: 'Song phrases' }).selectOption('48');
  await page.locator('.phrase-slot[data-phrase="47"]').click();
  const scroll = page.getByRole('region', { name: 'Melody track 3 note grid', exact: true });
  await scroll.evaluate(el => el.scrollIntoView({ block: 'center' }));
  const labels = page.locator('.note-labels').nth(2);
  const before = await labels.boundingBox();
  await scroll.evaluate(el => { el.scrollLeft = el.scrollWidth; });
  expect((await labels.boundingBox())!.x).toBe(before!.x);
  await page.locator('.melody-cell[data-track="2"][data-step="63"][data-note="0"]').click();
  const downloading = page.waitForEvent('download');
  await page.locator('#save-btn').click();
  const file = await downloading;
  const json = JSON.parse(await readFile((await file.path())!, 'utf8'));
  expect(json.phraseCount).toBe(48);
  expect(json.phrases).toHaveLength(48);
  expect(json.phrases[47].melPat[2][63][11]).toBe(true);
  await page.locator('#song-new').click();
  await expect(page.getByRole('combobox', { name: 'Song phrases' })).toHaveValue('36');
  const choosing = page.waitForEvent('filechooser');
  await page.locator('#load-btn').click();
  await (await choosing).setFiles((await file.path())!);
  await expect(page.getByRole('combobox', { name: 'Song phrases' })).toHaveValue('48');
  await expect(page.locator('.phrase-slot.active')).toHaveAttribute('data-phrase', '47');
  await expect(page.locator('.melody-cell[data-track="2"][data-step="63"][data-note="0"]')).toHaveClass(/active/);
});


test('production GUI writes explicit song JSON to the configured Documents/songs folder', async ({ page }) => {
  const local = await startPreview('local', 0);
  try {
    const address = local.httpServer.address();
    if (!address || typeof address === 'string') throw new Error('No production export address');
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.waitForSelector('html[data-ready="true"]');
    await page.locator('#save-btn').click();
    const file = path.join(documents, 'songs', 'Untitled.json');
    await expect(page.locator('#save-btn')).toHaveAttribute('title', `Saved to ${file}`);
    const song = JSON.parse(await readFile(file, 'utf8'));
    expect(song.name).toBe('Untitled');
    expect(song.phrases).toHaveLength(36);
  } finally {
    local.httpServer.closeAllConnections();
    await new Promise<void>(resolve => local.httpServer.close(() => resolve()));
  }
});
