#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const passes = [];
const failures = [];

function parseArgs(argv) {
  const args = { mode: 'full' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--mode') {
      args.mode = argv[i + 1] || 'full';
      i++;
    }
  }
  return args;
}

function parseChangedFilesFromEnv() {
  const raw = process.env.GOV_CHANGED_FILES || '';
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function matchesPattern(filePath, pattern) {
  if (pattern === '**' || pattern === '*') return true;
  if (pattern.endsWith('/**')) {
    const prefix = pattern.slice(0, -3);
    return filePath.startsWith(prefix);
  }
  if (pattern.includes('*')) {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`).test(filePath);
  }
  return filePath === pattern;
}

function touchesAny(changedFiles, patterns) {
  if (changedFiles.length === 0) return true;
  return changedFiles.some((filePath) => patterns.some((pattern) => matchesPattern(filePath, pattern)));
}

function record(ok, name, detail) {
  if (ok) passes.push({ name, detail });
  else failures.push({ name, detail });
}

function recordSkipped(name, detail) {
  passes.push({ name, detail: `[delta-skip] ${detail}` });
}

function runRg(pattern, targets) {
  const result = spawnSync('rg', ['-n', pattern, ...targets], {
    cwd: root,
    encoding: 'utf8',
  });

  if (result.error && result.error.code === 'ENOENT') {
    const grep = spawnSync('grep', ['-RInE', pattern, ...targets], {
      cwd: root,
      encoding: 'utf8',
    });
    if (grep.status === 0) {
      return { matched: true, out: (grep.stdout || '').trim() };
    }
    if (grep.status === 1) {
      return { matched: false, out: '' };
    }
    return {
      matched: true,
      out: `grep fallback failed (status ${grep.status}): ${grep.stderr || 'unknown error'}`,
    };
  }

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

function hasAddedPattern(pattern, targets) {
  const diff = spawnSync('git', ['diff', '--cached', '--unified=0', '--', ...targets], {
    cwd: root,
    encoding: 'utf8',
  });
  if (diff.status !== 0) {
    return { matched: true, out: `git diff failed (status ${diff.status}): ${diff.stderr || 'unknown error'}` };
  }

  const addedLines = (diff.stdout || '')
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'));

  const re = new RegExp(pattern);
  const hits = addedLines.filter((line) => re.test(line.slice(1)));
  if (hits.length > 0) {
    return { matched: true, out: hits.join('\n') };
  }
  return { matched: false, out: '' };
}

async function checkNoFixme(args, changedFiles) {
  if (args.mode === 'delta') {
    if (!touchesAny(changedFiles, ['e2e/**', 'tests/**'])) {
      recordSkipped('No fixme debt', 'No test files changed.');
      return;
    }
    const r = hasAddedPattern('test\\.fixme\\(', ['e2e', 'tests']);
    record(!r.matched, 'No fixme debt', r.matched ? r.out : 'No new test.fixme() additions in staged diff.');
    return;
  }
  const r = runRg('test\\.fixme\\(', ['e2e', 'tests']);
  record(!r.matched, 'No fixme debt', r.matched ? r.out : 'No test.fixme() found.');
}

async function checkNoInformationalAsserts(args, changedFiles) {
  if (args.mode === 'delta') {
    if (!touchesAny(changedFiles, ['tests/**'])) {
      recordSkipped('No informational assertions', 'No audio test files changed.');
      return;
    }
    const r = hasAddedPattern('assert\\([^\\n]*,\\s*true\\b', ['tests']);
    record(
      !r.matched,
      'No informational assertions',
      r.matched ? r.out : 'No new assert(..., true, ...) additions in staged diff.',
    );
    return;
  }
  const r = runRg('assert\\([^\\n]*,\\s*true\\b', ['tests']);
  record(!r.matched, 'No informational assertions', r.matched ? r.out : 'No assert(..., true, ...) patterns found.');
}

async function checkNewSongExtensionReset(args, changedFiles) {
  if (args.mode === 'delta' && !touchesAny(changedFiles, ['src/transport/persistence.ts'])) {
    recordSkipped('newSong deterministic reset', 'Persistence layer unchanged.');
    return;
  }

  const fp = path.join(root, 'src/transport/persistence.ts');
  const text = await fs.readFile(fp, 'utf8');
  const start = text.indexOf('export async function newSong(): Promise<void> {');
  const end = text.indexOf('export async function deleteSong(): Promise<boolean> {');
  if (start < 0 || end < 0 || end <= start) {
    record(false, 'newSong deterministic reset', 'Could not locate newSong()/deleteSong() boundaries.');
    return;
  }
  const block = text.slice(start, end);
  const hasHelperResetCall = block.includes('resetAllExtensions(');
  const hasLoop = block.includes('SEQ_EXTENSIONS.forEach') || block.includes('for (const ext of SEQ_EXTENSIONS)');
  const hasStateReset = block.includes('ext.setState(');
  const hasEnabledReset = block.includes('ext.setEnabled(');
  const hasInlineReset = hasLoop && hasStateReset && hasEnabledReset;
  const ok = hasHelperResetCall || hasInlineReset;
  record(
    ok,
    'newSong deterministic reset',
    ok
      ? hasHelperResetCall
        ? 'newSong() delegates deterministic reset via resetAllExtensions().'
        : 'newSong() resets extension state + enabled state inline.'
      : 'Expected newSong() to reset extension state and enabled flags; pattern not found.',
  );
}

async function checkSetStateRespectsDisabled(args, changedFiles) {
  const preferredTargets = [
    'src/engine/extensions/pultec-eq.ts',
    'src/engine/extensions/compressor.ts',
    'src/engine/extensions/transformer.ts',
  ];
  const legacyTarget = 'src/engine/extensions/vari-mu.ts';
  const allTargets = [...preferredTargets, legacyTarget];

  if (args.mode === 'delta' && !touchesAny(changedFiles, allTargets)) {
    recordSkipped('setState respects disabled state', 'Extension processors unchanged.');
    return;
  }

  const targets = [];
  for (const rel of preferredTargets) {
    try {
      await fs.access(path.join(root, rel));
      if (args.mode === 'full' || changedFiles.length === 0 || changedFiles.includes(rel)) {
        targets.push(rel);
      }
    } catch {
      // ignore missing target
    }
  }

  if (targets.length === 0 && (args.mode === 'full' || changedFiles.length === 0 || changedFiles.includes(legacyTarget))) {
    try {
      await fs.access(path.join(root, legacyTarget));
      targets.push(legacyTarget);
    } catch {
      // ignore missing legacy target
    }
  }

  if (targets.length === 0) {
    recordSkipped('setState respects disabled state', 'No extension state files selected in delta scope.');
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

async function checkEngineControlCurves(args, changedFiles) {
  const rel = 'src/ui/engine-panel.ts';
  if (args.mode === 'delta' && !touchesAny(changedFiles, [rel])) {
    recordSkipped('Engine low-end control curve safety', 'Engine panel control mappings unchanged.');
    return;
  }

  const text = await fs.readFile(path.join(root, rel), 'utf8');
  const required = [
    't * t * 19000',
    't * t * 10',
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

async function checkBenchmarkDeterminism(args, changedFiles) {
  if (
    args.mode === 'delta' &&
    !touchesAny(changedFiles, ['tests/benchmark.html', 'src/engine/worklets/benchmark-processor.ts'])
  ) {
    recordSkipped('Benchmark deterministic harness', 'Benchmark/worklet paths unchanged.');
    return;
  }

  const rel = 'tests/benchmark.html';
  const text = await fs.readFile(path.join(root, rel), 'utf8');

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
  const args = parseArgs(process.argv.slice(2));
  const changedFiles = parseChangedFilesFromEnv();

  await checkNoFixme(args, changedFiles);
  await checkNoInformationalAsserts(args, changedFiles);
  await checkNewSongExtensionReset(args, changedFiles);
  await checkSetStateRespectsDisabled(args, changedFiles);
  await checkEngineControlCurves(args, changedFiles);
  await checkBenchmarkDeterminism(args, changedFiles);

  for (const p of passes) {
    console.log(`PASS | ${p.name} | ${p.detail}`);
  }
  for (const f of failures) {
    console.log(`FAIL | ${f.name} | ${f.detail}`);
  }

  const label = args.mode === 'delta' ? 'contract-gates(delta)' : 'contract-gates';
  if (failures.length > 0) {
    console.error(`\n${label}: ${failures.length} failure(s), ${passes.length} pass(es).`);
    process.exit(1);
  }

  console.log(`\n${label}: all ${passes.length} checks passed.`);
}

void main();
