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

function createSourceFile(filePath, content, kind = ts.ScriptKind.TS) {
  return ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, kind);
}

async function read(rel) {
  return fs.readFile(path.join(root, rel), 'utf8');
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
  return `${v.file}:${v.line}: ${v.message}`;
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
    if (line.startsWith('-') && !line.startsWith('---')) continue;
    if (line.startsWith(' ')) newLine += 1;
  }

  return { ok: true, map: addedByFile, error: '' };
}

function isViolationOnAddedLine(addedMap, violation) {
  const lines = addedMap.get(violation.file);
  if (!lines) return false;
  return lines.has(violation.line);
}

function extractHtmlScriptBlocks(html) {
  const blocks = [];
  const scriptTag = /<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi;
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

function containsCallNamed(node, name) {
  let found = false;
  walk(node, (child) => {
    if (found || !ts.isCallExpression(child)) return;
    if (ts.isIdentifier(child.expression) && child.expression.text === name) found = true;
    if (ts.isPropertyAccessExpression(child.expression) && child.expression.name.text === name) found = true;
  });
  return found;
}

function containsIdentifier(node, name) {
  let found = false;
  walk(node, (child) => {
    if (found) return;
    if (ts.isIdentifier(child) && child.text === name) found = true;
  });
  return found;
}

function getImportModuleTexts(sourceFile) {
  const modules = [];
  sourceFile.forEachChild((node) => {
    if (!ts.isImportDeclaration(node)) return;
    if (!ts.isStringLiteral(node.moduleSpecifier)) return;
    modules.push(node.moduleSpecifier.text);
  });
  return modules;
}

function isStyleMutationAssignment(node) {
  if (!ts.isBinaryExpression(node)) return false;
  if (node.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return false;

  const lhs = node.left;
  if (!ts.isPropertyAccessExpression(lhs)) return false;

  let cursor = lhs.expression;
  while (ts.isPropertyAccessExpression(cursor)) {
    if (cursor.name.text === 'style') return true;
    cursor = cursor.expression;
  }

  return false;
}

function rootIdentifierText(node) {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return rootIdentifierText(node.expression);
  return '';
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

  for (const rel of targets) {
    const text = await read(rel);
    const sourceFile = createSourceFile(rel, text, ts.ScriptKind.TS);
    const gainVars = new Set();

    walk(sourceFile, (node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer)) {
        const call = node.initializer;
        if (
          ts.isPropertyAccessExpression(call.expression) &&
          call.expression.name.text === 'createGain'
        ) {
          gainVars.add(node.name.text);
        }
      }

      if (!ts.isReturnStatement(node) || !node.expression || !ts.isObjectLiteralExpression(node.expression)) return;

      let inputName = '';
      let outputName = '';
      for (const prop of node.expression.properties) {
        if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.initializer)) continue;
        const key = ts.isIdentifier(prop.name) ? prop.name.text : ts.isStringLiteral(prop.name) ? prop.name.text : '';
        if (key === 'input') inputName = prop.initializer.text;
        if (key === 'output') outputName = prop.initializer.text;
      }

      if (inputName && outputName && inputName === outputName && gainVars.has(inputName)) {
        const loc = nodeLocation(rel, sourceFile, node);
        findings.push(`${loc.file}:${loc.line}: return { input: ${inputName}, output: ${outputName} }`);
      }
    });
  }

  record(
    findings.length === 0,
    'No dummy pass-through extension nodes',
    findings.length === 0 ? 'No pass-through dummy insert nodes detected.' : `Dummy node pattern found:\n${findings.join('\n')}`,
  );
}

