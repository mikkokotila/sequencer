#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const RULES_PATH = path.join(root, 'docs/qc/compiler/obligation-rules.json');
const DIAGNOSTICS_PATH = path.join(root, 'docs/qc/compiler/diagnostics.json');
const COMPILER_LOG_PATH = path.join(root, 'logs/compiler.log');
const STANDDOWN_ACTIVE_PATH = path.join(root, 'docs/qc/standdown/active.json');
const DEBT_BASELINE_PATH = path.join(root, 'docs/qc/debt/baseline.json');
const CHAIN_GENESIS_HASH = '0'.repeat(64);
const REPEATED_FAILURE_LOOKBACK_MS = 6 * 60 * 60 * 1000;
const REPEATED_FAILURE_PRIOR_THRESHOLD = 2;

function parseArgs(argv) {
  const args = {
    mode: 'check',
    specPath: process.env.GOV_TASK_SPEC || '',
    simulateFiles: [],
    noWrite: false,
    strictManifest: true,
    allowGovernanceChange: process.env.GOV_ALLOW_GOVERNANCE_CHANGE === '1',
    quiet: false,
  };

  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith('--')) {
      if (token === '--spec') {
        args.specPath = argv[i + 1] || '';
        i++;
      } else if (token === '--simulate-files') {
        const raw = argv[i + 1] || '';
        args.simulateFiles = raw
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean);
        i++;
      } else if (token === '--no-write') {
        args.noWrite = true;
      } else if (token === '--no-strict-manifest') {
        args.strictManifest = false;
      } else if (token === '--quiet') {
        args.quiet = true;
      } else if (token === '--allow-governance-change') {
        args.allowGovernanceChange = true;
      }
      continue;
    }
    positional.push(token);
  }

  if (positional.length > 0) {
    args.mode = positional[0];
  }

  return args;
}

function nowIso() {
  return new Date().toISOString();
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function readJsonFileSafe(content, filePath) {
  try {
    return { ok: true, data: JSON.parse(content) };
  } catch (err) {
    return {
      ok: false,
      error: `Invalid JSON at ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function spawn(command, options = {}) {
  const env = options.env ? { ...process.env, ...options.env } : process.env;
  const result = spawnSync(command, {
    cwd: root,
    encoding: 'utf8',
    shell: true,
    maxBuffer: 1024 * 1024 * 20,
    env,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    signal: result.signal || null,
  };
}

function git(command) {
  const out = spawn(`git ${command}`);
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
    const escaped = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');
    const re = new RegExp(`^${escaped}$`);
    return re.test(filePath);
  }
  return filePath === pattern;
}

function matchesAnyPattern(filePath, patterns) {
  return patterns.some((pattern) => matchesPattern(filePath, pattern));
}

const COMPILER_MANAGED_ARTIFACT_PATTERNS = [
  'docs/qc/proofs/**',
  'docs/qc/specs/**',
  'docs/qc/runs/**',
  'docs/qc/standdown/**',
  'logs/compiler.log',
];

function isCompilerManagedArtifact(filePath) {
  return matchesAnyPattern(filePath, COMPILER_MANAGED_ARTIFACT_PATTERNS);
}

function isGovernancePolicyFile(filePath) {
  const patterns = [
    'AGENTS.md',
    'CLAUDE.md',
    'docs/contracts/**',
    'docs/qc/compiler/**',
    'docs/qc/scripts/**',
    'package.json',
    'package-lock.json',
    '.husky/**',
  ];
  return matchesAnyPattern(filePath, patterns);
}

function computeSubjectShaFromIndex(files) {
  if (!Array.isArray(files) || files.length === 0) {
    return CHAIN_GENESIS_HASH;
  }
  const rows = [];
  for (const filePath of [...files].sort()) {
    const out = spawn(`git ls-files -s -- ${JSON.stringify(filePath)}`);
    if (out.status !== 0 || !out.stdout.trim()) {
      rows.push(`${filePath}:MISSING`);
      continue;
    }
    const line = out.stdout.trim().split('\n')[0];
    const parts = line.trim().split(/\s+/);
    const blobSha = parts[1] || 'MISSING';
    rows.push(`${filePath}:${blobSha}`);
  }
  return sha256(rows.join('\n'));
}

function compareMetric(actual, operator, expected) {
  if (typeof actual !== 'number') return false;
  switch (operator) {
    case '<=':
      return actual <= expected;
    case '>=':
      return actual >= expected;
    case '==':
      return actual === expected;
    case '<':
      return actual < expected;
    case '>':
      return actual > expected;
    default:
      return false;
  }
}

function summarizeVerdict(diagnostics) {
  const severities = diagnostics.map((d) => d.severity);
  if (severities.includes('ERROR')) return 'ERROR';
  if (severities.includes('FAIL')) return 'FAIL';
  if (severities.includes('BLOCKED')) return 'BLOCKED';
  return 'PASS';
}

function parseTimestampMs(value) {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return ms;
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function getCompilerLogChainState(logPath) {
  let raw = '';
  try {
    raw = await fs.readFile(logPath, 'utf8');
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      return { exists: false, lineCount: 0, lastHash: CHAIN_GENESIS_HASH };
    }
    throw err;
  }

  const parsed = parseCompilerLogContent(raw);
  return { exists: true, lineCount: parsed.lineCount, lastHash: parsed.lastHash };
}

function parseCompilerLogContent(raw) {
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const entries = [];
  let prevHash = CHAIN_GENESIS_HASH;
  for (let i = 0; i < lines.length; i++) {
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch (err) {
      throw new Error(`compiler.log line ${i + 1} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (entry.prev_hash !== prevHash) {
      throw new Error(
        `compiler.log hash-chain broken at line ${i + 1}: expected prev_hash=${prevHash}, got ${entry.prev_hash}`,
      );
    }

    const unsignedEntry = { ...entry };
    delete unsignedEntry.hash;
    const computedHash = sha256(JSON.stringify(unsignedEntry));
    if (entry.hash !== computedHash) {
      throw new Error(
        `compiler.log hash mismatch at line ${i + 1}: expected ${computedHash}, got ${entry.hash}`,
      );
    }

    entries.push(entry);
    prevHash = entry.hash;
  }

  return { entries, lineCount: lines.length, lastHash: prevHash };
}

async function readCompilerLogEntries(logPath) {
  let raw = '';
  try {
    raw = await fs.readFile(logPath, 'utf8');
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      return [];
    }
    throw err;
  }
  return parseCompilerLogContent(raw).entries;
}

async function appendCompilerAuditLog(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { written: 0, lastHash: null };
  }

  await ensureDir(path.dirname(COMPILER_LOG_PATH));
  const chainState = await getCompilerLogChainState(COMPILER_LOG_PATH);
  let prevHash = chainState.lastHash;
  let buffer = '';

  for (const event of entries) {
    const unsignedEntry = {
      ts: event.ts || nowIso(),
      run_id: event.run_id || 'unknown-run',
      level: event.level || 'WARN',
      category: event.category || 'compiler',
      code: event.code || null,
      severity: event.severity || null,
      phase: event.phase || null,
      message: event.message || '',
      task_id: event.task_id || null,
      spec_path: event.spec_path || null,
      head_sha: event.head_sha || null,
      tree_sha: event.tree_sha || null,
      context: event.context || {},
      prev_hash: prevHash,
    };
    const hash = sha256(JSON.stringify(unsignedEntry));
    const entry = { ...unsignedEntry, hash };
    buffer += `${JSON.stringify(entry)}\n`;
    prevHash = hash;
  }

  await fs.appendFile(COMPILER_LOG_PATH, buffer, 'utf8');
  return { written: entries.length, lastHash: prevHash };
}

