#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const failures = [];
const passes = [];

function record(ok, name, detail) {
  if (ok) passes.push({ name, detail });
  else failures.push({ name, detail });
}

function runRg(pattern, targets) {
  const result = spawnSync('rg', ['-n', pattern, ...targets], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status === 0) {
    return { matched: true, out: (result.stdout || '').trim() };
  }
  if (result.status === 1) {
    return { matched: false, out: '' };
  }
  return {
    matched: true,
    out: `rg execution failed (status ${result.status}): ${result.stderr || 'unknown error'}`,
  };
}

async function checkNoFixme() {
  const r = runRg('test\\.fixme\\(', ['e2e', 'tests']);
  record(!r.matched, 'No fixme debt', r.matched ? r.out : 'No test.fixme() found.');
}

async function checkNoInformationalAsserts() {
  const r = runRg('assert\\([^\\n]*,\\s*true\\b', ['tests']);
  record(
    !r.matched,
    'No informational assertions',
    r.matched ? r.out : 'No assert(..., true, ...) patterns found.',
  );
}

async function checkNewSongExtensionReset() {
  const fp = path.join(root, 'src/transport/persistence.ts');
  const text = await fs.readFile(fp, 'utf8');
  const start = text.indexOf('export async function newSong(): Promise<void> {');
  const end = text.indexOf('export async function deleteSong(): Promise<boolean> {');
  if (start < 0 || end < 0 || end <= start) {
    record(false, 'newSong deterministic reset', 'Could not locate newSong()/deleteSong() boundaries.');
    return;
  }
  const block = text.slice(start, end);
  const hasLoop =
    block.includes('SEQ_EXTENSIONS.forEach') || block.includes('for (const ext of SEQ_EXTENSIONS)');
  const hasStateReset = block.includes('ext.setState(');
  const hasEnabledReset = block.includes('ext.setEnabled(');
  const ok = hasLoop && hasStateReset && hasEnabledReset;
  record(
    ok,
    'newSong deterministic reset',
    ok
      ? 'newSong() resets extension state + enabled state.'
      : 'Expected newSong() to reset extension state and enabled flags; pattern not found.',
  );
}

async function checkSetStateRespectsDisabled() {
  const preferredTargets = [
    'src/engine/extensions/pultec-eq.ts',
    'src/engine/extensions/compressor.ts',
    'src/engine/extensions/transformer.ts',
  ];
  const legacyTarget = 'src/engine/extensions/vari-mu.ts';
  const targets = [];
  for (const rel of preferredTargets) {
    try {
      await fs.access(path.join(root, rel));
      targets.push(rel);
    } catch {
      // ignore missing target
    }
  }
  if (targets.length === 0) {
    try {
      await fs.access(path.join(root, legacyTarget));
      targets.push(legacyTarget);
    } catch {
      // ignore missing legacy target
    }
  }
  if (targets.length === 0) {
    record(
      false,
      'setState respects disabled state',
      'No expected extension files found for disabled-state guard checks.',
    );
    return;
  }
  for (const rel of targets) {
    const text = await fs.readFile(path.join(root, rel), 'utf8');
    const regex = /setState\(s: ExtensionState\): void \{[\s\S]*?if \(enabled\) applyState\(\);[\s\S]*?\}/m;
    const ok = regex.test(text);
    record(
      ok,
      `${rel}: setState respects disabled state`,
      ok
        ? 'setState is guarded by enabled-state check.'
        : 'setState applies state without enabled guard (risk: off is not transparent).',
    );
  }
}

async function checkEngineControlCurves() {
  const rel = 'src/ui/engine-panel.ts';
  const text = await fs.readFile(path.join(root, rel), 'utf8');
  const required = [
    "t * t * 19000",
    "t * t * 10",
    "setExtParam('vari-mu', 'drive', t * t)",
    "setExtParam('vari-mu', 'compress', -6 - t * t * 34)",
  ];
  const missing = required.filter((token) => !text.includes(token));
  const ok = missing.length === 0;
  record(
    ok,
    'Engine low-end control curve safety',
    ok ? 'Squared curve safeguards are present for master controls.' : `Missing tokens: ${missing.join(', ')}`,
  );
}

async function checkBenchmarkDeterminism() {
  const rel = 'tests/benchmark.html';
  const text = await fs.readFile(path.join(root, rel), 'utf8');

  // Benchmark harness uses its own real stress test chain (saturation + compressor worklets),
  // not the removed benchmark-processor.ts which measured nothing meaningful.
  const hasRealChain = text.includes('AudioWorkletNode') && text.includes('saturation');
  const forbidden = ['Math.random('];
  const forbiddenFound = forbidden.filter((token) => text.includes(token));

  const ok = hasRealChain && forbiddenFound.length === 0;
  const detail = ok
    ? 'Benchmark harness uses real DSP chain for measurement.'
    : `hasRealChain=${hasRealChain}; forbidden=${forbiddenFound.join(', ') || 'none'}`;
  record(ok, 'Benchmark deterministic harness', detail);
}

async function main() {
  await checkNoFixme();
  await checkNoInformationalAsserts();
  await checkNewSongExtensionReset();
  await checkSetStateRespectsDisabled();
  await checkEngineControlCurves();
  await checkBenchmarkDeterminism();

  for (const p of passes) {
    console.log(`PASS | ${p.name} | ${p.detail}`);
  }
  for (const f of failures) {
    console.log(`FAIL | ${f.name} | ${f.detail}`);
  }

  if (failures.length > 0) {
    console.error(`\ncontract-gates: ${failures.length} failure(s), ${passes.length} pass(es).`);
    process.exit(1);
  }

  console.log(`\ncontract-gates: all ${passes.length} checks passed.`);
}

void main();