async function checkNoWindowSeqGlobalInExtensions(args, changedFiles) {
  if (args.mode === 'delta' && !touchesAny(changedFiles, ['src/engine/extensions/**'])) {
    recordSkipped('No global window.SEQ extension coupling', 'Extension files unchanged.');
    return;
  }

  const extensionFiles = await listFilesRecursive('src/engine/extensions', ['.ts']);
  const scanFiles = args.mode === 'delta' ? changedFiles.filter((f) => f.startsWith('src/engine/extensions/')) : extensionFiles;

  const findings = [];

  for (const rel of scanFiles) {
    const text = await read(rel);
    const sourceFile = createSourceFile(rel, text, ts.ScriptKind.TS);

    walk(sourceFile, (node) => {
      if (ts.isPropertyAccessExpression(node)) {
        if (ts.isIdentifier(node.expression) && node.expression.text === 'window' && node.name.text === 'SEQ') {
          const loc = nodeLocation(rel, sourceFile, node);
          findings.push({ ...loc, message: 'window.SEQ' });
        }
      }
      if (ts.isElementAccessExpression(node)) {
        if (
          ts.isIdentifier(node.expression) &&
          node.expression.text === 'window' &&
          node.argumentExpression &&
          ts.isStringLiteral(node.argumentExpression) &&
          node.argumentExpression.text === 'SEQ'
        ) {
          const loc = nodeLocation(rel, sourceFile, node);
          findings.push({ ...loc, message: "window['SEQ']" });
        }
      }
    });
  }

  if (args.mode === 'delta') {
    const added = parseAddedLineMap(['src/engine/extensions']);
    if (!added.ok) {
      record(false, 'No global window.SEQ extension coupling', added.error);
      return;
    }
    const newFindings = findings.filter((f) => isViolationOnAddedLine(added.map, f));
    record(
      newFindings.length === 0,
      'No global window.SEQ extension coupling',
      newFindings.length === 0 ? 'No new window.SEQ additions in staged diff.' : newFindings.map(formatViolation).join('\n'),
    );
    return;
  }

  record(
    findings.length === 0,
    'No global window.SEQ extension coupling',
    findings.length === 0 ? 'No window.SEQ usage found in extensions.' : findings.map(formatViolation).join('\n'),
  );
}

async function checkEngineInterfaceUsed(args, changedFiles) {
  if (args.mode === 'delta' && !touchesAny(changedFiles, ['src/engine/interface.ts', 'src/engine/scheduler.ts'])) {
    recordSkipped('Engine interface contract is actually consumed', 'Engine boundary files unchanged.');
    return;
  }

  const interfaceRel = 'src/engine/interface.ts';
  let interfaceExists = true;
  try {
    await fs.access(path.join(root, interfaceRel));
  } catch {
    interfaceExists = false;
  }

  if (!interfaceExists) {
    record(true, 'Engine interface contract is actually consumed', 'No legacy engine interface module present (dead boundary removed).');
    return;
  }

  const srcFiles = await listFilesRecursive('src', ['.ts']);
  const importers = [];

  for (const rel of srcFiles) {
    if (rel === interfaceRel) continue;
    const text = await read(rel);
    const sourceFile = createSourceFile(rel, text, ts.ScriptKind.TS);
    const modules = getImportModuleTexts(sourceFile);
    const consumesInterface = modules.some((m) => m === './interface' || m === '../engine/interface');
    if (consumesInterface) importers.push(rel);
  }

  const ok = importers.length > 0;
  record(
    ok,
    'Engine interface contract is actually consumed',
    ok ? `Engine interface imported by ${importers.length} module(s).` : 'interface.ts exists but has no import consumers (dead contract surface).',
  );
}

async function checkSchedulerBoundary(args, changedFiles) {
  const rel = 'src/engine/scheduler.ts';
  if (args.mode === 'delta' && !touchesAny(changedFiles, [rel])) {
    recordSkipped('Scheduler does not import transport internals directly', 'Scheduler file unchanged.');
    return;
  }

  const text = await read(rel);
  const sourceFile = createSourceFile(rel, text, ts.ScriptKind.TS);
  const modules = getImportModuleTexts(sourceFile);
  const bad = modules.filter((m) => m === '../transport/patterns' || m === '../transport/song');

  record(
    bad.length === 0,
    'Scheduler does not import transport internals directly',
    bad.length === 0 ? 'No direct scheduler->transport state imports detected.' : `scheduler.ts imports forbidden modules: ${bad.join(', ')}`,
  );
}

async function checkPersistenceNoUICallbackInjection(args, changedFiles) {
  if (args.mode === 'delta' && !touchesAny(changedFiles, ['src/transport/persistence.ts', 'src/main.ts'])) {
    recordSkipped('Persistence lifecycle decoupled from UI callback injection', 'Persistence lifecycle files unchanged.');
    return;
  }

  const rel = 'src/transport/persistence.ts';
  const text = await read(rel);
  const sourceFile = createSourceFile(rel, text, ts.ScriptKind.TS);

  let hasCallbackInterface = false;
  let hasSetter = false;

  walk(sourceFile, (node) => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === 'PersistenceCallbacks') {
      hasCallbackInterface = true;
    }
    if (ts.isFunctionDeclaration(node) && node.name && node.name.text === 'setPersistenceCallbacks') {
      hasSetter = true;
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'setPersistenceCallbacks') {
      hasSetter = true;
    }
  });

  const ok = !hasCallbackInterface && !hasSetter;
  record(
    ok,
    'Persistence lifecycle decoupled from UI callback injection',
    ok ? 'No persistence callback injection API detected.' : 'Persistence callback injection API still present.',
  );
}