class CompilerContext {
  constructor(args, rules, diagnosticCatalog) {
    this.args = args;
    this.rules = rules;
    this.diagnosticCatalog = diagnosticCatalog;
    this.phases = [];
    this.diagnostics = [];
    this.commandResults = [];
    this.globalDebtResults = [];
    this.oracleResults = [];
    this.changedFiles = [];
    this.groupMatches = {};
    this.generatedObligations = {
      commands: [],
      oracles: [],
      manifest: true,
    };
    this.spec = null;
    this.specPath = args.specPath;
    this.taskId = null;
    this.taskType = null;
    this.executionProfile = (rules.execution_profiles && rules.execution_profiles.default) || 'headless';
    this.executionProfileExplicit = false;
    this.requireDebtReduction = false;
    this.debtRatchet = null;
    this.treeSha = 'UNSET';
    this.subjectSha = 'UNSET';
    this.subjectFiles = [];
    this.headSha = 'UNSET';
    this.proofDir = null;
    this.logsDir = null;
    this.startedAt = nowIso();
    this.runId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    this.auditEvents = [];
  }

  addPhase(name, status, detail) {
    this.phases.push({ name, status, detail });
    if (['WARN', 'FAIL', 'BLOCKED', 'ERROR'].includes(status)) {
      this.addAuditEvent(status === 'WARN' ? 'WARN' : 'ERROR', 'phase', `${name}: ${detail}`, {
        phase: name,
        status,
      });
    }
  }

  addDiagnostic(code, message, context = {}, severityOverride = null) {
    const template = this.diagnosticCatalog[code] || {
      severity: 'FAIL',
      title: 'Unknown diagnostic',
      why_failed: 'No diagnostic metadata registered for this code.',
      root_cause_reminder: 'Solve root cause. Avoid workaround edits.',
      operator_escalation: null,
      acceptable_recipes: [],
      disallowed_workarounds: [],
      required_evidence: [],
      allowed_change_scope: [],
      forbidden_change_scope: [],
      recheck_protocol: 'npm run gov:check -- --spec <spec>',
    };

    const diagnostic = {
      code,
      severity: severityOverride || template.severity,
      title: template.title,
      message: message || template.title,
      why_failed: template.why_failed,
      root_cause_reminder: template.root_cause_reminder || null,
      operator_escalation: template.operator_escalation || null,
      acceptable_recipes: template.acceptable_recipes,
      disallowed_workarounds: template.disallowed_workarounds,
      required_evidence: template.required_evidence,
      allowed_change_scope: template.allowed_change_scope,
      forbidden_change_scope: template.forbidden_change_scope,
      recheck_protocol: template.recheck_protocol,
      context,
    };

    this.diagnostics.push(diagnostic);
    this.addAuditEvent('ERROR', 'diagnostic', diagnostic.message, {
      code: diagnostic.code,
      severity: diagnostic.severity,
      context,
    });
  }

  hasSeverity(severity) {
    return this.diagnostics.some((d) => d.severity === severity);
  }

  addAuditEvent(level, category, message, extra = {}) {
    this.auditEvents.push({
      ts: nowIso(),
      run_id: this.runId,
      level,
      category,
      message,
      task_id: this.taskId,
      spec_path: this.specPath,
      head_sha: this.headSha,
      tree_sha: this.treeSha,
      ...extra,
    });
  }
}

async function detectRepeatedBlockingFailures(ctx) {
  if (!ctx.taskId || !ctx.specPath) return;

  const currentFailures = ctx.diagnostics.filter(
    (d) => d.code === 'GOV-PROC-002' && typeof d.context?.command === 'string' && d.context.command.trim() !== '',
  );
  if (currentFailures.length === 0) return;

  let entries = [];
  try {
    entries = await readCompilerLogEntries(COMPILER_LOG_PATH);
  } catch (err) {
    ctx.addAuditEvent(
      'WARN',
      'diagnostic',
      `Could not inspect compiler.log for repeated-failure detection: ${err instanceof Error ? err.message : String(err)}`,
      { code: 'GOV-PROC-007', severity: 'WARN', context: {} },
    );
    return;
  }

  const now = Date.now();
  const emitted = new Set();
  for (const diagnostic of currentFailures) {
    const command = diagnostic.context.command.trim();
    const key = `GOV-PROC-002|${command}`;
    if (!command || emitted.has(key)) continue;

    const priorAttempts = entries.filter((entry) => {
      if (entry.category !== 'diagnostic') return false;
      if (entry.code !== 'GOV-PROC-002') return false;
      if (entry.task_id !== ctx.taskId) return false;
      if ((entry.spec_path || '') !== ctx.specPath) return false;

      const entryCommand =
        entry && typeof entry === 'object' && entry.context && typeof entry.context.command === 'string'
          ? entry.context.command.trim()
          : '';
      if (entryCommand !== command) return false;

      const ts = parseTimestampMs(entry.ts);
      if (ts === null) return true;
      return now - ts <= REPEATED_FAILURE_LOOKBACK_MS;
    }).length;

    if (priorAttempts >= REPEATED_FAILURE_PRIOR_THRESHOLD) {
      ctx.addDiagnostic(
        'GOV-PROC-007',
        `Repeated failure on ${command} (${priorAttempts + 1} attempts including current run). Request operator guidance before further edits.`,
        {
          repeated_code: 'GOV-PROC-002',
          command,
          prior_attempts: priorAttempts,
          lookback_hours: REPEATED_FAILURE_LOOKBACK_MS / (60 * 60 * 1000),
        },
      );
      emitted.add(key);
    }
  }
}

function hasHardStopDiagnostics(ctx) {
  return ctx.hasSeverity('BLOCKED') || ctx.hasSeverity('ERROR');
}

async function loadRules() {
  const [rulesRaw, diagnosticsRaw] = await Promise.all([
    fs.readFile(RULES_PATH, 'utf8'),
    fs.readFile(DIAGNOSTICS_PATH, 'utf8'),
  ]);

  const rulesParsed = readJsonFileSafe(rulesRaw, RULES_PATH);
  if (!rulesParsed.ok) throw new Error(rulesParsed.error);

  const diagnosticsParsed = readJsonFileSafe(diagnosticsRaw, DIAGNOSTICS_PATH);
  if (!diagnosticsParsed.ok) throw new Error(diagnosticsParsed.error);

  return {
    rules: rulesParsed.data,
    diagnostics: diagnosticsParsed.data.diagnostics || {},
  };
}

async function readStanddownActive() {
  let raw = '';
  try {
    raw = await fs.readFile(STANDDOWN_ACTIVE_PATH, 'utf8');
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      return { exists: false, active: false, payload: null, reportExists: false };
    }
    throw err;
  }

  const parsed = readJsonFileSafe(raw, path.relative(root, STANDDOWN_ACTIVE_PATH));
  if (!parsed.ok) {
    return { exists: true, active: true, payload: null, reportExists: false, parseError: parsed.error };
  }

  const payload = parsed.data;
  const status = typeof payload?.status === 'string' ? payload.status.trim().toUpperCase() : '';
  const active = status === 'ACTIVE';
  let reportExists = false;
  if (typeof payload?.report_path === 'string' && payload.report_path.trim() !== '') {
    try {
      await fs.access(path.resolve(root, payload.report_path));
      reportExists = true;
    } catch {
      reportExists = false;
    }
  }

  return { exists: true, active, payload, reportExists, parseError: null };
}

