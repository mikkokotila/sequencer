#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const passes = [];
const failures = [];

function record(ok, name, detail) {
  if (ok) passes.push({ name, detail });
  else failures.push({ name, detail });
}

async function read(rel) {
  return fs.readFile(path.join(root, rel), 'utf8');
}

function runRg(pattern, targets) {
  const args = ['-n', pattern, ...targets];
  const result = spawnSync('rg', args, { cwd: root, encoding: 'utf8' });
  if (result.status === 0) return { matched: true, out: (result.stdout || '').trim() };
  if (result.status === 1) return { matched: false, out: '' };
  return {
    matched: true,
    out: `rg execution failed (status ${result.status}): ${result.stderr || 'unknown error'}`,
  };
}

async function checkNoDummyPassThroughNodes() {
  const targets = [
    'src/engine/extensions/reverb.ts',
    'src/engine/extensions/delay.ts',
    'src/engine/extensions/mixer.ts',
  ];
  const findings = [];
  for (const file of targets) {
    const text = await read(file);
    if (
      text.includes('const pass = ctx.createGain();') &&
      text.includes('return { input: pass, output: pass };')
    ) {
      findings.push(file);
    }
  }
  record(
    findings.length === 0,
    'No dummy pass-through extension nodes',
    findings.length === 0
      ? 'No pass-through dummy insert nodes detected.'
      : `Dummy node pattern found: ${findings.join(', ')}`,
  );
}

async function checkNoWindowSeqGlobalInExtensions() {
  const r = runRg('window\\.SEQ', ['src/engine/extensions']);
  record(
    !r.matched,
    'No global window.SEQ extension coupling',
    r.matched ? r.out : 'No window.SEQ usage found in extensions.',
  );
}

async function checkEngineInterfaceUsed() {
  const r = runRg('AudioEngine', ['src']);
  const lines = r.matched ? r.out.split('\n').filter(Boolean) : [];
  // Expect more than just the declaration in interface.ts.
  const ok = lines.length > 1;
  record(
    ok,
    'Engine interface contract is actually consumed',
    ok ? `AudioEngine references: ${lines.length}` : 'AudioEngine appears unused outside interface declaration.',
  );
}

async function checkSchedulerBoundary() {
  const text = await read('src/engine/scheduler.ts');
  const directPatternImport = text.includes("from '../transport/patterns'");
  const directSongImport = text.includes("from '../transport/song'");
  const ok = !directPatternImport && !directSongImport;
  record(
    ok,
    'Scheduler does not import transport internals directly',
    ok
      ? 'No direct scheduler->transport state imports detected.'
      : 'scheduler.ts imports transport internals directly.',
  );
}

