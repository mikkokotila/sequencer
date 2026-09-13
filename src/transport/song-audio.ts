import { checkExportAbort, renderSongToBuffer } from './render-song';

export type AudioExportFormat = 'wav' | 'mp3';
export interface AudioExportProgress {
  stage: 'rendering' | 'encoding';
  fraction: number;
}
export interface AudioExportOptions {
  signal?: AbortSignal;
  onProgress?: (progress: AudioExportProgress) => void;
}
export interface SongAudioExport {
  blob: Blob;
  filename: string;
  duration: number;
}

/** The GUI and programmatic callers use the same snapshot, mix render, and encoder. */
export async function exportSongAudio(
  format: AudioExportFormat,
  options: AudioExportOptions = {},
): Promise<SongAudioExport> {
  if (!['wav', 'mp3'].includes(format)) throw new Error('Choose WAV or MP3.');
  checkExportAbort(options.signal);
  options.onProgress?.({ stage: 'rendering', fraction: 0 });
  const renderOptions = {
    ...options,
    onProgress: (fraction: number) => options.onProgress?.({ stage: 'rendering', fraction }),
  };
  const song = await renderSongToBuffer(renderOptions);
  checkExportAbort(options.signal);
  options.onProgress?.({ stage: 'encoding', fraction: 0 });
  const blob = await new Promise<Blob>((resolve, reject) => {
    const worker = new Worker(new URL('./audio-encoder.worker.ts', import.meta.url), {
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
      reject(new Error(event.message || 'Audio encoding failed. Please try again.'));
    };
    worker.onmessage = (
      event: MessageEvent<{ type: string; fraction?: number; blob?: Blob; message?: string }>,
    ) => {
      const result = event.data;
      if (result.type === 'progress') {
        options.onProgress?.({ stage: 'encoding', fraction: result.fraction ?? 0 });
      } else {
        cleanup();
        if (result.type === 'done' && result.blob?.size) resolve(result.blob);
        else reject(new Error(result.message || 'Audio encoding returned no data.'));
      }
    };
    if (options.signal?.aborted) {
      abort();
      return;
    }
    try {
      // Transfer copies: the rendered buffer and all original sample buffers stay intact.
      const left = song.buffer.getChannelData(0).slice();
      const right = song.buffer.getChannelData(1).slice();
      worker.postMessage({ format, sampleRate: song.buffer.sampleRate, left, right }, [
        left.buffer,
        right.buffer,
      ]);
    } catch (error) {
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
  checkExportAbort(options.signal);
  options.onProgress?.({ stage: 'encoding', fraction: 1 });
  const name =
    song.name
      .replace(/[<>:"/\\|?*]/g, '')
      .replace(/\p{Cc}/gu, '')
      .trim()
      .slice(0, 120) || 'Untitled';
  return { blob, filename: `${name}.${format}`, duration: song.buffer.duration };
}

export function downloadSongAudio(result: Pick<SongAudioExport, 'blob' | 'filename'>): void {
  const url = URL.createObjectURL(result.blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = result.filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Give Chrome time to consume the blob before revoking its URL.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
