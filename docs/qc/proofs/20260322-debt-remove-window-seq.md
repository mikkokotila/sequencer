# Proof: Remove window.SEQ global

## Task
20260322-debt-remove-window-seq

## Summary
Removed the `window.SEQ` global API installation from `registry.ts`. All internal extensions already use `ExtensionHost` dependency injection via `init(ctx, host)`. No external extensions exist in the Vite/TypeScript app entrypoint; the legacy `sequencer.html` page and `extensions/*.js` scripts that still rely on `window.SEQ` are intentionally out of scope for this proof, so the global serves no purpose in the modern app and violates the architecture invariant "No global window.SEQ extension coupling."

## Changes
- `src/engine/extensions/registry.ts`: removed `SeqAPI` interface, `Window` global declaration, and `installSeqAPI()` function (~95 lines)
- `src/main.ts`: removed `installSeqAPI` import and call
- `src/types.ts`: removed stale comment referencing window.SEQ

## Debt Reduction
Targets architecture finding: "No global window.SEQ extension coupling"
