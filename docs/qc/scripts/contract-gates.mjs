#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const passes = [];
const failures = [];

function assertFullOnlyMode() {
  const modeArg = process.argv.find((arg) => arg === '--mode' || arg.startsWith('--mode='));
  if (!modeArg) return;

  if (modeArg === '--mode') {
    const modeIndex = process.argv.indexOf('--mode');
    const value = process.argv[modeIndex + 1] || '';
    const suffix = value ? ` ${value}` : '';
    throw new Error(`contract-gates is full-only; remove --mode${suffix}`.trim());
  }

  throw new Error(`contract-gates is full-only; remove ${modeArg}`);
}

function record(ok, name, detail) {
  if (ok) passes.push({ name, detail });
  else failures.push({ name, detail });
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
  const lower = html.toLowerCase();
  let cursor = 0;

  while (cursor < lower.length) {
    const openStart = lower.indexOf('<script', cursor);
    if (openStart === -1) break;

    const openEnd = lower.indexOf('>', openStart + 7);
    if (openEnd === -1) break;

    const scriptContentStart = openEnd + 1;
    const closeStart = lower.indexOf('</script', scriptContentStart);
    if (closeStart === -1) break;

    const closeEnd = lower.indexOf('>', closeStart + 8);
    if (closeEnd === -1) break;

    const content = html.slice(scriptContentStart, closeStart);
    const prefix = html.slice(0, scriptContentStart);
    const lineOffset = prefix.split('\n').length - 1;
    blocks.push({ content, lineOffset });
    cursor = closeEnd + 1;
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

async function checkNoFixme() {
  const allTestFiles = await listFilesRecursive('e2e', ['.ts', '.js', '.html']);
  const extraTestFiles = await listFilesRecursive('tests', ['.ts', '.js', '.html']);
  const relFiles = [...allTestFiles, ...extraTestFiles].sort();

  const sources = await collectSources(relFiles);
  const violations = findTestFixmeViolations(sources);
  record(
    violations.length === 0,
    'No fixme debt',
    violations.length === 0 ? 'No test.fixme() found.' : violations.map(formatViolation).join('\n'),
  );
}

async function checkNoInformationalAsserts() {
  const relFiles = await listFilesRecursive('tests', ['.ts', '.js', '.html']);

  const sources = await collectSources(relFiles);
  const violations = findInformationalAssertViolations(sources);
  record(
    violations.length === 0,
    'No informational assertions',
    violations.length === 0 ? 'No assert(..., true, ...) patterns found.' : violations.map(formatViolation).join('\n'),
  );
}

async function checkNewSongExtensionReset() {
  const rel = 'src/transport/persistence.ts';

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

async function checkSetStateRespectsDisabled() {
  const preferredTargets = [
    'src/engine/extensions/pultec-eq.ts',
    'src/engine/extensions/compressor.ts',
    'src/engine/extensions/transformer.ts',
  ];

  const targets = [];
  for (const rel of preferredTargets) {
    if (await fileExists(rel)) {
      targets.push(rel);
    }
  }

  if (targets.length === 0) {
    record(false, 'setState respects disabled state', 'No extension state files found to validate.');
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

function extractIdentifierFromPropertyChain(node) {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return extractIdentifierFromPropertyChain(node.expression);
  return '';
}

function findControlMapperNames(sourceFile) {
  const names = {
    cutoffMapper: '',
    resonanceMapper: '',
    compMapper: '',
  };

  walk(sourceFile, (node) => {
    if (!ts.isFunctionDeclaration(node) || !node.name || node.name.text !== 'applyEngineParams' || !node.body) return;

    for (const stmt of node.body.statements) {
      if (!ts.isIfStatement(stmt) || !stmt.thenStatement) continue;
      const branch = stmt.thenStatement;
      const branchStatements = ts.isBlock(branch) ? branch.statements : [branch];
      for (const bStmt of branchStatements) {
        if (!ts.isExpressionStatement(bStmt) || !ts.isBinaryExpression(bStmt.expression)) continue;
        const bin = bStmt.expression;
        if (bin.operatorToken.kind !== ts.SyntaxKind.EqualsToken) continue;
        if (!ts.isPropertyAccessExpression(bin.left)) continue;
        if (!ts.isCallExpression(bin.right)) continue;
        if (!ts.isIdentifier(bin.right.expression)) continue;
        if (bin.right.arguments.length !== 1) continue;

        const mapper = bin.right.expression.text;
        const targetRoot = extractIdentifierFromPropertyChain(bin.left.expression);

        if (targetRoot === 'engineFilter' && bin.left.name.text === 'value') {
          if (containsIdentifier(bin.left, 'frequency')) names.cutoffMapper = mapper;
          if (containsIdentifier(bin.left, 'Q')) names.resonanceMapper = mapper;
        }
        if (targetRoot === 'engineCompressor' && bin.left.name.text === 'value' && containsIdentifier(bin.left, 'threshold')) {
          names.compMapper = mapper;
        }
      }
    }
  });

  return names;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

async function checkEngineControlCurves() {
  const rel = 'src/ui/engine-panel.ts';

  const sourceText = await fs.readFile(path.join(root, rel), 'utf8');
  const sourceFile = createSourceFile(rel, sourceText, ts.ScriptKind.TS);
  const mappers = findControlMapperNames(sourceFile);
  const cutoffExpr = extractReturnExpressionText(sourceFile, mappers.cutoffMapper, sourceText);
  const resonanceExpr = extractReturnExpressionText(sourceFile, mappers.resonanceMapper, sourceText);
  const compExpr = extractReturnExpressionText(sourceFile, mappers.compMapper, sourceText);

  if (!cutoffExpr || !resonanceExpr || !compExpr) {
    record(
      false,
      'Engine low-end control curve safety',
      `Missing control mapper(s) bound in applyEngineParams (cutoff=${mappers.cutoffMapper || 'unset'}, resonance=${mappers.resonanceMapper || 'unset'}, comp=${mappers.compMapper || 'unset'}).`,
    );
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

async function checkBenchmarkDeterminism() {
  const rel = 'tests/benchmark.html';

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
  assertFullOnlyMode();
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

  const label = 'contract-gates';
  if (failures.length > 0) {
    console.error(`\n${label}: ${failures.length} failure(s), ${passes.length} pass(es).`);
    process.exit(1);
  }

  console.log(`\n${label}: all ${passes.length} checks passed.`);
}

void main();