async function phaseParseSpec(ctx) {
  const phaseName = 'parse';

  if (!ctx.specPath) {
    ctx.addDiagnostic('GOV-SPEC-001', 'No --spec provided.');
    ctx.addPhase(phaseName, 'BLOCKED', 'Missing --spec argument.');
    return;
  }

  let specRaw;
  try {
    specRaw = await fs.readFile(path.resolve(root, ctx.specPath), 'utf8');
  } catch {
    ctx.addDiagnostic('GOV-SPEC-001', `Spec file not found: ${ctx.specPath}`, { specPath: ctx.specPath });
    ctx.addPhase(phaseName, 'BLOCKED', `Spec file missing: ${ctx.specPath}`);
    return;
  }

  const parsed = readJsonFileSafe(specRaw, ctx.specPath);
  if (!parsed.ok) {
    ctx.addDiagnostic('GOV-SPEC-002', parsed.error, { specPath: ctx.specPath });
    ctx.addPhase(phaseName, 'BLOCKED', 'Spec JSON parse failed.');
    return;
  }

  const spec = parsed.data;
  ctx.spec = spec;
  ctx.taskId = typeof spec.task_id === 'string' ? spec.task_id.trim() : '';
  ctx.taskType = typeof spec.task_type === 'string' ? spec.task_type.trim() : '';
  const allowedProfiles = Array.isArray(ctx.rules.execution_profiles?.allowed)
    ? ctx.rules.execution_profiles.allowed
    : ['headless', 'interactive'];
  const defaultProfile =
    typeof ctx.rules.execution_profiles?.default === 'string' ? ctx.rules.execution_profiles.default : 'headless';
  const rawExecutionProfile = typeof spec.execution_profile === 'string' ? spec.execution_profile.trim() : '';
  ctx.executionProfileExplicit = rawExecutionProfile.length > 0;
  ctx.executionProfile = (rawExecutionProfile || defaultProfile).toLowerCase();
  if (ctx.taskId) {
    ctx.proofDir = path.join(root, 'docs/qc/proofs', ctx.taskId);
    ctx.logsDir = path.join(ctx.proofDir, 'logs');
  }

  const errors = [];
  if (!ctx.taskId) errors.push('task_id must be a non-empty string');
  if (!ctx.rules.task_types?.includes(ctx.taskType)) {
    errors.push(`task_type must be one of: ${(ctx.rules.task_types || []).join(', ')}`);
    const suggestedTaskType = ctx.taskType === 'fix' ? 'bugfix' : null;
    ctx.addDiagnostic(
      'GOV-SPEC-007',
      `Invalid task_type "${ctx.taskType}". Allowed values: ${(ctx.rules.task_types || []).join(', ')}`,
      {
        provided_task_type: ctx.taskType,
        allowed_task_types: ctx.rules.task_types || [],
        suggested_task_type: suggestedTaskType,
      },
    );
  }
  if (!allowedProfiles.includes(ctx.executionProfile)) {
    errors.push(`execution_profile must be one of: ${allowedProfiles.join(', ')}`);
    ctx.addDiagnostic(
      'GOV-SPEC-008',
      `Invalid execution_profile "${ctx.executionProfile}". Allowed values: ${allowedProfiles.join(', ')}`,
      {
        provided_execution_profile: ctx.executionProfile,
        allowed_execution_profiles: allowedProfiles,
      },
    );
  }

  if (ctx.taskType === 'governance-change' && !ctx.args.allowGovernanceChange) {
    ctx.addDiagnostic(
      'GOV-ROLE-001',
      'governance-change is observer-only. CA must stand down; observer must rerun with --allow-governance-change.',
      {
        task_type: ctx.taskType,
        allow_governance_change: ctx.args.allowGovernanceChange,
      },
    );
  }

  const standdown = await readStanddownActive();
  const isProductTaskType = ['feature', 'bugfix', 'refactor'].includes(ctx.taskType);
  if (standdown.active && isProductTaskType) {
    const activePathRel = path.relative(root, STANDDOWN_ACTIVE_PATH);
    if (standdown.parseError) {
      ctx.addDiagnostic(
        'GOV-PROC-008',
        `Stand-down lock is active but invalid JSON: ${activePathRel}.`,
        { active_path: activePathRel, parse_error: standdown.parseError },
      );
    } else if (!standdown.payload?.report_path || !standdown.reportExists) {
      ctx.addDiagnostic(
        'GOV-PROC-008',
        `Stand-down lock active in ${activePathRel} but report artifact is missing.`,
        {
          active_path: activePathRel,
          report_path: standdown.payload?.report_path || null,
          report_exists: standdown.reportExists,
        },
      );
    } else {
      ctx.addDiagnostic(
        'GOV-PROC-008',
        `Stand-down lock is ACTIVE for product tasks. Wait for operator reactivation.`,
        {
          active_path: activePathRel,
          report_path: standdown.payload.report_path,
          activated_at_utc: standdown.payload.activated_at_utc || null,
          standdown_task_id: standdown.payload.task_id || null,
        },
      );
    }
  }

  const capability = spec.capability;
  if (!capability || typeof capability !== 'object') {
    errors.push('capability object is required');
  } else {
    if (typeof capability.summary !== 'string' || capability.summary.trim() === '') {
      errors.push('capability.summary is required');
    }
    if (!Array.isArray(capability.in_scope)) {
      errors.push('capability.in_scope must be an array');
    }
    if (!Array.isArray(capability.out_of_scope)) {
      errors.push('capability.out_of_scope must be an array');
    }
    if (!Array.isArray(capability.controls)) {
      errors.push('capability.controls must be an array');
    }
  }

  const proof = spec.proof;
  if (!proof || typeof proof !== 'object') {
    errors.push('proof object is required');
  } else {
    if (!Array.isArray(proof.fixtures) || proof.fixtures.length === 0) {
      errors.push('proof.fixtures must include at least one deterministic fixture');
      ctx.addDiagnostic('GOV-SPEC-004', 'proof.fixtures is missing or empty.');
    }
    if (typeof proof.seed !== 'string' || proof.seed.trim() === '') {
      errors.push('proof.seed is required');
      ctx.addDiagnostic('GOV-SPEC-004', 'proof.seed is missing or empty.');
    }
    if (!Array.isArray(proof.oracles)) {
      errors.push('proof.oracles must be an array');
    }
  }

  const guardrails = spec.guardrails;
  if (!guardrails || typeof guardrails !== 'object') {
    errors.push('guardrails object is required');
    ctx.addDiagnostic('GOV-SPEC-006', 'guardrails object is required.');
  } else {
    const guardrailKeys = ['allow_fixme', 'allow_skip', 'allow_contract_edits'];
    for (const key of guardrailKeys) {
      if (typeof guardrails[key] !== 'boolean') {
        errors.push(`guardrails.${key} must be boolean`);
      }
    }
    if ('require_debt_reduction' in guardrails && typeof guardrails.require_debt_reduction !== 'boolean') {
      errors.push('guardrails.require_debt_reduction must be boolean when present');
    }
    ctx.requireDebtReduction = guardrails.require_debt_reduction === true;
  }

  const controls = spec?.capability?.controls;
  if (ctx.taskType !== 'governance-change') {
    if (!Array.isArray(controls) || controls.length === 0) {
      ctx.addDiagnostic(
        'GOV-SPEC-003',
        'capability.controls must define at least one control truth table for non-governance tasks.',
      );
    }
  }

  if (ctx.taskType !== 'governance-change') {
    const mandatoryOracles = ctx.rules.mandatory_spec_oracles || [];
    const declaredOracles = Array.isArray(spec?.proof?.oracles) ? spec.proof.oracles : [];
    const missingMandatory = mandatoryOracles.filter((oracle) => !declaredOracles.includes(oracle));
    if (missingMandatory.length > 0) {
      ctx.addDiagnostic(
        'GOV-SPEC-004',
        `Spec missing mandatory oracle declarations: ${missingMandatory.join(', ')}`,
        { missingMandatory },
      );
    }
  }

  if (errors.length > 0) {
    ctx.addDiagnostic('GOV-SPEC-002', `Spec schema violations: ${errors.join('; ')}`, { errors });
    ctx.addPhase(phaseName, 'BLOCKED', `${errors.length} schema issue(s).`);
    return;
  }

  ctx.addPhase(phaseName, 'PASS', 'task.spec.json schema validated.');
}

function readChangedFilesFromGit() {
  const diff = spawn('git diff --cached --name-only --diff-filter=ACMR');
  if (diff.status !== 0) {
    throw new Error(`Unable to read staged diff: ${diff.stderr || diff.stdout || 'unknown error'}`);
  }
  const files = diff.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return files;
}

function parsePorcelainPath(raw) {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (trimmed.includes(' -> ')) {
    return trimmed.split(' -> ').pop().trim();
  }
  return trimmed;
}

