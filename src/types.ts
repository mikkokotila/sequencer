// Track configuration
export interface TrackColorConfig {
  readonly color: string;
  readonly bright: string;
  readonly idle: string;
  readonly grid: string;
}

export type DrumTrackConfig = TrackColorConfig;

export interface MelodyTrackConfig extends TrackColorConfig {
  readonly mono: boolean;
}

// Pattern data
export interface Phrase {
  drumPat: boolean[][]; // [track][step]
  melPat: boolean[][][]; // [track][step][note]
  vocalPat: boolean[]; // [step]
}

// Sample data for persistence
export interface SampleData {
  name: string;
  data: ArrayBuffer;
}

// Song persistence
export interface SongData {
  id: string;
  name: string;
  bpm: number;
  phrases: Phrase[];
  currentPhrase: number;
  octaves: number[];
  harmonies: number[];
  drumNames: string[];
  melNames: string[];
  vocalName: string;
  mutedArr: boolean[];
  drumSampleData: (SampleData | null)[];
  melSampleData: (SampleData | null)[];
  vocalSampleData: SampleData | null;
  extensions: Record<string, ExtensionState>;
  updatedAt: number;
}

// Extension system
export type ExtensionState = Record<string, unknown>;

export interface NodePair {
  input: AudioNode;
  output: AudioNode;
}

export interface Extension {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  init(ctx: AudioContext): NodePair | null;
  createUI(container: HTMLElement): void;
  getState(): ExtensionState;
  setState(s: ExtensionState): void;
  setEnabled?(on: boolean): void;
  destroy(): void;
  _enabled?: boolean;
  _nodes?: NodePair | null;
}

export type TrackType = 'drum' | 'melody' | 'vocal';

export interface TrackInfo {
  name: string;
  color: string;
  bright: string;
  type: TrackType;
}

export interface Selection {
  track: number;
  start: number;
  end: number;
}

export interface SampleManifestEntry {
  path: string;
  files: string[];
}

export type SampleManifest = Record<string, SampleManifestEntry>;

export interface BrowserItem {
  name: string;
  displayName: string;
  url: string;
  group: string;
}

export interface LoadedSample {
  buffer: AudioBuffer;
  data: ArrayBuffer;
  name: string;
}
