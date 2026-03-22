# Commit Contract

Every change that has been made, tested, and handed over gets a commit. No exceptions.

## Format

Conventional Commits: `type(scope): description`

### Types
- `feat` — new feature or capability
- `fix` — bug fix
- `refactor` — code change that neither fixes a bug nor adds a feature
- `style` — visual/UI change (colors, layout, spacing)
- `perf` — performance improvement (audio, rendering)
- `test` — adding or updating tests
- `docs` — documentation only
- `chore` — build, config, dependencies

### Scope
Optional. Use the affected area: `core`, `ext`, `mixer`, `reverb`, `delay`, `vari-mu`, `pultec`, `ui`, `audio`, `persistence`, `phrases`, `tests`.

### Examples
```
feat(phrases): add 12-phrase song structure with fill-from-previous
fix(audio): eliminate DC offset in tape saturation curve
style(ui): apply three-family color contract
test(audio): add deterministic signal path quality gate
docs(contracts): add commit and quality-gates contracts
```

## Rules

1. One commit per logical change. Don't batch unrelated work.
2. Run `npm run gov:check -- --spec docs/qc/specs/<task-id>.task.spec.json` before committing.
3. If `gov:check` is not `PASS`, do not commit. Read diagnostics, apply acceptable recipes, rerun `gov:check`, and repeat until `PASS`.
4. Commit through `npm run gov:commit -- --spec docs/qc/specs/<task-id>.task.spec.json -m \"type(scope): description\"`.
5. Do not bypass with direct `git commit` for product changes.
6. Commit message describes the *why*, not the *what*.
7. Never amend previous commits unless explicitly asked.
8. Keep one active work branch per task lifecycle; do not split the same task into multiple branches.
9. After every completion commit, push immediately: `git push origin HEAD`.
10. If no open PR exists for the current branch, create one immediately targeting `main`.
11. Do not report task completion until PR readiness gate is `PASS`: `npm run gate:pr-ready`.

## Verification Before Commit

No committing without verifying the actual app works in a real browser. Automated checks (CI, preview screenshots) are necessary but not sufficient. The duplicate-handler bug that made clicking do nothing was invisible to every automated check.

Before every commit:
1. `npm run gov:check -- --spec docs/qc/specs/<task-id>.task.spec.json` returns `PASS`
2. All compiler-required blocking obligations pass (`ci`, `e2e`, full contract/architecture gates, `gate:commit-range`, and `audio:gates` if bound)
3. The app has been opened in an actual browser and the changed feature manually confirmed to work

If you cannot verify in a real browser, the commit message must state this explicitly.

## Remote Publication Protocol

A task is not complete at commit time alone. Completion requires remote publication.

Required sequence after `gov:commit`:

1. `git push origin HEAD`
2. Check branch PR status.
3. If no PR exists, create PR:
   - `gh pr create --base main --head <current-branch> --fill`
4. Continue all further commits on the same branch/PR until merged.
5. Wait for required CI checks and incoming review feedback on that PR.
6. For every review conversation, respond in-thread:
   - if fixed: push fix commit and leave confirmation reply
   - if not fixed: leave explicit no-fix rationale
7. Before reporting back, run `npm run gate:pr-ready` and require `PASS` (all required checks green, all conversations resolved, all conversations answered).
