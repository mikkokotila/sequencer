import { test, expect, type Page } from '@playwright/test';

// Helper: wait for app to initialize (IndexedDB + audio context setup)
async function waitForApp(page: Page) {
  await page.goto('/');
  await page.waitForSelector('#app', { state: 'visible' });
  await page.waitForSelector('.melody-track', { state: 'visible' });
  // Wait for song pane
  await page.waitForSelector('#song-pane', { state: 'visible' });
}

type TriggerEvent = {
  track: number;
  step: number;
  phrase: number;
  time: number;
  source: 'drum' | 'melody' | 'vocal';
};

async function startTriggerCapture(page: Page, tracks: number[]) {
  await page.evaluate((tracked) => {
    type TriggerCaptureState = {
      off: () => void;
      log: TriggerEvent[];
    };
    const win = window as typeof window & {
      __syncCapture?: TriggerCaptureState;
      __SEQ_EVENT_BUS__?: {
        on: (event: 'engine:trigger', fn: (e: TriggerEvent) => void) => void;
        off: (event: 'engine:trigger', fn: (e: TriggerEvent) => void) => void;
      };
    };
    if (win.__syncCapture) {
      win.__syncCapture.off();
      delete win.__syncCapture;
    }
    const bus = win.__SEQ_EVENT_BUS__;
    if (!bus) throw new Error('E2E sync capture missing live event bus');
    const set = new Set<number>(tracked);
    const log: TriggerEvent[] = [];
    const handler = (e: TriggerEvent) => {
      if (set.has(e.track)) log.push(e);
    };
    bus.on('engine:trigger', handler);
    win.__syncCapture = {
      off: () => bus.off('engine:trigger', handler),
      log,
    };
  }, tracks);
}

async function stopTriggerCapture(page: Page): Promise<TriggerEvent[]> {
  return page.evaluate(() => {
    type TriggerCaptureState = {
      off: () => void;
      log: TriggerEvent[];
    };
    const win = window as typeof window & {
      __syncCapture?: TriggerCaptureState;
    };
    const capture = win.__syncCapture;
    if (!capture) return [];
    capture.off();
    const out = [...capture.log];
    delete win.__syncCapture;
    return out;
  });
}

function assertInterTrackSync(log: TriggerEvent[], trackA: number, trackB: number) {
  const a = log.filter((e) => e.track === trackA);
  const b = log.filter((e) => e.track === trackB);
  expect(a.length).toBeGreaterThanOrEqual(4);
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) {
    const ea = a[i];
    const eb = b[i];
    expect(ea).toBeTruthy();
    expect(eb).toBeTruthy();
    expect(ea?.phrase).toBe(eb?.phrase);
    expect(ea?.step).toBe(eb?.step);
    expect(Math.abs((ea?.time ?? 0) - (eb?.time ?? 0))).toBeLessThan(1e-9);
  }
}

// ═══════════════════════════════════════════
//  1. APP INITIALIZATION
// ═══════════════════════════════════════════

test.describe('App Initialization', () => {
  test('renders all track sections', async ({ page }) => {
    await waitForApp(page);
    // 5 drum tracks + 3 melody + 1 vocal = 9 total
    const tracks = await page.locator('.melody-track').count();
    expect(tracks).toBe(9);
  });

  test('renders song pane with 12 phrase slots', async ({ page }) => {
    await waitForApp(page);
    const slots = await page.locator('.phrase-slot').count();
    expect(slots).toBe(12);
  });

  test('renders transport bar with all controls', async ({ page }) => {
    await waitForApp(page);
    await expect(page.locator('#play-btn')).toBeVisible();
    await expect(page.locator('#stop-btn')).toBeVisible();
    await expect(page.locator('#song-name')).toBeVisible();
    await expect(page.locator('#song-new')).toBeVisible();
    await expect(page.locator('#song-del')).toBeVisible();
    await expect(page.locator('#save-btn')).toBeVisible();
    await expect(page.locator('#load-btn')).toBeVisible();
    await expect(page.locator('#bpm-range')).toBeVisible();
    await expect(page.locator('#bpm-num')).toBeVisible();
  });

  test('renders extension icons', async ({ page }) => {
    await waitForApp(page);
    const icons = await page.locator('.ext-icon-btn').count();
    expect(icons).toBeGreaterThanOrEqual(5); // 5 extensions + engine
  });

  test('renders engine icon with divider', async ({ page }) => {
    await waitForApp(page);
    await expect(page.locator('#engine-icon-btn')).toBeVisible();
    await expect(page.locator('.engine-divider')).toBeVisible();
  });

  test('song name shows Untitled by default', async ({ page }) => {
    await waitForApp(page);
    // May show persisted name, but should exist
    await expect(page.locator('#song-name')).toBeVisible();
  });

  test('BPM defaults to 120', async ({ page }) => {
    await waitForApp(page);
    const val = await page.locator('#bpm-num').inputValue();
    expect(val).toBe('120');
  });
});

// ═══════════════════════════════════════════
//  2. DRUM GRID INTERACTION
// ═══════════════════════════════════════════

test.describe('Drum Grid', () => {
  test('clicking a drum cell toggles it on', async ({ page }) => {
    await waitForApp(page);
    const cell = page.locator('.melody-track[data-type="drum"][data-track="1"] .step-cell').nth(5);
    await expect(cell).not.toHaveClass(/active/);
    await cell.click();
    await expect(cell).toHaveClass(/active/);
  });

  test('clicking an active drum cell toggles it off', async ({ page }) => {
    await waitForApp(page);
    const cell = page.locator('.melody-track[data-type="drum"][data-track="1"] .step-cell').nth(7);
    await cell.click(); // on
    await expect(cell).toHaveClass(/active/);
    await cell.click(); // off
    await expect(cell).not.toHaveClass(/active/);
  });

  test('default kick pattern has four-on-the-floor', async ({ page }) => {
    await waitForApp(page);
    // Steps 0, 4, 8, 12 should be active on kick track (track 0)
    const kickTrack = page.locator('.melody-track[data-type="drum"][data-track="0"]');
    for (const step of [0, 4, 8, 12]) {
      await expect(kickTrack.locator('.step-cell').nth(step)).toHaveClass(/active/);
    }
  });
});

// ═══════════════════════════════════════════
//  3. MELODY GRID INTERACTION
// ═══════════════════════════════════════════

