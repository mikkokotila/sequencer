# Task Proof Template

task_id: <YYYYMMDD-short-name>
completed_at_utc: <ISO-8601>
author: <agent-or-human>
commit_shas:
- <sha1>

## Required Gates

| Gate | Required | Result | Evidence |
|---|---|---|---|
| `npm run ci` | yes | PASS/FAIL/BLOCKED | command output summary or link |
| `npm run e2e` | yes | PASS/FAIL/BLOCKED | command output summary or link |
| `tests/audio-quality.html` | conditional | PASS/FAIL/BLOCKED/N/A | assertion count + result |
| `tests/benchmark.html` | conditional | PASS/FAIL/BLOCKED/N/A | config + p99 vs budget |

## Contract Applicability

| Contract | Applies | Status | Evidence |
|---|---|---|---|
| `docs/contracts/commit.md` | yes/no | PASS/FAIL/BLOCKED | |
| `docs/contracts/quality-gates.md` | yes/no | PASS/FAIL/BLOCKED | |
| `docs/contracts/e2e.md` | yes/no | PASS/FAIL/BLOCKED | |
| `docs/contracts/adaptive-transfer.md` | yes/no | PASS/FAIL/BLOCKED/N/A | |
| `docs/contracts/use-of-color.md` | yes/no | PASS/FAIL/BLOCKED/N/A | |

## Browser Verification

status: VERIFIED / NOT_VERIFIED
details: <what was manually verified in a real browser, or why not verified>

## Notes

- Include blockers, caveats, and any deviations.
