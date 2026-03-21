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

async function read(rel) {
  return fs.readFile(path.join(root, rel), 'utf8');
}

function runRg(pattern, targets) {
  const args = ['-n', pattern, ...targets];
  const result = spawnSync('rg', args, { cwd: root, encoding: 'utf8' });

  if (result.error && result.error.code === 'ENOENT') {
    const grep = spawnSync('grep', ['-RInE', pattern, ...targets], { cwd: root, encoding: 'utf8' });
    if (grep.status === 0) return { matched: true, out: (grep.stdout || '').trim() };
    if (grep.status === 1) return { matched: false, out: '' };
    return {
      matched: true,
      out: `grep fallback failed (status ${grep.status}): ${grep.stderr || 'unknown error'}`,
    };
  }

  if (result.status === 0) return { matched: true, out: (result.stdout || '').trim() };
  if (result.status === 1) return { matched: false, out: '' };
  return {
    matched: true,
    out: `rg execution failed (status ${result.status}): ${result.stderr || 'unknown error'}`,
  };
}

function readAddedLines(targets) {
  const diff = spawnSync('git', ['diff', '--cached', '--unified=0', '--', ...targets], {
    cwd: root,
    encoding: 'utf8',
  });
  if (diff.status !== 0) {
    return { ok: false, lines: [], error: `git diff failed (status ${diff.status}): ${diff.stderr || 'unknown error'}` };
  }
  const lines = (diff.stdout || '')
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1));
  return { ok: true, lines, error: '' };
}

function hasAddedPattern(pattern, targets) {
  const added = readAddedLines(targets);
  if (!added.ok) {
    return { matched: true, out: added.error };
  }
  const re = new RegExp(pattern);
  const hits = added.lines.filter((line) => re.test(line));
  if (hits.length > 0) {
    return { matched: true, out: hits.join('\n') };
  }
  return { matched: false, out: '' };
}

async function checkNoDummyPassThroughNodes(args, changedFiles) {
  const targets = [
    'src/engine/extensions/reverb.ts',
    'src/engine/extensions/delay.ts',
    'src/engine/extensions/mixer.ts',
  ];
  if (args.mode === 'delta' && !touchesAny(changedFiles, targets)) {
    recordSkipped('No dummy pass-through extension nodes', 'Extension topology files unchanged.');
    return;
  }

  const findings = [];
  for (const file of targets) {
    const text = await read(file);
    if (text.includes('const pass = ctx.createGain();') && text.includes('return { input: pass, output: pass };')) {
      findings.push(file);
    }
  }
  record(
    findings.length === 0,
    'No dummy pass-through extension nodes',
    findings.length === 0 ? 'No pass-through dummy insert nodes detected.' : `Dummy node pattern found: ${findings.join(', ')}`,
  );
}

async function checkNoWindowSeqGlobalInExtensions(args, changedFiles) {
  if (args.mode === 'delta' && !touchesAny(changedFiles, ['src/engine/extensions/**'])) {
    recordSkipped('No global window.SEQ extension coupling', 'Extension files unchanged.');
    return;
  }
  if (args.mode === 'delta') {
    const r = hasAddedPattern('window\\.SEQ', ['src/engine/extensions']);
    record(
      !r.matched,
      'No global window.SEQ extension coupling',
      r.matched ? r.out : 'No new window.SEQ additions in staged diff.',
    );
    return;
  }
  const r = runRg('window\\.SEQ', ['src/engine/extensions']);
  record(!r.matched, 'No global window.SEQ extension coupling', r.matched ? r.out : 'No window.SEQ usage found in extensions.');
}

async function checkEngineInterfaceUsed(args, changedFiles) {
  if (args.mode === 'delta' && !touchesAny(changedFiles, ['src/engine/interface.ts', 'src/engine/scheduler.ts'])) {
    recordSkipped('Engine interface contract is actually consumed', 'Engine boundary files unchanged.');
    return;
  }
  const r = runRg('AudioEngine', ['src']);
  const lines = r.matched ? r.out.split('\n').filter(Boolean) : [];
  const ok = lines.length > 1;
  record(
    ok,
    'Engine interface contract is actually consumed',
    ok ? `AudioEngine references: ${lines.length}` : 'AudioEngine appears unused outside interface declaration.',
  );
}

