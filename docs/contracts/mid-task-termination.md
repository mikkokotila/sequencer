# Mid-Task Termination Contract

## Mandate

Operator stand-down instructions override all active work immediately.

When operator says `stand down`, WA must stop task execution and run termination protocol before any further action.

## Hard Stop Rules

1. Stop all task processes (dev servers, watch mode, tests) immediately.
2. Do not create new edits.
3. Do not stage new files.
4. Do not commit.
5. Do not continue remediation loop.

## Required Protocol

Run:

```bash
npm run gov:standdown -- --task-id <task-id> --reason "<operator reason>"
```

This command captures:

1. `HEAD` SHA
2. staged / unstaged / untracked snapshot
3. optional safety stash (if dirty)
4. immutable stand-down report artifact
5. active stand-down lock artifact

## Required Artifacts

1. `docs/qc/standdown/reports/<timestamp>-<task-id>.json`
2. `docs/qc/standdown/active.json`

`active.json` remains active until operator explicitly clears it.

## Compiler Enforcement

If `docs/qc/standdown/active.json` is active:

1. product task types (`feature`, `bugfix`, `refactor`) are blocked with `GOV-PROC-008`
2. WA must not resume product work until operator clears stand-down lock

## Reactivation

Only operator can reactivate WA by clearing `docs/qc/standdown/active.json` and issuing explicit resume instruction.
