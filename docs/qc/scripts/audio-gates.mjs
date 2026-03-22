#!/usr/bin/env node
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'vite';

const PORT = Number(process.env.AUDIO_GATE_PORT || '5174');
const BASE = `http://localhost:${PORT}`;

function hasDisplayServer() {
  if (process.platform === 'win32' || process.platform === 'darwin') return true;
  return Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
}

async function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // server not ready yet
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for server at ${url}`);
}

function parsePassedSummary(text) {
  const m = text.match(/(\d+)\s*\/\s*(\d+)\s*passed(?:\s*[—-]\s*(\d+)\s*failed)?/i);
  if (!m) return null;
  const passed = Number(m[1]);
  const total = Number(m[2]);
  const failed = m[3] !== undefined ? Number(m[3]) : Math.max(0, total - passed);
  return { passed, total, failed };
}

function parseFiniteNumber(text) {
  if (typeof text !== 'string') return null;
  const value = Number.parseFloat(text.trim());
  return Number.isFinite(value) ? value : null;
}

async function run() {
  if (!hasDisplayServer()) {
    const linuxHint = process.platform === 'linux' ? ' Run with xvfb-run -a npm run audio:gates.' : '';
    throw new Error(`Real audio benchmark requires a display server.${linuxHint}`);
  }

  const viteServer = await createServer({
    root: process.cwd(),
    logLevel: 'error',
    clearScreen: false,
    server: {
      port: PORT,
      strictPort: true,
    },
  });
  await viteServer.listen();

  let browser = null;

  try {
    await waitForServer(`${BASE}/`);

    const { chromium } = await import('playwright');
    browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();

    const results = [];

    async function runSummaryPage(name, path) {
      await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.summary', { timeout: 20000 });
      const text = (await page.textContent('.summary'))?.trim() || '';
      const parsed = parsePassedSummary(text);
      const failures = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('.test')];
        return rows
          .filter((row) => {
            const klass = row.className || '';
            const badge = row.querySelector('.badge')?.textContent || '';
            return /\bfail\b/i.test(klass) || /\bFAIL\b/i.test(badge);
          })
          .map((row) => {
            const name = (row.querySelector('.test-name')?.textContent || '').trim() || 'unnamed-test';
            const detail = (row.querySelector('.test-detail')?.textContent || '').trim() || 'no detail';
            return { suite: 'browser-audio-suite', test_name: name, file_line: null, first_message: detail };
          });
      });
      const ok = !!parsed && parsed.failed === 0 && parsed.passed === parsed.total;
      results.push({
        name,
        ok,
        failures,
        detail: parsed
          ? `${parsed.passed}/${parsed.total} passed, ${parsed.failed} failed`
          : `Could not parse summary: "${text}"`,
      });
    }

    await runSummaryPage('audio-quality', '/tests/audio-quality.html');
    await runSummaryPage('e2e-signal', '/tests/e2e-signal.html');
    await runSummaryPage('signal-purity', '/tests/signal-purity.html');

    await page.addInitScript(() => {
      window.__audioGateStats = {
        intervalCalls: 0,
        randomCalls: 0,
        workletConstructs: 0,
      };

      const origInterval = window.setInterval;
      window.setInterval = function (...args) {
        window.__audioGateStats.intervalCalls += 1;
        return origInterval.apply(this, args);
      };

      const origRandom = Math.random;
      Math.random = function (...args) {
        window.__audioGateStats.randomCalls += 1;
        return origRandom.apply(this, args);
      };

      const OriginalAudioWorkletNode = window.AudioWorkletNode;
      if (typeof OriginalAudioWorkletNode === 'function') {
        window.AudioWorkletNode = new Proxy(OriginalAudioWorkletNode, {
          construct(target, args, newTarget) {
            window.__audioGateStats.workletConstructs += 1;
            return Reflect.construct(target, args, newTarget);
          },
        });
      }
    });

    await page.goto(`${BASE}/tests/benchmark.html`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      if (window.__audioGateStats) {
        window.__audioGateStats.intervalCalls = 0;
        window.__audioGateStats.randomCalls = 0;
        window.__audioGateStats.workletConstructs = 0;
      }
    });
    await page.click('#run-btn');
    await page.waitForFunction(() => {
      const gate = document.querySelector('#gate');
      const gateText = (gate?.textContent || '').trim();
      return (
        gate?.classList.contains('pass') ||
        gate?.classList.contains('fail') ||
        /^PASS\\b/.test(gateText) ||
        /^FAIL\\s+—/.test(gateText)
      );
    }, null, { timeout: 60000 });

    const benchmark = await page.evaluate(() => {
      const gateText = (document.querySelector('#gate')?.textContent || '').trim();
      const gateClass = document.querySelector('#gate')?.className || '';
      const p99Text = (document.querySelector('#p99')?.textContent || '').trim();
      const budgetText = (document.querySelector('#budget')?.textContent || '').trim();
      const sampleMatch =
        gateText.match(/(\d+)\s+worklet process\(\)\s+samples/i) || gateText.match(/(\d+)\s*samples/i);
      return {
        gateText,
        gateClass,
        p99Text,
        budgetText,
        sampleCount: sampleMatch ? Number(sampleMatch[1]) : null,
        hasAudioWorkletRuntime: Number(window.__audioGateStats?.workletConstructs || 0) > 0,
        randomCalls: Number(window.__audioGateStats?.randomCalls || 0),
        intervalCalls: Number(window.__audioGateStats?.intervalCalls || 0),
      };
    });

    const p99 = parseFiniteNumber(benchmark.p99Text);
    const budget = parseFiniteNumber(benchmark.budgetText);
    const sampleCount = Number.isFinite(benchmark.sampleCount) ? benchmark.sampleCount : null;
    const gateShowsFail = /\bFAIL\b/i.test(benchmark.gateText);
    const structuralOk =
      benchmark.hasAudioWorkletRuntime &&
      benchmark.randomCalls === 0 &&
      benchmark.intervalCalls === 0;

    const benchmarkOk =
      !gateShowsFail &&
      structuralOk &&
      p99 !== null &&
      budget !== null &&
      sampleCount !== null &&
      sampleCount >= 50 &&
      p99 <= budget;

    const benchmarkFailures = [];
    if (gateShowsFail) {
      benchmarkFailures.push({
        suite: 'benchmark',
        test_name: 'gate-state',
        file_line: null,
        first_message: benchmark.gateText || 'benchmark reported FAIL',
      });
    }
    if (!benchmark.hasAudioWorkletRuntime) {
      benchmarkFailures.push({
        suite: 'benchmark',
        test_name: 'audio-worklet-runtime',
        file_line: null,
        first_message: 'AudioWorkletNode did not execute at runtime',
      });
    }
    if (benchmark.randomCalls !== 0 || benchmark.intervalCalls !== 0) {
      benchmarkFailures.push({
        suite: 'benchmark',
        test_name: 'determinism',
        file_line: null,
        first_message: `random_calls=${benchmark.randomCalls} interval_calls=${benchmark.intervalCalls}`,
      });
    }
    if (sampleCount === null || sampleCount < 50) {
      benchmarkFailures.push({
        suite: 'benchmark',
        test_name: 'sample-count',
        file_line: null,
        first_message: `sample_count=${sampleCount ?? 'null'} (expected >= 50)`,
      });
    }
    if (p99 === null || budget === null || (p99 !== null && budget !== null && p99 > budget)) {
      benchmarkFailures.push({
        suite: 'benchmark',
        test_name: 'worklet-budget',
        file_line: null,
        first_message:
          p99 === null || budget === null
            ? `missing metric(s): p99="${benchmark.p99Text}" budget="${benchmark.budgetText}"`
            : `p99=${p99.toFixed(3)}ms budget=${budget.toFixed(3)}ms`,
      });
    }

    results.push({
      name: 'benchmark',
      ok: benchmarkOk,
      failures: benchmarkFailures,
      detail:
        p99 === null || budget === null || sampleCount === null
          ? `real benchmark missing metrics (p99="${benchmark.p99Text}", budget="${benchmark.budgetText}", gate="${benchmark.gateText}")`
          : `real p99=${p99.toFixed(3)}ms budget=${budget.toFixed(3)}ms samples=${sampleCount} structural_ok=${structuralOk ? 1 : 0} gate_fail=${gateShowsFail ? 1 : 0} worklet_runtime=${benchmark.hasAudioWorkletRuntime ? 1 : 0} random_calls=${benchmark.randomCalls} interval_calls=${benchmark.intervalCalls} gate_class="${benchmark.gateClass}" gate="${benchmark.gateText}"`,
    });

    let failed = 0;
    for (const r of results) {
      console.log(`${r.ok ? 'PASS' : 'FAIL'} | ${r.name} | ${r.detail}`);
      if (!r.ok && Array.isArray(r.failures) && r.failures.length > 0) {
        for (const item of r.failures) {
          const location = item.file_line ? ` @ ${item.file_line}` : '';
          console.log(
            `FAIL-ITEM | ${r.name} | ${item.test_name}${location} | ${item.first_message}`,
          );
        }
      }
      if (!r.ok) failed++;
    }

    if (failed > 0) {
      throw new Error(`audio-gates failed (${failed}/${results.length})`);
    }

    console.log(`audio-gates: all ${results.length} checks passed.`);
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // ignore browser shutdown issues; gate outcome already captured
      }
    }
    try {
      await viteServer.close();
    } catch {
      // ignore server shutdown issues; gate outcome already captured
    }
  }
}

run().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