async function checkSchedulerBoundary(args, changedFiles) {
  if (args.mode === 'delta' && !touchesAny(changedFiles, ['src/engine/scheduler.ts'])) {
    recordSkipped('Scheduler does not import transport internals directly', 'Scheduler file unchanged.');
    return;
  }
  const text = await read('src/engine/scheduler.ts');
  const directPatternImport = text.includes("from '../transport/patterns'");
  const directSongImport = text.includes("from '../transport/song'");
  const ok = !directPatternImport && !directSongImport;
  record(
    ok,
    'Scheduler does not import transport internals directly',
    ok ? 'No direct scheduler->transport state imports detected.' : 'scheduler.ts imports transport internals directly.',
  );
}

async function checkPersistenceNoUICallbackInjection(args, changedFiles) {
  if (args.mode === 'delta' && !touchesAny(changedFiles, ['src/transport/persistence.ts', 'src/main.ts'])) {
    recordSkipped('Persistence lifecycle decoupled from UI callback injection', 'Persistence lifecycle files unchanged.');
    return;
  }
  const text = await read('src/transport/persistence.ts');
  const hasCallbackInterface = text.includes('interface PersistenceCallbacks');
  const hasSetter = text.includes('setPersistenceCallbacks(');
  const ok = !hasCallbackInterface && !hasSetter;
  record(
    ok,
    'Persistence lifecycle decoupled from UI callback injection',
    ok ? 'No persistence callback injection API detected.' : 'Persistence callback injection API still present.',
  );
}

async function checkPreviewNodeCleanup(args, changedFiles) {
  if (args.mode === 'delta' && !touchesAny(changedFiles, ['src/engine/audio.ts'])) {
    recordSkipped('Preview audio nodes are explicitly cleaned up', 'Audio core preview path unchanged.');
    return;
  }
  const text = await read('src/engine/audio.ts');
  const hasPreviewGain = text.includes('const previewGain = audioCtx.createGain();');
  const hasEndedCleanup = text.includes('src.onended') && text.includes('previewGain.disconnect()');
  const ok = !hasPreviewGain || hasEndedCleanup;
  record(
    ok,
    'Preview audio nodes are explicitly cleaned up',
    ok ? 'Preview node cleanup logic detected.' : 'previewGain is created without explicit onended disconnect cleanup.',
  );
}

