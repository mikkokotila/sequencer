import { test, expect } from '@playwright/test';

test('closing Engine restores single-click access to the previously open effect', async ({ page }) => {
  await page.goto('/'); await page.waitForSelector('html[data-ready="true"]');
  const effect = page.locator('.ext-icon-btn[data-ext-id="reverb"]');
  await effect.click(); await expect(page.locator('#ext-panel')).toHaveClass(/open/);
  await page.locator('#engine-icon-btn').click();
  await expect(page.locator('#ext-panel')).not.toHaveClass(/open/);
  await page.locator('#engine-panel').getByRole('button', { name: '×', exact: true }).click();
  await effect.click();
  await expect(page.locator('#ext-panel')).toHaveClass(/open/);
  await expect(effect).toHaveClass(/active/);
});
