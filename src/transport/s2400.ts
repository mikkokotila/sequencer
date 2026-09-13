/** Public drum-project export API shared by the GUI and programmatic callers. */
import { DRUMS_CFG, STEPS } from '../config';
import { getChannelFaders } from '../engine/audio';
import { bpm, currentSongName, drumBuf, drumNames, mutedArr } from './song';
import { phrases } from './patterns';
import type { S2400Track } from './s2400-format';

export interface S2400ExportOptions {
  signal?: AbortSignal;
  onProgress?: (progress: { stage: 'samples' | 'packaging'; fraction: number }) => void;
}
export interface S2400Export {
  blob: Blob;
  filename: string;
  patternCount: number;
  trackCount: number;
  warnings: string[];
}
const RATE = 48000;
const PCM_BUDGET = 32 * 1024 * 1024;
function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError');
}
function safeName(value: string, length: number): string {
  return (
    value
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, length) || 'Untitled'
  );
}

/** Snapshot all five drum rows, including muted rows, before invoking callbacks or yielding. */
function capture() {
  if (
    DRUMS_CFG.length !== 5 ||
    phrases.some(
      (phrase) => phrase.drumPat.length !== 5 || phrase.drumPat.some((row) => row.length !== STEPS),
    )
  )
    throw new Error('S2400 export requires five drum tracks and 64-step phrases.');
  if (!Number.isFinite(bpm) || bpm < 30 || bpm > 300)
    throw new Error('S2400 tempo must be between 30 and 300 BPM.');
  const patterns = phrases
    .map((phrase, i) => ({
      phrase: i + 1,
      steps: phrase.drumPat.map((row) => row.slice()),
    }))
    .filter((pattern) => pattern.steps.some((row) => row.some(Boolean)));
  if (!patterns.length) throw new Error('Add drum steps before exporting to S2400.');
  if (patterns.length > 99) throw new Error('S2400 projects support at most 99 patterns.');
  const faders = getChannelFaders();
  let pcmBytes = 0,
    sourceBytes = 0;
  // Validate every source before allocating copies; missing samples never silently drop notes.
  const sources = drumBuf.flatMap((buffer, index) => {
    const used = patterns.some((pattern) => pattern.steps[index]?.some(Boolean));
    if (!buffer) {
      if (used) throw new Error(`Load a sample for drum ${index + 1} before exporting.`);
      return [];
    }
    if (!used) return [];
    if (buffer.numberOfChannels > 2 || buffer.duration > 60)
      throw new Error(`Drum ${index + 1} must be mono or stereo and no longer than 60 seconds.`);
    const frames = Math.max(1, Math.round(buffer.duration * RATE));
    pcmBytes += frames * buffer.numberOfChannels * 2;
    sourceBytes += buffer.length * buffer.numberOfChannels * 4;
    const gain = faders[index]?.gain.value ?? 0.8;
    if (!Number.isFinite(gain) || gain < 0 || gain > 1)
      throw new Error(`Drum ${index + 1} level must be between 0 and 1 for S2400 export.`);
    return [{ buffer, index, frames, level: Math.round(gain * 255) }];
  });
  if (pcmBytes > PCM_BUDGET || sourceBytes > PCM_BUDGET * 4)
    throw new Error('S2400 export exceeds the 32 MiB sample budget. Use shorter drum samples.');
  const tracks = sources.map(({ buffer, index, frames, level }) => ({
    index,
    frames,
    channels: buffer.numberOfChannels,
    level,
    muted: mutedArr[index] ?? false,
    name: `A${index + 1}_${safeName(drumNames[index] ?? 'Drum', 24)}`,
    rate: buffer.sampleRate,
    audio: Array.from({ length: buffer.numberOfChannels }, (_, channel) =>
      buffer.getChannelData(channel).slice(),
    ),
  }));
  return {
    name: `${safeName(currentSongName, 14)}-S2400`,
    tempo: Math.round(bpm * 10) / 10,
    tracks,
    patterns,
  };
}

