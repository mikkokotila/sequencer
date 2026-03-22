#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const DEFAULT_REQUIRED_CHECKS = [
  'type-gate',
  'style-gate',
  'format-gate',
  'circular-gate',
  'e2e-gate',
  'audio-gate',
  'codeql-gate',
  'compiler-gate',
];

function parseArgs(argv) {
  const args = {
    pr: '',
    repo: '',
    requiredChecks: '',
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--pr') {
      args.pr = (argv[i + 1] || '').trim();
      i++;
      continue;
    }
    if (token === '--repo') {
      args.repo = (argv[i + 1] || '').trim();
      i++;
      continue;
    }
    if (token === '--required-checks') {
      args.requiredChecks = (argv[i + 1] || '').trim();
      i++;
      continue;
    }
  }

  return args;
}

function parseCsv(value) {
  return (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function run(command, args) {
  const env = { ...process.env };
  if (!env.GH_TOKEN && env.GITHUB_TOKEN) {
    env.GH_TOKEN = env.GITHUB_TOKEN;
  }
  const out = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
    env,
  });
  return {
    status: out.status ?? 1,
    stdout: out.stdout || '',
    stderr: out.stderr || '',
  };
}

function mustRun(command, args) {
  const out = run(command, args);
  if (out.status !== 0) {
    const rendered = [command, ...args].join(' ');
    throw new Error(`${rendered} failed: ${(out.stderr || out.stdout || 'unknown error').trim()}`);
  }
  return out.stdout.trim();
}

function ghApi(args) {
  return mustRun('gh', ['api', ...args]);
}