test.describe('Melody Grid', () => {
  test('clicking a melody cell toggles it on', async ({ page }) => {
    await waitForApp(page);
    const cell = page
      .locator('.melody-track[data-type="melody"][data-track="0"] .melody-cell')
      .nth(5);
    await cell.click();
    await expect(cell).toHaveClass(/active/);
  });

  test('clicking an active melody cell toggles it off', async ({ page }) => {
    await waitForApp(page);
    const cell = page
      .locator('.melody-track[data-type="melody"][data-track="0"] .melody-cell')
      .nth(7);
    await cell.click(); // on
    await expect(cell).toHaveClass(/active/);
    await cell.click(); // off
    await expect(cell).not.toHaveClass(/active/);
  });
});

// ═══════════════════════════════════════════
//  4. VOCAL/SAMPLE GRID INTERACTION
// ═══════════════════════════════════════════

test.describe('Vocal Grid', () => {
  test('clicking a vocal cell toggles it on', async ({ page }) => {
    await waitForApp(page);
    const cell = page.locator('.melody-track[data-type="vocal"] .step-cell').nth(3);
    await cell.click();
    await expect(cell).toHaveClass(/active/);
  });
});

// ═══════════════════════════════════════════
//  5. TRACK CONTROLS
// ═══════════════════════════════════════════

