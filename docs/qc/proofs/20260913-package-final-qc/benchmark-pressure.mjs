import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { validateBenchmarkEvidence } from '../../scripts/benchmark-evidence.mjs';
const browser = await chromium.launch({ headless: false });
try {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:5173/tests/benchmark.html');
  await page.selectOption('#polyphony', '32'); await page.selectOption('#duration', '30');
  await page.click('#run-btn');
  await page.waitForFunction(() => /pass|fail/.test(document.querySelector('#gate').className), null, { timeout: 45000, polling: 100 });
  const evidence = await page.evaluate(() => window.__benchmarkEvidence);
  const result = { ...validateBenchmarkEvidence(evidence), errors };
  await writeFile(new URL('benchmark-32-voices-raw.json', import.meta.url), JSON.stringify(evidence));
  await writeFile(new URL('benchmark-32-voices.json', import.meta.url), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result)); assert.ok(result.ok); assert.deepEqual(errors, []);
} finally { await browser.close(); }
