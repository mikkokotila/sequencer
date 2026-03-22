#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';

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

function walk(node, cb) {
  cb(node);
  node.forEachChild((child) => walk(child, cb));
}

function scriptKindFor(filePath) {
  if (filePath.endsWith('.ts')) return ts.ScriptKind.TS;
  if (filePath.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (filePath.endsWith('.js')) return ts.ScriptKind.JS;
  if (filePath.endsWith('.jsx')) return ts.ScriptKind.JSX;
  return ts.ScriptKind.Unknown;
}

function createSourceFile(filePath, content, kind = scriptKindFor(filePath)) {
  return ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, kind);
}

function extractHtmlScriptBlocks(html) {
  const blocks = [];
  const scriptTag = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptTag.exec(html)) !== null) {
    const full = match[0] || '';
    const content = match[1] || '';
    const startIdx = match.index;
    const openTagEnd = full.indexOf('>');
    const scriptContentStart = startIdx + (openTagEnd >= 0 ? openTagEnd + 1 : 0);
    const prefix = html.slice(0, scriptContentStart);
    const lineOffset = prefix.split('\n').length - 1;
    blocks.push({ content, lineOffset });
  }
  return blocks;
}

function nodeLocation(relPath, sourceFile, node, lineOffset = 0) {
  const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return {
    file: relPath,
    line: pos.line + 1 + lineOffset,
    col: pos.character + 1,
  };
}

function formatViolation(v) {
  const where = `${v.file}:${v.line}`;
  return `${where}: ${v.message}`;
}

function parseAddedLineMap(targets) {
  const diff = spawnSync('git', ['diff', '--cached', '--unified=0', '--', ...targets], {
    cwd: root,
    encoding: 'utf8',
  });

  if (diff.status !== 0) {
    return {
      ok: false,
      map: new Map(),
      error: `git diff failed (status ${diff.status}): ${diff.stderr || 'unknown error'}`,
    };
  }

  const addedByFile = new Map();
  const lines = (diff.stdout || '').split('\n');
  let currentFile = '';
  let newLine = 0;

  for (const line of lines) {
    if (line.startsWith('+++ b/')) {
      currentFile = line.slice('+++ b/'.length).trim();
      if (!addedByFile.has(currentFile)) addedByFile.set(currentFile, new Set());
      continue;
    }

    const hunk = line.match(/^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,(\d+))?\s+@@/);
    if (hunk) {
      newLine = Number.parseInt(hunk[1], 10);
      continue;
    }

    if (!currentFile) continue;
    if (line.startsWith('+') && !line.startsWith('+++')) {
      addedByFile.get(currentFile)?.add(newLine);
      newLine += 1;
      continue;
    }
    if (line.startsWith('-') && !line.startsWith('---')) {
      continue;
    }
    if (line.startsWith(' ')) {
      newLine += 1;
    }
  }

  return { ok: true, map: addedByFile, error: '' };
}

function isViolationOnAddedLine(addedMap, violation) {
  const lines = addedMap.get(violation.file);
  if (!lines) return false;
  return lines.has(violation.line);
}

async function listFilesRecursive(relDir, allowedExts) {
  const out = [];
  const base = path.join(root, relDir);

  async function visit(absDir, relPrefix) {
    let entries = [];
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const abs = path.join(absDir, entry.name);
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : `${relDir}/${entry.name}`;
      if (entry.isDirectory()) {
        await visit(abs, rel);
      } else if (allowedExts.some((ext) => rel.endsWith(ext))) {
        out.push(rel);
      }
    }
  }

  await visit(base, '');
  return out.sort();
}

