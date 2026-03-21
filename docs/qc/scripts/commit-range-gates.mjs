#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();

function parseArgs(argv) {
  const args = { range: process.env.GOV_COMMIT_RANGE || '' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--range') {
      args.range = argv[i + 1] || '';
      i++;
    }
  }
  return args;
}

function run(command) {
  const result = spawnSync(command, {
    cwd: root,
    shell: true,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function git(command) {
  const out = run(`git ${command}`);
  if (out.status !== 0) {
    throw new Error(`git ${command} failed: ${out.stderr || out.stdout || 'unknown error'}`);
  }
  return out.stdout.trim();
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

function touchesAny(files, patterns) {
  return files.some((filePath) => patterns.some((pattern) => matchesPattern(filePath, pattern)));
}

function resolveDefaultRange() {
  const prev = run('git rev-parse --verify HEAD~1');
  if (prev.status === 0) {
    return 'HEAD~1..HEAD';
  }
  return 'HEAD';
}

function parseTrailer(message, key) {
  const re = new RegExp(`^${key}:\\s*(.+)$`, 'm');
  const match = message.match(re);
  return match ? match[1].trim() : '';
}

function readFileAtCommit(commitSha, relPath) {
  const out = run(`git show ${commitSha}:${JSON.stringify(relPath)}`);
  if (out.status !== 0) return null;
  return out.stdout;
}

function loadProductPatterns() {
  const rulesPath = path.join(root, 'docs/qc/compiler/obligation-rules.json');
  const raw = fs.readFileSync(rulesPath, 'utf8');
  const rules = JSON.parse(raw);
  return rules.path_groups?.product || ['src/**', 'tests/**', 'e2e/**', 'index.html', 'sequencer.html', 'README.md'];
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const range = args.range || resolveDefaultRange();
  const productPatterns = loadProductPatterns();

  const commitList = git(`rev-list --reverse ${range}`)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  let failures = 0;
  let passes = 0;

  for (const sha of commitList) {
    const files = git(`show --pretty= --name-only ${sha}`)
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const productTouched = touchesAny(files, productPatterns);
    if (!productTouched) {
      console.log(`PASS | ${sha} | non-product commit; governance attestation trailers not required`);
      passes++;
      continue;
    }

    const message = git(`show -s --format=%B ${sha}`);
    const govTask = parseTrailer(message, 'Gov-Task');
    const govVerdict = parseTrailer(message, 'Gov-Verdict');
    const govAttestation = parseTrailer(message, 'Gov-Attestation');

    if (!govTask || !govVerdict || !govAttestation) {
      console.log(`FAIL | ${sha} | missing governance trailers (Gov-Task/Gov-Verdict/Gov-Attestation)`);
      failures++;
      continue;
    }

    if (govVerdict !== 'PASS') {
      console.log(`FAIL | ${sha} | Gov-Verdict is ${govVerdict}, expected PASS`);
      failures++;
      continue;
    }

    const attestationRaw = readFileAtCommit(sha, govAttestation);
    if (!attestationRaw) {
      console.log(`FAIL | ${sha} | attestation file not found in commit: ${govAttestation}`);
      failures++;
      continue;
    }

    let attestation;
    try {
      attestation = JSON.parse(attestationRaw);
    } catch (err) {
      console.log(`FAIL | ${sha} | attestation JSON parse failed: ${err instanceof Error ? err.message : String(err)}`);
      failures++;
      continue;
    }

    if (attestation.verdict !== 'PASS') {
      console.log(`FAIL | ${sha} | attestation verdict is ${attestation.verdict}, expected PASS`);
      failures++;
      continue;
    }

    if (attestation.task_id !== govTask) {
      console.log(`FAIL | ${sha} | Gov-Task (${govTask}) does not match attestation task_id (${attestation.task_id})`);
      failures++;
      continue;
    }

    console.log(`PASS | ${sha} | governance trailers + PASS attestation verified (${govAttestation})`);
    passes++;
  }

  if (failures > 0) {
    console.error(`\ncommit-range-gates: ${failures} failure(s), ${passes} pass(es) in range ${range}.`);
    process.exit(1);
  }

  console.log(`\ncommit-range-gates: all ${passes} commit(s) passed in range ${range}.`);
}

try {
  main();
} catch (err) {
  console.error(`commit-range-gates internal error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
