#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = Number(process.env.AUDIO_GATE_PORT || '5174');
const BASE = `http://localhost:${PORT}`;

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
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  let serverOut = '';
  let serverErr = '';
  server.stdout?.on('data', (d) => {
    serverOut += String(d);
  });
  server.stderr?.on('data', (d) => {
    serverErr += String(d);
  });

  try {
    await waitForServer(`${BASE}/`);

    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    const results = [];

    async function runSummaryPage(name, path) {
      await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.summary', { timeout: 20000 });
      const text = (await page.textContent('.summary'))?.trim() || '';
      const parsed = parsePassedSummary(text);
      const ok = !!parsed && parsed.failed === 0 && parsed.passed === parsed.total;
      results.push({
        name,
        ok,
        detail: parsed
          ? `${parsed.passed}/${parsed.total} passed, ${parsed.failed} failed`
          : `Could not parse summary: "${text}"`,
      });
    }

    await runSummaryPage('audio-quality', '/tests/audio-quality.html');
    await runSummaryPage('e2e-signal', '/tests/e2e-signal.html');
    await runSummaryPage('signal-purity', '/tests/signal-purity.html');

    await page.goto(`${BASE}/tests/benchmark.html`, { waitUntil: 'domcontentloaded' });
    await page.click('#run-btn');
    await page.waitForFunction(() => {
      const p99 = document.querySelector('#p99')?.textContent || '';
      const budget = document.querySelector('#budget')?.textContent || '';
      const p99Value = Number.parseFloat(p99.trim());
      const budgetValue = Number.parseFloat(budget.trim());
      return Number.isFinite(p99Value) && Number.isFinite(budgetValue);
    }, null, { timeout: 60000 });

    const benchmark = await page.evaluate(() => {
      const gateText = (document.querySelector('#gate')?.textContent || '').trim();
      const p99Text = (document.querySelector('#p99')?.textContent || '').trim();
      const budgetText = (document.querySelector('#budget')?.textContent || '').trim();
      const sampleMatch = gateText.match(/(\d+)\s*samples/i);
      return {
        gateText,
        p99Text,
        budgetText,
        sampleCount: sampleMatch ? Number(sampleMatch[1]) : null,
      };
    });

    const p99 = parseFiniteNumber(benchmark.p99Text);
    const budget = parseFiniteNumber(benchmark.budgetText);
    const sampleCount = Number.isFinite(benchmark.sampleCount) ? benchmark.sampleCount : null;
    const benchmarkOk = p99 !== null && budget !== null && sampleCount !== null && sampleCount >= 50 && p99 <= budget;

    results.push({
      name: 'benchmark',
      ok: benchmarkOk,
      detail:
        p99 === null || budget === null || sampleCount === null
          ? `Missing benchmark metrics (p99="${benchmark.p99Text}", budget="${benchmark.budgetText}", gate="${benchmark.gateText}")`
          : `p99=${p99.toFixed(3)}ms budget=${budget.toFixed(3)}ms samples=${sampleCount} gate="${benchmark.gateText}"`,
    });

    await browser.close();

    let failed = 0;
    for (const r of results) {
      console.log(`${r.ok ? 'PASS' : 'FAIL'} | ${r.name} | ${r.detail}`);
      if (!r.ok) failed++;
    }

    if (failed > 0) {
      throw new Error(`audio-gates failed (${failed}/${results.length})`);
    }

    console.log(`audio-gates: all ${results.length} checks passed.`);
  } finally {
    server.kill('SIGTERM');
    await delay(250);
    if (!server.killed) {
      server.kill('SIGKILL');
    }

    if (serverOut.trim().length > 0) {
      console.log(serverOut.trim());
    }
    if (serverErr.trim().length > 0) {
      console.error(serverErr.trim());
    }
  }
}

run().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
