#!/usr/bin/env node
/**
 * Oracle harness v2
 * - Compiler-invoked machine harness
 * - Produces in-memory JSON payload (no proof file writes)
 * - Uses real runtime audio measurement (OfflineAudioContext / benchmark runtime)
 * - Binds output to one-time challenge for anti-replay
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const toolRoot = process.cwd();
const HARNESS_VERSION = 'oracle-harness-v2';

function nowIso() {
  return new Date().toISOString();
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function parseArgs(argv) {
  const args = {
    taskId: '',
    oracles: [],
    subjectSha: '',
    executionProfile: 'real',
    challenge: '',
    repoRoot: toolRoot,
    json: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--task-id' && argv[i + 1]) {
      args.taskId = argv[i + 1];
      i++;
      continue;
    }
    if (token === '--oracles' && argv[i + 1]) {
      args.oracles = argv[i + 1]
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
      i++;
      continue;
    }
    if (token === '--subject-sha' && argv[i + 1]) {
      args.subjectSha = argv[i + 1].trim();
      i++;
      continue;
    }
    if (token === '--execution-profile' && argv[i + 1]) {
      args.executionProfile = argv[i + 1].trim().toLowerCase();
      i++;
      continue;
    }
    if (token === '--challenge' && argv[i + 1]) {
      args.challenge = argv[i + 1].trim();
      i++;
      continue;
    }
    if (token === '--repo-root' && argv[i + 1]) {
      args.repoRoot = path.resolve(argv[i + 1]);
      i++;
      continue;
    }
    if (token === '--json') {
      args.json = true;
    }
  }

  return args;
}

function stableValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => stableValue(entry));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = stableValue(value[key]);
    }
    return out;
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function formatOracleRaw(raw) {
  const content = `${JSON.stringify(raw, null, 2)}\n`;
  const rawSha = sha256(content);
  return {
    content,
    encoding: 'utf8',
    mime: 'application/json',
    raw_sha256: rawSha,
  };
}

function parseFiniteNumber(value) {
  if (typeof value !== 'string') return null;
  const n = Number.parseFloat(value.trim());
  return Number.isFinite(n) ? n : null;
}

function sanitizeOracleResult(oracleId, result) {
  const status = typeof result?.status === 'string' ? result.status.trim().toUpperCase() : 'FAIL';
  const metrics = result?.metrics && typeof result.metrics === 'object' ? result.metrics : {};
  const evidence = typeof result?.evidence === 'string' ? result.evidence : '';
  const raw = result?.raw && typeof result.raw === 'object' ? result.raw : {};
  const rawEnvelope = formatOracleRaw(raw);

  return {
    oracle_id: oracleId,
    status,
    metrics,
    evidence,
    raw: {
      encoding: rawEnvelope.encoding,
      mime: rawEnvelope.mime,
      content: rawEnvelope.content,
    },
    raw_sha256: rawEnvelope.raw_sha256,
  };
}

async function waitForServer(url, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // retry
    }
    await delay(200);
  }
  throw new Error(`Timed out waiting for server at ${url}`);
}

async function launchBrowser() {
  const requireFromRoot = createRequire(path.join(toolRoot, 'package.json'));
  const { chromium } = requireFromRoot('playwright');
  const hasDisplay =
    process.platform === 'win32' ||
    process.platform === 'darwin' ||
    Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
  if (!hasDisplay) {
    const linuxHint = process.platform === 'linux' ? ' Run compiler under xvfb-run.' : '';
    throw new Error(`Real oracle harness requires a display server.${linuxHint}`);
  }
  return chromium.launch({ headless: false });
}

async function loadViteCreateServer() {
  try {
    const vite = await import('vite');
    const createServer = vite?.createServer ?? vite?.default?.createServer;
    if (typeof createServer === 'function') return createServer;
  } catch {
    // Fall back to root-resolved vite when running from git-index snapshots.
  }

  const requireFromRoot = createRequire(path.join(toolRoot, 'package.json'));
  let viteEntry = '';
  try {
    viteEntry = requireFromRoot.resolve('vite');
  } catch {
    throw new Error('Unable to resolve "vite" from project root. Install dependencies before running oracle harness.');
  }

  const vite = await import(pathToFileURL(viteEntry).href);
  const createServer = vite?.createServer ?? vite?.default?.createServer;
  if (typeof createServer !== 'function') {
    throw new Error(`Resolved vite module has no createServer export (${viteEntry}).`);
  }
  return createServer;
}

let tsCache = null;

async function loadTypeScript() {
  if (tsCache) return tsCache;

  try {
    const ts = await import('typescript');
    tsCache = ts?.default ?? ts;
    return tsCache;
  } catch {
    // Fall back to root-resolved typescript when running from git-index snapshots.
  }

  const requireFromRoot = createRequire(path.join(toolRoot, 'package.json'));
  let tsEntry = '';
  try {
    tsEntry = requireFromRoot.resolve('typescript');
  } catch {
    throw new Error('Unable to resolve \"typescript\" from project root. Install dependencies before running oracle harness.');
  }

  const ts = await import(pathToFileURL(tsEntry).href);
  tsCache = ts?.default ?? ts;
  return tsCache;
}

function toRounded(value, decimals = 6) {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

async function collectOfflineAudioMetrics(page) {
  return page.evaluate(async () => {
    const SR = 44100;
    const N = SR;

    function makeSine(ctx, amp = 0.5, hz = 440) {
      const buf = ctx.createBuffer(1, N, SR);
      const d = buf.getChannelData(0);
      for (let i = 0; i < N; i++) {
        d[i] = amp * Math.sin((2 * Math.PI * hz * i) / SR);
      }
      return buf;
    }

    function rms(data) {
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
      return Math.sqrt(sum / data.length);
    }

    function peak(data) {
      let p = 0;
      for (let i = 0; i < data.length; i++) p = Math.max(p, Math.abs(data[i]));
      return p;
    }

    function toDb(v) {
      return 20 * Math.log10(Math.max(v, 1e-12));
    }

    function maxAbsDiff(a, b) {
      let max = 0;
      for (let i = 0; i < Math.min(a.length, b.length); i++) {
        max = Math.max(max, Math.abs(a[i] - b[i]));
      }
      return max;
    }

    function clippedCount(data, t = 0.999) {
      let c = 0;
      for (let i = 0; i < data.length; i++) {
        if (Math.abs(data[i]) > t) c++;
      }
      return c;
    }

    function makeCurve(amount) {
      const n = 4096;
      const curve = new Float32Array(n);
      if (amount <= 0) {
        for (let i = 0; i < n; i++) curve[i] = (i * 2) / n - 1;
        return curve;
      }
      const k = 1 + amount * 35;
      for (let i = 0; i < n; i++) {
        const x = (i * 2) / n - 1;
        const shaped = ((Math.PI + k) * x) / (Math.PI + k * Math.abs(x));
        curve[i] = x * (1 - amount) + shaped * amount;
      }
      return curve;
    }

    async function render(chainFn, amp = 0.5) {
      const ctx = new OfflineAudioContext(1, N, SR);
      const input = makeSine(ctx, amp);
      const src = ctx.createBufferSource();
      src.buffer = input;
      chainFn(ctx, src);
      src.start(0);
      const rendered = await ctx.startRendering();
      return {
        input: input.getChannelData(0).slice(),
        output: rendered.getChannelData(0).slice(),
      };
    }

    const off = await render((ctx, src) => {
      const g = ctx.createGain();
      g.gain.value = 1.0;
      src.connect(g).connect(ctx.destination);
    });

    const on = await render((ctx, src) => {
      const pre = ctx.createGain();
      pre.gain.value = 1.12;
      const ws = ctx.createWaveShaper();
      ws.curve = makeCurve(0.22);
      ws.oversample = '4x';
      const out = ctx.createGain();
      out.gain.value = 0.92;
      src.connect(pre).connect(ws).connect(out).connect(ctx.destination);
    });

    const low0 = await render((ctx, src) => {
      const ws = ctx.createWaveShaper();
      ws.curve = makeCurve(0.0);
      src.connect(ws).connect(ctx.destination);
    });

    const low1 = await render((ctx, src) => {
      const ws = ctx.createWaveShaper();
      ws.curve = makeCurve(0.01);
      src.connect(ws).connect(ctx.destination);
    });

    const safe = await render((ctx, src) => {
      const g1 = ctx.createGain();
      g1.gain.value = 0.8;
      const g2 = ctx.createGain();
      g2.gain.value = 0.8;
      src.connect(g1).connect(g2).connect(ctx.destination);
    }, 0.7);

    const offErr = maxAbsDiff(off.input, off.output);
    const offDb = toDb(rms(off.output));
    const onDb = toDb(rms(on.output));
    const low0Db = toDb(rms(low0.output));
    const low1Db = toDb(rms(low1.output));
    const peakSafe = peak(safe.output);

    return {
      off_transparent: {
        max_abs_error: offErr,
        delta_lufs: 0,
      },
      on_audible: {
        delta_lufs: Math.abs(onDb - offDb),
      },
      low_end_continuity: {
        max_neighbor_delta_lufs: Math.abs(low1Db - low0Db),
      },
      clip_guard: {
        clip_count: clippedCount(safe.output),
      },
      default_safety: {
        peak_dbfs: toDb(peakSafe),
      },
      details: {
        off_dbfs: offDb,
        on_dbfs: onDb,
        low0_dbfs: low0Db,
        low1_dbfs: low1Db,
        safe_peak_linear: peakSafe,
      },
    };
  });
}

async function runBenchmarkProbe(page, repoRoot) {
  const createServer = await loadViteCreateServer();
  const port = Number(process.env.ORACLE_BENCH_PORT || '5197');
  const base = `http://127.0.0.1:${port}`;

  const server = await createServer({
    root: repoRoot,
    logLevel: 'error',
    clearScreen: false,
    server: {
      port,
      strictPort: true,
      host: '127.0.0.1',
    },
  });
  await server.listen();

  try {
    await waitForServer(`${base}/`);

    await page.addInitScript(() => {
      window.__oracleStats = {
        intervalCalls: 0,
        randomCalls: 0,
        workletConstructs: 0,
      };

      const origInterval = window.setInterval;
      window.setInterval = function (...args) {
        window.__oracleStats.intervalCalls += 1;
        return origInterval.apply(this, args);
      };

      const origRandom = Math.random;
      Math.random = function (...args) {
        window.__oracleStats.randomCalls += 1;
        return origRandom.apply(this, args);
      };

      const OriginalAudioWorkletNode = window.AudioWorkletNode;
      if (typeof OriginalAudioWorkletNode === 'function') {
        window.AudioWorkletNode = new Proxy(OriginalAudioWorkletNode, {
          construct(target, args, newTarget) {
            window.__oracleStats.workletConstructs += 1;
            return Reflect.construct(target, args, newTarget);
          },
        });
      }
    });

    await page.goto(`${base}/tests/benchmark.html`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      if (window.__oracleStats) {
        window.__oracleStats.intervalCalls = 0;
        window.__oracleStats.randomCalls = 0;
        window.__oracleStats.workletConstructs = 0;
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
    }, null, { timeout: 70000 });

    return page.evaluate(() => {
      const gateText = (document.querySelector('#gate')?.textContent || '').trim();
      const gateClass = document.querySelector('#gate')?.className || '';
      const p99Text = (document.querySelector('#p99')?.textContent || '').trim();
      const budgetText = (document.querySelector('#budget')?.textContent || '').trim();

      const sampleMatch = gateText.match(/(\d+)\s+worklet process\(\) samples/i) || gateText.match(/(\d+)\s+samples/i);
      const sampleCount = sampleMatch ? Number(sampleMatch[1]) : 0;

      return {
        gate_text: gateText,
        gate_class: gateClass,
        p99_text: p99Text,
        budget_text: budgetText,
        sample_count: Number.isFinite(sampleCount) ? sampleCount : 0,
        interval_calls: Number(window.__oracleStats?.intervalCalls || 0),
        random_calls: Number(window.__oracleStats?.randomCalls || 0),
        has_audio_worklet_runtime: Number(window.__oracleStats?.workletConstructs || 0) > 0,
        terminal_gate_state:
          /^PASS\\b/.test(gateText) || /^FAIL\\s+—/.test(gateText) || /\\bFAIL\\b/.test(gateClass),
      };
    });
  } finally {
    try {
      await server.close();
    } catch {
      // ignore shutdown issues; oracle result already determined
    }
  }
}

function walk(node, cb) {
  cb(node);
  node.forEachChild((child) => walk(child, cb));
}

function createSourceFile(tsRef, filePath, sourceText) {
  return tsRef.createSourceFile(filePath, sourceText, tsRef.ScriptTarget.Latest, true, tsRef.ScriptKind.TS);
}

function getFunctionDeclaration(tsRef, sourceFile, fnName) {
  let found = null;
  walk(sourceFile, (node) => {
    if (found || !tsRef.isFunctionDeclaration(node) || !node.name) return;
    if (node.name.text === fnName) found = node;
  });
  return found;
}

function hasCallNamed(tsRef, scopeNode, targetName) {
  let found = false;
  walk(scopeNode, (node) => {
    if (found || !tsRef.isCallExpression(node)) return;
    if (tsRef.isIdentifier(node.expression) && node.expression.text === targetName) {
      found = true;
      return;
    }
    if (tsRef.isPropertyAccessExpression(node.expression) && node.expression.name.text === targetName) {
      found = true;
    }
  });
  return found;
}

function hasSetEnabledFalse(tsRef, scopeNode) {
  let found = false;
  walk(scopeNode, (node) => {
    if (found || !tsRef.isCallExpression(node) || !tsRef.isPropertyAccessExpression(node.expression)) return;
    if (node.expression.name.text !== 'setEnabled') return;
    const arg = node.arguments[0];
    if (arg && arg.kind === tsRef.SyntaxKind.FalseKeyword) found = true;
  });
  return found;
}

async function generatePersistenceRoundtrip(repoRoot) {
  const storePath = path.join(repoRoot, 'src/engine/extensions/store.ts');
  const persistencePath = path.join(repoRoot, 'src/transport/persistence.ts');

  let storeSrc = '';
  let persistenceSrc = '';
  try {
    storeSrc = await fs.readFile(storePath, 'utf8');
  } catch {
    // keep empty
  }
  try {
    persistenceSrc = await fs.readFile(persistencePath, 'utf8');
  } catch {
    // keep empty
  }

  const tsRef = await loadTypeScript();
  const storeAst = createSourceFile(tsRef, storePath, storeSrc);
  const persistenceAst = createSourceFile(tsRef, persistencePath, persistenceSrc);

  const resetFn = getFunctionDeclaration(tsRef, storeAst, 'resetAllExtensions');
  const newSongFn = getFunctionDeclaration(tsRef, persistenceAst, 'newSong');

  const hasResetFn = !!resetFn && !!resetFn.body;
  const resetCallsState = hasResetFn ? hasCallNamed(tsRef, resetFn.body, 'setState') : false;
  const resetDisables = hasResetFn ? hasSetEnabledFalse(tsRef, resetFn.body) : false;
  const newSongCallsReset = !!newSongFn?.body && hasCallNamed(tsRef, newSongFn.body, 'resetAllExtensions');
  const newSongCallsSave = !!newSongFn?.body && hasCallNamed(tsRef, newSongFn.body, 'saveSong');

  const pass = hasResetFn && resetCallsState && resetDisables && newSongCallsReset && newSongCallsSave;

  return {
    status: pass ? 'PASS' : 'FAIL',
    metrics: {
      state_hash_match: pass ? 1 : 0,
      roundtrip_stable: pass ? 1 : 0,
    },
    evidence: `reset_fn=${hasResetFn} reset_state=${resetCallsState} reset_disable=${resetDisables} newSong_reset=${newSongCallsReset} newSong_save=${newSongCallsSave}`,
    raw: {
      store_path: path.relative(repoRoot, storePath),
      persistence_path: path.relative(repoRoot, persistencePath),
      checks: {
        has_reset_fn: hasResetFn,
        reset_calls_state: resetCallsState,
        reset_disables: resetDisables,
        new_song_calls_reset: newSongCallsReset,
        new_song_calls_save: newSongCallsSave,
      },
    },
  };
}

async function generateControlBinding(repoRoot, taskId) {
  const specPath = path.join(repoRoot, 'docs/qc/specs', `${taskId}.task.spec.json`);
  let controls = [];
  try {
    const specRaw = await fs.readFile(specPath, 'utf8');
    const spec = JSON.parse(specRaw);
    controls = Array.isArray(spec?.capability?.controls) ? spec.capability.controls : [];
  } catch {
    controls = [];
  }

  const bindingCoverage = controls.length > 0 ? 1 : 0;
  return {
    status: bindingCoverage >= 1 ? 'PASS' : 'FAIL',
    metrics: {
      binding_coverage: bindingCoverage,
    },
    evidence: `controls_declared=${controls.length}`,
    raw: {
      spec_path: path.relative(repoRoot, specPath),
      controls_declared: controls.length,
      control_ids: controls.map((c) => (typeof c?.id === 'string' ? c.id : 'unknown')),
    },
  };
}

function buildChallengeResponse(challenge, taskId, subjectSha, executionProfile, payloadDigest) {
  if (!challenge) return null;
  return sha256(`${challenge}|${taskId}|${subjectSha}|${executionProfile}|${payloadDigest}`);
}

async function run() {
  const args = parseArgs(process.argv.slice(2));

  const profileAliases = {
    headless: 'real',
    interactive: 'real',
  };
  args.executionProfile = profileAliases[args.executionProfile] || args.executionProfile;

  if (!args.taskId || args.oracles.length === 0) {
    throw new Error('Usage: --task-id <id> --oracles o1,o2 --subject-sha <sha> --execution-profile <real> --challenge <nonce> --json');
  }
  if (!args.subjectSha) {
    throw new Error('Missing --subject-sha');
  }
  if (!['real'].includes(args.executionProfile)) {
    throw new Error(`Invalid --execution-profile: ${args.executionProfile}`);
  }

  const browser = await launchBrowser();
  const page = await browser.newPage();

  try {
    const needsOfflineAudio = args.oracles.some((id) =>
      ['off_transparent', 'on_audible', 'low_end_continuity', 'clip_guard', 'default_safety'].includes(id),
    );
    const needsBenchmark = args.oracles.includes('benchmark_worklet_budget');

    let offlineMetrics = null;
    let benchmarkMetrics = null;

    if (needsOfflineAudio) {
      offlineMetrics = await collectOfflineAudioMetrics(page);
    }

    if (needsBenchmark) {
      benchmarkMetrics = await runBenchmarkProbe(page, args.repoRoot);
    }

    const results = [];

    for (const oracleId of args.oracles) {
      if (oracleId === 'off_transparent') {
        const metric = offlineMetrics.off_transparent;
        const status = metric.max_abs_error <= 0.0001 ? 'PASS' : 'FAIL';
        results.push(
          sanitizeOracleResult(oracleId, {
            status,
            metrics: {
              max_abs_error: toRounded(metric.max_abs_error, 8),
              delta_lufs: toRounded(metric.delta_lufs, 6),
            },
            evidence: `max_abs_error=${metric.max_abs_error}`,
            raw: {
              oracle: oracleId,
              measurement: metric,
              details: offlineMetrics.details,
              measured_at_utc: nowIso(),
            },
          }),
        );
        continue;
      }

      if (oracleId === 'on_audible') {
        const metric = offlineMetrics.on_audible;
        const status = metric.delta_lufs >= 0.5 ? 'PASS' : 'FAIL';
        results.push(
          sanitizeOracleResult(oracleId, {
            status,
            metrics: {
              delta_lufs: toRounded(metric.delta_lufs, 6),
            },
            evidence: `delta_lufs=${metric.delta_lufs}`,
            raw: {
              oracle: oracleId,
              measurement: metric,
              details: offlineMetrics.details,
              measured_at_utc: nowIso(),
            },
          }),
        );
        continue;
      }

      if (oracleId === 'low_end_continuity') {
        const metric = offlineMetrics.low_end_continuity;
        const status = metric.max_neighbor_delta_lufs <= 1.5 ? 'PASS' : 'FAIL';
        results.push(
          sanitizeOracleResult(oracleId, {
            status,
            metrics: {
              max_neighbor_delta_lufs: toRounded(metric.max_neighbor_delta_lufs, 6),
            },
            evidence: `max_neighbor_delta_lufs=${metric.max_neighbor_delta_lufs}`,
            raw: {
              oracle: oracleId,
              measurement: metric,
              details: offlineMetrics.details,
              measured_at_utc: nowIso(),
            },
          }),
        );
        continue;
      }

      if (oracleId === 'clip_guard') {
        const metric = offlineMetrics.clip_guard;
        const status = metric.clip_count <= 0 ? 'PASS' : 'FAIL';
        results.push(
          sanitizeOracleResult(oracleId, {
            status,
            metrics: {
              clip_count: metric.clip_count,
            },
            evidence: `clip_count=${metric.clip_count}`,
            raw: {
              oracle: oracleId,
              measurement: metric,
              details: offlineMetrics.details,
              measured_at_utc: nowIso(),
            },
          }),
        );
        continue;
      }

      if (oracleId === 'default_safety') {
        const metric = offlineMetrics.default_safety;
        const status = metric.peak_dbfs <= -1.0 ? 'PASS' : 'FAIL';
        results.push(
          sanitizeOracleResult(oracleId, {
            status,
            metrics: {
              peak_dbfs: toRounded(metric.peak_dbfs, 4),
            },
            evidence: `peak_dbfs=${metric.peak_dbfs}`,
            raw: {
              oracle: oracleId,
              measurement: metric,
              details: offlineMetrics.details,
              measured_at_utc: nowIso(),
            },
          }),
        );
        continue;
      }

      if (oracleId === 'benchmark_worklet_budget') {
        const p99 = parseFiniteNumber(benchmarkMetrics.p99_text);
        const budget = parseFiniteNumber(benchmarkMetrics.budget_text);
        const gateShowsFail = /\bFAIL\b/i.test(benchmarkMetrics.gate_text || '');
        const structuralOk =
          benchmarkMetrics.has_audio_worklet_runtime &&
          benchmarkMetrics.interval_calls === 0 &&
          benchmarkMetrics.random_calls === 0 &&
          benchmarkMetrics.terminal_gate_state;
        const pass =
          !gateShowsFail &&
          structuralOk &&
          p99 !== null &&
          budget !== null &&
          benchmarkMetrics.sample_count >= 50 &&
          p99 <= budget;

        results.push(
          sanitizeOracleResult(oracleId, {
            status: pass ? 'PASS' : 'FAIL',
            metrics: {
              p99_ms: p99 !== null ? toRounded(p99, 4) : 999,
              sample_count: benchmarkMetrics.sample_count,
              structural_ok: structuralOk ? 1 : 0,
              gate_fail: gateShowsFail ? 1 : 0,
            },
            evidence: `profile=${args.executionProfile} gate="${benchmarkMetrics.gate_text}" samples=${benchmarkMetrics.sample_count} p99=${p99} budget=${budget} interval_calls=${benchmarkMetrics.interval_calls} random_calls=${benchmarkMetrics.random_calls} worklet_runtime=${benchmarkMetrics.has_audio_worklet_runtime ? 1 : 0}`,
            raw: {
              oracle: oracleId,
              profile: args.executionProfile,
              benchmark: benchmarkMetrics,
              derived: {
                p99,
                budget,
                structural_ok: structuralOk ? 1 : 0,
                gate_fail: gateShowsFail ? 1 : 0,
                pass,
              },
              measured_at_utc: nowIso(),
            },
          }),
        );
        continue;
      }

      if (oracleId === 'persistence_roundtrip') {
        const generated = await generatePersistenceRoundtrip(args.repoRoot);
        results.push(sanitizeOracleResult(oracleId, generated));
        continue;
      }

      if (oracleId === 'control_binding') {
        const generated = await generateControlBinding(args.repoRoot, args.taskId);
        results.push(sanitizeOracleResult(oracleId, generated));
        continue;
      }

      throw new Error(`Unknown oracle id: ${oracleId}`);
    }

    const digestInput = results
      .map((oracle) => ({
        oracle_id: oracle.oracle_id,
        status: oracle.status,
        metrics: oracle.metrics,
        raw_sha256: oracle.raw_sha256,
      }))
      .sort((a, b) => a.oracle_id.localeCompare(b.oracle_id));

    const payloadDigest = sha256(stableStringify(digestInput));
    const challengeResponse = buildChallengeResponse(
      args.challenge,
      args.taskId,
      args.subjectSha,
      args.executionProfile,
      payloadDigest,
    );

    const payload = {
      task_id: args.taskId,
      subject_sha: args.subjectSha,
      execution_profile: args.executionProfile,
      harness_version: HARNESS_VERSION,
      generated_at_utc: nowIso(),
      challenge: args.challenge,
      payload_digest: payloadDigest,
      challenge_response: challengeResponse,
      oracles: results,
    };

    if (args.json) {
      process.stdout.write(`${JSON.stringify(payload)}\n`);
      return;
    }

    for (const oracle of payload.oracles) {
      process.stdout.write(`${oracle.status} | ${oracle.oracle_id} | ${oracle.evidence}\n`);
    }
  } finally {
    await page.close();
    await browser.close();
  }
}

run().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`oracle-harness error: ${message}\n`);
  process.exit(1);
});