async function checkPreviewNodeCleanup(args, changedFiles) {
  const rel = 'src/engine/audio.ts';
  if (args.mode === 'delta' && !touchesAny(changedFiles, [rel])) {
    recordSkipped('Preview audio nodes are explicitly cleaned up', 'Audio core preview path unchanged.');
    return;
  }

  const text = await read(rel);
  const sourceFile = createSourceFile(rel, text, ts.ScriptKind.TS);

  let hasPreviewGainCreate = false;
  let hasCleanupDisconnect = false;

  walk(sourceFile, (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'previewGain' && node.initializer && ts.isCallExpression(node.initializer)) {
      const call = node.initializer;
      if (ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === 'createGain') {
        hasPreviewGainCreate = true;
      }
    }

    if (!ts.isBinaryExpression(node) || node.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return;
    if (!ts.isPropertyAccessExpression(node.left)) return;
    if (!ts.isIdentifier(node.left.expression) || node.left.expression.text !== 'src') return;
    if (node.left.name.text !== 'onended') return;

    if (containsCallNamed(node.right, 'disconnect') && containsIdentifier(node.right, 'previewGain')) {
      hasCleanupDisconnect = true;
    }
  });

  const ok = !hasPreviewGainCreate || hasCleanupDisconnect;
  record(
    ok,
    'Preview audio nodes are explicitly cleaned up',
    ok ? 'Preview node cleanup logic detected.' : 'previewGain is created without explicit onended disconnect cleanup.',
  );
}

async function checkInitAudioCallSpread(args, changedFiles) {
  const scanPatterns = ['src/engine/audio.ts', 'src/main.ts', 'src/ui/**', 'src/transport/persistence.ts'];
  if (args.mode === 'delta' && !touchesAny(changedFiles, scanPatterns)) {
    recordSkipped('Audio initialization ownership is centralized', 'initAudio callsite files unchanged.');
    return;
  }

  const files = await listFilesRecursive('src', ['.ts']);
  const calls = [];

  for (const rel of files) {
    if (args.mode === 'delta' && !changedFiles.includes(rel)) continue;

    const text = await read(rel);
    const sourceFile = createSourceFile(rel, text, ts.ScriptKind.TS);

    walk(sourceFile, (node) => {
      if (!ts.isCallExpression(node)) return;
      if (!ts.isIdentifier(node.expression) || node.expression.text !== 'initAudio') return;
      const loc = nodeLocation(rel, sourceFile, node);
      calls.push(loc);
    });
  }

  if (args.mode === 'delta') {
    const added = parseAddedLineMap(changedFiles.filter((f) => f.startsWith('src/')));
    if (!added.ok) {
      record(false, 'Audio initialization ownership is centralized', added.error);
      return;
    }

    const newCalls = calls.filter((loc) => isViolationOnAddedLine(added.map, { file: loc.file, line: loc.line }));
    record(
      newCalls.length === 0,
      'Audio initialization ownership is centralized',
      newCalls.length === 0
        ? 'No new initAudio call sites added in staged diff.'
        : `New initAudio call sites added: ${newCalls.map((loc) => `${loc.file}:${loc.line}`).join(' | ')}`,
    );
    return;
  }

  const ok = calls.length <= 3;
  record(
    ok,
    'Audio initialization ownership is centralized',
    ok ? `initAudio call sites: ${calls.length}` : `Too many initAudio call sites (${calls.length}).`,
  );
}

async function checkNoSilentDecodeCatch(args, changedFiles) {
  const rel = 'src/transport/persistence.ts';
  if (args.mode === 'delta' && !touchesAny(changedFiles, [rel])) {
    recordSkipped('Decode failures are not silently swallowed', 'Persistence decode path unchanged.');
    return;
  }

  const text = await read(rel);
  const sourceFile = createSourceFile(rel, text, ts.ScriptKind.TS);

  const silentFindings = [];

  walk(sourceFile, (node) => {
    if (!ts.isTryStatement(node) || !node.catchClause || !node.catchClause.block) return;
    const tryHasDecode = containsCallNamed(node.tryBlock, 'decodeAudioData');
    if (!tryHasDecode) return;

    let hasThrow = false;
    let hasCall = false;
    walk(node.catchClause.block, (c) => {
      if (ts.isThrowStatement(c)) hasThrow = true;
      if (ts.isCallExpression(c)) hasCall = true;
    });

    if (!hasThrow && !hasCall) {
      const loc = nodeLocation(rel, sourceFile, node.catchClause.block);
      silentFindings.push(`${loc.file}:${loc.line}: catch block has no throw/log call`);
    }
  });

  record(
    silentFindings.length === 0,
    'Decode failures are not silently swallowed',
    silentFindings.length === 0 ? 'No silent decode catch blocks detected.' : silentFindings.join('\n'),
  );
}

