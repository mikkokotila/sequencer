/**
 * Typed event bus — connects engine, transport, and UI layers.
 * No external dependencies.
 */

// ── Event type map ──

export interface EventMap {
  // Engine → UI: playback position
  'engine:step':              { step: number; phrase: number };
  'engine:stop':              Record<string, never>;

  // Transport → UI: state changed, re-render
  'transport:patternChanged': { type: string; track: number; step: number };
  'transport:phraseChanged':  { phrase: number };
  'transport:songLoaded':     Record<string, never>;
  'transport:songNameChanged': { name: string };
  'transport:save':           Record<string, never>;

  // UI → Transport: user actions
  'ui:setStep':               { type: string; track: number; step: number; note?: number; value: boolean };
  'ui:loadSample':            { type: string; track: number; buffer: ArrayBuffer; name: string };
  'ui:setBpm':                { bpm: number };
}

// ── Bus implementation ──

type Listener<T> = (data: T) => void;

const listeners = new Map<string, Set<Listener<unknown>>>();

export function on<K extends keyof EventMap>(
  event: K,
  fn: Listener<EventMap[K]>,
): void {
  let set = listeners.get(event);
  if (!set) {
    set = new Set();
    listeners.set(event, set);
  }
  set.add(fn as Listener<unknown>);
}

export function off<K extends keyof EventMap>(
  event: K,
  fn: Listener<EventMap[K]>,
): void {
  const set = listeners.get(event);
  if (set) set.delete(fn as Listener<unknown>);
}

export function emit<K extends keyof EventMap>(
  event: K,
  data: EventMap[K],
): void {
  const set = listeners.get(event);
  if (set) {
    for (const fn of set) fn(data);
  }
}
