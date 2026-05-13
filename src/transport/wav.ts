/**
 * Encode an AudioBuffer to a 24-bit signed PCM WAV file (universal sampler format).
 * Channel count and sample rate are preserved from the input.
 */
export function audioBufferToWav24(buffer: AudioBuffer): Uint8Array {
  const channels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const frames = buffer.length;
  const bytesPerSample = 3;
  const blockAlign = channels * bytesPerSample;
  const dataSize = frames * blockAlign;
  const headerSize = 44;

  const out = new Uint8Array(headerSize + dataSize);
  const view = new DataView(out.buffer);

  // RIFF header
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');

  // fmt chunk (PCM)
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // format code: 1 = PCM int
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 24, true); // bits per sample

  // data chunk
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // Interleave channels and convert float [-1, 1] to signed 24-bit
  const channelData: Float32Array[] = [];
  for (let c = 0; c < channels; c++) {
    channelData.push(buffer.getChannelData(c));
  }

  let offset = headerSize;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const channel = channelData[c];
      if (!channel) continue;
      const sample = Math.max(-1, Math.min(1, channel[i] ?? 0));
      const intVal = sample < 0 ? Math.round(sample * 0x800000) : Math.round(sample * 0x7fffff);
      const unsigned = intVal < 0 ? intVal + 0x1000000 : intVal;
      out[offset] = unsigned & 0xff;
      out[offset + 1] = (unsigned >> 8) & 0xff;
      out[offset + 2] = (unsigned >> 16) & 0xff;
      offset += 3;
    }
  }

  return out;
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}
