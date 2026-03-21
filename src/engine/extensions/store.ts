/**
 * Extension state — the canonical home for extension-related shared state.
 * Extracted from state.ts to give clear ownership and avoid circular
 * dependencies between registry.ts and persistence.ts.
 */

import type { Extension } from '../../types';

/** Registered extensions (ordered: inserts first, then aux/utility) */
export const SEQ_EXTENSIONS: Extension[] = [];

/** Currently active (open) extension panel, or null */
export let activeExtensionId: string | null = null;

export function setActiveExtensionId(v: string | null): void {
  activeExtensionId = v;
}

/** Callbacks to run when playback stops (registered by extensions) */
export const seqStopCallbacks: (() => void)[] = [];