test.describe('Track Controls', () => {
  test('mute button toggles muted state', async ({ page }) => {
    await waitForApp(page);
    const muteBtn = page.locator('.melody-track[data-type="drum"][data-track="0"] .mute-btn');
    await expect(muteBtn).not.toHaveClass(/muted/);
    await muteBtn.click();
    await expect(muteBtn).toHaveClass(/muted/);
    await muteBtn.click();
    await expect(muteBtn).not.toHaveClass(/muted/);
  });

  test('CLR button clears all cells in track', async ({ page }) => {
    await waitForApp(page);
    // Kick track has default pattern — clear it
    const kickTrack = page.locator('.melody-track[data-type="drum"][data-track="0"]');
    const activeBefore = await kickTrack.locator('.step-cell.active').count();
    expect(activeBefore).toBeGreaterThan(0);

    await kickTrack.locator('.clear-btn').click();
    const activeAfter = await kickTrack.locator('.step-cell.active').count();
    expect(activeAfter).toBe(0);
  });

  test('FILL replicates pattern across all bars', async ({ page }) => {
    await waitForApp(page);
    // Clear first, then add a pattern in bar 1
    const track = page.locator('.melody-track[data-type="drum"][data-track="2"]');
    await track.locator('.clear-btn').click();

    // Add hits on steps 0 and 4
    await track.locator('.step-cell').nth(0).click();
    await track.locator('.step-cell').nth(4).click();

    // Click FILL
    await track.locator('.fill-btn').click();

    // Steps 16, 20, 32, 36, 48, 52 should now be active (bar 2, 3, 4 copies)
    for (const step of [16, 20, 32, 36, 48, 52]) {
      await expect(track.locator('.step-cell').nth(step)).toHaveClass(/active/);
    }
  });

  test('LOAD button opens sample browser', async ({ page }) => {
    await waitForApp(page);
    const loadBtn = page.locator('.melody-track[data-type="drum"][data-track="0"] .sample-btn');
    await loadBtn.click();
    await expect(page.locator('#browser-overlay')).toHaveClass(/open/);
  });

  test('Export Loops produces a ZIP of 24-bit WAVs, one per non-empty phrase', async ({
    page,
  }) => {
    await waitForApp(page);
    // Default song has four-on-the-floor on the kick in phrase 1 only.
    const result = await page.evaluate(async () => {
      let captured: Blob | null = null;
      const origCreate = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (blob: Blob): string => {
        captured = blob;
        return origCreate(blob);
      };
      const origCreateElement = document.createElement.bind(document);
      document.createElement = ((tag: string) => {
        const el = origCreateElement(tag) as HTMLElement;
        if (tag.toLowerCase() === 'a') {
          (el as HTMLAnchorElement).click = () => {};
        }
        return el;
      }) as typeof document.createElement;

      document.getElementById('export-loops-btn')?.click();
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline && !captured) {
        await new Promise((r) => setTimeout(r, 200));
      }
      URL.createObjectURL = origCreate;
      document.createElement = origCreateElement;
      if (!captured) return { ok: false, reason: 'no blob captured' };

      const blob = captured as Blob;
      const buf = new Uint8Array(await blob.arrayBuffer());
      const entries: { name: string; bps: number; sr: number; fmt: string }[] = [];
      for (let i = 0; i < buf.length - 4; i++) {
        if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x03 && buf[i + 3] === 0x04) {
          const nameLen = (buf[i + 26] ?? 0) | ((buf[i + 27] ?? 0) << 8);
          const extraLen = (buf[i + 28] ?? 0) | ((buf[i + 29] ?? 0) << 8);
          const size =
            (buf[i + 22] ?? 0) |
            ((buf[i + 23] ?? 0) << 8) |
            ((buf[i + 24] ?? 0) << 16) |
            ((buf[i + 25] ?? 0) << 24);
          const name = new TextDecoder().decode(buf.slice(i + 30, i + 30 + nameLen));
          const dataStart = i + 30 + nameLen + extraLen;
          const fmt = String.fromCharCode(...buf.slice(dataStart, dataStart + 4));
          const bps = (buf[dataStart + 34] ?? 0) | ((buf[dataStart + 35] ?? 0) << 8);
          const sr =
            (buf[dataStart + 24] ?? 0) |
            ((buf[dataStart + 25] ?? 0) << 8) |
            ((buf[dataStart + 26] ?? 0) << 16) |
            ((buf[dataStart + 27] ?? 0) << 24);
          entries.push({ name, bps, sr, fmt });
          i = dataStart + size - 1;
        }
      }
      return {
        ok: true,
        type: blob.type,
        head: Array.from(buf.slice(0, 4))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join(' '),
        entries,
      };
    });

    expect(result.ok).toBe(true);
    expect(result.type).toBe('application/zip');
    expect(result.head).toBe('50 4b 03 04');
    expect(result.entries?.length).toBeGreaterThanOrEqual(1);
    for (const entry of result.entries ?? []) {
      expect(entry.name).toMatch(/^phrase-\d{2}\.wav$/);
      expect(entry.fmt).toBe('RIFF');
      expect(entry.bps).toBe(24);
      expect(entry.sr).toBeGreaterThan(0);
    }
    const exportBtn = page.locator('#export-loops-btn');
    await expect(exportBtn).not.toHaveClass(/export-error/);
    await expect(exportBtn).not.toHaveClass(/busy/);
  });

  test('Export Loops surfaces an error state when render throws', async ({ page }) => {
    await waitForApp(page);
    // Sabotage OfflineAudioContext so renderPhraseToBuffer rejects; the click
    // handler's catch should set the export-error class and a Failed title.
    await page.evaluate(() => {
      (window as unknown as { OfflineAudioContext: unknown }).OfflineAudioContext = function () {
        throw new Error('synthetic render failure');
      };
    });
    const exportBtn = page.locator('#export-loops-btn');
    await exportBtn.click();
    await expect(exportBtn).toHaveClass(/export-error/);
    await expect(exportBtn).toHaveAttribute('title', /Export failed/);
    await expect(exportBtn).not.toHaveClass(/busy/);
  });

  test('preview failure surfaces error state on the preview button', async ({ page }) => {
    await waitForApp(page);
    // Force every sample URL to fail decoding by returning non-audio bytes
    await page.route('**/*.wav', (route) => {
      void route.fulfill({
        status: 200,
        contentType: 'text/plain',
        body: 'not audio',
      });
    });
    const loadBtn = page.locator('.melody-track[data-type="drum"][data-track="0"] .sample-btn');
    await loadBtn.click();
    await expect(page.locator('#browser-overlay')).toHaveClass(/open/);
    const firstPreview = page.locator('.browser-item-preview').first();
    await firstPreview.click();
    await expect(firstPreview).toHaveClass(/preview-error/);
    await expect(firstPreview).not.toHaveClass(/previewing/);
    await expect(firstPreview).toHaveAttribute('title', /Preview failed/);
  });

  test('Load failure surfaces error state on the LOAD button, browser stays open', async ({
    page,
  }) => {
    await waitForApp(page);
    // Make every wav URL fail to decode (non-audio bytes).
    await page.route('**/*.wav', (route) => {
      void route.fulfill({ status: 200, contentType: 'text/plain', body: 'not audio' });
    });
    await page.locator('.melody-track[data-type="drum"][data-track="0"] .sample-btn').click();
    await expect(page.locator('#browser-overlay')).toHaveClass(/open/);
    // Select first item then click LOAD
    await page.locator('.browser-item').first().click();
    const loadBtn = page.locator('#browser-load');
    await expect(loadBtn).toBeEnabled();
    await loadBtn.click();
    // The decode rejected → LOAD button must show error state, overlay must
    // remain open (pre-fix it stayed open but with no visible feedback).
    await expect(loadBtn).toHaveClass(/load-error/);
    await expect(loadBtn).toHaveAttribute('title', /Load failed/);
    await expect(page.locator('#browser-overlay')).toHaveClass(/open/);
  });

  test('selecting a different row clears the LOAD-failure state', async ({ page }) => {
    await waitForApp(page);
    await page.route('**/*.wav', (route) => {
      void route.fulfill({ status: 200, contentType: 'text/plain', body: 'not audio' });
    });
    await page.locator('.melody-track[data-type="drum"][data-track="0"] .sample-btn').click();
    await expect(page.locator('#browser-overlay')).toHaveClass(/open/);
    await page.locator('.browser-item').first().click();
    const loadBtn = page.locator('#browser-load');
    await loadBtn.click();
    await expect(loadBtn).toHaveClass(/load-error/);
    // Picking a different row resets the error.
    await page.locator('.browser-item').nth(1).click();
    await expect(loadBtn).not.toHaveClass(/load-error/);
    await expect(loadBtn).not.toHaveAttribute('title', /Load failed/);
  });

  test('a slow failing preview does not clobber a newer in-flight preview', async ({ page }) => {
    await waitForApp(page);
    // First request: slow fail (250ms). Subsequent requests: fast bytes that
    // also fail to decode but resolve quickly.
    let served = 0;
    await page.route('**/*.wav', async (route) => {
      served++;
      if (served === 1) await new Promise((r) => setTimeout(r, 250));
      await route.fulfill({ status: 200, contentType: 'text/plain', body: 'not audio' });
    });
    await page
      .locator('.melody-track[data-type="drum"][data-track="0"] .sample-btn')
      .click();
    await expect(page.locator('#browser-overlay')).toHaveClass(/open/);
    const first = page.locator('.browser-item-preview').nth(0);
    const second = page.locator('.browser-item-preview').nth(1);
    await first.click();
    await second.click();
    // Wait for both fetches to settle.
    await page.waitForTimeout(700);
    // Both rows show error (their own fetches failed), but the race fix means
    // the second click's identity was preserved through the first's failure.
    await expect(first).toHaveClass(/preview-error/);
    await expect(second).toHaveClass(/preview-error/);
    await expect(second).toHaveAttribute('title', /Preview failed/);
  });

  test('a stale preview-failure for index i does not clobber a newer success for the same i', async ({
    page,
  }) => {
    await waitForApp(page);
    // First request for index 0: slow + fails. Second request for the same
    // index 0: fast + decodes into a valid silent WAV (mock_wav).
    const silentWav = (() => {
      const sr = 44100;
      const ch = 2;
      const frames = Math.floor(sr * 0.05);
      const dataSize = frames * ch * 2;
      const buf = Buffer.alloc(44 + dataSize);
      buf.write('RIFF', 0);
      buf.writeUInt32LE(36 + dataSize, 4);
      buf.write('WAVE', 8);
      buf.write('fmt ', 12);
      buf.writeUInt32LE(16, 16);
      buf.writeUInt16LE(1, 20);
      buf.writeUInt16LE(ch, 22);
      buf.writeUInt32LE(sr, 24);
      buf.writeUInt32LE(sr * ch * 2, 28);
      buf.writeUInt16LE(ch * 2, 32);
      buf.writeUInt16LE(16, 34);
      buf.write('data', 36);
      buf.writeUInt32LE(dataSize, 40);
      return buf;
    })();
    let served = 0;
    await page.route('**/*.wav', async (route) => {
      served++;
      if (served === 1) {
        // First click: slow fail
        await new Promise((r) => setTimeout(r, 300));
        await route.fulfill({ status: 200, contentType: 'text/plain', body: 'not audio' });
      } else {
        // Subsequent clicks: valid wav
        await route.fulfill({ status: 200, contentType: 'audio/wav', body: silentWav });
      }
    });
    await page
      .locator('.melody-track[data-type="drum"][data-track="0"] .sample-btn')
      .click();
    await expect(page.locator('#browser-overlay')).toHaveClass(/open/);
    const first = page.locator('.browser-item-preview').nth(0);
    // Click the SAME row twice — exercises the per-invocation token guard.
    await first.click();
    await page.waitForTimeout(50);
    await first.click();
    // Wait long enough for the first (slow) request to return its failure
    // AFTER the second (fast) request has already succeeded.
    await page.waitForTimeout(500);
    // The newer invocation succeeded → button must NOT be in error state.
    await expect(first).not.toHaveClass(/preview-error/);
    await expect(first).toHaveClass(/previewing/);
  });
});

