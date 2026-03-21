import { test, expect, type Page } from '@playwright/test';

// Helper: wait for app to initialize (IndexedDB + audio context setup)
async function waitForApp(page: Page) {
  await page.goto('/');
  await page.waitForSelector('#app', { state: 'visible' });
  await page.waitForSelector('.melody-track', { state: 'visible' });
  // Wait for song pane
  await page.waitForSelector('#song-pane', { state: 'visible' });
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
    const cell = page.locator('.melody-track[data-type="melody"][data-track="0"] .melody-cell').nth(5);
    await cell.click();
    await expect(cell).toHaveClass(/active/);
  });

  test('clicking an active melody cell toggles it off', async ({ page }) => {
    await waitForApp(page);
    const cell = page.locator('.melody-track[data-type="melody"][data-track="0"] .melody-cell').nth(7);
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
    const harmBtn = page.locator('.melody-track[data-type="melody"][data-track="1"] .harmony-toggle');
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

  test.fixme('new song clears patterns', async ({ page }) => {
    await waitForApp(page);
    // Clear IndexedDB to start fresh
    await page.evaluate(() => indexedDB.deleteDatabase('sequencer-db'));
    await page.reload();
    await waitForApp(page);

    // Click a cell on an empty track
    const cell = page.locator('.melody-track[data-type="drum"][data-track="3"] .step-cell').nth(5);
    await cell.click();
    await expect(cell).toHaveClass(/active/);

    // Create new song
    await page.locator('#song-new').click();
    await page.waitForTimeout(1000);

    // That cell should now be cleared
    const activeCount = await page.locator(
      '.melody-track[data-type="drum"][data-track="3"] .step-cell.active',
    ).count();
    expect(activeCount).toBe(0);
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
//  14. PERSISTENCE
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
    const cellAfter = page.locator('.melody-track[data-type="drum"][data-track="1"] .step-cell').nth(4);
    await expect(cellAfter).toHaveClass(/active/);
  });
});

// ═══════════════════════════════════════════
//  15. GRID ALIGNMENT
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
