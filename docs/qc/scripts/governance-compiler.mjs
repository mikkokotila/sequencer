#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const RULES_PATH = path.join(root, 'docs/qc/compiler/obligation-rules.json');
const DIAGNOSTICS_PATH = path.join(root, 'docs/qc/compiler/diagnostics.json');
const COMPILER_LOG_PATH = path.join(root, 'logs/compiler.log');
const CHAIN_GENESIS_HASH = '0'.repeat(64);

function parseArgs(argv) {
  const args = {
    mode: 'check',
    specPath: process.env.GOV_TASK_SPEC || '',
    simulateFiles: [],
    noWrite: false,
    strictManifest: true,
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

const COMPILER_MANAGED_ARTIFACT_PATTERNS = ['docs/qc/proofs/**', 'docs/qc/specs/**', 'logs/compiler.log'];

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

  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

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

    prevHash = entry.hash;
  }

  return { exists: true, lineCount: lines.length, lastHash: prevHash };
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

  const errors = [];
  if (!ctx.taskId) errors.push('task_id must be a non-empty string');
  if (!ctx.rules.task_types?.includes(ctx.taskType)) {
    errors.push(`task_type must be one of: ${(ctx.rules.task_types || []).join(', ')}`);
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

  ctx.proofDir = path.join(root, 'docs/qc/proofs', ctx.taskId);
  ctx.logsDir = path.join(ctx.proofDir, 'logs');

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

async function validateOracleArtifact(ctx, oracleId) {
  const artifactTemplate = ctx.rules.oracle_artifact?.base_dir || 'docs/qc/proofs/{task_id}/oracles';
  const oracleBase = artifactTemplate.replace('{task_id}', ctx.taskId);
  const oraclePath = path.join(root, oracleBase, `${oracleId}.json`);
  const relOraclePath = path.relative(root, oraclePath);

  let raw;
  try {
    raw = await fs.readFile(oraclePath, 'utf8');
  } catch {
    ctx.addDiagnostic('GOV-PROOF-004', `Missing oracle artifact: ${relOraclePath}`, {
      oracle_id: oracleId,
      artifact: relOraclePath,
    });
    ctx.oracleResults.push({ oracle_id: oracleId, status: 'BLOCKED', artifact: relOraclePath });
    return;
  }

  const parsed = readJsonFileSafe(raw, relOraclePath);
  if (!parsed.ok) {
    ctx.addDiagnostic('GOV-PROOF-008', parsed.error, {
      oracle_id: oracleId,
      artifact: relOraclePath,
    });
    ctx.oracleResults.push({ oracle_id: oracleId, status: 'BLOCKED', artifact: relOraclePath });
    return;
  }

  const artifact = parsed.data;
  const requiredFields = ctx.rules.oracle_artifact?.required_fields || [];
  const missingFields = requiredFields.filter((field) => !(field in artifact));
  if (missingFields.length > 0) {
    ctx.addDiagnostic('GOV-PROOF-008', `Oracle artifact missing fields: ${missingFields.join(', ')}`, {
      oracle_id: oracleId,
      missingFields,
    });
  }

  if (artifact.oracle_id !== oracleId) {
    ctx.addDiagnostic(
      'GOV-PROOF-008',
      `Oracle id mismatch in ${relOraclePath} (expected ${oracleId}, got ${artifact.oracle_id})`,
      { oracle_id: oracleId, artifact_oracle_id: artifact.oracle_id },
    );
  }

  if (artifact.task_id !== ctx.taskId) {
    ctx.addDiagnostic(
      'GOV-PROOF-008',
      `Oracle task_id mismatch for ${oracleId} (expected ${ctx.taskId}, got ${artifact.task_id})`,
      { oracle_id: oracleId, artifact_task_id: artifact.task_id },
    );
  }

  if (!ctx.args.simulateFiles.length && artifact.subject_sha !== ctx.subjectSha) {
    ctx.addDiagnostic(
      'GOV-PROOF-006',
      `Oracle subject_sha mismatch for ${oracleId} (expected ${ctx.subjectSha}, got ${artifact.subject_sha})`,
      { oracle_id: oracleId, artifact_subject_sha: artifact.subject_sha, expected_subject_sha: ctx.subjectSha },
    );
  }

  const rawArtifactPath = path.resolve(ctx.proofDir, artifact.raw_artifact || '');
  let rawContent;
  try {
    rawContent = await fs.readFile(rawArtifactPath);
  } catch {
    ctx.addDiagnostic('GOV-PROOF-004', `Missing oracle raw artifact for ${oracleId}: ${artifact.raw_artifact}`, {
      oracle_id: oracleId,
      raw_artifact: artifact.raw_artifact,
    });
    ctx.oracleResults.push({
      oracle_id: oracleId,
      status: 'BLOCKED',
      artifact: relOraclePath,
      raw_artifact: artifact.raw_artifact,
    });
    return;
  }

  const actualHash = sha256(rawContent);
  if (actualHash !== artifact.raw_sha256) {
    ctx.addDiagnostic(
      'GOV-PROOF-005',
      `Oracle raw artifact hash mismatch for ${oracleId}`,
      {
        oracle_id: oracleId,
        expected_hash: artifact.raw_sha256,
        actual_hash: actualHash,
      },
    );
  }

  const threshold = ctx.rules.oracle_thresholds?.[oracleId];
  let thresholdPass = true;
  if (threshold) {
    const metricValue = artifact.metrics?.[threshold.metric];
    thresholdPass = compareMetric(metricValue, threshold.operator, threshold.value);
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
  }

  if (artifact.status !== 'PASS') {
    ctx.addDiagnostic(
      threshold?.failure_code || 'GOV-PROOF-008',
      `${oracleId} reported status ${artifact.status}`,
      { oracle_id: oracleId, status: artifact.status },
    );
  }

  ctx.oracleResults.push({
    oracle_id: oracleId,
    status: artifact.status === 'PASS' && thresholdPass ? 'PASS' : 'FAIL',
    artifact: relOraclePath,
    raw_artifact: path.relative(root, rawArtifactPath),
    raw_sha256: actualHash,
  });
}

async function phaseExecute(ctx) {
  const phaseName = 'execute';

  if (!ctx.spec || !ctx.taskId) {
    ctx.addPhase(phaseName, 'BLOCKED', 'Spec missing; execute skipped.');
    return;
  }

  if (!ctx.args.noWrite) {
    await ensureDir(ctx.proofDir);
    await ensureDir(ctx.logsDir);
  }

  await executeCommandObligations(ctx);
  await validateManifest(ctx);

  for (const oracleId of ctx.generatedObligations.oracles) {
    await validateOracleArtifact(ctx, oracleId);
  }

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
  await phaseBind(ctx);
  await phaseSynthesize(ctx);
  await phaseExecute(ctx);
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