async function checkNoDuplicateUiBusinessLogic(args, changedFiles) {
  if (args.mode === 'delta' && !touchesAny(changedFiles, ['src/ui/painting.ts', 'src/ui/cells.ts', 'src/transport/patterns.ts'])) {
    recordSkipped('UI does not duplicate transport business logic', 'UI/transport rule files unchanged.');
    return;
  }

  const targets = ['src/ui/painting.ts', 'src/ui/cells.ts'];
  const findings = [];

  for (const rel of targets) {
    const text = await read(rel);
    const sourceFile = createSourceFile(rel, text, ts.ScriptKind.TS);

    walk(sourceFile, (node) => {
      if (!ts.isFunctionDeclaration(node) || !node.name) return;
      const name = node.name.text;
      if (name === 'replicateTrack' || name === 'setMelodyCell') {
        const loc = nodeLocation(rel, sourceFile, node);
        findings.push(`${loc.file}:${loc.line}: function ${name}()`);
      }
    });
  }

  record(
    findings.length === 0,
    'UI does not duplicate transport business logic',
    findings.length === 0 ? 'No duplicate replicateTrack/setMelodyCell in UI layer.' : findings.join('\n'),
  );
}

async function checkPaintingSetupIdempotent(args, changedFiles) {
  const rel = 'src/ui/painting.ts';
  if (args.mode === 'delta' && !touchesAny(changedFiles, [rel, 'src/ui/build.ts'])) {
    recordSkipped('Painting event setup is idempotent', 'Painting setup files unchanged.');
    return;
  }

  const text = await read(rel);
  const sourceFile = createSourceFile(rel, text, ts.ScriptKind.TS);

  const topLevelFlags = new Set();
  sourceFile.forEachChild((node) => {
    if (!ts.isVariableStatement(node)) return;
    for (const decl of node.declarationList.declarations) {
      if (ts.isIdentifier(decl.name)) topLevelFlags.add(decl.name.text);
    }
  });

  let hasGuard = false;

  walk(sourceFile, (node) => {
    if (!ts.isFunctionDeclaration(node) || !node.name || node.name.text !== 'setupPainting' || !node.body) return;

    for (const stmt of node.body.statements) {
      if (!ts.isIfStatement(stmt)) continue;
      if (!stmt.thenStatement || !ts.isReturnStatement(stmt.thenStatement) && !containsCallNamed(stmt.thenStatement, 'return')) {
        // If-statement with block `{ return; }` is covered below
      }

      const conditionIdentifiers = [];
      walk(stmt.expression, (c) => {
        if (ts.isIdentifier(c)) conditionIdentifiers.push(c.text);
      });

      const referencesFlag = conditionIdentifiers.some((id) => topLevelFlags.has(id));
      const returnsEarly =
        ts.isReturnStatement(stmt.thenStatement) ||
        (ts.isBlock(stmt.thenStatement) && stmt.thenStatement.statements.some((s) => ts.isReturnStatement(s)));

      if (referencesFlag && returnsEarly) {
        hasGuard = true;
      }
    }
  });

  record(hasGuard, 'Painting event setup is idempotent', hasGuard ? 'Found setup guard.' : 'No idempotency guard detected for setupPainting().');
}

async function checkNoInlinePlayheadStyleThrash(args, changedFiles) {
  if (args.mode === 'delta' && !touchesAny(changedFiles, ['src/ui/playhead.ts', 'src/ui/cells.ts'])) {
    recordSkipped('Playhead/cell rendering avoids repeated inline style mutation', 'Playhead/cell render files unchanged.');
    return;
  }

  const targets = ['src/ui/playhead.ts', 'src/ui/cells.ts'];
  const findings = [];

  for (const rel of targets) {
    const text = await read(rel);
    const sourceFile = createSourceFile(rel, text, ts.ScriptKind.TS);

    walk(sourceFile, (node) => {
      if (!isStyleMutationAssignment(node)) return;
      const loc = nodeLocation(rel, sourceFile, node);
      findings.push(`${loc.file}:${loc.line}: inline style mutation`);
    });
  }

  record(
    findings.length === 0,
    'Playhead/cell rendering avoids repeated inline style mutation',
    findings.length === 0 ? 'No inline style thrash patterns found.' : findings.join('\n'),
  );
}