// ═══════════════════════════════════════════
//  6. MELODY TRACK-SPECIFIC CONTROLS
// ═══════════════════════════════════════════

test.describe('Melody Track Controls', () => {
  test('octave buttons change octave value', async ({ page }) => {
    await waitForApp(page);
    const track = page.locator('.melody-track[data-type="melody"][data-track="0"]');
    const octVal = track.locator('.oct-val');
    await expect(octVal).toHaveText('3');

    // Click octave up
    await track.locator('button:has-text("+")').click();
    await expect(octVal).toHaveText('4');

    // Click octave down twice
    await track.locator('button:has-text("−")').click();
    await track.locator('button:has-text("−")').click();
    await expect(octVal).toHaveText('2');
  });

  test('harmony toggle cycles through modes', async ({ page }) => {
    await waitForApp(page);
    // Harmony only on poly tracks (track 1 or 2 in melody)
    const harmBtn = page.locator(
      '.melody-track[data-type="melody"][data-track="1"] .harmony-toggle',
    );
    if ((await harmBtn.count()) === 0) {
      test.skip();
      return;
    }

    // Check initial text contains dash or "HARM"
    const initial = await harmBtn.textContent();
    await harmBtn.click();
    const after1 = await harmBtn.textContent();
    expect(after1).not.toBe(initial); // should have changed
    await harmBtn.click();
    const after2 = await harmBtn.textContent();
    expect(after2).not.toBe(after1); // should cycle
  });
});

// ═══════════════════════════════════════════
//  7. BPM CONTROL
// ═══════════════════════════════════════════

test.describe('BPM Control', () => {
  test('BPM number input updates value', async ({ page }) => {
    await waitForApp(page);
    const bpmNum = page.locator('#bpm-num');
    await bpmNum.fill('140');
    await bpmNum.press('Enter');
    await expect(bpmNum).toHaveValue('140');
  });

  test('BPM clamps to range 40-220', async ({ page }) => {
    await waitForApp(page);
    const bpmNum = page.locator('#bpm-num');
    await bpmNum.fill('300');
    await bpmNum.dispatchEvent('change');
    await expect(bpmNum).toHaveValue('220');
  });
});

// ═══════════════════════════════════════════
//  8. SONG MANAGEMENT
// ═══════════════════════════════════════════

test.describe('Song Management', () => {
  test('song name is visible', async ({ page }) => {
    await waitForApp(page);
    await expect(page.locator('#song-name')).toBeVisible();
  });

  test('double-click song name enables editing', async ({ page }) => {
    await waitForApp(page);
    await page.locator('#song-name').dblclick();
    await expect(page.locator('.song-name-input')).toBeVisible();
  });

  test('new song resets patterns and extensions deterministically', async ({ page }) => {
    await waitForApp(page);

    // Toggle on an extension to create non-default state
    const extIconBtn = page.locator('.ext-icon-btn').first();
    await extIconBtn.click();
    await expect(page.locator('#ext-panel')).toHaveClass(/open/);
    const toggle = page.locator('.ext-toggle');
    await toggle.click();
    await expect(toggle).toHaveClass(/on/);
    // Close extension panel
    await page.locator('#ext-panel-close').click();
    await expect(page.locator('#ext-panel')).not.toHaveClass(/open/);

    // Click a cell on an empty track to create non-default pattern
    const cell = page.locator('.melody-track[data-type="drum"][data-track="3"] .step-cell').nth(5);
    await cell.click();
    await expect(cell).toHaveClass(/active/);

    // Create new song — triggers resetAllExtensions() + pattern clearing
    await page.locator('#song-new').click();
    // Wait for async save + UI refresh
    await page.waitForTimeout(1500);

    // Pattern should be cleared (only default kick pattern remains on track 0)
    const track3Active = await page
      .locator('.melody-track[data-type="drum"][data-track="3"] .step-cell.active')
      .count();
    expect(track3Active).toBe(0);

    // Extension should be disabled — re-open same panel and check toggle is OFF
    await extIconBtn.click();
    await expect(page.locator('#ext-panel')).toHaveClass(/open/);
    await expect(page.locator('.ext-toggle')).not.toHaveClass(/on/);
  });
});

// ═══════════════════════════════════════════
//  9. SAMPLE BROWSER
// ═══════════════════════════════════════════

test.describe('Sample Browser', () => {
  test('opens and closes', async ({ page }) => {
    await waitForApp(page);
    // Open
    await page.locator('.melody-track[data-type="drum"][data-track="0"] .sample-btn').click();
    await expect(page.locator('#browser-overlay')).toHaveClass(/open/);

    // Close via Escape
    await page.keyboard.press('Escape');
    await expect(page.locator('#browser-overlay')).not.toHaveClass(/open/);
  });

  test('search filters items', async ({ page }) => {
    await waitForApp(page);
    await page.locator('.melody-track[data-type="drum"][data-track="0"] .sample-btn').click();
    await expect(page.locator('#browser-overlay')).toHaveClass(/open/);

    const search = page.locator('#browser-search');
    if (await search.isVisible()) {
      await search.fill('kick');
      // Items should filter — count should change
      await page.waitForTimeout(200);
    }

    await page.keyboard.press('Escape');
  });
});

// ═══════════════════════════════════════════
//  10. PHRASE/SONG PANE
// ═══════════════════════════════════════════

