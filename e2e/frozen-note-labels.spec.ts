import { test, expect } from '@playwright/test';

for (const width of [390, 600]) {
  test(`note labels stay fixed and aligned while every melody track scrolls at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page.waitForSelector('html[data-ready="true"]');
    for (let track = 0; track < 3; track++) {
      const panel = page.locator(`.melody-track[data-type="melody"][data-track="${track}"]`);
      const scroll = panel.getByRole('region', {
        name: `Melody track ${track + 1} note grid`,
        exact: true,
      });
      // Center the grid above the fixed phrase bar before checking hit targets.
      await scroll.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      const labels = panel.locator('.note-labels');
      const before = await labels.boundingBox();
      expect(before).not.toBeNull();
      const extent = await scroll.evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(extent).toBeGreaterThan(100);
      for (const left of [extent / 2, extent]) {
        await scroll.evaluate((el, left) => {
          el.scrollLeft = left;
        }, left);
        const after = await labels.boundingBox();
        expect(after!.x).toBeCloseTo(before!.x, 1);
        expect(after!.y).toBeCloseTo(before!.y, 1);
        expect(after!.width).toBeCloseTo(before!.width, 1);
        const alignment = await panel.evaluate((panel) => {
          const labels = [...panel.querySelectorAll('.note-label')];
          const rows = [...panel.querySelectorAll('.melody-row')];
          return labels.map((label, i) => {
            const a = label.getBoundingClientRect(),
              b = rows[i]!.getBoundingClientRect();
            const top = document.elementFromPoint(a.x + a.width / 2, a.y + a.height / 2);
            return {
              delta: Math.abs(a.y + a.height / 2 - b.y - b.height / 2),
              unobscured: top === label,
            };
          });
        });
        expect(alignment).toHaveLength(12);
        alignment.forEach((row) => {
          expect(row.delta).toBeLessThan(1);
          expect(row.unobscured).toBe(true);
        });
      }
      // The last B note remains editable next to its frozen row label.
      const cell = panel.locator('.melody-cell[data-step="63"][data-note="0"]');
      await cell.click();
      await expect(cell).toHaveClass(/active/);
      const notes = await page.evaluate(async (track) => {
        const { melPat } = await import('/src/transport/patterns.ts');
        return melPat[track]![63];
      }, track);
      expect(notes).toEqual(Array.from({ length: 12 }, (_, note) => note === 11));
      // Clicking a label cannot paint a note hidden under it.
      await panel.locator('.note-label').first().click();
      await expect(cell).toHaveClass(/active/);
    }
  });
}

test('grid scrolling is keyboard accessible and desktop note labels keep row alignment', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/');
  await page.waitForSelector('html[data-ready="true"]');
  const scroll = page.getByRole('region', { name: 'Melody track 1 note grid', exact: true });
  await scroll.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => scroll.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  await page.setViewportSize({ width: 1280, height: 900 });
  const layout = await page.locator('.melody-grid-wrapper').evaluateAll((wrappers) =>
    wrappers.map((wrapper) => {
      const labels = wrapper.querySelector('.note-labels')!.getBoundingClientRect();
      const grid = wrapper.querySelector('.melody-grid')!.getBoundingClientRect();
      const scroll = wrapper.querySelector('.melody-grid-scroll')!;
      return {
        gap: grid.left - labels.right,
        top: grid.top - labels.top,
        overflow: scroll.scrollWidth - scroll.clientWidth,
      };
    }),
  );
  layout.forEach((track) => {
    expect(track.gap).toBeCloseTo(0);
    expect(track.top).toBeCloseTo(0);
    expect(track.overflow).toBe(0);
  });
});