function getUnstagedGovernanceScriptEdits() {
  const out = spawn('git status --porcelain --untracked-files=all -- docs/qc/scripts docs/qc/compiler');
  if (out.status !== 0) {
    throw new Error(`Unable to inspect governance script working tree state: ${out.stderr || out.stdout || 'unknown error'}`);
  }

  const dirty = new Set();
  const lines = out.stdout
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean);

  for (const line of lines) {
    if (line.startsWith('?? ')) {
      dirty.add(parsePorcelainPath(line.slice(3)));
      continue;
    }

    if (line.length < 4) continue;
    const x = line[0];
    const y = line[1];
    const filePath = parsePorcelainPath(line.slice(3));

    // We allow staged governance script edits, but block any unstaged/local drift.
    const hasUnstaged = y !== ' ';
    const unmerged = x === 'U' || y === 'U';
    if (hasUnstaged || unmerged) {
      dirty.add(filePath);
    }
  }

  return [...dirty].filter(Boolean).sort();
}

async function createIndexSnapshot(treeSha) {
  const snapshotRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gov-index-'));
  const command = `git archive ${JSON.stringify(treeSha)} | tar -x -C ${JSON.stringify(snapshotRoot)}`;
  const out = spawn(command);
  if (out.status !== 0) {
    await fs.rm(snapshotRoot, { recursive: true, force: true });
    throw new Error(`Failed to create git-index snapshot (${treeSha}): ${out.stderr || out.stdout || 'unknown error'}`);
  }
  return snapshotRoot;
}

function stableValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => stableValue(entry));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = stableValue(value[key]);
    }
    return out;
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function buildChallengeResponse(challenge, taskId, subjectSha, executionProfile, payloadDigest) {
  return sha256(`${challenge}|${taskId}|${subjectSha}|${executionProfile}|${payloadDigest}`);
}

function parseHarnessPayload(stdout) {
  const trimmed = (stdout || '').trim();
  if (!trimmed) {
    return { ok: false, error: 'Oracle harness produced empty stdout.' };
  }
  try {
    return { ok: true, data: JSON.parse(trimmed) };
  } catch (err) {
    return {
      ok: false,
      error: `Oracle harness did not output valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function loadDebtBaseline() {
  let raw = '';
  try {
    raw = await fs.readFile(DEBT_BASELINE_PATH, 'utf8');
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      return { ok: false, error: `Missing debt baseline: ${path.relative(root, DEBT_BASELINE_PATH)}` };
    }
    return {
      ok: false,
      error: `Could not read debt baseline: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const parsed = readJsonFileSafe(raw, path.relative(root, DEBT_BASELINE_PATH));
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }

  const baseline = parsed.data;
  const baselineTotal = baseline?.counts?.total_failures;
  if (!Number.isInteger(baselineTotal) || baselineTotal < 0) {
    return {
      ok: false,
      error: 'Debt baseline is missing valid counts.total_failures integer.',
    };
  }

  return { ok: true, baseline };
}

function extractFailLinesFromCommandLog(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  const stdoutMarker = '--- stdout ---';
  const stderrMarker = '--- stderr ---';
  const start = raw.indexOf(stdoutMarker);
  const end = raw.indexOf(stderrMarker);
  const body =
    start >= 0 && end > start
      ? raw.slice(start + stdoutMarker.length, end)
      : start >= 0
        ? raw.slice(start + stdoutMarker.length)
        : raw;

  const lines = body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('FAIL |'));

  return lines.map((line) => {
    const parts = line.split('|').map((part) => part.trim());
    return {
      line,
      name: parts[1] || 'unknown',
      detail: parts.slice(2).join(' | ') || '',
    };
  });
}

async function parseGlobalDebtFailures(logFileRel) {
  if (!logFileRel) return [];
  const abs = path.resolve(root, logFileRel);
  let raw = '';
  try {
    raw = await fs.readFile(abs, 'utf8');
  } catch {
    return [];
  }
  return extractFailLinesFromCommandLog(raw);
}

async function enforceGlobalDebtRatchet(ctx) {
  if (!ctx.groupMatches.product) return;

  const contracts = ctx.commandResults.find((r) => r.id === 'O-GATE-CONTRACTS-FULL');
  const architecture = ctx.commandResults.find((r) => r.id === 'O-GATE-ARCH-FULL');
  if (!contracts || !architecture) return;

  const baselineResult = await loadDebtBaseline();
  if (!baselineResult.ok) {
    ctx.addDiagnostic('GOV-DEBT-001', baselineResult.error, {
      baseline_path: path.relative(root, DEBT_BASELINE_PATH),
    });
    return;
  }

  const contractsFailures = await parseGlobalDebtFailures(contracts.log_file);
  const architectureFailures = await parseGlobalDebtFailures(architecture.log_file);
  const currentTotal = contractsFailures.length + architectureFailures.length;
  const baselineTotal = baselineResult.baseline.counts.total_failures;
  const delta = currentTotal - baselineTotal;

  ctx.debtRatchet = {
    baseline_id: baselineResult.baseline.baseline_id || null,
    baseline_total_failures: baselineTotal,
    current_total_failures: currentTotal,
    delta_total_failures: delta,
    require_debt_reduction: ctx.requireDebtReduction,
    contracts_failures: contractsFailures.map((f) => f.name),
    architecture_failures: architectureFailures.map((f) => f.name),
  };

  if (currentTotal > baselineTotal) {
    ctx.addDiagnostic(
      'GOV-DEBT-002',
      `Global debt increased versus baseline (baseline=${baselineTotal}, current=${currentTotal}, delta=+${delta}).`,
      {
        baseline_total_failures: baselineTotal,
        current_total_failures: currentTotal,
        delta_total_failures: delta,
      },
    );
  }

  if (ctx.requireDebtReduction && currentTotal >= baselineTotal) {
    ctx.addDiagnostic(
      'GOV-DEBT-003',
      `Debt-burn task requires strict reduction (baseline=${baselineTotal}, current=${currentTotal}).`,
      {
        baseline_total_failures: baselineTotal,
        current_total_failures: currentTotal,
        reduction_required: 1,
      },
    );
  }
}

function getThresholdForOracle(ctx, oracleId) {
  const thresholdConfig = ctx.rules.oracle_thresholds?.[oracleId];
  const threshold =
    thresholdConfig && typeof thresholdConfig === 'object' && thresholdConfig.profiles
      ? thresholdConfig.profiles[ctx.executionProfile]
      : thresholdConfig;

  if (thresholdConfig && thresholdConfig.profiles && !threshold) {
    ctx.addDiagnostic(
      'GOV-SPEC-008',
      `Oracle ${oracleId} has no threshold for execution_profile=${ctx.executionProfile}`,
      {
        oracle_id: oracleId,
        execution_profile: ctx.executionProfile,
        available_profiles: Object.keys(thresholdConfig.profiles || {}),
      },
    );
  }

  return threshold || null;
}

function evaluateOracleThreshold(ctx, oracleId, metrics) {
  const threshold = getThresholdForOracle(ctx, oracleId);
  if (!threshold) {
    return { thresholdPass: true, threshold: null };
  }
  const metricValue = metrics?.[threshold.metric];
  const thresholdPass = compareMetric(metricValue, threshold.operator, threshold.value);
  if (!thresholdPass) {
    ctx.addDiagnostic(
      threshold.failure_code || 'GOV-PROOF-008',
      `${oracleId} metric failed (${threshold.metric} ${threshold.operator} ${threshold.value}, got ${metricValue})`,
      {
        oracle_id: oracleId,
        metric: threshold.metric,
        operator: threshold.operator,
        expected: threshold.value,
        actual: metricValue,
      },
    );
  }
  return { thresholdPass, threshold };
}

