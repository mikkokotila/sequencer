#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const STANDDOWN_DIR = path.join(root, 'docs/qc/standdown');
const REPORTS_DIR = path.join(STANDDOWN_DIR, 'reports');
const ACTIVE_PATH = path.join(STANDDOWN_DIR, 'active.json');

function nowIso() {
  return new Date().toISOString();
}

function safeStamp(iso) {
  return iso.replace(/[:.]/g, '-');
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

function mustRun(command) {
  const out = run(command);
  if (out.status !== 0) {
    throw new Error(`Command failed: ${command}\n${out.stderr || out.stdout || 'unknown error'}`);
  }
  return out;
}

function parseArgs(argv) {
  const args = {
    taskId: 'unknown-task',
    reason: 'operator stand-down',
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--task-id') {
      args.taskId = (argv[i + 1] || '').trim() || args.taskId;
      i++;
      continue;
    }
    if (token === '--reason') {
      args.reason = (argv[i + 1] || '').trim() || args.reason;
      i++;
      continue;
    }
  }

  return args;
}

function parseStatusLines(text) {
  const lines = text
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean);

  const staged = [];
  const unstaged = [];
  const untracked = [];

  for (const line of lines) {
    const xy = line.slice(0, 2);
    const file = line.slice(3).trim();
    if (xy === '??') {
      untracked.push(file);
      continue;
    }
    if (xy[0] && xy[0] !== ' ') staged.push(file);
    if (xy[1] && xy[1] !== ' ') unstaged.push(file);
  }

  return { staged, unstaged, untracked };
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const ts = nowIso();

  const headSha = mustRun('git rev-parse --short HEAD').stdout.trim();
  const status = mustRun('git status --porcelain=v1 -uall').stdout;
  const diffCached = mustRun('git diff --cached --name-status').stdout;
  const diffWorking = mustRun('git diff --name-status').stdout;

  const parsed = parseStatusLines(status);
  const dirty = parsed.staged.length > 0 || parsed.unstaged.length > 0 || parsed.untracked.length > 0;

  let stashRef = null;
  let stashCreated = false;
  let stashShow = '';
  if (dirty) {
    const msg = `WA-STANDDOWN ${args.taskId} ${ts}`;
    mustRun(`git stash push -u -m ${JSON.stringify(msg)}`);
    const list = mustRun('git stash list --max-count=1').stdout.trim();
    const m = list.match(/^(stash@\{\d+\})/);
    stashRef = m ? m[1] : null;
    if (stashRef) {
      stashCreated = true;
      stashShow = mustRun(`git stash show --name-status ${stashRef}`).stdout;
    }
  }

  await ensureDir(REPORTS_DIR);

  const reportName = `${safeStamp(ts)}-${args.taskId}.json`;
  const reportPath = path.join(REPORTS_DIR, reportName);
  const reportRel = path.relative(root, reportPath);

  const report = {
    protocol: 'mid-task-termination-v1',
    issued_at_utc: ts,
    task_id: args.taskId,
    reason: args.reason,
    head_sha: headSha,
    clean_or_dirty_before_stash: dirty ? 'DIRTY' : 'CLEAN',
    staged_files: parsed.staged,
    unstaged_files: parsed.unstaged,
    untracked_files: parsed.untracked,
    stash_ref: stashRef,
    stash_created: stashCreated,
    commands: {
      status_porcelain: status,
      diff_cached_name_status: diffCached,
      diff_working_name_status: diffWorking,
      stash_show_name_status: stashShow,
    },
    background_processes_stopped: true,
  };

  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const active = {
    status: 'ACTIVE',
    activated_at_utc: ts,
    task_id: args.taskId,
    reason: args.reason,
    report_path: reportRel,
    head_sha: headSha,
    stash_ref: stashRef,
  };
  await ensureDir(STANDDOWN_DIR);
  await fs.writeFile(ACTIVE_PATH, `${JSON.stringify(active, null, 2)}\n`, 'utf8');

  console.log(`standdown: ACTIVE`);
  console.log(`report: ${reportRel}`);
  console.log(`active: ${path.relative(root, ACTIVE_PATH)}`);
  console.log(`stash_ref: ${stashRef || 'none'}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
