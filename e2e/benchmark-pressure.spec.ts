import { test, expect } from '@playwright/test';
import { validateBenchmarkEvidence } from '../docs/qc/scripts/benchmark-evidence.mjs';

test('real shipped compressor overload fails the independently calculated quantum budget', async ({ page }) => {
  test.setTimeout(45000);
  await page.addInitScript(() => {
    (window as any).__overloadInjection = 0;
    const original = AudioWorklet.prototype.addModule;
    AudioWorklet.prototype.addModule = async function(url, ...options) {
      if (!String(url).includes('/compressor-processor.ts')) return original.call(this, url, ...options);
      const response = await fetch(url);
      let source = await response.text();
      const pattern = /process\(inputs, outputs, parameters\)\s*\{/;
      if (!pattern.test(source)) throw new Error('Shipped compressor process method not found');
      source = source.replace(pattern, match => match + '\nlet qcSink = 0; for (let qcI = 0; qcI < 2000000; qcI++) qcSink += Math.sin(qcI); globalThis.__qcOverloadSink = qcSink;\n');
      source = source.replace(/(from\s*|import\s*)(['"])(\/.*?)\2/g, (_m, prefix, quote, path) => prefix + quote + location.origin + path + quote);
      (window as any).__overloadInjection++;
      const blob = URL.createObjectURL(new Blob([source], { type: 'application/javascript' }));
      try { return await original.call(this, blob, ...options); } finally { URL.revokeObjectURL(blob); }
    };
  });
  await page.goto('/tests/benchmark.html'); await page.locator('#run-btn').click();
  await expect(page.locator('#gate')).toHaveClass(/fail/, { timeout: 35000 });
  const result = await page.evaluate(() => ({ injected: (window as any).__overloadInjection, evidence: (window as any).__benchmarkEvidence }));
  expect(result.injected).toBe(1);
  expect(result.evidence.sampleCount).toBeGreaterThanOrEqual(50);
  expect(result.evidence.samples.every((s: any) => !s.error && JSON.stringify(s.counts) === '[1,2,1,1,1]')).toBe(true);
  const independent = validateBenchmarkEvidence({ ...result.evidence, passed: true, p99UpperBoundMs: 0 });
  expect(independent.ok).toBe(false);
  expect(independent.p99).toBeGreaterThan(independent.budget);
});
