# Proof: setState disabled guard for master insert extensions

## Task
20260322-debt-setstate-disabled-guard

## Summary
Added `if (enabled)` guard to `applyState()` in `setState()` for compressor, pultec-eq, and transformer extensions. Previously `setState` applied audio processing unconditionally — even when the extension was disabled — violating the "off means off" contract.

## Debt Reduction
Targets 3 findings from `docs/qc/debt/baseline.json`:
- `src/engine/extensions/pultec-eq.ts: setState respects disabled state`
- `src/engine/extensions/compressor.ts: setState respects disabled state`
- `src/engine/extensions/transformer.ts: setState respects disabled state`

## Change
In each file, changed:
```typescript
setState(s: ExtensionState): void {
  state = { ...state, ...(s as Partial<...>) };
  applyState(); // ← unconditional
}
```
To:
```typescript
setState(s: ExtensionState): void {
  state = { ...state, ...(s as Partial<...>) };
  if (enabled) applyState(); // ← only when on
}
```

## Gate Results
Verified by contract gate regex: `setState(s: ExtensionState): void {` followed by `if (enabled) applyState()`.