async function executeOracleHarness(ctx) {
  const requiredOracles = [...ctx.generatedObligations.oracles];
  if (requiredOracles.length === 0) {
    return;
  }

  if (!ctx.args.noWrite) {
    await ensureDir(path.join(ctx.proofDir, 'oracles'));
    await ensureDir(path.join(ctx.proofDir, 'raw'));
  }

  const challenge = crypto.randomBytes(32).toString('hex');
  let snapshotRoot = root;
  let usedSnapshot = false;

  if (!ctx.args.simulateFiles.length && ctx.treeSha && ctx.treeSha !== 'UNSET') {
    snapshotRoot = await createIndexSnapshot(ctx.treeSha);
    usedSnapshot = true;
  }

  try {
    const harnessPath = path.join(snapshotRoot, 'docs/qc/scripts/oracle-harness.mjs');
    const oracleCsv = requiredOracles.join(',');
    const command = [
      `node ${JSON.stringify(harnessPath)}`,
      `--task-id ${JSON.stringify(ctx.taskId)}`,
      `--oracles ${JSON.stringify(oracleCsv)}`,
      `--subject-sha ${JSON.stringify(ctx.subjectSha)}`,
      `--execution-profile ${JSON.stringify(ctx.executionProfile)}`,
      `--challenge ${JSON.stringify(challenge)}`,
      `--repo-root ${JSON.stringify(snapshotRoot)}`,
      '--json',
    ].join(' ');

    const started = Date.now();
    const result = spawn(command, {
      env: {
        GOV_TASK_TYPE: ctx.taskType || '',
        GOV_EXECUTION_PROFILE: ctx.executionProfile || 'headless',
      },
    });
    const elapsedMs = Date.now() - started;

    const harnessLogPath = path.join(ctx.logsDir, 'O-ORACLE-HARNESS.log');
    const harnessLogBody = [
      `command: ${command}`,
      `status: ${result.status}`,
      `elapsed_ms: ${elapsedMs}`,
      `snapshot_root: ${snapshotRoot}`,
      `used_snapshot: ${usedSnapshot}`,
      '',
      '--- stdout ---',
      result.stdout,
      '',
      '--- stderr ---',
      result.stderr,
    ].join('\n');
    await writeLog(harnessLogPath, harnessLogBody);

    if (result.status !== 0) {
      ctx.addDiagnostic(
        'GOV-PROOF-010',
        `Oracle harness failed (exit=${result.status}).`,
        {
          command,
          exit_code: result.status,
          log_file: path.relative(root, harnessLogPath),
        },
      );
      for (const oracleId of requiredOracles) {
        ctx.oracleResults.push({
          oracle_id: oracleId,
          status: 'BLOCKED',
          artifact: path.join('docs/qc/proofs', ctx.taskId, 'oracles', `${oracleId}.json`),
        });
      }
      return;
    }

    const parsed = parseHarnessPayload(result.stdout);
    if (!parsed.ok) {
      ctx.addDiagnostic('GOV-PROOF-010', parsed.error, {
        log_file: path.relative(root, harnessLogPath),
      });
      for (const oracleId of requiredOracles) {
        ctx.oracleResults.push({
          oracle_id: oracleId,
          status: 'BLOCKED',
          artifact: path.join('docs/qc/proofs', ctx.taskId, 'oracles', `${oracleId}.json`),
        });
      }
      return;
    }

    const payload = parsed.data;
    if (payload.task_id !== ctx.taskId) {
      ctx.addDiagnostic('GOV-PROOF-008', `Oracle harness task_id mismatch (expected ${ctx.taskId}, got ${payload.task_id})`, {
        expected_task_id: ctx.taskId,
        harness_task_id: payload.task_id,
      });
    }
    if (payload.subject_sha !== ctx.subjectSha) {
      ctx.addDiagnostic(
        'GOV-PROOF-006',
        `Oracle harness subject_sha mismatch (expected ${ctx.subjectSha}, got ${payload.subject_sha})`,
        {
          expected_subject_sha: ctx.subjectSha,
          harness_subject_sha: payload.subject_sha,
        },
      );
    }
    if (payload.execution_profile !== ctx.executionProfile) {
      ctx.addDiagnostic(
        'GOV-SPEC-008',
        `Oracle harness execution_profile mismatch (expected ${ctx.executionProfile}, got ${payload.execution_profile})`,
        {
          expected_execution_profile: ctx.executionProfile,
          harness_execution_profile: payload.execution_profile,
        },
      );
    }

    const harnessVersion = typeof payload.harness_version === 'string' ? payload.harness_version.trim() : '';
    if (!harnessVersion) {
      ctx.addDiagnostic('GOV-PROOF-008', 'Oracle harness_version is missing or empty in harness payload.');
    } else if (/^manual\b/i.test(harnessVersion)) {
      ctx.addDiagnostic('GOV-PROOF-009', `Manual oracle harness is not allowed (harness_version=${harnessVersion}).`, {
        harness_version: harnessVersion,
      });
    }

    const payloadOracles = Array.isArray(payload.oracles) ? payload.oracles : [];
    const digestInput = payloadOracles
      .map((oracle) => ({
        oracle_id: oracle?.oracle_id,
        status: oracle?.status,
        metrics: oracle?.metrics || {},
        raw_sha256: oracle?.raw_sha256 || null,
      }))
      .sort((a, b) => String(a.oracle_id).localeCompare(String(b.oracle_id)));

    const payloadDigest = sha256(stableStringify(digestInput));
    if (payload.payload_digest !== payloadDigest) {
      ctx.addDiagnostic(
        'GOV-PROOF-011',
        'Oracle payload digest mismatch.',
        {
          expected_payload_digest: payloadDigest,
          harness_payload_digest: payload.payload_digest || null,
        },
      );
    }

    if (payload.challenge !== challenge) {
      ctx.addDiagnostic('GOV-PROOF-011', 'Oracle challenge echo mismatch.', {
        expected_challenge: challenge,
        harness_challenge: payload.challenge || null,
      });
    }

    const expectedResponse = buildChallengeResponse(
      challenge,
      ctx.taskId,
      ctx.subjectSha,
      ctx.executionProfile,
      payloadDigest,
    );
    if (payload.challenge_response !== expectedResponse) {
      ctx.addDiagnostic('GOV-PROOF-011', 'Oracle challenge_response mismatch.', {
        expected_challenge_response: expectedResponse,
        harness_challenge_response: payload.challenge_response || null,
      });
    }

    const payloadById = new Map();
    for (const oracle of payloadOracles) {
      if (oracle && typeof oracle.oracle_id === 'string' && !payloadById.has(oracle.oracle_id)) {
        payloadById.set(oracle.oracle_id, oracle);
      }
    }

    for (const oracleId of requiredOracles) {
      const relArtifact = path.join('docs/qc/proofs', ctx.taskId, 'oracles', `${oracleId}.json`);
      const relRaw = path.posix.join('raw', `${oracleId}.json`);

      const oracle = payloadById.get(oracleId);
      if (!oracle) {
        ctx.addDiagnostic('GOV-PROOF-004', `Oracle harness did not return required oracle: ${oracleId}`, {
          oracle_id: oracleId,
        });
        ctx.oracleResults.push({ oracle_id: oracleId, status: 'BLOCKED', artifact: relArtifact });
        continue;
      }

      const metrics = oracle.metrics && typeof oracle.metrics === 'object' ? oracle.metrics : {};
      const evidence = typeof oracle.evidence === 'string' ? oracle.evidence : '';
      const status = typeof oracle.status === 'string' ? oracle.status.toUpperCase() : 'FAIL';
      const rawEncoding = oracle.raw?.encoding === 'base64' ? 'base64' : 'utf8';
      const rawContent = typeof oracle.raw?.content === 'string' ? oracle.raw.content : '';
      const rawBuffer = Buffer.from(rawContent, rawEncoding);
      const rawSha = sha256(rawBuffer);

      if (oracle.raw_sha256 && oracle.raw_sha256 !== rawSha) {
        ctx.addDiagnostic('GOV-PROOF-005', `Oracle raw artifact hash mismatch for ${oracleId}`, {
          oracle_id: oracleId,
          expected_hash: oracle.raw_sha256,
          actual_hash: rawSha,
        });
      }

      const artifact = {
        oracle_id: oracleId,
        task_id: ctx.taskId,
        subject_sha: ctx.subjectSha,
        harness_version: harnessVersion || 'unknown',
        status,
        metrics,
        raw_artifact: relRaw,
        raw_sha256: rawSha,
        evidence,
        challenge_id: sha256(challenge),
        payload_digest: payloadDigest,
      };

      const rawPath = path.join(ctx.proofDir, relRaw);
      const artifactPath = path.join(ctx.proofDir, 'oracles', `${oracleId}.json`);
      if (!ctx.args.noWrite) {
        await fs.writeFile(rawPath, rawBuffer);
        await fs.writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
      }

      const { thresholdPass, threshold } = evaluateOracleThreshold(ctx, oracleId, metrics);
      if (status !== 'PASS') {
        ctx.addDiagnostic(
          threshold?.failure_code || 'GOV-PROOF-008',
          `${oracleId} reported status ${status}`,
          { oracle_id: oracleId, status },
        );
      }

      ctx.oracleResults.push({
        oracle_id: oracleId,
        status: status === 'PASS' && thresholdPass ? 'PASS' : 'FAIL',
        artifact: relArtifact,
        raw_artifact: path.join('docs/qc/proofs', ctx.taskId, relRaw),
        raw_sha256: rawSha,
      });
    }
  } finally {
    if (usedSnapshot) {
      await fs.rm(snapshotRoot, { recursive: true, force: true });
    }
  }
}