async function collectSources(relFiles) {
  const sources = [];

  for (const rel of relFiles) {
    let text = '';
    try {
      text = await fs.readFile(path.join(root, rel), 'utf8');
    } catch {
      continue;
    }

    if (rel.endsWith('.html')) {
      const blocks = extractHtmlScriptBlocks(text);
      blocks.forEach((block, i) => {
        const virtual = `${rel}#script${i + 1}.js`;
        const sourceFile = createSourceFile(virtual, block.content, ts.ScriptKind.JS);
        sources.push({ relPath: rel, sourceFile, lineOffset: block.lineOffset });
      });
      continue;
    }

    sources.push({ relPath: rel, sourceFile: createSourceFile(rel, text), lineOffset: 0 });
  }

  return sources;
}

function findTestFixmeViolations(sources) {
  const violations = [];

  for (const src of sources) {
    walk(src.sourceFile, (node) => {
      if (!ts.isCallExpression(node)) return;
      const expr = node.expression;
      if (!ts.isPropertyAccessExpression(expr)) return;
      if (!ts.isIdentifier(expr.expression) || expr.expression.text !== 'test') return;
      if (expr.name.text !== 'fixme') return;

      violations.push({
        ...nodeLocation(src.relPath, src.sourceFile, node, src.lineOffset),
        message: 'test.fixme(...)',
      });
    });
  }

  return violations;
}

function findInformationalAssertViolations(sources) {
  const violations = [];

  for (const src of sources) {
    walk(src.sourceFile, (node) => {
      if (!ts.isCallExpression(node)) return;
      if (!ts.isIdentifier(node.expression) || node.expression.text !== 'assert') return;
      const arg = node.arguments[1];
      if (!arg || arg.kind !== ts.SyntaxKind.TrueKeyword) return;

      violations.push({
        ...nodeLocation(src.relPath, src.sourceFile, node, src.lineOffset),
        message: 'assert(..., true, ...)',
      });
    });
  }

  return violations;
}

function containsIdentifier(node, name) {
  let found = false;
  walk(node, (child) => {
    if (found) return;
    if (ts.isIdentifier(child) && child.text === name) {
      found = true;
    }
  });
  return found;
}

function containsCallNamed(node, name) {
  let found = false;
  walk(node, (child) => {
    if (found) return;
    if (!ts.isCallExpression(child)) return;
    if (ts.isIdentifier(child.expression) && child.expression.text === name) {
      found = true;
    }
  });
  return found;
}

async function checkNoFixme(args, changedFiles) {
  const allTestFiles = await listFilesRecursive('e2e', ['.ts', '.js', '.html']);
  const extraTestFiles = await listFilesRecursive('tests', ['.ts', '.js', '.html']);
  const relFiles = [...allTestFiles, ...extraTestFiles].sort();

  if (args.mode === 'delta') {
    if (!touchesAny(changedFiles, ['e2e/**', 'tests/**'])) {
      recordSkipped('No fixme debt', 'No test files changed.');
      return;
    }

    const targets = changedFiles.filter((f) => f.startsWith('e2e/') || f.startsWith('tests/'));
    const sources = await collectSources(targets);
    const violations = findTestFixmeViolations(sources);

    const added = parseAddedLineMap(['e2e', 'tests']);
    if (!added.ok) {
      record(false, 'No fixme debt', added.error);
      return;
    }

    const newViolations = violations.filter((v) => isViolationOnAddedLine(added.map, v));
    record(
      newViolations.length === 0,
      'No fixme debt',
      newViolations.length === 0
        ? 'No new test.fixme() additions in staged diff.'
        : newViolations.map(formatViolation).join('\n'),
    );
    return;
  }

  const sources = await collectSources(relFiles);
  const violations = findTestFixmeViolations(sources);
  record(
    violations.length === 0,
    'No fixme debt',
    violations.length === 0 ? 'No test.fixme() found.' : violations.map(formatViolation).join('\n'),
  );
}

