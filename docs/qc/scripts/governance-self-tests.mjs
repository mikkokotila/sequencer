#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';

const root = process.cwd();

const sourceGateScripts = [
  'docs/qc/scripts/contract-gates.mjs',
  'docs/qc/scripts/architecture-gates.mjs',
];

const runtimeGateScripts = [
  'docs/qc/scripts/audio-gates.mjs',
  'docs/qc/scripts/oracle-harness.mjs',
];

const failures = [];
const passes = [];

function record(ok, name, detail) {
  if (ok) passes.push({ name, detail });
  else failures.push({ name, detail });
}

function parseSource(relPath, text) {
  return ts.createSourceFile(relPath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
}

function walk(node, cb) {
  cb(node);
  node.forEachChild((child) => walk(child, cb));
}

function hasTypescriptImport(sourceFile) {
  let found = false;
  sourceFile.forEachChild((node) => {
    if (!ts.isImportDeclaration(node)) return;
    if (!ts.isStringLiteral(node.moduleSpecifier)) return;
    if (node.moduleSpecifier.text === 'typescript') found = true;
  });
  return found;
}

function findSpawnSyncToolCalls(sourceFile) {
  const hits = [];
  walk(sourceFile, (node) => {
    if (!ts.isCallExpression(node)) return;
    if (!ts.isIdentifier(node.expression) || node.expression.text !== 'spawnSync') return;
    const firstArg = node.arguments[0];
    if (!firstArg || !ts.isStringLiteral(firstArg)) return;
    const tool = firstArg.text;
    if (tool === 'rg' || tool === 'grep') {
      const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      hits.push(`${tool}@${pos.line + 1}`);
    }
  });
  return hits;
}

function findForbiddenRuntimeSourceScans(sourceFile) {
  const hits = [];
  walk(sourceFile, (node) => {
    if (ts.isPropertyAccessExpression(node)) {
      if (
        node.name.text === 'outerHTML' &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'documentElement'
      ) {
        const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        hits.push(`documentElement.outerHTML@${pos.line + 1}`);
      }
    }

    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      if (node.expression.name.text !== 'includes') return;
      const arg = node.arguments[0];
      if (!arg || !ts.isStringLiteral(arg)) return;
      if (arg.text === 'AudioWorkletNode') {
        const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        hits.push(`includes('AudioWorkletNode')@${pos.line + 1}`);
      }
    }
  });
  return hits;
}

function runNodeScript(args, env = {}) {
  const result = spawnSync('node', args, {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env,
    },
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function assertPathDeterminism(scriptRel) {
  const normal = runNodeScript([scriptRel, '--mode', 'full']);
  const noRg = runNodeScript([scriptRel, '--mode', 'full'], {
    PATH: '/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin',
  });

  const same =
    normal.status === noRg.status &&
    normal.stdout === noRg.stdout &&
    normal.stderr === noRg.stderr;

  record(
    same,
    `${path.basename(scriptRel)} is PATH-deterministic`,
    same
      ? `status=${normal.status}`
      : `normal(status=${normal.status}) vs no-rg(status=${noRg.status}) output mismatch`,
  );
}

async function main() {
  for (const relPath of sourceGateScripts) {
    const text = await fs.readFile(path.join(root, relPath), 'utf8');
    const sourceFile = parseSource(relPath, text);

    const hasTs = hasTypescriptImport(sourceFile);
    record(hasTs, `${path.basename(relPath)} imports typescript`, hasTs ? 'AST parser import present.' : 'Missing `import ts from "typescript"`.');

    const spawnToolCalls = findSpawnSyncToolCalls(sourceFile);
    record(
      spawnToolCalls.length === 0,
      `${path.basename(relPath)} avoids rg/grep shell scans`,
      spawnToolCalls.length === 0 ? 'No spawnSync rg/grep calls found.' : spawnToolCalls.join(', '),
    );
  }

  for (const relPath of runtimeGateScripts) {
    const text = await fs.readFile(path.join(root, relPath), 'utf8');
    const sourceFile = parseSource(relPath, text);
    const forbidden = findForbiddenRuntimeSourceScans(sourceFile);

    record(
      forbidden.length === 0,
      `${path.basename(relPath)} avoids benchmark source-text scans`,
      forbidden.length === 0 ? 'No benchmark source-text scan tokens found.' : forbidden.join(', '),
    );
  }

  assertPathDeterminism('docs/qc/scripts/contract-gates.mjs');
  assertPathDeterminism('docs/qc/scripts/architecture-gates.mjs');

  for (const pass of passes) {
    console.log(`PASS | ${pass.name} | ${pass.detail}`);
  }
  for (const fail of failures) {
    console.log(`FAIL | ${fail.name} | ${fail.detail}`);
  }

  if (failures.length > 0) {
    console.error(`\ngovernance-self-tests: ${failures.length} failure(s), ${passes.length} pass(es).`);
    process.exit(1);
  }

  console.log(`\ngovernance-self-tests: all ${passes.length} checks passed.`);
}

void main();
