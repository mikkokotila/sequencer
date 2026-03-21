# E2E Test Contract

## Mandate

The E2E test suite must cover every user-facing feature in the application. Every interaction that a user can perform must have a corresponding test. No exceptions.

## Running

```
npm run e2e
```

Starts a Vite dev server and runs Playwright tests against it. All tests must pass.
Global debt scan: `npm run gate:contracts` reports unresolved `test.fixme`.
Blocking task-regression scan runs via governance compiler delta mode and fails on newly introduced `test.fixme`.
E2E is compiler-bound: product diffs trigger this gate automatically through `gov:check`.

## Coverage Requirements

Every feature category must be tested:

| Category | What to test |
|----------|-------------|
| App Initialization | All tracks render, transport bar, extensions, phrase pane |
| Drum Grid | Click toggles on/off, default pattern, drag painting |
| Melody Grid | Click toggles on/off, mono enforcement |
| Vocal Grid | Click toggles on/off |
| Track Controls | Mute, CLR, FILL, LOAD (opens browser), track name edit |
| Melody Controls | Octave up/down, harmony toggle |
| BPM Control | Slider and number input, clamping |
| Song Management | Name display, rename, new song, delete |
| Sample Browser | Open, close, search filter, item selection |
| Phrase Pane | Click switches phrase, content indicator, fill-with-prev |
| Extension Panels | Open, close, toggle on/off, app shift |
| Engine Panel | Open, close, all control sections visible |
| Keyboard Shortcuts | Space play/stop, Escape close |
| Persistence | Pattern survives reload |
| Grid Alignment | Bar dividers, drum/melody vertical alignment |

## Rules

1. **Every new feature gets a test.** If you add a button, the test suite must verify it works.
2. **Every bug fix gets a test.** The test must fail without the fix and pass with it.
3. **Tests must be deterministic.** No flaky assertions. Use explicit waits, not timeouts where possible.
4. **Tests must be independent.** Each test starts from a fresh page load. No test depends on another.
5. **`test.fixme()` is release-blocking.** Zero fixme is mandatory.
6. **Audio tests use OfflineAudioContext** in separate test files (signal-purity, audio-quality, benchmark). E2E tests verify DOM state, not audio output.
