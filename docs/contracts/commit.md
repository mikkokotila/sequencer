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
2. Run `npm run ci` and `npm run e2e` before committing.
3. Commit message describes the *why*, not the *what*.
4. Never amend previous commits unless explicitly asked.

## Verification Before Commit

No committing without verifying the actual app works in a real browser. Automated checks (CI, preview screenshots) are necessary but not sufficient. The duplicate-handler bug that made clicking do nothing was invisible to every automated check.

Before every commit:
1. `npm run ci` passes (typecheck, lint, format, circular)
2. `npm run e2e` passes (all Playwright tests)
3. The app has been opened in an actual browser and the changed feature manually confirmed to work

If you cannot verify in a real browser, the commit message must state this explicitly.