async function checkNoInformationalAsserts(args, changedFiles) {
  const relFiles = await listFilesRecursive('tests', ['.ts', '.js', '.html']);

  if (args.mode === 'delta') {
    if (!touchesAny(changedFiles, ['tests/**'])) {
      recordSkipped('No informational assertions', 'No audio test files changed.');
      return;
    }

    const targets = changedFiles.filter((f) => f.startsWith('tests/'));
    const sources = await collectSources(targets);
    const violations = findInformationalAssertViolations(sources);

    const added = parseAddedLineMap(['tests']);
    if (!added.ok) {
      record(false, 'No informational assertions', added.error);
      return;
    }

    const newViolations = violations.filter((v) => isViolationOnAddedLine(added.map, v));
    record(
      newViolations.length === 0,
      'No informational assertions',
      newViolations.length === 0
        ? 'No new assert(..., true, ...) additions in staged diff.'
        : newViolations.map(formatViolation).join('\n'),
    );
    return;
  }

  const sources = await collectSources(relFiles);
  const violations = findInformationalAssertViolations(sources);
  record(
    violations.length === 0,
    'No informational assertions',
    violations.length === 0 ? 'No assert(..., true, ...) patterns found.' : violations.map(formatViolation).join('\n'),
  );
}

async function checkNewSongExtensionReset(args, changedFiles) {
  const rel = 'src/transport/persistence.ts';
  if (args.mode === 'delta' && !touchesAny(changedFiles, [rel])) {
    recordSkipped('newSong deterministic reset', 'Persistence layer unchanged.');
    return;
  }

  const text = await fs.readFile(path.join(root, rel), 'utf8');
  const sourceFile = createSourceFile(rel, text, ts.ScriptKind.TS);

  let newSongFn = null;
  walk(sourceFile, (node) => {
    if (!ts.isFunctionDeclaration(node) || !node.name) return;
    if (node.name.text === 'newSong') newSongFn = node;
  });

  if (!newSongFn || !newSongFn.body) {
    record(false, 'newSong deterministic reset', 'Could not locate newSong() function body.');
    return;
  }

  let hasHelperResetCall = false;
  let hasStateReset = false;
  let hasEnabledReset = false;

  walk(newSongFn.body, (node) => {
    if (!ts.isCallExpression(node)) return;
    if (ts.isIdentifier(node.expression) && node.expression.text === 'resetAllExtensions') {
      hasHelperResetCall = true;
      return;
    }
    if (ts.isPropertyAccessExpression(node.expression)) {
      if (node.expression.name.text === 'setState') hasStateReset = true;
      if (node.expression.name.text === 'setEnabled') hasEnabledReset = true;
    }
  });

  const hasInlineReset = hasStateReset && hasEnabledReset;
  const ok = hasHelperResetCall || hasInlineReset;

  record(
    ok,
    'newSong deterministic reset',
    ok
      ? hasHelperResetCall
        ? 'newSong() delegates deterministic reset via resetAllExtensions().'
        : 'newSong() resets extension state + enabled state inline.'
      : 'Expected newSong() to reset extension state and enabled flags; required calls not found.',
  );
}

function methodName(node) {
  if (!node?.name) return '';
  if (ts.isIdentifier(node.name)) return node.name.text;
  if (ts.isStringLiteral(node.name)) return node.name.text;
  return '';
}

function hasEnabledGuardedApplyState(methodNode) {
  if (!methodNode.body) return false;
  let guarded = false;

  walk(methodNode.body, (node) => {
    if (guarded) return;

    if (ts.isIfStatement(node)) {
      const conditionHasEnabled = containsIdentifier(node.expression, 'enabled');
      if (conditionHasEnabled && containsCallNamed(node.thenStatement, 'applyState')) {
        guarded = true;
        return;
      }
    }

    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      const leftHasEnabled = containsIdentifier(node.left, 'enabled');
      const rightCallsApply = containsCallNamed(node.right, 'applyState');
      if (leftHasEnabled && rightCallsApply) {
        guarded = true;
      }
    }
  });

  return guarded;
}