function ghGraphql(query, vars) {
  const args = ['graphql', '-f', `query=${query}`];
  for (const [key, value] of Object.entries(vars || {})) {
    if (value === undefined || value === null || value === '') continue;
    args.push('-F', `${key}=${value}`);
  }
  const raw = ghApi(args);
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse gh graphql response: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function tryReadEventContext() {
  const eventPath = process.env.GITHUB_EVENT_PATH || '';
  if (!eventPath || !fs.existsSync(eventPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
    const pr = parsed?.pull_request;
    if (!pr?.number) return null;
    return {
      pr: String(pr.number),
      repo: parsed?.repository?.full_name || process.env.GITHUB_REPOSITORY || '',
      headSha: pr?.head?.sha || '',
    };
  } catch {
    return null;
  }
}

function splitRepo(fullName) {
  const parts = (fullName || '').split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid repo format: "${fullName}". Expected owner/repo.`);
  }
  return { owner: parts[0], name: parts[1] };
}

function resolveContext(args) {
  const fromEvent = tryReadEventContext();
  const repo =
    args.repo ||
    fromEvent?.repo ||
    process.env.GITHUB_REPOSITORY ||
    mustRun('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
  const pr =
    args.pr || fromEvent?.pr || mustRun('gh', ['pr', 'view', '--json', 'number', '--jq', '.number']);

  const { owner, name } = splitRepo(repo);
  const number = Number.parseInt(pr, 10);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`Invalid PR number: "${pr}".`);
  }

  const query = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      number
      url
      headRefOid
      author { login }
    }
  }
}
`;
  const payload = ghGraphql(query, { owner, name, number });
  const prData = payload?.data?.repository?.pullRequest;
  if (!prData) {
    throw new Error(`Unable to load PR #${number} in ${repo}.`);
  }

  return {
    owner,
    name,
    repo,
    number,
    url: prData.url || '',
    waLogin: prData?.author?.login || '',
    headSha: prData.headRefOid || fromEvent?.headSha || '',
  };
}

function collectLatestCheckRuns(owner, name, headSha) {
  const raw = ghApi([
    '-H',
    'Accept: application/vnd.github+json',
    `repos/${owner}/${name}/commits/${headSha}/check-runs?per_page=100`,
  ]);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse check-runs payload: ${err instanceof Error ? err.message : String(err)}`);
  }
  const runs = Array.isArray(parsed?.check_runs) ? parsed.check_runs : [];
  const latest = new Map();
  for (const runItem of runs) {
    const key = typeof runItem?.name === 'string' ? runItem.name.trim() : '';
    if (!key) continue;
    const prev = latest.get(key);
    if (!prev || Number(runItem.id || 0) > Number(prev.id || 0)) {
      latest.set(key, runItem);
    }
  }
  return latest;
}

function collectReviewThreads(owner, name, number) {
  const query = `
query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $cursor) {
        nodes {
          id
          isResolved
          path
          line
          originalLine
          comments(first: 100) {
            nodes {
              url
              body
              createdAt
              author { login }
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
}
`;

  const nodes = [];
  let cursor = '';
  let hasNext = true;
  while (hasNext) {
    const payload = ghGraphql(query, { owner, name, number, cursor });
    const threads = payload?.data?.repository?.pullRequest?.reviewThreads;
    const batch = Array.isArray(threads?.nodes) ? threads.nodes : [];
    nodes.push(...batch);
    hasNext = Boolean(threads?.pageInfo?.hasNextPage);
    cursor = hasNext ? threads?.pageInfo?.endCursor || '' : '';
  }
  return nodes;
}

function toMs(value) {
  const t = Date.parse(value || '');
  return Number.isFinite(t) ? t : 0;
}

function location(thread) {
  const line = Number.isInteger(thread?.line) ? thread.line : thread?.originalLine;
  const path = thread?.path || '<unknown>';
  return line ? `${path}:${line}` : path;
}

function evaluateChecks(requiredChecks, latestRuns) {
  const failures = [];
  for (const checkName of requiredChecks) {
    const runItem = latestRuns.get(checkName);
    if (!runItem) {
      failures.push({
        check: checkName,
        issue: 'missing',
        message: 'required check run not found',
      });
      continue;
    }
    const status = String(runItem.status || '').toLowerCase();
    const conclusion = String(runItem.conclusion || '').toLowerCase();
    if (status !== 'completed') {
      failures.push({
        check: checkName,
        issue: 'pending',
        message: `status=${runItem.status || 'unknown'}`,
        detailsUrl: runItem.html_url || runItem.details_url || '',
      });
      continue;
    }
    if (conclusion !== 'success') {
      failures.push({
        check: checkName,
        issue: 'failed',
        message: `conclusion=${runItem.conclusion || 'unknown'}`,
        detailsUrl: runItem.html_url || runItem.details_url || '',
      });
    }
  }
  return failures;
}

function evaluateThreads(threads, waLogin) {
  const unresolved = [];
  const missingResponse = [];

  for (const thread of threads) {
    const comments = Array.isArray(thread?.comments?.nodes) ? thread.comments.nodes : [];
    const waComments = comments.filter((c) => c?.author?.login === waLogin && String(c?.body || '').trim().length > 0);
    const nonWaComments = comments.filter((c) => c?.author?.login && c?.author?.login !== waLogin);

    const latestWaMs = waComments.reduce((acc, c) => Math.max(acc, toMs(c?.createdAt)), 0);
    const latestNonWaMs = nonWaComments.reduce((acc, c) => Math.max(acc, toMs(c?.createdAt)), 0);
    const respondedAfterLatestReviewer = latestWaMs > 0 && latestWaMs >= latestNonWaMs;

    if (!thread?.isResolved) {
      unresolved.push({
        location: location(thread),
        url: comments[comments.length - 1]?.url || '',
      });
    }
    if (!respondedAfterLatestReviewer) {
      missingResponse.push({
        location: location(thread),
        url: comments[comments.length - 1]?.url || '',
      });
    }
  }

  return { unresolved, missingResponse };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const configuredChecks = parseCsv(args.requiredChecks || process.env.PR_READY_REQUIRED_CHECKS);
  const requiredChecks = configuredChecks.length > 0 ? configuredChecks : DEFAULT_REQUIRED_CHECKS;

  let context;
  try {
    context = resolveContext(args);
  } catch (err) {
    console.error(
      `BLOCKED | PR-READY-004 | Failed to resolve PR context: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }

  if (!context.headSha) {
    console.error(`BLOCKED | PR-READY-004 | Missing PR head SHA for PR #${context.number}.`);
    process.exit(1);
  }
  if (!context.waLogin) {
    console.error(`BLOCKED | PR-READY-004 | Missing PR author login for PR #${context.number}.`);
    process.exit(1);
  }

  const latestRuns = collectLatestCheckRuns(context.owner, context.name, context.headSha);
  const checkFailures = evaluateChecks(requiredChecks, latestRuns);

  const threads = collectReviewThreads(context.owner, context.name, context.number);
  const threadEval = evaluateThreads(threads, context.waLogin);

  let failures = 0;

  if (checkFailures.length > 0) {
    failures += 1;
    console.error(
      `FAIL | PR-READY-001 | Required checks are not all green for PR #${context.number} (${context.repo}).`,
    );
    for (const item of checkFailures) {
      const suffix = item.detailsUrl ? ` | url=${item.detailsUrl}` : '';
      console.error(`- check=${item.check} | issue=${item.issue} | ${item.message}${suffix}`);
    }
  }

  if (threadEval.unresolved.length > 0) {
    failures += 1;
    console.error(
      `FAIL | PR-READY-002 | Unresolved review conversations: ${threadEval.unresolved.length} thread(s).`,
    );
    for (const item of threadEval.unresolved) {
      const suffix = item.url ? ` | url=${item.url}` : '';
      console.error(`- conversation=${item.location}${suffix}`);
    }
  }

  if (threadEval.missingResponse.length > 0) {
    failures += 1;
    console.error(
      `FAIL | PR-READY-003 | Missing WA response comments after latest reviewer message: ${threadEval.missingResponse.length} thread(s).`,
    );
    for (const item of threadEval.missingResponse) {
      const suffix = item.url ? ` | url=${item.url}` : '';
      console.error(`- conversation=${item.location}${suffix}`);
    }
  }

  if (failures > 0) {
    console.error(
      `\npr-ready-gate: BLOCKED handoff for PR #${context.number}. Resolve diagnostics, rerun npm run gate:pr-ready.`,
    );
    process.exit(1);
  }

  console.log(`PASS | pr-ready-gate | PR #${context.number} is ready to merge.`);
  console.log(`- repo=${context.repo}`);
  console.log(`- pr_url=${context.url}`);
  console.log(`- required_checks_green=${requiredChecks.length}`);
  console.log(`- review_threads=${threads.length}`);
  console.log(`- unresolved_threads=0`);
  console.log(`- missing_wa_responses=0`);
}

try {
  main();
} catch (err) {
  console.error(`ERROR | PR-READY-004 | ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
