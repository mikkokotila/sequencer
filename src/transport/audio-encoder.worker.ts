import { Mp3Encoder } from '@breezystack/lamejs';
import { audioBufferToWav24 } from './wav';

interface EncodingInput {
  format: 'wav' | 'mp3';
  sampleRate: number;
  left: Float32Array<ArrayBuffer>;
  right: Float32Array<ArrayBuffer>;
}

self.onmessage = (event: MessageEvent<EncodingInput>) => {
  try {
    const { format, sampleRate, left, right } = event.data;
    let blob: Blob;
    if (format === 'wav') {
      const bytes = audioBufferToWav24({
        numberOfChannels: 2,
        sampleRate,
        length: left.length,
        getChannelData: (channel: number) => (channel === 0 ? left : right),
      });
      blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'audio/wav' });
    } else {
      const encoder = new Mp3Encoder(2, sampleRate, 320);
      const parts: BlobPart[] = [];
      const pcm = (data: Float32Array, offset: number, count: number): Int16Array => {
        const result = new Int16Array(count);
        for (let i = 0; i < count; i++) {
          const sample = Math.max(-1, Math.min(1, data[offset + i] ?? 0));
          result[i] = Math.round(sample * (sample < 0 ? 32768 : 32767));
        }
        return result;
      };
      for (let offset = 0; offset < left.length; offset += 1152) {
        const count = Math.min(1152, left.length - offset);
        const bytes = encoder.encodeBuffer(pcm(left, offset, count), pcm(right, offset, count));
        if (bytes.length) parts.push(new Uint8Array(bytes).buffer);
        if (offset % (1152 * 32) === 0)
          self.postMessage({ type: 'progress', fraction: offset / left.length });
      }
      const final = encoder.flush();
      if (final.length) parts.push(new Uint8Array(final).buffer);
      blob = new Blob(parts, { type: 'audio/mpeg' });
    }
    self.postMessage({ type: 'done', blob });
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