async function fileExists(rel) {
  try {
    await fs.access(path.join(root, rel));
    return true;
  } catch {
    return false;
  }
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
    if (await fileExists(rel)) {
      if (args.mode === 'full' || changedFiles.length === 0 || changedFiles.includes(rel)) targets.push(rel);
    }
  }

  if (
    targets.length === 0 &&
    (args.mode === 'full' || changedFiles.length === 0 || changedFiles.includes(legacyTarget)) &&
    (await fileExists(legacyTarget))
  ) {
    targets.push(legacyTarget);
  }

  if (targets.length === 0) {
    recordSkipped('setState respects disabled state', 'No extension state files selected in delta scope.');
    return;
  }

  for (const rel of targets) {
    const text = await fs.readFile(path.join(root, rel), 'utf8');
    const sourceFile = createSourceFile(rel, text, ts.ScriptKind.TS);

    const setStateMethods = [];
    walk(sourceFile, (node) => {
      if (ts.isMethodDeclaration(node) && methodName(node) === 'setState') {
        setStateMethods.push(node);
      }
    });

    if (setStateMethods.length === 0) {
      record(false, `${rel}: setState respects disabled state`, 'No setState method found.');
      continue;
    }

    const guarded = setStateMethods.some((methodNode) => hasEnabledGuardedApplyState(methodNode));
    record(
      guarded,
      `${rel}: setState respects disabled state`,
      guarded
        ? 'setState is guarded by enabled-state check.'
        : 'setState applies state without enabled guard (risk: off is not transparent).',
    );
  }
}

function extractReturnExpressionText(sourceFile, fnName, sourceText) {
  let fn = null;
  walk(sourceFile, (node) => {
    if (fn) return;
    if (!ts.isFunctionDeclaration(node) || !node.name) return;
    if (node.name.text === fnName) fn = node;
  });

  if (!fn || !fn.body) return null;

  for (const stmt of fn.body.statements) {
    if (ts.isReturnStatement(stmt) && stmt.expression) {
      return sourceText.slice(stmt.expression.pos, stmt.expression.end).trim();
    }
  }
  return null;
}

