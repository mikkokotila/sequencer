/** Explicit exports use the local server's Documents folders, or browser downloads on static hosts. */
export interface SavedExport {
  filename: string;
  path?: string;
}

/** Keep human-readable names while respecting filesystem names and UTF-8 byte limits. */
export function exportFilename(name: string, extension: string): string {
  const clean =
    name
      .replace(/[<>:"/\\|?*\p{Cc}]/gu, '')
      .replace(/^[. ]+/, '')
      .trim() || 'Untitled';
  let stem = '';
  const encoder = new TextEncoder();
  for (const character of clean) {
    if (encoder.encode(stem + character).length > 200) break;
    stem += character;
  }
  return `${stem}${extension}`;
}

const headers = { 'X-Sequencer-Export': '1' };

export async function saveExportFile(
  blob: Blob,
  filename: string,
  kind: 'song' | 'download',
  signal?: AbortSignal,
): Promise<SavedExport> {
  const options: RequestInit = { headers, cache: 'no-store', ...(signal ? { signal } : {}) };
  let capability: Response;
  try {
    capability = await fetch('/api/exports', options);
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error('Cannot reach the sequencer server. Start it and retry the export.');
  }
  const missing = capability.status === 404 || capability.status === 405;
  const html = capability.ok && capability.headers.get('content-type')?.includes('text/html');
  let local = false;
  if (!missing && !html) {
    const body = (await capability.json()) as { mode?: string; error?: string };
    if (!capability.ok || !['local', 'browser'].includes(body.mode ?? ''))
      throw new Error(body.error || 'Could not determine the export destination.');
    local = body.mode === 'local';
  }
  if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError');
  if (local) {
    const query = new URLSearchParams({ kind, filename });
    const response = await fetch(`/api/exports?${query}`, {
      ...options,
      method: 'POST',
      body: blob,
    });
    const result = (await response.json()) as SavedExport & { error?: string };
    if (!response.ok) throw new Error(result.error || 'Could not save the export. Please retry.');
    if (!result.path || !result.filename)
      throw new Error('The server did not confirm the saved file.');
    return { filename: result.filename, path: result.path };
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return { filename };
}