function buildGroupMatches(pathGroups, changedFiles) {
  const matches = {};
  for (const [group, patterns] of Object.entries(pathGroups || {})) {
    matches[group] = changedFiles.some((filePath) => matchesAnyPattern(filePath, patterns));
  }
  return matches;
}

async function phaseBind(ctx) {
  const phaseName = 'bind';

  try {
    ctx.headSha = git('rev-parse --short HEAD');
  } catch {
    ctx.headSha = 'UNSET';
  }

  if (ctx.args.simulateFiles.length > 0) {
    ctx.changedFiles = [...ctx.args.simulateFiles];
    ctx.treeSha = 'SIMULATED-TREE';
    ctx.subjectFiles = ctx.changedFiles.filter((filePath) => !isCompilerManagedArtifact(filePath));
    ctx.subjectSha = ctx.subjectFiles.length > 0 ? sha256(ctx.subjectFiles.sort().join('\n')) : 'SIMULATED-SUBJECT';
  } else {
    ctx.changedFiles = readChangedFilesFromGit();
    if (ctx.changedFiles.length > 0) {
      try {
        ctx.treeSha = git('write-tree');
      } catch {
        ctx.treeSha = 'UNSET';
      }
    }
    ctx.subjectFiles = ctx.changedFiles.filter((filePath) => !isCompilerManagedArtifact(filePath));
    ctx.subjectSha = computeSubjectShaFromIndex(ctx.subjectFiles);
  }

  if (ctx.changedFiles.length === 0) {
    ctx.addDiagnostic('GOV-PROC-001', 'No staged files found.');
    ctx.addPhase(phaseName, 'BLOCKED', 'No staged files to bind.');
    return;
  }

  const pathGroups = ctx.rules.path_groups || {};
  ctx.groupMatches = buildGroupMatches(pathGroups, ctx.changedFiles);

  const allPatterns = Object.values(pathGroups).flat();
  const unboundFiles = ctx.changedFiles.filter((filePath) => !matchesAnyPattern(filePath, allPatterns));
  if (unboundFiles.length > 0) {
    ctx.addDiagnostic('GOV-BIND-001', `Unbound changed files: ${unboundFiles.join(', ')}`, { unboundFiles });
  }

  if (!ctx.args.simulateFiles.length) {
    try {
      const dirtyGovernanceScripts = getUnstagedGovernanceScriptEdits();
      if (dirtyGovernanceScripts.length > 0) {
        ctx.addDiagnostic(
          'GOV-PROC-009',
          `Governance script local edits must be cleanly staged before check: ${dirtyGovernanceScripts.join(', ')}`,
          { dirtyGovernanceScripts },
        );
      }
    } catch (err) {
      ctx.addDiagnostic(
        'GOV-PROC-003',
        `Unable to inspect governance script working tree state: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const inScopePatterns = Array.isArray(ctx.spec?.capability?.in_scope) ? ctx.spec.capability.in_scope : [];
  if (inScopePatterns.length > 0 && !inScopePatterns.includes('**')) {
    const scopeMismatches = ctx.changedFiles.filter(
      (filePath) => !isCompilerManagedArtifact(filePath) && !matchesAnyPattern(filePath, inScopePatterns),
    );
    if (scopeMismatches.length > 0) {
      ctx.addDiagnostic(
        'GOV-BIND-006',
        `Staged files outside capability.in_scope: ${scopeMismatches.join(', ')}`,
        { scopeMismatches },
      );
    }
  }

  const governanceTouched = ctx.changedFiles.some((filePath) => isGovernancePolicyFile(filePath));
  const productTouched = !!ctx.groupMatches.product;

  if (ctx.taskType !== 'governance-change' && governanceTouched) {
    ctx.addDiagnostic(
      'GOV-BIND-004',
      `Non-governance task (${ctx.taskType}) modified governance files.`,
      { taskType: ctx.taskType },
    );
  }

  if (ctx.taskType === 'governance-change' && productTouched) {
    ctx.addDiagnostic('GOV-SPEC-005', 'governance-change task cannot include product files.', {
      changedFiles: ctx.changedFiles,
    });
  }

  const declaredOracles = Array.isArray(ctx.spec?.proof?.oracles) ? ctx.spec.proof.oracles : [];

  if (ctx.groupMatches.audio_dsp || ctx.groupMatches.audio) {
    const requiredAudio = ctx.rules.required_oracles?.audio || [];
    const missing = requiredAudio.filter((oracle) => !declaredOracles.includes(oracle));
    if (missing.length > 0) {
      ctx.addDiagnostic('GOV-BIND-002', `Missing declared audio oracles: ${missing.join(', ')}`, {
        missing,
      });
    }
  }

  if (ctx.groupMatches.controls) {
    const requiredControls = ctx.rules.required_oracles?.controls || [];
    const missing = requiredControls.filter((oracle) => !declaredOracles.includes(oracle));
    if (missing.length > 0) {
      ctx.addDiagnostic('GOV-BIND-003', `Missing declared control oracles: ${missing.join(', ')}`, {
        missing,
      });
    }
  }

  if (ctx.groupMatches.persistence) {
    const requiredPersistence = ctx.rules.required_oracles?.persistence || [];
    const missing = requiredPersistence.filter((oracle) => !declaredOracles.includes(oracle));
    if (missing.length > 0) {
      ctx.addDiagnostic('GOV-BIND-005', `Missing persistence oracle declarations: ${missing.join(', ')}`, {
        missing,
      });
    }
  }

  if (ctx.groupMatches.benchmark && !ctx.executionProfileExplicit) {
    ctx.addDiagnostic(
      'GOV-SPEC-008',
      'Benchmark-governed task must declare execution_profile explicitly in task spec.',
      { required_profiles: ctx.rules.execution_profiles?.allowed || ['headless', 'interactive'] },
    );
  }

  ctx.addPhase(phaseName, ctx.diagnostics.length > 0 ? 'WARN' : 'PASS', 'Diff-to-contract binding complete.');
}

function synthesizeCommandObligations(ctx) {
  const commandRules = ctx.rules.command_obligations || {};
  const commandIds = new Set();

  if (ctx.groupMatches.product) {
    commandIds.add('O-CI');
    commandIds.add('O-E2E');
    commandIds.add('O-GATE-CONTRACTS-DELTA');
    commandIds.add('O-GATE-ARCH-DELTA');
    commandIds.add('O-GATE-CONTRACTS-FULL');
    commandIds.add('O-GATE-ARCH-FULL');
    commandIds.add('O-COMMIT-RANGE');
  }

  if (ctx.groupMatches.audio_dsp || ctx.groupMatches.audio) {
    commandIds.add('O-AUDIO-GATES');
  }

  if (ctx.taskType === 'governance-change') {
    commandIds.add('O-CI');
  }

  return [...commandIds]
    .map((id) => ({ id, ...commandRules[id] }))
    .filter((obligation) => obligation.command);
}

function synthesizeOracleObligations(ctx) {
  const set = new Set();

  const declared = Array.isArray(ctx.spec?.proof?.oracles) ? ctx.spec.proof.oracles : [];
  if (ctx.taskType !== 'governance-change' || ctx.groupMatches.product) {
    for (const oracle of declared) {
      set.add(oracle);
    }
  }

  if (ctx.groupMatches.audio_dsp || ctx.groupMatches.audio) {
    for (const oracle of ctx.rules.required_oracles?.audio || []) set.add(oracle);
  }

  if (ctx.groupMatches.controls) {
    for (const oracle of ctx.rules.required_oracles?.controls || []) set.add(oracle);
  }

  if (ctx.groupMatches.persistence) {
    for (const oracle of ctx.rules.required_oracles?.persistence || []) set.add(oracle);
  }

  if (ctx.groupMatches.benchmark) {
    for (const oracle of ctx.rules.required_oracles?.benchmark || []) set.add(oracle);
  }

  return [...set];
}

async function phaseSynthesize(ctx) {
  const phaseName = 'synthesize';

  ctx.generatedObligations.commands = synthesizeCommandObligations(ctx);
  ctx.generatedObligations.oracles = synthesizeOracleObligations(ctx);

  const detail = `commands=${ctx.generatedObligations.commands.length}, oracles=${ctx.generatedObligations.oracles.length}, manifest=required`;
  ctx.addPhase(phaseName, 'PASS', detail);
}

async function writeLog(logPath, content) {
  await ensureDir(path.dirname(logPath));
  await fs.writeFile(logPath, content, 'utf8');
}

async function executeCommandObligations(ctx) {
  const obligations = ctx.generatedObligations.commands;
  if (obligations.length === 0) {
    return;
  }

  await ensureDir(ctx.logsDir);

  for (const obligation of obligations) {
    const started = Date.now();
    const result = spawn(obligation.command, {
      env: {
        GOV_CHANGED_FILES: ctx.changedFiles.join('\n'),
        GOV_SUBJECT_FILES: ctx.subjectFiles.join('\n'),
        GOV_TASK_TYPE: ctx.taskType || '',
        GOV_EXECUTION_PROFILE: ctx.executionProfile || 'headless',
      },
    });
    const elapsedMs = Date.now() - started;
    const logFile = path.join(ctx.logsDir, `${obligation.id}.log`);
    const logBody = [
      `command: ${obligation.command}`,
      `status: ${result.status}`,
      `elapsed_ms: ${elapsedMs}`,
      '',
      '--- stdout ---',
      result.stdout,
      '',
      '--- stderr ---',
      result.stderr,
    ].join('\n');

    await writeLog(logFile, logBody);

    const outcome = {
      id: obligation.id,
      label: obligation.label || obligation.id,
      command: obligation.command,
      blocking: obligation.non_blocking === true ? false : true,
      status: result.status === 0 ? 'PASS' : 'FAIL',
      exit_code: result.status,
      elapsed_ms: elapsedMs,
      log_file: path.relative(root, logFile),
    };

    ctx.commandResults.push(outcome);

    if (result.status !== 0) {
      if (obligation.non_blocking === true) {
        ctx.globalDebtResults.push({
          id: obligation.id,
          label: obligation.label || obligation.id,
          command: obligation.command,
          status: 'FAIL',
          log_file: outcome.log_file,
        });
        ctx.addAuditEvent('WARN', 'global_debt', `${obligation.id} failed (tracked, non-blocking)`, {
          code: obligation.failure_code || 'GOV-PROC-002',
          severity: 'WARN',
          context: { command: obligation.command, log_file: outcome.log_file, exit_code: result.status },
        });
      } else {
        ctx.addDiagnostic(
          obligation.failure_code || 'GOV-PROC-002',
          `${obligation.id} failed: ${obligation.command}`,
          {
            command: obligation.command,
            log_file: outcome.log_file,
            exit_code: result.status,
          },
        );
      }
    }
  }
}

async function validateManifest(ctx) {
  const manifestPath = path.join(ctx.proofDir, 'proof.manifest.json');
  const relManifest = path.relative(root, manifestPath);

  let raw;
  try {
    raw = await fs.readFile(manifestPath, 'utf8');
  } catch {
    ctx.addDiagnostic('GOV-PROOF-001', `Missing proof manifest: ${relManifest}`, { manifest: relManifest });
    return null;
  }

  const parsed = readJsonFileSafe(raw, relManifest);
  if (!parsed.ok) {
    ctx.addDiagnostic('GOV-PROOF-008', parsed.error, { manifest: relManifest });
    return null;
  }

  const manifest = parsed.data;
  if (!ctx.args.noWrite && ctx.commandResults.length > 0) {
    manifest.required_gates = ctx.commandResults.map((result) => ({
      id: result.id,
      result: result.status,
      blocking: result.blocking,
      evidence: result.log_file,
    }));
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  }

  const requiredFields = ctx.rules.manifest?.required_fields || [];
  const missingFields = requiredFields.filter((field) => !(field in manifest));
  if (missingFields.length > 0) {
    ctx.addDiagnostic(
      'GOV-PROOF-008',
      `Manifest missing fields: ${missingFields.join(', ')}`,
      { missingFields, manifest: relManifest },
    );
  }

  if (manifest.task_id !== ctx.taskId) {
    ctx.addDiagnostic('GOV-PROOF-008', `Manifest task_id mismatch (expected ${ctx.taskId}, got ${manifest.task_id})`, {
      manifest_task_id: manifest.task_id,
    });
  }

  const manifestTreeAuto = manifest.tree_sha === '__AUTO__';
  if (!ctx.args.simulateFiles.length && !manifestTreeAuto && manifest.tree_sha !== ctx.treeSha) {
    ctx.addDiagnostic(
      'GOV-PROOF-006',
      `Manifest tree_sha mismatch (expected ${ctx.treeSha}, got ${manifest.tree_sha})`,
      { expected_tree_sha: ctx.treeSha, actual_tree_sha: manifest.tree_sha },
    );
  }

  if (ctx.args.strictManifest) {
    const requiredCommandIds = ctx.generatedObligations.commands
      .filter((obligation) => obligation.non_blocking !== true)
      .map((o) => o.id);
    const gateRecords = Array.isArray(manifest.required_gates) ? manifest.required_gates : [];
    const missingGateRecords = requiredCommandIds.filter(
      (id) => !gateRecords.some((record) => record.id === id && typeof record.result === 'string'),
    );
    if (missingGateRecords.length > 0) {
      ctx.addDiagnostic(
        'GOV-PROOF-008',
        `Manifest missing required gate records: ${missingGateRecords.join(', ')}`,
        { missingGateRecords },
      );
    }
  }

  return manifest;
}

async function phaseExecute(ctx) {
  const phaseName = 'execute';

  if (!ctx.spec || !ctx.taskId) {
    ctx.addPhase(phaseName, 'BLOCKED', 'Spec missing; execute skipped.');
    return;
  }
  if (!ctx.proofDir || !ctx.logsDir) {
    ctx.addDiagnostic(
      'GOV-SPEC-002',
      'Proof paths could not be resolved from spec; fix parse diagnostics first, then rerun.',
      { task_id: ctx.taskId, proof_dir: ctx.proofDir, logs_dir: ctx.logsDir },
    );
    ctx.addPhase(phaseName, 'BLOCKED', 'Proof paths unresolved; execute skipped.');
    return;
  }

  if (!ctx.args.noWrite) {
    await ensureDir(ctx.proofDir);
    await ensureDir(ctx.logsDir);
  }

  await executeCommandObligations(ctx);
  await enforceGlobalDebtRatchet(ctx);
  await validateManifest(ctx);
  await executeOracleHarness(ctx);

  const failCount = ctx.diagnostics.filter((d) => d.severity === 'FAIL').length;
  const blockedCount = ctx.diagnostics.filter((d) => d.severity === 'BLOCKED').length;
  const status = failCount > 0 ? 'FAIL' : blockedCount > 0 ? 'BLOCKED' : 'PASS';
  ctx.addPhase(
    phaseName,
    status,
    `commands=${ctx.commandResults.length}, oracles=${ctx.oracleResults.length}, diagnostics=${ctx.diagnostics.length}`,
  );
}

async function phaseVerify(ctx) {
  const phaseName = 'verify';
  await detectRepeatedBlockingFailures(ctx);
  const verdict = summarizeVerdict(ctx.diagnostics);
  ctx.addPhase(phaseName, verdict, `Final verdict: ${verdict}`);
}

async function phaseAttest(ctx) {
  const phaseName = 'attest';
  if (!ctx.spec || !ctx.taskId) {
    ctx.addPhase(phaseName, 'BLOCKED', 'No spec/task_id; attestation not written.');
    return null;
  }

  const verdict = summarizeVerdict(ctx.diagnostics);
  const attestation = {
    task_id: ctx.taskId,
    task_type: ctx.taskType,
    execution_profile: ctx.executionProfile,
    spec_path: ctx.specPath,
    policy_version: ctx.rules.version,
    diagnostics_version: ctx.diagnosticCatalog.version || '1.0.0',
    started_at_utc: ctx.startedAt,
    finished_at_utc: nowIso(),
    head_sha: ctx.headSha,
    tree_sha: ctx.treeSha,
    subject_sha: ctx.subjectSha,
    subject_files: ctx.subjectFiles,
    simulated_files: ctx.args.simulateFiles,
    changed_files: ctx.changedFiles,
    phases: ctx.phases,
    obligations: {
      commands: ctx.commandResults,
      global_debt: ctx.globalDebtResults,
      debt_ratchet: ctx.debtRatchet,
      oracles: ctx.oracleResults,
      manifest_required: true,
    },
    diagnostics: ctx.diagnostics,
    verdict,
  };

  const verdictPath = path.join(ctx.proofDir, 'verdict.json');
  if (!ctx.args.noWrite) {
    await ensureDir(ctx.proofDir);
    await fs.writeFile(verdictPath, `${JSON.stringify(attestation, null, 2)}\n`, 'utf8');
  }

  ctx.addPhase(phaseName, verdict, ctx.args.noWrite ? 'Attestation write skipped (--no-write).' : 'verdict.json written.');
  return { verdictPath, verdict, attestation };
}

async function flushAuditTrail(ctx) {
  if (ctx.auditEvents.length === 0) {
    return { written: 0, lastHash: null };
  }

  return appendCompilerAuditLog(ctx.auditEvents);
}

function printSummary(ctx, attestationResult) {
  if (ctx.args.quiet) return;

  console.log('governance-compiler: phase summary');
  console.log(`execution_profile: ${ctx.executionProfile}`);
  for (const phase of ctx.phases) {
    console.log(`- ${phase.name}: ${phase.status} | ${phase.detail}`);
  }

  if (ctx.commandResults.length > 0) {
    console.log('\ncommand obligations');
    for (const command of ctx.commandResults) {
      console.log(
        `- ${command.status} | ${command.id} | ${command.command} | blocking=${command.blocking} | log=${command.log_file} | exit=${command.exit_code}`,
      );
    }
  }

  if (ctx.globalDebtResults.length > 0) {
    console.log('\nglobal debt (non-blocking)');
    for (const debt of ctx.globalDebtResults) {
      console.log(`- FAIL | ${debt.id} | ${debt.command} | log=${debt.log_file}`);
    }
  }

  if (ctx.debtRatchet) {
    console.log('\ndebt ratchet');
    console.log(`- baseline_id=${ctx.debtRatchet.baseline_id || 'unknown'}`);
    console.log(
      `- baseline_total=${ctx.debtRatchet.baseline_total_failures} | current_total=${ctx.debtRatchet.current_total_failures} | delta=${ctx.debtRatchet.delta_total_failures >= 0 ? '+' : ''}${ctx.debtRatchet.delta_total_failures}`,
    );
    console.log(`- require_debt_reduction=${ctx.debtRatchet.require_debt_reduction ? 'true' : 'false'}`);
  }

  if (ctx.oracleResults.length > 0) {
    console.log('\noracle obligations');
    for (const oracle of ctx.oracleResults) {
      console.log(`- ${oracle.status} | ${oracle.oracle_id} | artifact=${oracle.artifact}`);
    }
  }

  if (ctx.diagnostics.length > 0) {
    console.log('\ndiagnostics');
    for (const diagnostic of ctx.diagnostics) {
      console.log(`- ${diagnostic.severity} | ${diagnostic.code} | ${diagnostic.message}`);
      if (diagnostic.acceptable_recipes?.length) {
        const recipes = diagnostic.acceptable_recipes.map((r) => `${r.id}: ${r.summary}`).join(' || ');
        console.log(`  acceptable: ${recipes}`);
      }
      if (diagnostic.root_cause_reminder) {
        console.log(`  reminder: ${diagnostic.root_cause_reminder}`);
      }
      if (diagnostic.operator_escalation) {
        console.log(`  escalate: ${diagnostic.operator_escalation}`);
      }
      if (diagnostic.disallowed_workarounds?.length) {
        console.log(`  disallowed: ${diagnostic.disallowed_workarounds.join(' || ')}`);
      }
      if (diagnostic.recheck_protocol) {
        console.log(`  recheck: ${diagnostic.recheck_protocol}`);
      }
    }
  } else {
    console.log('\ndiagnostics\n- none');
  }

  if (ctx.diagnostics.length > 0) {
    console.log('\nrequired remediation loop');
    console.log('1. Read the highest-severity diagnostic and pick one acceptable recipe.');
    console.log('2. Apply only root-cause remediation; do not bypass with direct commit.');
    console.log('3. Re-run: npm run gov:check -- --spec <same-spec>');
    console.log('4. If conflict is truly unresolvable in-task, request operator guidance with evidence.');
    console.log('5. Repeat until final verdict is PASS, then run gov:commit.');
  }

  if (attestationResult?.verdictPath && !ctx.args.noWrite) {
    console.log(`\nattestation: ${path.relative(root, attestationResult.verdictPath)}`);
  }

  console.log(`\nfinal verdict: ${attestationResult?.verdict || summarizeVerdict(ctx.diagnostics)}`);
}

async function runCompiler(args) {
  const { rules, diagnostics } = await loadRules();
  diagnostics.version = diagnostics.version || '1.0.0';

  const ctx = new CompilerContext(args, rules, diagnostics);

  await phaseParseSpec(ctx);
  if (hasHardStopDiagnostics(ctx)) {
    ctx.addPhase('bind', 'BLOCKED', 'Skipped due blocking parse diagnostics.');
    ctx.addPhase('synthesize', 'BLOCKED', 'Skipped due blocking parse diagnostics.');
    ctx.addPhase('execute', 'BLOCKED', 'Skipped due blocking parse diagnostics.');
  } else {
    await phaseBind(ctx);
    if (hasHardStopDiagnostics(ctx)) {
      ctx.addPhase('synthesize', 'BLOCKED', 'Skipped due blocking bind diagnostics.');
      ctx.addPhase('execute', 'BLOCKED', 'Skipped due blocking bind diagnostics.');
    } else {
      await phaseSynthesize(ctx);
      await phaseExecute(ctx);
    }
  }
  await phaseVerify(ctx);
  const attestationResult = await phaseAttest(ctx);
  const auditWriteResult = await flushAuditTrail(ctx);
  if (auditWriteResult.written > 0) {
    ctx.addPhase('audit', 'PASS', `Appended ${auditWriteResult.written} warning/error event(s) to logs/compiler.log.`);
  }

  printSummary(ctx, attestationResult);

  const verdict = attestationResult?.verdict || summarizeVerdict(ctx.diagnostics);
  return { verdict, ctx, attestationResult, auditWriteResult };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  try {
    const { verdict } = await runCompiler(args);
    if (verdict === 'PASS') {
      process.exit(0);
    }
    process.exit(1);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await appendCompilerAuditLog([
        {
          ts: nowIso(),
          run_id: `fatal-${Date.now()}`,
          level: 'ERROR',
          category: 'fatal',
          code: 'GOV-PROC-003',
          severity: 'ERROR',
          phase: 'main',
          message,
          task_id: null,
          spec_path: args.specPath || null,
          head_sha: null,
          tree_sha: null,
          context: {},
        },
      ]);
    } catch {
      // do not mask primary error
    }
    console.error(`ERROR | GOV-PROC-003 | ${message}`);
    process.exit(1);
  }
}

void main();