export async function exportS2400Drums(options: S2400ExportOptions = {}): Promise<S2400Export> {
  checkAbort(options.signal);
  const snapshot = capture();
  const warnings = [
    'Experimental: generated projects have not yet been load/playback tested on S2400 hardware.',
    'Drums only: synths, the sample/vocal track, effects, ADSR, pan, and master processing are omitted.',
    'Each nonempty drum phrase is a separate four-bar pattern. No Song-mode chain is created.',
    'Native one-shot retrigger behavior cuts off the previous hit on the same pad. Mixer levels are quantized to 0–255.',
  ];
  const prepared: (S2400Track & { audio: Float32Array[] })[] = [];
  for (const track of snapshot.tracks) {
    options.onProgress?.({ stage: 'samples', fraction: prepared.length / snapshot.tracks.length });
    checkAbort(options.signal);
    let audio = track.audio;
    if (track.rate !== RATE) {
      const ctx = new OfflineAudioContext(track.channels, track.frames, RATE);
      const source = ctx.createBufferSource();
      const buffer = ctx.createBuffer(track.channels, audio[0]!.length, track.rate);
      audio.forEach((data, channel) => buffer.copyToChannel(data, channel));
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start();
      // OfflineAudioContext cannot be aborted. Cancel stops waiting and disconnects the source;
      // its bounded render completes independently without touching the live audio graph.
      let abort: (() => void) | undefined;
      try {
        const rendered = await new Promise<AudioBuffer>((resolve, reject) => {
          abort = () => {
            source.disconnect();
            reject(new DOMException('Export cancelled.', 'AbortError'));
          };
          options.signal?.addEventListener('abort', abort, { once: true });
          if (options.signal?.aborted) {
            abort();
            return;
          }
          void ctx.startRendering().then(resolve, reject);
        });
        audio = Array.from({ length: track.channels }, (_, channel) =>
          rendered.getChannelData(channel).slice(),
        );
      } finally {
        source.disconnect();
        if (abort) options.signal?.removeEventListener('abort', abort);
      }
    }
    checkAbort(options.signal);
    prepared.push({ ...track, audio });
  }
  const mapping = prepared.map(({ index, name, frames, channels, level, muted }) => ({
    index,
    name,
    frames,
    channels,
    level,
    muted,
    sampleRate: RATE,
  }));
  const manifest = {
    format: 'sequencer-s2400-drums-v1',
    hardwareVerified: false,
    project: snapshot.name,
    bpm: snapshot.tempo,
    tracks: mapping,
    patterns: snapshot.patterns.map((pattern, i) => ({
      number: i + 1,
      sourcePhrase: pattern.phrase,
      bars: 4,
      hits: pattern.steps.reduce((sum, row) => sum + row.filter(Boolean).length, 0),
    })),
    warnings,
  };
  const readme = [
    `${snapshot.name} — S2400 drum project`,
    '',
    'Unzip, then copy the project folder inside PROJECTS to the SD card PROJECTS directory.',
    'Use a new folder; do not replace an existing project. Eject the card before moving it to the S2400.',
    `Load ${snapshot.name}.S24 on the S2400. Select patterns individually; their names identify the source phrase.`,
    'WAV samples are 48 kHz, 16-bit PCM. Stereo is preserved. Outputs route to 1/2; mono to output 1.',
    'Only drum tracks with steps are included. Pad numbers stay fixed at A1–A5, including gaps.',
    'Muted rows retain their notes and mute state. Unmute their pads to hear them.',
    'Use export.json for the pad/sample and phrase/pattern mapping.',
    '',
    ...warnings,
  ].join('\n');
  options.onProgress?.({ stage: 'packaging', fraction: 0 });
  checkAbort(options.signal);
  const blob = await new Promise<Blob>((resolve, reject) => {
    const worker = new Worker(new URL('./s2400-encoder.worker.ts', import.meta.url), {
      type: 'module',
    });
    const cleanup = () => {
      worker.terminate();
      options.signal?.removeEventListener('abort', abort);
    };
    const abort = () => {
      cleanup();
      reject(new DOMException('Export cancelled.', 'AbortError'));
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = (event) => {
      cleanup();
      reject(new Error(event.message || 'S2400 packaging failed.'));
    };
    worker.onmessage = (
      event: MessageEvent<{ type: string; fraction?: number; blob?: Blob; message?: string }>,
    ) => {
      const result = event.data;
      if (result.type === 'progress')
        options.onProgress?.({ stage: 'packaging', fraction: result.fraction ?? 0 });
      else {
        cleanup();
        if (result.type === 'done' && result.blob?.size) resolve(result.blob);
        else reject(new Error(result.message || 'S2400 packaging returned no data.'));
      }
    };
    if (options.signal?.aborted) {
      abort();
      return;
    }
    try {
      worker.postMessage(
        { ...snapshot, tracks: prepared, readme, manifest: JSON.stringify(manifest, null, 2) },
        prepared.flatMap((track) => track.audio.map((channel) => channel.buffer)),
      );
    } catch (error) {
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
  checkAbort(options.signal);
  options.onProgress?.({ stage: 'packaging', fraction: 1 });
  checkAbort(options.signal);
  return {
    blob,
    filename: `${snapshot.name}.zip`,
    patternCount: snapshot.patterns.length,
    trackCount: prepared.length,
    warnings,
  };
}