async function checkNoEmptyStringPaintTypeSentinel(args, changedFiles) {
  const rel = 'src/state.ts';
  if (args.mode === 'delta' && !touchesAny(changedFiles, [rel, 'src/ui/painting.ts'])) {
    recordSkipped('PaintType does not use empty-string sentinel', 'Paint state files unchanged.');
    return;
  }

  const text = await read(rel);
  const sourceFile = createSourceFile(rel, text, ts.ScriptKind.TS);

  let hasSentinel = false;
  walk(sourceFile, (node) => {
    if (!ts.isTypeAliasDeclaration(node) || node.name.text !== 'PaintType') return;
    if (!ts.isUnionTypeNode(node.type)) return;
    hasSentinel = node.type.types.some((t) => ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal) && t.literal.text === '');
  });

  record(
    !hasSentinel,
    'PaintType does not use empty-string sentinel',
    hasSentinel ? "PaintType includes ''. Use explicit null." : 'No empty-string PaintType sentinel detected.',
  );
}

async function checkNoTransportInnerHtmlTemplate(args, changedFiles) {
  const rel = 'src/ui/build.ts';
  if (args.mode === 'delta' && !touchesAny(changedFiles, [rel])) {
    recordSkipped('Transport UI avoids large innerHTML template injection', 'Transport builder unchanged.');
    return;
  }

  const text = await read(rel);
  const sourceFile = createSourceFile(rel, text, ts.ScriptKind.TS);
  const findings = [];

  walk(sourceFile, (node) => {
    if (!ts.isBinaryExpression(node) || node.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return;
    if (!ts.isPropertyAccessExpression(node.left)) return;
    if (node.left.name.text !== 'innerHTML') return;
    const targetRoot = rootIdentifierText(node.left.expression);
    if (targetRoot !== 'transport') return;
    const loc = nodeLocation(rel, sourceFile, node);
    findings.push(`${loc.file}:${loc.line}: ${node.left.getText(sourceFile)} = ...`);
  });

  record(
    findings.length === 0,
    'Transport UI avoids large innerHTML template injection',
    findings.length === 0 ? 'No transport.innerHTML injection detected.' : findings.join('\n'),
  );
}

async function checkBenchmarkHarnessDeterminism(args, changedFiles) {
  const rel = 'tests/benchmark.html';
  if (args.mode === 'delta' && !touchesAny(changedFiles, [rel, 'src/engine/worklets/**'])) {
    recordSkipped('Benchmark harness is deterministic (no proxy timing/randomness)', 'Benchmark harness files unchanged.');
    return;
  }

  const html = await read(rel);
  const scripts = extractHtmlScriptBlocks(html);

  let hasAudioWorkletNode = false;
  const forbidden = [];

  scripts.forEach((block, i) => {
    const sourceFile = createSourceFile(`${rel}#script${i + 1}.js`, block.content, ts.ScriptKind.JS);

    walk(sourceFile, (node) => {
      if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'AudioWorkletNode') {
        hasAudioWorkletNode = true;
      }

      if (ts.isCallExpression(node)) {
        if (ts.isIdentifier(node.expression) && node.expression.text === 'setInterval') {
          const loc = nodeLocation(rel, sourceFile, node, block.lineOffset);
          forbidden.push(`${loc.file}:${loc.line}: setInterval(...)`);
        }

        if (ts.isPropertyAccessExpression(node.expression)) {
          const left = node.expression.expression;
          if (ts.isIdentifier(left) && left.text === 'Math' && node.expression.name.text === 'random') {
            const loc = nodeLocation(rel, sourceFile, node, block.lineOffset);
            forbidden.push(`${loc.file}:${loc.line}: Math.random(...)`);
          }
          if (node.expression.name.text === 'setInterval') {
            const loc = nodeLocation(rel, sourceFile, node, block.lineOffset);
            forbidden.push(`${loc.file}:${loc.line}: *.setInterval(...)`);
          }
        }
      }

      if (ts.isPropertyAccessExpression(node) && node.name.text === 'currentTime') {
        const loc = nodeLocation(rel, sourceFile, node, block.lineOffset);
        forbidden.push(`${loc.file}:${loc.line}: .currentTime`);
      }
    });
  });

  const ok = hasAudioWorkletNode && forbidden.length === 0;
  record(
    ok,
    'Benchmark harness is deterministic (no proxy timing/randomness)',
    ok
      ? 'No forbidden benchmark timing proxies detected.'
      : `hasAudioWorkletNode=${hasAudioWorkletNode}; forbidden=${forbidden.join(' | ') || 'none'}`,
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
  record(
    !exists,
    'Fake benchmark processor removed',
    exists ? 'benchmark-processor.ts still exists — should be deleted.' : 'benchmark-processor.ts correctly removed.',
  );
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
