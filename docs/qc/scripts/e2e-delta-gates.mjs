#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const passes = [];
const failures = [];

function record(ok, name, detail) {
  if (ok) passes.push({ name, detail });
  else failures.push({ name, detail });
}

function run(command) {
  const result = spawnSync(command, {
    shell: true,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 10,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function readChangedFilesFromEnvOrIndex() {
  const envRaw = process.env.GOV_CHANGED_FILES || '';
  const envFiles = envRaw
    .split('\n')
    .map((v) => v.trim())
    .filter(Boolean);

  if (envFiles.length > 0) {
    return [...new Set(envFiles)].sort();
  }

  const out = run('git diff --cached --name-only --diff-filter=ACMR');
  if (out.status !== 0) {
    throw new Error(`Unable to read staged files: ${out.stderr || out.stdout || 'unknown error'}`);
  }
  return out.stdout
    .split('\n')
    .map((v) => v.trim())
    .filter(Boolean)
    .sort();
}

function isRuntimeProductFile(filePath) {
  if (filePath === 'index.html' || filePath === 'sequencer.html') return true;
  if (filePath.startsWith('src/')) return true;
  return false;
}

function isTestFile(filePath) {
  return filePath.startsWith('e2e/') || filePath.startsWith('tests/');
}

function quotePath(filePath) {
  return JSON.stringify(filePath);
}

function readDiffForFiles(files) {
  if (!files.length) return '';
  const joined = files.map(quotePath).join(' ');
  const out = run(`git diff --cached -U0 -- ${joined}`);
  if (out.status !== 0) {
    throw new Error(`Unable to read staged diff for test files: ${out.stderr || out.stdout || 'unknown error'}`);
  }
  return out.stdout;
}

function extractAddedLines(diffText) {
  return diffText
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1));
}

function hasBehavioralAssertionDelta(addedLines) {
  const assertionRe = /\b(expect|assert)\s*\(/;
  const testDeclRe = /\b(test|it)\s*\(/;
  return addedLines.some((line) => assertionRe.test(line) || testDeclRe.test(line));
}

function shouldEnforceDelta(taskType) {
  return taskType === 'feature' || taskType === 'bugfix' || taskType === 'refactor';
}

function main() {
  const taskType = (process.env.GOV_TASK_TYPE || '').trim();
  if (!shouldEnforceDelta(taskType)) {
    record(true, 'E2E delta required for product task types', `task_type=${taskType || 'unset'} (no delta enforcement)`);
    summarizeAndExit();
    return;
  }

  const changedFiles = readChangedFilesFromEnvOrIndex();
  const runtimeChanged = changedFiles.filter(isRuntimeProductFile);
  const testsChanged = changedFiles.filter(isTestFile);

  if (runtimeChanged.length === 0) {
    record(true, 'Runtime product delta requires test delta', 'No runtime product files changed.');
    summarizeAndExit();
    return;
  }

  record(
    testsChanged.length > 0,
    'Runtime product delta requires test delta',
    testsChanged.length > 0
      ? `runtime_files=${runtimeChanged.length}, test_files=${testsChanged.length}`
      : `Changed runtime files without test changes: ${runtimeChanged.join(', ')}`,
  );

  const diffText = readDiffForFiles(testsChanged);
  const addedLines = extractAddedLines(diffText);
  const hasBehavioralDelta = hasBehavioralAssertionDelta(addedLines);

  record(
    hasBehavioralDelta,
    'Test delta contains behavioral assertions',
    hasBehavioralDelta
      ? 'Found added/modified test declaration or assertion line in staged test diff.'
      : 'No added test/assert lines found in staged test diff (expected test()/it()/expect()/assert() delta).',
  );

  summarizeAndExit();
}

function summarizeAndExit() {
  for (const pass of passes) {
    console.log(`PASS | ${pass.name} | ${pass.detail}`);
  }
  for (const fail of failures) {
    console.log(`FAIL | ${fail.name} | ${fail.detail}`);
  }

  if (failures.length > 0) {
    console.error(`\ne2e-delta-gates: ${failures.length} failure(s), ${passes.length} pass(es).`);
    process.exit(1);
  }

  console.log(`\ne2e-delta-gates: all ${passes.length} checks passed.`);
}

try {
  main();
} catch (err) {
  console.log(`FAIL | e2e-delta gate runtime | ${(err instanceof Error ? err.message : String(err)).trim()}`);
  console.error('\ne2e-delta-gates: 1 failure(s), 0 pass(es).');
  process.exit(1);
}