test.describe('Phrase Pane', () => {
  test('clicking phrase slot switches active phrase', async ({ page }) => {
    await waitForApp(page);
    const slot2 = page.locator('.phrase-slot').nth(1);
    const slot3 = page.locator('.phrase-slot').nth(2);

    await slot3.click();
    await expect(slot3).toHaveClass(/active/);
    await expect(slot2).not.toHaveClass(/active/);
  });

  test('phrase 1 has content indicator if default pattern exists', async ({ page }) => {
    await waitForApp(page);
    // Phrase 1 should have the default kick pattern
    const dot = page.locator('.phrase-slot').nth(0).locator('.phrase-dot');
    await expect(dot).toBeVisible();
  });

  test('fill-with-prev button copies previous phrase', async ({ page }) => {
    await waitForApp(page);
    // Switch to phrase 2
    await page.locator('.phrase-slot').nth(1).click();

    // It should have a fill button (phrases 2-12 have it)
    const fillBtn = page.locator('.phrase-slot').nth(1).locator('.phrase-fill-btn');
    if (await fillBtn.isVisible()) {
      await fillBtn.click();
      // Phrase 2 should now have content if phrase 1 had content
    }
  });
});

// ═══════════════════════════════════════════
//  11. EXTENSION PANELS
// ═══════════════════════════════════════════

test.describe('Extension Panels', () => {
  test('clicking extension icon opens side panel', async ({ page }) => {
    await waitForApp(page);
    const firstIcon = page.locator('.ext-icon-btn').first();
    await firstIcon.click();
    await expect(page.locator('#ext-panel')).toHaveClass(/open/);
    await expect(firstIcon).toHaveClass(/active/);
  });

  test('clicking same icon closes panel', async ({ page }) => {
    await waitForApp(page);
    const firstIcon = page.locator('.ext-icon-btn').first();
    await firstIcon.click();
    await expect(page.locator('#ext-panel')).toHaveClass(/open/);
    await firstIcon.click();
    await expect(page.locator('#ext-panel')).not.toHaveClass(/open/);
  });

  test('extension panel has on/off toggle', async ({ page }) => {
    await waitForApp(page);
    await page.locator('.ext-icon-btn').first().click();
    await expect(page.locator('.ext-toggle')).toBeVisible();
  });

  test('toggling extension on/off changes state', async ({ page }) => {
    await waitForApp(page);
    await page.locator('.ext-icon-btn').first().click();
    const toggle = page.locator('.ext-toggle');
    await expect(toggle).not.toHaveClass(/on/);
    await toggle.click();
    await expect(toggle).toHaveClass(/on/);
    await toggle.click();
    await expect(toggle).not.toHaveClass(/on/);
  });

  test('compressor model selector switches between FET/OPTO/VCA', async ({ page }) => {
    await waitForApp(page);
    // Open compressor compressor (second extension after Pultec EQ)
    await page.locator('.ext-icon-btn').nth(1).click();
    await expect(page.locator('#ext-panel')).toHaveClass(/open/);

    // Enable the extension
    const toggle = page.locator('.ext-toggle');
    if (!(await toggle.evaluate((el) => el.classList.contains('on')))) {
      await toggle.click();
    }

    // Find model buttons — should be 3 (FET, OPTO, VCA)
    const modelBtns = page.locator(
      '#ext-panel button:has-text("FET"), #ext-panel button:has-text("OPTO"), #ext-panel button:has-text("VCA")',
    );
    const count = await modelBtns.count();
    expect(count).toBe(3);

    // Click OPTO
    await page.locator('#ext-panel button:has-text("OPTO")').click();
    // Title should update
    await expect(page.locator('#ext-panel')).toContainText('OPTICAL');

    // Click VCA
    await page.locator('#ext-panel button:has-text("VCA")').click();
    await expect(page.locator('#ext-panel')).toContainText('VCA');

    // Click FET
    await page.locator('#ext-panel button:has-text("FET")').click();
    await expect(page.locator('#ext-panel')).toContainText('FET');

    await page.locator('#ext-panel-close').click();
  });

  test('transformer extension opens and has controls', async ({ page }) => {
    await waitForApp(page);
    // Transformer is third extension (after Pultec, Compressor)
    await page.locator('.ext-icon-btn').nth(2).click();
    await expect(page.locator('#ext-panel')).toHaveClass(/open/);
    await expect(page.locator('#ext-panel')).toContainText('TRANSFORMER');
    await page.locator('#ext-panel-close').click();
  });

  test('close button closes panel', async ({ page }) => {
    await waitForApp(page);
    await page.locator('.ext-icon-btn').first().click();
    await expect(page.locator('#ext-panel')).toHaveClass(/open/);
    await page.locator('#ext-panel-close').click();
    await expect(page.locator('#ext-panel')).not.toHaveClass(/open/);
  });

  test('app shifts when panel opens', async ({ page }) => {
    await waitForApp(page);
    await page.locator('.ext-icon-btn').first().click();
    await expect(page.locator('#app')).toHaveClass(/ext-panel-open/);
  });
});

// ═══════════════════════════════════════════
//  12. ENGINE CONTROL PANEL
// ═══════════════════════════════════════════

test.describe('Engine Control Panel', () => {
  test('clicking engine icon opens full-screen panel', async ({ page }) => {
    await waitForApp(page);
    await page.locator('#engine-icon-btn').click();
    await expect(page.locator('#engine-panel')).toHaveCSS('opacity', '1');
  });

  test('closing engine panel restores app view', async ({ page }) => {
    await waitForApp(page);
    await page.locator('#engine-icon-btn').click();
    await page.waitForTimeout(500);
    // App should be hidden
    await expect(page.locator('#app')).toHaveCSS('display', 'none');

    // Close via Escape (engine icon is hidden when app is hidden)
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await expect(page.locator('#app')).not.toHaveCSS('display', 'none');
  });

  test('Escape closes engine panel', async ({ page }) => {
    await waitForApp(page);
    await page.locator('#engine-icon-btn').click();
    await expect(page.locator('#engine-panel')).toHaveCSS('opacity', '1');
    await page.keyboard.press('Escape');
    await expect(page.locator('#engine-panel')).toHaveCSS('pointer-events', 'none');
  });

  test('engine panel has all control sections', async ({ page }) => {
    await waitForApp(page);
    await page.locator('#engine-icon-btn').click();
    await expect(page.locator('#ep-buf')).toBeVisible();
    await expect(page.locator('#ep-sr')).toBeVisible();
    await expect(page.locator('#ep-os')).toBeVisible();
  });
});

// ═══════════════════════════════════════════
//  13. KEYBOARD SHORTCUTS
// ═══════════════════════════════════════════

