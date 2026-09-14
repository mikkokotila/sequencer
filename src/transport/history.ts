/** Session history. Samples and decoded buffers are shared, never copied per edit. */
import { emit } from '../events';
import type { SongData } from '../types';

export interface HistorySnapshot {
  song: SongData;
  buffers: (AudioBuffer | null)[];
}
interface Entry {
  snapshot: HistorySnapshot;
  label: string;
}
interface HistoryHost {
  capture(): HistorySnapshot;
  restore(snapshot: HistorySnapshot): void;
  equal(a: HistorySnapshot, b: HistorySnapshot): boolean;
  save(): void;
}
let host: HistoryHost | undefined;
let current: HistorySnapshot | undefined;
const past: Entry[] = [];
const future: Entry[] = [];
let depth = 0;
let gestureLabel = 'Edit song';
let restoring = false;
let revision = 0;

export function configureHistory(value: HistoryHost): void {
  host = value;
}
export function getHistoryState() {
  return {
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    undoLabel: past[past.length - 1]?.label ?? '',
    redoLabel: future[future.length - 1]?.label ?? '',
    revision,
  };
}
function notify(): void {
  emit('editor:historyChanged', getHistoryState());
}
export function resetHistory(): void {
  past.length = 0;
  future.length = 0;
  depth = 0;
  current = host?.capture();
  revision++;
  notify();
}

function resources(snapshot: HistorySnapshot): Map<object, number> {
  const result = new Map<object, number>();
  const s = snapshot.song;
  for (const sample of [...s.drumSampleData, ...s.melSampleData, s.vocalSampleData])
    if (sample) result.set(sample.data, sample.data.byteLength);
  for (const buffer of snapshot.buffers)
    if (buffer) result.set(buffer, buffer.length * buffer.numberOfChannels * 4);
  return result;
}
function boundHistory(): void {
  while (past.length > 50) past.shift();
  // Bound audio retained ONLY for undo, in addition to the current song's audio.
  const live = resources(current!);
  while (past.length || future.length) {
    const retained = new Map<object, number>();
    for (const entry of [...past, ...future])
      for (const [resource, bytes] of resources(entry.snapshot))
        if (!live.has(resource)) retained.set(resource, bytes);
    if ([...retained.values()].reduce((sum, bytes) => sum + bytes, 0) <= 128 * 1024 * 1024) break;
    if (past.length) past.shift();
    else future.shift();
  }
}

/** Call after an edit; nested gestures collapse into one history entry. */
export function checkpoint(label = 'Edit song'): void {
  if (!host || restoring || depth || !current) return;
  const next = host.capture();
  if (host.equal(current, next)) return;
  past.push({ snapshot: current, label });
  current = next;
  future.length = 0;
  revision++;
  boundHistory();
  notify();
}
export function beginHistoryGesture(label = 'Edit song'): void {
  if (restoring) return;
  if (!depth) {
    checkpoint();
    gestureLabel = label;
  }
  depth++;
}
export function endHistoryGesture(): void {
  if (!depth) return;
  depth--;
  if (!depth) checkpoint(gestureLabel);
}

/** Validate before entering, or throw to roll back a partially applied synchronous edit. */
export function editDocument<T>(label: string, operation: () => T): T {
  const before = host?.capture();
  const previousDepth = depth;
  beginHistoryGesture(label);
  try {
    const result = operation();
    endHistoryGesture();
    emit('editor:documentChanged', {});
    host?.save();
    return result;
  } catch (error) {
    depth = previousDepth;
    if (before && host) {
      restoring = true;
      try {
        host.restore(before);
      } finally {
        restoring = false;
      }
    }
    throw error;
  }
}
function travel(direction: 'undo' | 'redo'): boolean {
  if (!host || !current || depth || restoring) return false;
  checkpoint();
  const source = direction === 'undo' ? past : future;
  const destination = direction === 'undo' ? future : past;
  const entry = source[source.length - 1];
  if (!entry) return false;
  const previous = current;
  restoring = true;
  try {
    host.restore(entry.snapshot);
  } finally {
    restoring = false;
  }
  source.pop();
  destination.push({ snapshot: previous, label: entry.label });
  current = host.capture();
  boundHistory();
  revision++;
  notify();
  host.save();
  return true;
}
export function undo(): boolean {
  return travel('undo');
}
export function redo(): boolean {
  return travel('redo');
}