async function checkInitAudioCallSpread(args, changedFiles) {
  if (
    args.mode === 'delta' &&
    !touchesAny(changedFiles, ['src/engine/audio.ts', 'src/main.ts', 'src/ui/**', 'src/transport/persistence.ts'])
  ) {
    recordSkipped('Audio initialization ownership is centralized', 'initAudio callsite files unchanged.');
    return;
  }
  if (args.mode === 'delta') {
    const deltaTargets = changedFiles.filter((filePath) => filePath.startsWith('src/'));
    if (deltaTargets.length === 0) {
      recordSkipped('Audio initialization ownership is centralized', 'No source files in delta scope.');
      return;
    }
    const added = readAddedLines(deltaTargets);
    if (!added.ok) {
      record(false, 'Audio initialization ownership is centralized', added.error);
      return;
    }
    const newCalls = added.lines.filter(
      (line) =>
        /\binitAudio\(/.test(line) &&
        !/function\s+initAudio\s*\(/.test(line) &&
        !/import\s+\{[^}]*\binitAudio\b/.test(line),
    );
    record(
      newCalls.length === 0,
      'Audio initialization ownership is centralized',
      newCalls.length === 0
        ? 'No new initAudio call sites added in staged diff.'
        : `New initAudio call sites added: ${newCalls.join(' | ')}`,
    );
    return;
  }
  const r = runRg('initAudio\\(', ['src']);
  const lines = r.matched ? r.out.split('\n').filter(Boolean) : [];
  const nonDef = lines.filter((line) => !line.includes('src/engine/audio.ts:84:'));
  const ok = nonDef.length <= 3;
  record(
    ok,
    'Audio initialization ownership is centralized',
    ok ? `initAudio call sites (excluding definition): ${nonDef.length}` : `Too many initAudio call sites (${nonDef.length}).`,
  );
}

async function checkNoSilentDecodeCatch(args, changedFiles) {
  if (args.mode === 'delta' && !touchesAny(changedFiles, ['src/transport/persistence.ts'])) {
    recordSkipped('Decode failures are not silently swallowed', 'Persistence decode path unchanged.');
    return;
  }
  const text = await read('src/transport/persistence.ts');
  const hasSilentDecodeCatch = /decodeAudioData\([\s\S]*?\)\s*;\s*\}\s*catch\s*\{\s*[\s\S]*?\}/m.test(text);
  record(
    !hasSilentDecodeCatch,
    'Decode failures are not silently swallowed',
    hasSilentDecodeCatch ? 'Detected catch {} style decode fallback without explicit error context.' : 'No silent decode catch blocks detected.',
  );
}

async function checkNoDuplicateUiBusinessLogic(args, changedFiles) {
  if (args.mode === 'delta' && !touchesAny(changedFiles, ['src/ui/painting.ts', 'src/ui/cells.ts', 'src/transport/patterns.ts'])) {
    recordSkipped('UI does not duplicate transport business logic', 'UI/transport rule files unchanged.');
    return;
  }
  const painting = await read('src/ui/painting.ts');
  const cells = await read('src/ui/cells.ts');
  const hasReplicateTrackInUI = painting.includes('export function replicateTrack(');
  const hasSetMelodyCellInUI = cells.includes('export function setMelodyCell(');
  const ok = !hasReplicateTrackInUI && !hasSetMelodyCellInUI;
  record(
    ok,
    'UI does not duplicate transport business logic',
    ok ? 'No duplicate replicateTrack/setMelodyCell in UI layer.' : 'Duplicate track replication and/or melody mutation logic exists in UI layer.',
  );
}

async function checkPaintingSetupIdempotent(args, changedFiles) {
  if (args.mode === 'delta' && !touchesAny(changedFiles, ['src/ui/painting.ts', 'src/ui/build.ts'])) {
    recordSkipped('Painting event setup is idempotent', 'Painting setup files unchanged.');
    return;
  }
  const text = await read('src/ui/painting.ts');
  const hasInitGuard =
    text.includes('let paintingInitialized') || text.includes('let isPaintingSetup') || text.includes('if (paintingSetupDone) return');
  record(hasInitGuard, 'Painting event setup is idempotent', hasInitGuard ? 'Found setup guard.' : 'No idempotency guard detected for setupPainting().');
}

async function checkNoInlinePlayheadStyleThrash(args, changedFiles) {
  if (args.mode === 'delta' && !touchesAny(changedFiles, ['src/ui/playhead.ts', 'src/ui/cells.ts'])) {
    recordSkipped('Playhead/cell rendering avoids repeated inline style mutation', 'Playhead/cell render files unchanged.');
    return;
  }
  const playhead = await read('src/ui/playhead.ts');
  const cells = await read('src/ui/cells.ts');
  const hasInline =
    playhead.includes('.style.background') ||
    playhead.includes('.style.boxShadow') ||
    cells.includes('.style.background') ||
    cells.includes('.style.boxShadow');
  record(
    !hasInline,
    'Playhead/cell rendering avoids repeated inline style mutation',
    hasInline ? 'Inline style mutation detected in playhead/cell render paths.' : 'No inline style thrash patterns found.',
  );
}

async function checkNoEmptyStringPaintTypeSentinel(args, changedFiles) {
  if (args.mode === 'delta' && !touchesAny(changedFiles, ['src/state.ts', 'src/ui/painting.ts'])) {
    recordSkipped('PaintType does not use empty-string sentinel', 'Paint state files unchanged.');
    return;
  }
  const text = await read('src/state.ts');
  const hasSentinel = text.includes("export type PaintType = 'drum' | 'melody' | 'vocal' | '';");
  record(!hasSentinel, 'PaintType does not use empty-string sentinel', hasSentinel ? "PaintType includes ''. Use explicit null." : 'No empty-string PaintType sentinel detected.');
}

async function checkNoTransportInnerHtmlTemplate(args, changedFiles) {
  if (args.mode === 'delta' && !touchesAny(changedFiles, ['src/ui/build.ts'])) {
    recordSkipped('Transport UI avoids large innerHTML template injection', 'Transport builder unchanged.');
    return;
  }
  const text = await read('src/ui/build.ts');
  const hasTransportInnerHtml = text.includes('transport.innerHTML =');
  record(
    !hasTransportInnerHtml,
    'Transport UI avoids large innerHTML template injection',
    hasTransportInnerHtml ? 'transport.innerHTML template detected; prefer explicit DOM builder with bound refs.' : 'No transport.innerHTML injection detected.',
  );
}

async function checkBenchmarkHarnessDeterminism(args, changedFiles) {
  if (args.mode === 'delta' && !touchesAny(changedFiles, ['tests/benchmark.html', 'src/engine/worklets/**'])) {
    recordSkipped('Benchmark harness is deterministic (no proxy timing/randomness)', 'Benchmark harness files unchanged.');
    return;
  }
  const text = await read('tests/benchmark.html');
  const forbidden = ['Math.random(', 'setInterval(', 'currentTime'];
  const hits = forbidden.filter((token) => text.includes(token));
  record(
    hits.length === 0,
    'Benchmark harness is deterministic (no proxy timing/randomness)',
    hits.length === 0 ? 'No forbidden benchmark timing proxies detected.' : `Forbidden tokens: ${hits.join(', ')}`,
  );
}

async function checkBenchmarkProcessorRemoved(args, changedFiles) {
  if (args.mode === 'delta' && !touchesAny(changedFiles, ['src/engine/worklets/**'])) {
    recordSkipped('Fake benchmark processor removed', 'Worklet files unchanged.');
    return;
  }
  const exists = await fs
    .access(path.join(root, 'src/engine/worklets/benchmark-processor.ts'))
    .then(() => true)
    .catch(() => false);
  record(!exists, 'Fake benchmark processor removed', exists ? 'benchmark-processor.ts still exists — should be deleted.' : 'benchmark-processor.ts correctly removed.');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const changedFiles = parseChangedFilesFromEnv();

  await checkNoDummyPassThroughNodes(args, changedFiles);
  await checkNoWindowSeqGlobalInExtensions(args, changedFiles);
  await checkEngineInterfaceUsed(args, changedFiles);
  await checkSchedulerBoundary(args, changedFiles);
  await checkPersistenceNoUICallbackInjection(args, changedFiles);
  await checkPreviewNodeCleanup(args, changedFiles);
  await checkInitAudioCallSpread(args, changedFiles);
  await checkNoSilentDecodeCatch(args, changedFiles);
  await checkNoDuplicateUiBusinessLogic(args, changedFiles);
  await checkPaintingSetupIdempotent(args, changedFiles);
  await checkNoInlinePlayheadStyleThrash(args, changedFiles);
  await checkNoEmptyStringPaintTypeSentinel(args, changedFiles);
  await checkNoTransportInnerHtmlTemplate(args, changedFiles);
  await checkBenchmarkHarnessDeterminism(args, changedFiles);
  await checkBenchmarkProcessorRemoved(args, changedFiles);

  for (const p of passes) {
    console.log(`PASS | ${p.name} | ${p.detail}`);
  }
  for (const f of failures) {
    console.log(`FAIL | ${f.name} | ${f.detail}`);
  }

  const label = args.mode === 'delta' ? 'architecture-gates(delta)' : 'architecture-gates';
  if (failures.length > 0) {
    console.error(`\n${label}: ${failures.length} failure(s), ${passes.length} pass(es).`);
    process.exit(1);
  }

  console.log(`\n${label}: all ${passes.length} checks passed.`);
}

void main();