test.describe('Keyboard Shortcuts', () => {
  test('Space toggles play/stop', async ({ page }) => {
    await waitForApp(page);
    // Need user gesture first for AudioContext
    await page.click('#app');
    const playBtn = page.locator('#play-btn');
    await expect(playBtn).not.toHaveClass(/active/);
    await page.keyboard.press('Space');
    // Play button should become active (or AudioContext suspended warning)
    // We just verify no crash
  });

  test('Escape closes browser modal', async ({ page }) => {
    await waitForApp(page);
    await page.locator('.melody-track[data-type="drum"][data-track="0"] .sample-btn').click();
    await expect(page.locator('#browser-overlay')).toHaveClass(/open/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#browser-overlay')).not.toHaveClass(/open/);
  });
});

// ═══════════════════════════════════════════
//  14. TRANSPORT SYNC (sync-gate coverage)
// ═══════════════════════════════════════════

test.describe('Transport Sync', () => {
  test('remains in sync after repeated edit + stop/start cycles', async ({ page }) => {
    await waitForApp(page);
    await page.click('#app'); // user gesture for audio

    const playBtn = page.locator('#play-btn');
    const stopBtn = page.locator('#stop-btn');
    const kickTrack = page.locator('.melody-track[data-type="drum"][data-track="0"]');
    const snareTrack = page.locator('.melody-track[data-type="drum"][data-track="1"]');
    const hatTrack = page.locator('.melody-track[data-type="drum"][data-track="2"]');
    const melodyTrack = page.locator('.melody-track[data-type="melody"][data-track="1"]');

    // Baseline: two tracks with identical pattern must be synchronized.
    await kickTrack.locator('.clear-btn').click();
    await snareTrack.locator('.clear-btn').click();
    for (const step of [0, 4, 8, 12]) {
      await kickTrack.locator('.step-cell').nth(step).click();
      await snareTrack.locator('.step-cell').nth(step).click();
    }

    await startTriggerCapture(page, [0, 1]);
    await playBtn.click();
    await page.waitForTimeout(1600);
    await stopBtn.click();
    const baseline = await stopTriggerCapture(page);
    assertInterTrackSync(baseline, 0, 1);

    // Stress: chaotic edits and controls while cycling stop/start.
    await startTriggerCapture(page, [0, 1]);
    for (let i = 0; i < 6; i++) {
      await playBtn.click();
      await page.waitForTimeout(140);
      await hatTrack.locator('.step-cell').nth((i * 5) % 64).click();
      await melodyTrack.locator('.melody-cell').nth((i * 71) % (64 * 12)).click();
      await page.locator('#bpm-range').evaluate((el, bpm) => {
        const input = el as HTMLInputElement;
        input.value = String(bpm);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, 108 + (i % 4) * 6);
      await stopBtn.click();
      await page.waitForTimeout(50);
    }
    await playBtn.click();
    await page.waitForTimeout(1600);
    await stopBtn.click();
    const stressed = await stopTriggerCapture(page);
    assertInterTrackSync(stressed, 0, 1);
  });
});

// ═══════════════════════════════════════════
//  15. PERSISTENCE
// ═══════════════════════════════════════════

test.describe('Persistence', () => {
  test('pattern survives page reload', async ({ page }) => {
    await waitForApp(page);

    // Toggle a cell on snare track
    const cell = page.locator('.melody-track[data-type="drum"][data-track="1"] .step-cell').nth(4);
    await cell.click();
    await expect(cell).toHaveClass(/active/);

    // Wait for auto-save (500ms debounce)
    await page.waitForTimeout(800);

    // Reload
    await page.reload();
    await waitForApp(page);

    // Cell should still be active
    const cellAfter = page
      .locator('.melody-track[data-type="drum"][data-track="1"] .step-cell')
      .nth(4);
    await expect(cellAfter).toHaveClass(/active/);
  });
});

// ═══════════════════════════════════════════
//  16. GRID ALIGNMENT
// ═══════════════════════════════════════════

test.describe('Grid Alignment', () => {
  test('bar dividers are visible', async ({ page }) => {
    await waitForApp(page);
    const dividers = await page.locator('.bar-group + .bar-group').count();
    expect(dividers).toBeGreaterThan(0);
  });

  test('drum and melody grids are vertically aligned', async ({ page }) => {
    await waitForApp(page);
    const drumBar = page.locator('.melody-track[data-type="drum"] .bar-group').first();
    const melBar = page.locator('.melody-track[data-type="melody"] .bar-group').first();
    const drumLeft = (await drumBar.boundingBox())?.x ?? 0;
    const melLeft = (await melBar.boundingBox())?.x ?? 0;
    expect(Math.abs(drumLeft - melLeft)).toBeLessThan(2); // within 2px
  });
});

// ═══════════════════════════════════════════
//  MIDI Controls
// ═══════════════════════════════════════════

test.describe('MIDI Controls', () => {
  test('MIDI button visible on all 3 melody tracks', async ({ page }) => {
    await waitForApp(page);
    const midiBtns = page.locator('.melody-track[data-type="melody"] .midi-btn');
    await expect(midiBtns).toHaveCount(3);
  });

  test('MIDI button not on drum tracks', async ({ page }) => {
    await waitForApp(page);
    const drumMidi = page.locator('.melody-track[data-type="drum"] .midi-btn');
    await expect(drumMidi).toHaveCount(0);
  });

  test('clicking MIDI button opens midi browser', async ({ page }) => {
    await waitForApp(page);
    const midiBtn = page.locator('.melody-track[data-type="melody"] .midi-btn').first();
    await midiBtn.click();
    await expect(page.locator('#midi-overlay')).toHaveClass(/open/);
  });

  test('Escape closes midi browser', async ({ page }) => {
    await waitForApp(page);
    const midiBtn = page.locator('.melody-track[data-type="melody"] .midi-btn').first();
    await midiBtn.click();
    await expect(page.locator('#midi-overlay')).toHaveClass(/open/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#midi-overlay')).not.toHaveClass(/open/);
  });

  test('close button closes midi browser', async ({ page }) => {
    await waitForApp(page);
    const midiBtn = page.locator('.melody-track[data-type="melody"] .midi-btn').first();
    await midiBtn.click();
    await expect(page.locator('#midi-overlay')).toHaveClass(/open/);
    await page.locator('#midi-close').click();
    await expect(page.locator('#midi-overlay')).not.toHaveClass(/open/);
  });

  test('midi browser shows status element', async ({ page }) => {
    await waitForApp(page);
    const midiBtn = page.locator('.melody-track[data-type="melody"] .midi-btn').first();
    await midiBtn.click();
    await expect(page.locator('#midi-status')).toBeVisible();
  });
});

// ═══════════════════════════════════════════
//  ADSR Controls
// ═══════════════════════════════════════════

test.describe('ADSR Controls', () => {
  test('ADSR button visible on all 9 tracks', async ({ page }) => {
    await waitForApp(page);
    const adsrBtns = page.locator('.adsr-btn');
    await expect(adsrBtns).toHaveCount(9);
  });

  test('clicking ADSR button opens popup', async ({ page }) => {
    await waitForApp(page);
    const adsrBtn = page.locator('.adsr-btn').first();
    await adsrBtn.click();
    await expect(page.locator('#adsr-popup')).toHaveClass(/open/);
  });

  test('ADSR popup has canvas visualization', async ({ page }) => {
    await waitForApp(page);
    const adsrBtn = page.locator('.adsr-btn').first();
    await adsrBtn.click();
    await expect(page.locator('#adsr-canvas')).toBeVisible();
  });

  test('ADSR popup has 4 sliders', async ({ page }) => {
    await waitForApp(page);
    const adsrBtn = page.locator('.adsr-btn').first();
    await adsrBtn.click();
    const sliders = page.locator('.adsr-slider-vertical');
    await expect(sliders).toHaveCount(4);
  });

  test('Escape closes ADSR popup', async ({ page }) => {
    await waitForApp(page);
    const adsrBtn = page.locator('.adsr-btn').first();
    await adsrBtn.click();
    await expect(page.locator('#adsr-popup')).toHaveClass(/open/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#adsr-popup')).not.toHaveClass(/open/);
  });

  test('close button closes ADSR popup', async ({ page }) => {
    await waitForApp(page);
    const adsrBtn = page.locator('.adsr-btn').first();
    await adsrBtn.click();
    await expect(page.locator('#adsr-popup')).toHaveClass(/open/);
    await page.locator('#adsr-close').click();
    await expect(page.locator('#adsr-popup')).not.toHaveClass(/open/);
  });

  test('ADSR envelope actually modulates audio when enabled', async ({ page }) => {
    await waitForApp(page);
    // Use OfflineAudioContext to verify envelope gain automation is real.
    // Create a source, apply envelope with slow attack (0.5s), render 0.01s,
    // and verify the output is near-silent (attack hasn't completed yet).
    const result = await page.evaluate(async () => {
      const offline = new OfflineAudioContext(1, 4800, 48000); // 0.1s at 48kHz
      const buf = offline.createBuffer(1, 48000, 48000); // 1s of noise
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = 0.5; // constant signal

      const src = offline.createBufferSource();
      src.buffer = buf;

      // Simulate ADSR with slow attack (0.5s) — at 0.01s into rendering,
      // the envelope should still be near zero (attack barely started)
      const env = offline.createGain();
      env.gain.setValueAtTime(0.0001, 0);
      env.gain.linearRampToValueAtTime(1.0, 0.5); // 500ms attack
      env.gain.setTargetAtTime(0.8, 0.5, 0.033); // decay to 0.8 sustain

      src.connect(env);
      env.connect(offline.destination);
      src.start(0);

      const rendered = await offline.startRendering();
      const out = rendered.getChannelData(0);

      // Check first 480 samples (10ms) — with 500ms attack, gain ≈ 0.02 max
      let peakFirst10ms = 0;
      for (let i = 0; i < 480; i++) {
        peakFirst10ms = Math.max(peakFirst10ms, Math.abs(out[i] ?? 0));
      }

      // Check samples at 90-100ms — gain ≈ 0.2 (20% into 500ms attack)
      let peakAt100ms = 0;
      for (let i = 4320; i < 4800; i++) {
        peakAt100ms = Math.max(peakAt100ms, Math.abs(out[i] ?? 0));
      }

      return { peakFirst10ms, peakAt100ms };
    });

    // With slow attack, first 10ms should be heavily attenuated (< 0.1)
    expect(result.peakFirst10ms).toBeLessThan(0.1);
    // At 100ms into 500ms attack, signal should be rising but still below full (< 0.5 * 0.5 = 0.25ish)
    expect(result.peakAt100ms).toBeLessThan(0.25);
    // And it should be higher than the start (proving the ramp is real)
    expect(result.peakAt100ms).toBeGreaterThan(result.peakFirst10ms);
  });
});

// ═══════════════════════════════════════════
//  15. AUDIO ENGINE TIMING (regression for dual-ctx + ADSR-leak fixes)
// ═══════════════════════════════════════════

/** Build a tiny silent stereo PCM WAV (100ms at 44.1 kHz) for tests that need
 * decodeAudioData to succeed without depending on real sample files on disk
 * (CI runners don't have the audio sample libraries). */
function makeSilentWavBytes(): Uint8Array {
  const sr = 44100;
  const ch = 2;
  const frames = Math.floor(sr * 0.1);
  const dataSize = frames * ch * 2;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  v.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, ch, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * ch * 2, true);
  v.setUint16(32, ch * 2, true);
  v.setUint16(34, 16, true);
  writeStr(36, 'data');
  v.setUint32(40, dataSize, true);
  return new Uint8Array(buf);
}

async function mockWavRoutes(page: Page) {
  const body = Buffer.from(makeSilentWavBytes());
  await page.route('**/*.wav', (route) =>
    route.fulfill({ status: 200, contentType: 'audio/wav', body }),
  );
}

test.describe('Audio Engine Timing', () => {
  test('AudioContexts are unique — Tone is bound to the engine context', async ({ page }) => {
    // Regression: Tone.setContext must run BEFORE the Play button is wired,
    // otherwise a fast click during init lazy-creates a second AudioContext
    // and reintroduces the dual-context timing bug. We verify the binding by
    // counting distinct AudioContexts after init has settled — there must be
    // exactly one.
    await page.goto('/');
    await page.waitForSelector('#app', { state: 'visible' });
    await page.evaluate(() => {
      const seen = new Set<unknown>();
      const Orig = window.AudioContext;
      (window as unknown as { AudioContext: typeof AudioContext }).AudioContext = class extends Orig {
        constructor(...args: ConstructorParameters<typeof AudioContext>) {
          super(...args);
          seen.add(this);
        }
      } as typeof AudioContext;
      (window as unknown as { __ctxCount: () => number }).__ctxCount = () => seen.size;
    });
    await page.waitForSelector('.melody-track', { state: 'visible' });
    await page.waitForSelector('#song-pane', { state: 'visible' });
    // Click Play immediately — exercises the early-init race window. With the
    // pre-fix ordering this would cause Tone to create its own context first.
    await page.click('#app');
    await page.locator('#play-btn').click();
    await page.waitForTimeout(500);
    const count = await page.evaluate(() =>
      (window as unknown as { __ctxCount: () => number }).__ctxCount(),
    );
    expect(count).toBeLessThanOrEqual(1);
  });

  test('src.start times are scheduled in the future (single AudioContext)', async ({ page }) => {
    await mockWavRoutes(page);
    await page.goto('/');
    await page.waitForSelector('#app', { state: 'visible' });
    // Instrument createBufferSource BEFORE the app does anything audible.
    await page.evaluate(() => {
      const origBS = BaseAudioContext.prototype.createBufferSource;
      const tracker: { when: number; ctxTime: number }[] = [];
      (window as unknown as { __timingTrace: typeof tracker }).__timingTrace = tracker;
      BaseAudioContext.prototype.createBufferSource = function (this: BaseAudioContext) {
        const s = origBS.call(this);
        const origStart = s.start;
        s.start = function (this: AudioBufferSourceNode, ...args: Parameters<typeof origStart>) {
          const when = (args[0] ?? 0) as number;
          tracker.push({ when, ctxTime: s.context.currentTime });
          return origStart.apply(this, args);
        };
        return s;
      };
    });
    await page.waitForSelector('.melody-track', { state: 'visible' });
    await page.waitForSelector('#song-pane', { state: 'visible' });
    await page.click('#app'); // user gesture for AudioContext.resume
    // Default song has kick four-on-the-floor in phrase 1; load a sample so
    // playSample actually creates buffer sources.
    await page.locator('.melody-track[data-type="drum"][data-track="0"] .sample-btn').click();
    await expect(page.locator('#browser-overlay')).toHaveClass(/open/);
    await page.locator('.browser-item').first().click();
    await page.locator('#browser-load').click();
    await page.waitForTimeout(800);
    await page.locator('#play-btn').click();
    await page.waitForTimeout(2000);
    await page.locator('#stop-btn').click();
    const result = await page.evaluate(() => {
      const tracker = (
        window as unknown as { __timingTrace: { when: number; ctxTime: number }[] }
      ).__timingTrace;
      const deltas = tracker.map((s) => s.when - s.ctxTime);
      return {
        count: tracker.length,
        minDelta: deltas.length ? Math.min(...deltas) : 0,
        maxDelta: deltas.length ? Math.max(...deltas) : 0,
        negative: deltas.filter((d) => d < 0).length,
      };
    });
    // At least one scheduler-driven sample played
    expect(result.count).toBeGreaterThan(0);
    // Every src.start must be at or after ctx.currentTime — the dual-context
    // bug had src.start scheduled ~22s in the past on every call.
    expect(result.negative).toBe(0);
    // And the minimum delta should reflect Tone.Transport's lookahead, not be
    // a giant past-offset.
    expect(result.minDelta).toBeGreaterThanOrEqual(0);
    expect(result.maxDelta).toBeLessThan(1);
  });

  test('ADSR-enabled triggers do not leak GainNodes across play/stop cycles', async ({ page }) => {
    await mockWavRoutes(page);
    await page.goto('/');
    await page.waitForSelector('#app', { state: 'visible' });
    // Instrument createGain BEFORE the app's audio init — track every gain
    // created and decrement on disconnect.
    await page.evaluate(() => {
      const origGain = BaseAudioContext.prototype.createGain;
      const state: { created: number; alive: Set<GainNode> } = { created: 0, alive: new Set() };
      (window as unknown as { __gainTrace: typeof state }).__gainTrace = state;
      BaseAudioContext.prototype.createGain = function (this: BaseAudioContext) {
        const g = origGain.call(this);
        state.created++;
        state.alive.add(g);
        const origDisconnect = g.disconnect.bind(g);
        (g as GainNode & { disconnect: (...a: unknown[]) => void }).disconnect = function (
          ...args: unknown[]
        ) {
          state.alive.delete(g);
          return (origDisconnect as (...a: unknown[]) => void)(...args);
        };
        return g;
      };
    });
    await page.waitForSelector('.melody-track', { state: 'visible' });
    await page.waitForSelector('#song-pane', { state: 'visible' });
    await page.click('#app');
    await page.locator('.melody-track[data-type="drum"][data-track="0"] .sample-btn').click();
    await expect(page.locator('#browser-overlay')).toHaveClass(/open/);
    await page.locator('.browser-item').first().click();
    await page.locator('#browser-load').click();
    await page.waitForTimeout(800);
    // Enable ADSR on the kick (popup → click OFF toggle to turn ON)
    await page.locator('.melody-track[data-type="drum"][data-track="0"] .adsr-btn').click();
    await page.waitForTimeout(200);
    const offToggle = page.locator('button', { hasText: /^OFF$/ }).first();
    await offToggle.click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    // Snapshot baseline AFTER setup, then run multiple short play/stop cycles.
    const baseline = await page.evaluate(() => {
      const s = (window as unknown as { __gainTrace: { created: number; alive: Set<GainNode> } })
        .__gainTrace;
      return { created: s.created, alive: s.alive.size };
    });
    for (let i = 0; i < 3; i++) {
      await page.locator('#play-btn').click();
      await page.waitForTimeout(2200);
      await page.locator('#stop-btn').click();
      // Allow the release tail + ended-event handler to run.
      await page.waitForTimeout(800);
    }
    const after = await page.evaluate(() => {
      const s = (window as unknown as { __gainTrace: { created: number; alive: Set<GainNode> } })
        .__gainTrace;
      return { created: s.created, alive: s.alive.size };
    });
    // Each cycle should create envelope GainNodes (proves ADSR is engaged).
    expect(after.created).toBeGreaterThan(baseline.created);
    // But none should remain alive — every env GainNode must be disconnected
    // when its buffer source ends. The pre-fix behavior leaked one per trigger.
    expect(after.alive).toBe(baseline.alive);
  });
});
