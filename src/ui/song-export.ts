import {
  exportSongAudio,
  downloadSongAudio,
  type AudioExportFormat,
} from '../transport/song-audio';
import { exportS2400Drums } from '../transport/s2400';
import { currentSongName } from '../transport/song';

/** Mount once; audio export never edits the song or changes its live transport. */
export function createSongExportButton(): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'tb';
  button.id = 'export-song-btn';
  button.title = 'Download Song Audio';
  button.setAttribute('aria-label', 'Download song audio');
  button.innerHTML =
    '<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 3v7M6 1v6M9 3v4M12 1v6M6 11l3 3 3-3M9 8v6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const dialog = document.createElement('dialog');
  dialog.id = 'song-export-dialog';
  dialog.className = 'song-export-dialog';
  dialog.setAttribute('aria-labelledby', 'song-export-title');
  dialog.innerHTML = `<h2 id="song-export-title">Download song</h2>
    <p id="song-export-name" class="song-export-name"></p>
    <p class="song-export-description">All active phrases, once. Includes your mix and effect tails.</p>
    <div class="song-export-formats">
      <button type="button" id="export-wav-btn">Download WAV<span>24-bit · 44.1 kHz · stereo</span></button>
      <button type="button" id="export-mp3-btn">Download MP3<span>320 kbps · stereo</span></button>
    </div>
    <div class="song-export-formats">
      <button type="button" id="export-s2400-btn">Export S2400 drums<span>Experimental · project + samples · ZIP</span></button>
    </div>
    <p class="song-export-description">S2400: drum phrases on A1–A5, including muted rows. Dry samples and track levels; no synths, effects, envelopes, pan, or song chain. Hardware playback needs verification.</p>
    <progress id="song-export-progress" max="1" value="0" hidden aria-label="Audio export progress"></progress>
    <p id="song-export-status" role="status" aria-live="polite"></p>
    <button type="button" id="song-export-close">Close</button>`;
  document.body.appendChild(dialog);
  const wav = dialog.querySelector<HTMLButtonElement>('#export-wav-btn')!;
  const mp3 = dialog.querySelector<HTMLButtonElement>('#export-mp3-btn')!;
  const s2400 = dialog.querySelector<HTMLButtonElement>('#export-s2400-btn')!;
  const close = dialog.querySelector<HTMLButtonElement>('#song-export-close')!;
  const progress = dialog.querySelector<HTMLProgressElement>('#song-export-progress')!;
  const status = dialog.querySelector<HTMLElement>('#song-export-status')!;
  let controller: AbortController | null = null;
  const run = async (format: AudioExportFormat | 's2400') => {
    if (controller) return;
    controller = new AbortController();
    wav.disabled = mp3.disabled = s2400.disabled = true;
    progress.hidden = false;
    progress.value = 0;
    status.classList.remove('export-error');
    close.textContent = 'Cancel';
    try {
      const result =
        format === 's2400'
          ? await exportS2400Drums({
              signal: controller.signal,
              onProgress: ({ stage, fraction }) => {
                progress.value = fraction;
                status.textContent =
                  stage === 'samples'
                    ? 'Preparing drum samples…'
                    : `Packaging S2400 project… ${Math.round(fraction * 100)}%`;
              },
            })
          : await exportSongAudio(format, {
              signal: controller.signal,
              onProgress: ({ stage, fraction }) => {
                progress.value = fraction;
                status.textContent =
                  stage === 'rendering'
                    ? 'Rendering song…'
                    : `Encoding ${format.toUpperCase()}… ${Math.round(fraction * 100)}%`;
              },
            });
      status.textContent = 'Saving export…';
      const saved = await downloadSongAudio(result, controller.signal);
      status.textContent = saved.path ? `Saved to ${saved.path}` : `${saved.filename} downloaded.`;
    } catch (error) {
      // Browsers also use AbortError for failed module loads and rendering.
      // Only our own cancellation signal means the user cancelled this export.
      if (controller.signal.aborted) status.textContent = 'Export cancelled.';
      else {
        status.textContent =
          error instanceof Error
            ? `Export failed. ${error.message}`
            : 'Export failed. Please try again.';
        status.classList.add('export-error');
      }
    } finally {
      controller = null;
      wav.disabled = mp3.disabled = s2400.disabled = false;
      progress.hidden = true;
      close.textContent = 'Close';
      close.disabled = false;
    }
  };
  wav.onclick = () => {
    void run('wav');
  };
  mp3.onclick = () => {
    void run('mp3');
  };
  s2400.onclick = () => {
    void run('s2400');
  };
  close.onclick = () => {
    if (controller) {
      controller.abort();
      close.disabled = true;
    } else dialog.close();
  };
  dialog.addEventListener('cancel', () => controller?.abort());
  dialog.addEventListener('close', () => button.focus());
  button.onclick = () => {
    dialog.querySelector('#song-export-name')!.textContent = currentSongName;
    if (!controller) {
      status.textContent = '';
      close.disabled = false;
    }
    dialog.showModal();
    // Only the open dialog blocks the global Space shortcut.
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('role', 'dialog');
  };
  dialog.addEventListener('close', () => {
    dialog.removeAttribute('aria-modal');
    dialog.removeAttribute('role');
  });
  return button;
}
