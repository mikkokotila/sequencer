# Contract Routing

Read the relevant contract BEFORE starting work. Not all contracts apply to every task.

## Always

**Read:** `docs/contracts/commit.md`
Every completed change gets a conventional commit.

**Run:** `npm run ci`
Every completed change must pass all four CI gates (typecheck, lint, format, circular). Read `docs/contracts/quality-gates.md` for details.

## When changing audio code

Applies to: any file in `src/engine/`, `src/engine/worklets/`, `src/engine/extensions/`.

**Read:** `docs/contracts/quality-gates.md`
Run `tests/audio-quality.html` after changes. All 25 assertions must pass.

## When changing colors, styles, or visual identity

Applies to: CSS in `index.html`, track colors, extension panel styling, grid cell colors, text colors.

**Read:** `docs/contracts/use-of-color.md`
Three color families. Controls are monochrome. No color for decoration.
