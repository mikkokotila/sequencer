import { on } from '../events';
import {
  savePatternFile,
  saveSong,
  saveSongCopy,
  reloadSavedSong,
  reportPersistenceError,
} from '../transport/persistence';

/** Recoverable errors remain visible until a successful save/load. Local work stays intact. */
export function initPersistenceStatus(): void {
  const panel = document.createElement('div');
  panel.id = 'persistence-status';
  panel.setAttribute('role', 'alert');
  panel.hidden = true;
  panel.style.cssText =
    'position:fixed;top:8px;left:8px;right:8px;z-index:10000;padding:12px;background:#321e17;color:#ffe4d2;border:1px solid #a66;font:13px sans-serif;';
  document.body.appendChild(panel);
  on('persistence:status', ({ message, conflict }) => {
    panel.replaceChildren();
    panel.hidden = !message;
    if (!message) return;
    const text = document.createElement('p');
    text.textContent = message;
    panel.appendChild(text);
    const action = (label: string, run: () => void | Promise<void>): void => {
      const button = document.createElement('button');
      button.textContent = label;
      button.style.cssText = 'margin:4px;padding:6px 10px;';
      button.onclick = () => {
        void Promise.resolve().then(run).catch(reportPersistenceError);
      };
      panel.appendChild(button);
    };
    action('Export local copy', async () => {
      await savePatternFile();
    });
    if (conflict) {
      action('Save as new song', saveSongCopy);
      action('Reload saved song', reloadSavedSong);
    } else {
      action('Retry save', saveSong);
      action('Dismiss', () => {
        panel.hidden = true;
      });
    }
  });
}

export function showStartupError(error: unknown): void {
  document.documentElement.dataset.ready = 'false';
  const panel = document.createElement('div');
  panel.id = 'startup-error';
  panel.setAttribute('role', 'alert');
  panel.style.cssText =
    'position:fixed;inset:20% 10% auto;z-index:10001;padding:24px;background:#231a19;color:#ffe4d2;border:1px solid #a66;font:16px sans-serif;';
  const message = document.createElement('p');
  message.textContent = `Sequencer could not start. ${error instanceof Error ? error.message : String(error)} Check browser storage permissions and your connection, then retry.`;
  const retry = document.createElement('button');
  retry.textContent = 'Retry startup';
  // A fresh document prevents duplicate audio graphs, handlers or partially initialized stores.
  retry.onclick = () => window.location.reload();
  panel.append(message, retry);
  document.body.appendChild(panel);
}
