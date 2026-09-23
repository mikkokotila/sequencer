import { exportKit } from '../transport/kit-export';

export function createKitExportButton(): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'tb';
  button.id = 'kit-export-btn';
  button.title = 'Export Sample Kit';
  button.setAttribute('aria-label', 'Export Sample Kit');
  button.innerHTML =
    '<svg width="10" height="10" viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M5 7h6M8 7v4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
  button.onclick = () => {
    button.disabled = true;
    button.classList.remove('export-error');
    button.classList.add('busy');
    button.setAttribute('aria-busy', 'true');
    button.title = 'Saving sample kit…';
    void exportKit()
      .then((saved) => {
        button.title = saved.path ? `Saved to ${saved.path}` : `${saved.filename} downloaded.`;
      })
      .catch((error: unknown) => {
        button.classList.add('export-error');
        button.title = `Export failed: ${error instanceof Error ? error.message : String(error)}`;
      })
      .finally(() => {
        button.disabled = false;
        button.classList.remove('busy');
        button.setAttribute('aria-busy', 'false');
      });
  };
  return button;
}
