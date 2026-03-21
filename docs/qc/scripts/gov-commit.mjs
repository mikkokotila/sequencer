#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();

function run(command) {
  const result = spawnSync(command, {
    cwd: root,
    shell: true,
    encoding: 'utf8',
    stdio: 'pipe',
    maxBuffer: 1024 * 1024 * 20,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function parseArgs(argv) {
  const args = {
    specPath: process.env.GOV_TASK_SPEC || '',
    message: '',
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--spec') {
      args.specPath = argv[i + 1] || '';
      i++;
      continue;
    }
    if (token === '-m' || token === '--message') {
      args.message = argv[i + 1] || '';
      i++;
      continue;
    }
  }

  return args;
}

function parseSpec(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.specPath) {
    console.error('BLOCKED | GOV-SPEC-001 | Missing --spec argument.');
    process.exit(1);
  }

  if (!args.message.trim()) {
    console.error('BLOCKED | GOV-PROC-005 | Missing commit message. Use -m "type(scope): description".');
    process.exit(1);
  }

  const specAbs = path.resolve(root, args.specPath);
  let specRaw;
  try {
    specRaw = await fs.readFile(specAbs, 'utf8');
  } catch {
    console.error(`BLOCKED | GOV-SPEC-001 | Spec file not found: ${args.specPath}`);
    process.exit(1);
  }

  const spec = parseSpec(specRaw);
  if (!spec || typeof spec.task_id !== 'string' || !spec.task_id.trim()) {
    console.error('BLOCKED | GOV-SPEC-002 | Spec JSON invalid or task_id missing.');
    process.exit(1);
  }

  const taskId = spec.task_id.trim();
  const compilerCmd = `node docs/qc/scripts/governance-compiler.mjs check --spec ${JSON.stringify(args.specPath)}`;
  const compilerResult = run(compilerCmd);
  process.stdout.write(compilerResult.stdout);
  process.stderr.write(compilerResult.stderr);
  if (compilerResult.status !== 0) {
    console.error('FAIL | GOV-PROC-004 | Governance compiler did not return PASS. Commit blocked.');
    process.exit(1);
  }

  const verdictPath = path.join(root, 'docs/qc/proofs', taskId, 'verdict.json');
  let verdictRaw;
  try {
    verdictRaw = await fs.readFile(verdictPath, 'utf8');
  } catch {
    console.error(`BLOCKED | GOV-PROOF-004 | Missing attestation: ${path.relative(root, verdictPath)}`);
    process.exit(1);
  }

  let verdict;
  try {
    verdict = JSON.parse(verdictRaw);
  } catch {
    console.error('BLOCKED | GOV-PROOF-008 | verdict.json is not valid JSON.');
    process.exit(1);
  }

  if (verdict.verdict !== 'PASS') {
    console.error(`FAIL | GOV-PROC-004 | Attestation verdict is ${verdict.verdict}, expected PASS.`);
    process.exit(1);
  }

  const proofDirRel = path.join('docs/qc/proofs', taskId);
  const addProof = run(`git add ${JSON.stringify(proofDirRel)}`);
  if (addProof.status !== 0) {
    console.error(`ERROR | GOV-PROC-003 | Failed to stage proof artifacts in ${proofDirRel}.`);
    process.stderr.write(addProof.stderr);
    process.exit(1);
  }

  const trailer = [
    `Gov-Task: ${taskId}`,
    'Gov-Verdict: PASS',
    `Gov-Attestation: ${path.relative(root, verdictPath)}`,
  ].join('\n');
  const fullMessage = `${args.message.trim()}\n\n${trailer}\n`;

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gov-commit-'));
  const messageFile = path.join(tempDir, 'COMMIT_MSG.txt');
  await fs.writeFile(messageFile, fullMessage, 'utf8');

  try {
    const commit = run(`git commit -F ${JSON.stringify(messageFile)}`);
    process.stdout.write(commit.stdout);
    process.stderr.write(commit.stderr);
    if (commit.status !== 0) {
      console.error('FAIL | GOV-PROC-004 | git commit failed.');
      process.exit(1);
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

void main();
