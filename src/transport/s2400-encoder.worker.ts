import { buildStoreZip } from './zip';
import {
  buildS2400Kit,
  buildS2400Project,
  type S2400Pattern,
  type S2400Track,
} from './s2400-format';

interface Request {
  name: string;
  tempo: number;
  patterns: S2400Pattern[];
  tracks: (S2400Track & { audio: Float32Array[] })[];
  readme: string;
  manifest: string;
}

self.onmessage = (event: MessageEvent<Request>) => {
  try {
    const { name, tempo, tracks, patterns, readme, manifest } = event.data;
    const prefix = `PROJECTS/${name}/`;
    const entries = [
      { name: `${prefix}${name}.KIT`, data: buildS2400Kit(tracks) },
      { name: `${prefix}${name}.S24`, data: buildS2400Project(tracks, patterns, tempo) },
      { name: 'README.txt', data: new TextEncoder().encode(readme) },
      { name: 'export.json', data: new TextEncoder().encode(manifest) },
    ];
    for (const track of tracks) {
      const bytes = new Uint8Array(44 + track.frames * track.channels * 2);
      const view = new DataView(bytes.buffer);
      const text = (offset: number, value: string) =>
        bytes.set(new TextEncoder().encode(value), offset);
      text(0, 'RIFF');
      view.setUint32(4, bytes.length - 8, true);
      text(8, 'WAVE');
      text(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, track.channels, true);
      view.setUint32(24, 48000, true);
      view.setUint32(28, 48000 * track.channels * 2, true);
      view.setUint16(32, track.channels * 2, true);
      view.setUint16(34, 16, true);
      text(36, 'data');
      view.setUint32(40, bytes.length - 44, true);
      for (let frame = 0; frame < track.frames; frame++) {
        for (let channel = 0; channel < track.channels; channel++) {
          const sample = track.audio[channel]![frame]!;
          if (!Number.isFinite(sample))
            throw new Error(`A${track.index + 1} contains invalid audio.`);
          const clipped = Math.max(-1, Math.min(1, sample));
          view.setInt16(
            44 + (frame * track.channels + channel) * 2,
            Math.round(clipped * (clipped < 0 ? 32768 : 32767)),
            true,
          );
        }
      }
      entries.push({ name: `${prefix}${track.name}.wav`, data: bytes });
      self.postMessage({
        type: 'progress',
        fraction: (tracks.indexOf(track) + 1) / (tracks.length + 1),
      });
    }
    const zip = buildStoreZip(entries);
    self.postMessage({
      type: 'done',
      blob: new Blob([zip as Uint8Array<ArrayBuffer>], { type: 'application/zip' }),
    });
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