async function checkPersistenceNoUICallbackInjection() {
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

async function checkPreviewNodeCleanup() {
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

async function checkInitAudioCallSpread() {
  const r = runRg('initAudio\\(', ['src']);
  const lines = r.matched ? r.out.split('\n').filter(Boolean) : [];
  const nonDef = lines.filter((line) => !line.includes('src/engine/audio.ts:84:'));
  const ok = nonDef.length <= 3;
  record(
    ok,
    'Audio initialization ownership is centralized',
    ok
      ? `initAudio call sites (excluding definition): ${nonDef.length}`
      : `Too many initAudio call sites (${nonDef.length}).`,
  );
}

async function checkNoSilentDecodeCatch() {
  const text = await read('src/transport/persistence.ts');
  const hasSilentDecodeCatch = /decodeAudioData\([\s\S]*?\)\s*;\s*\}\s*catch\s*\{\s*[\s\S]*?\}/m.test(
    text,
  );
  record(
    !hasSilentDecodeCatch,
    'Decode failures are not silently swallowed',
    hasSilentDecodeCatch
      ? 'Detected catch {} style decode fallback without explicit error context.'
      : 'No silent decode catch blocks detected.',
  );
}

async function checkNoDuplicateUiBusinessLogic() {
  const painting = await read('src/ui/painting.ts');
  const cells = await read('src/ui/cells.ts');
  const hasReplicateTrackInUI = painting.includes('export function replicateTrack(');
  const hasSetMelodyCellInUI = cells.includes('export function setMelodyCell(');
  const ok = !hasReplicateTrackInUI && !hasSetMelodyCellInUI;
  record(
    ok,
    'UI does not duplicate transport business logic',
    ok
      ? 'No duplicate replicateTrack/setMelodyCell in UI layer.'
      : 'Duplicate track replication and/or melody mutation logic exists in UI layer.',
  );
}

async function checkPaintingSetupIdempotent() {
  const text = await read('src/ui/painting.ts');
  const hasInitGuard =
    text.includes('let paintingInitialized') ||
    text.includes('let isPaintingSetup') ||
    text.includes('if (paintingSetupDone) return');
  record(
    hasInitGuard,
    'Painting event setup is idempotent',
    hasInitGuard ? 'Found setup guard.' : 'No idempotency guard detected for setupPainting().',
  );
}

async function checkNoInlinePlayheadStyleThrash() {
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

async function checkNoEmptyStringPaintTypeSentinel() {
  const text = await read('src/state.ts');
  const hasSentinel = text.includes("export type PaintType = 'drum' | 'melody' | 'vocal' | '';");
  record(
    !hasSentinel,
    'PaintType does not use empty-string sentinel',
    hasSentinel ? "PaintType includes ''. Use explicit null." : 'No empty-string PaintType sentinel detected.',
  );
}

async function checkNoTransportInnerHtmlTemplate() {
  const text = await read('src/ui/build.ts');
  const hasTransportInnerHtml = text.includes('transport.innerHTML =');
  record(
    !hasTransportInnerHtml,
    'Transport UI avoids large innerHTML template injection',
    hasTransportInnerHtml
      ? 'transport.innerHTML template detected; prefer explicit DOM builder with bound refs.'
      : 'No transport.innerHTML injection detected.',
  );
}

async function checkBenchmarkHarnessDeterminism() {
  const text = await read('tests/benchmark.html');
  const forbidden = ['Math.random(', 'setInterval(', 'currentTime'];
  const hits = forbidden.filter((token) => text.includes(token));
  record(
    hits.length === 0,
    'Benchmark harness is deterministic (no proxy timing/randomness)',
    hits.length === 0 ? 'No forbidden benchmark timing proxies detected.' : `Forbidden tokens: ${hits.join(', ')}`,
  );
}

async function checkBenchmarkProcessorRemoved() {
  // The fake benchmark-processor.ts was removed because it measured nothing
  // (performance.now() immediately before and after with no work in between).
  // benchmark.html uses its own real stress-test chain instead.
  const exists = await fs.access(path.join(root, 'src/engine/worklets/benchmark-processor.ts')).then(() => true).catch(() => false);
  record(
    !exists,
    'Fake benchmark processor removed',
    exists
      ? 'benchmark-processor.ts still exists — should be deleted.'
      : 'benchmark-processor.ts correctly removed.',
  );
}

async function main() {
  await checkNoDummyPassThroughNodes();
  await checkNoWindowSeqGlobalInExtensions();
  await checkEngineInterfaceUsed();
  await checkSchedulerBoundary();
  await checkPersistenceNoUICallbackInjection();
  await checkPreviewNodeCleanup();
  await checkInitAudioCallSpread();
  await checkNoSilentDecodeCatch();
  await checkNoDuplicateUiBusinessLogic();
  await checkPaintingSetupIdempotent();
  await checkNoInlinePlayheadStyleThrash();
  await checkNoEmptyStringPaintTypeSentinel();
  await checkNoTransportInnerHtmlTemplate();
  await checkBenchmarkHarnessDeterminism();
  await checkBenchmarkProcessorRemoved();

  for (const p of passes) {
    console.log(`PASS | ${p.name} | ${p.detail}`);
  }
  for (const f of failures) {
    console.log(`FAIL | ${f.name} | ${f.detail}`);
  }

  if (failures.length > 0) {
    console.error(`\narchitecture-gates: ${failures.length} failure(s), ${passes.length} pass(es).`);
    process.exit(1);
  }

  console.log(`\narchitecture-gates: all ${passes.length} checks passed.`);
}

void main();
