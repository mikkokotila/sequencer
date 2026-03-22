/**
 * Typed event bus — connects engine, transport, and UI layers.
 * No external dependencies.
 */

// ── Event type map ──

export interface EventMap {
  // Engine → UI: playback position
  'engine:step': { step: number; phrase: number };
  'engine:trigger': {
    track: number;
    step: number;
    phrase: number;
    time: number;
    source: 'drum' | 'melody' | 'vocal';
  };
  'engine:stop': Record<string, never>;

  // Transport → UI: state changed, re-render
  'transport:patternChanged': { type: string; track: number; step: number };
  'transport:phraseChanged': { phrase: number };
  'transport:songLoaded': Record<string, never>;
  'transport:songNameChanged': { name: string };
  'transport:save': Record<string, never>;

  // UI → Transport: user actions
  'ui:setStep': { type: string; track: number; step: number; note?: number; value: boolean };
  'ui:loadSample': { type: string; track: number; buffer: ArrayBuffer; name: string };
  'ui:setBpm': { bpm: number };

  // Persistence lifecycle
  'persistence:songCreated': Record<string, never>;
  'persistence:songDeleted': Record<string, never>;
  'persistence:songSwitched': Record<string, never>;
  'persistence:fileLoaded': Record<string, never>;

  // MIDI
  'midi:connected': { trackIndex: number; inputId: string; inputName: string };
  'midi:disconnected': { trackIndex: number };
  'midi:devicesChanged': Record<string, never>;
}

// ── Bus implementation ──

type Listener<T> = (data: T) => void;

const listeners = new Map<string, Set<Listener<unknown>>>();

export function on<K extends keyof EventMap>(event: K, fn: Listener<EventMap[K]>): void {
  let set = listeners.get(event);
  if (!set) {
    set = new Set();
    listeners.set(event, set);
  }
  set.add(fn as Listener<unknown>);
}

export function off<K extends keyof EventMap>(event: K, fn: Listener<EventMap[K]>): void {
  const set = listeners.get(event);
  if (set) set.delete(fn as Listener<unknown>);
}

export function emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
  const set = listeners.get(event);
  if (set) {
    for (const fn of set) fn(data);
  }
}

// Test hook: expose the same live bus instance to browser E2E code.
if (typeof window !== 'undefined') {
  (
    window as typeof window & {
      __SEQ_EVENT_BUS__?: { on: typeof on; off: typeof off };
    }
  ).__SEQ_EVENT_BUS__ = { on, off };
}