function safeEvalMapper(expressionText) {
  return new Function('v', `return (${expressionText});`);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

async function checkEngineControlCurves(args, changedFiles) {
  const rel = 'src/ui/engine-panel.ts';
  if (args.mode === 'delta' && !touchesAny(changedFiles, [rel])) {
    recordSkipped('Engine low-end control curve safety', 'Engine panel control mappings unchanged.');
    return;
  }

  const sourceText = await fs.readFile(path.join(root, rel), 'utf8');
  const sourceFile = createSourceFile(rel, sourceText, ts.ScriptKind.TS);

  const cutoffExpr = extractReturnExpressionText(sourceFile, 'cutoffToFreq', sourceText);
  const resonanceExpr = extractReturnExpressionText(sourceFile, 'resonanceToQ', sourceText);
  const compExpr = extractReturnExpressionText(sourceFile, 'compToThreshold', sourceText);

  if (!cutoffExpr || !resonanceExpr || !compExpr) {
    record(false, 'Engine low-end control curve safety', 'Missing one or more control mapping functions (cutoffToFreq/resonanceToQ/compToThreshold).');
    return;
  }

  const cutoffFn = safeEvalMapper(cutoffExpr);
  const resonanceFn = safeEvalMapper(resonanceExpr);
  const compFn = safeEvalMapper(compExpr);

  const samples = {
    c0: cutoffFn(0),
    c1: cutoffFn(0.01),
    cMax: cutoffFn(1),
    r0: resonanceFn(0),
    r1: resonanceFn(0.01),
    rMax: resonanceFn(1),
    p0: compFn(0),
    p1: compFn(0.01),
    pMax: compFn(1),
  };

  const numericOk = Object.values(samples).every(isFiniteNumber);
  if (!numericOk) {
    record(false, 'Engine low-end control curve safety', 'Control mapping function returned non-finite numeric values.');
    return;
  }

  const cutoffTotal = Math.abs(samples.cMax - samples.c0);
  const resTotal = Math.abs(samples.rMax - samples.r0);
  const compTotal = Math.abs(samples.pMax - samples.p0);

  const cutoffLowRatio = cutoffTotal > 0 ? Math.abs(samples.c1 - samples.c0) / cutoffTotal : 1;
  const resLowRatio = resTotal > 0 ? Math.abs(samples.r1 - samples.r0) / resTotal : 1;
  const compLowRatio = compTotal > 0 ? Math.abs(samples.p1 - samples.p0) / compTotal : 1;

  const monotonicOk =
    samples.c1 >= samples.c0 &&
    samples.cMax > samples.c1 &&
    samples.r1 >= samples.r0 &&
    samples.rMax > samples.r1 &&
    samples.p1 <= samples.p0 &&
    samples.pMax < samples.p1;

  const lowEndSmoothOk = cutoffLowRatio <= 0.2 && resLowRatio <= 0.2 && compLowRatio <= 0.2;

  const ok = monotonicOk && lowEndSmoothOk;
  record(
    ok,
    'Engine low-end control curve safety',
    ok
      ? `smoothness ratios cutoff=${cutoffLowRatio.toFixed(4)} resonance=${resLowRatio.toFixed(4)} comp=${compLowRatio.toFixed(4)}`
      : `unsafe curve ratios cutoff=${cutoffLowRatio.toFixed(4)} resonance=${resLowRatio.toFixed(4)} comp=${compLowRatio.toFixed(4)} monotonic=${monotonicOk}`,
  );
}

async function checkBenchmarkDeterminism(args, changedFiles) {
  const rel = 'tests/benchmark.html';
  if (args.mode === 'delta' && !touchesAny(changedFiles, [rel, 'src/engine/worklets/**'])) {
    recordSkipped('Benchmark deterministic harness', 'Benchmark/worklet paths unchanged.');
    return;
  }

  const html = await fs.readFile(path.join(root, rel), 'utf8');
  const scripts = extractHtmlScriptBlocks(html);
  const forbiddenHits = [];
  let hasAudioWorkletNode = false;

  scripts.forEach((block, i) => {
    const sourceFile = createSourceFile(`${rel}#script${i + 1}.js`, block.content, ts.ScriptKind.JS);

    walk(sourceFile, (node) => {
      if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'AudioWorkletNode') {
        hasAudioWorkletNode = true;
      }

      if (ts.isCallExpression(node)) {
        if (ts.isIdentifier(node.expression) && node.expression.text === 'setInterval') {
          const loc = nodeLocation(rel, sourceFile, node, block.lineOffset);
          forbiddenHits.push(`${loc.file}:${loc.line}: setInterval(...)`);
        }
        if (ts.isPropertyAccessExpression(node.expression)) {
          const left = node.expression.expression;
          if (ts.isIdentifier(left) && left.text === 'Math' && node.expression.name.text === 'random') {
            const loc = nodeLocation(rel, sourceFile, node, block.lineOffset);
            forbiddenHits.push(`${loc.file}:${loc.line}: Math.random(...)`);
          }
          if (node.expression.name.text === 'setInterval') {
            const loc = nodeLocation(rel, sourceFile, node, block.lineOffset);
            forbiddenHits.push(`${loc.file}:${loc.line}: *.setInterval(...)`);
          }
        }
      }

      if (ts.isPropertyAccessExpression(node) && node.name.text === 'currentTime') {
        const loc = nodeLocation(rel, sourceFile, node, block.lineOffset);
        forbiddenHits.push(`${loc.file}:${loc.line}: .currentTime`);
      }
    });
  });

  const ok = hasAudioWorkletNode && forbiddenHits.length === 0;
  record(
    ok,
    'Benchmark deterministic harness',
    ok
      ? 'Benchmark harness uses real AudioWorkletNode chain and no forbidden timing proxies.'
      : `hasAudioWorkletNode=${hasAudioWorkletNode}; forbidden=${forbiddenHits.join(' | ') || 'none'}`,
  );
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
