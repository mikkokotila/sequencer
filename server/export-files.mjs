import { mkdir, open, realpath, link, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const ENDPOINT = '/api/exports';
const fail = (status, message) => Object.assign(new Error(message), { status });

/** Local exports are explicit, same-origin writes into two fixed directories. */
export function exportFilesMiddleware({
  documents = path.join(homedir(), 'Documents'),
  browserDownloads = false,
  maxBytes = 512 * 1024 * 1024,
} = {}) {
  documents = path.resolve(documents);
  return (req, res, next) => {
    if ((req.url || '').split('?')[0] !== ENDPOINT) return next();
    const reply = (status, body) => {
      if (res.destroyed || res.headersSent) return;
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    void (async () => {
      const host = req.headers.host || '';
      const origin = `${req.socket.encrypted ? 'https' : 'http'}://${host}`;
      let hostname;
      try { hostname = new URL(origin).hostname; } catch { /* reject below */ }
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)
        || !['localhost', '127.0.0.1', '[::1]'].includes(hostname)
        || req.headers['x-sequencer-export'] !== '1'
        || (req.headers.origin && req.headers.origin !== origin)
        || (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')) {
        throw fail(403, 'Exports must be requested from the local sequencer.');
      }
      if (req.method === 'GET') return reply(200, { mode: browserDownloads ? 'browser' : 'local' });
      if (req.method !== 'POST') throw fail(405, 'Use POST to save an export.');
      if (browserDownloads) throw fail(409, 'This server uses browser downloads.');
      const url = new URL(req.url, origin);
      const kind = url.searchParams.get('kind');
      const filename = url.searchParams.get('filename') || '';
      const ext = path.extname(filename).toLowerCase();
      if (!['song', 'download'].includes(kind)
        || !filename || filename.startsWith('.') || filename.trim() !== filename
        || /[<>:"/\\|?*\x00-\x1f\x7f]/.test(filename)
        || Buffer.byteLength(filename) > 220
        || (kind === 'song' ? ext !== '.json' : !['.wav', '.mp3', '.zip'].includes(ext))) {
        throw fail(400, 'Invalid export filename or file type.');
      }
      const limit = Math.min(maxBytes, kind === 'song' ? 128 * 1024 * 1024 : maxBytes);
      const advertised = req.headers['content-length'];
      if (advertised && (!/^\d+$/.test(advertised) || Number(advertised) > limit))
        throw fail(413, 'Export exceeds the file size limit.');
      await mkdir(documents, { recursive: true });
      const root = await realpath(documents);
      const folder = kind === 'song' ? path.join(root, 'songs') : root;
      await mkdir(folder, { recursive: true });
      const resolved = await realpath(folder);
      if (resolved !== root && !resolved.startsWith(root + path.sep))
        throw fail(403, 'The song folder must be inside Documents.');
      const temporary = path.join(resolved, `.sequencer-${randomUUID()}.tmp`);
      const file = await open(temporary, 'wx', 0o600);
      let closed = false;
      try {
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > limit) throw fail(413, 'Export exceeds the file size limit.');
          await file.writeFile(chunk);
        }
        if (!size || !req.complete || res.destroyed) throw fail(400, 'Export data is empty or incomplete.');
        await file.sync();
        await file.close();
        closed = true;
        // Publishing by hard link is atomic and never replaces an existing file.
        const stem = filename.slice(0, -ext.length);
        for (let suffix = 1; suffix <= 10000; suffix++) {
          const name = suffix === 1 ? filename : `${stem} (${suffix})${ext}`;
          try {
            await link(temporary, path.join(resolved, name));
            return reply(201, {
              filename: name,
              path: path.join(documents, kind === 'song' ? 'songs' : '', name),
            });
          } catch (error) {
            if (error.code !== 'EEXIST') throw error;
          }
        }
        throw fail(409, 'Too many exports with this name. Rename the song and try again.');
      } finally {
        if (!closed) await file.close();
        await unlink(temporary).catch(() => {});
      }
    })().catch((error) => {
      const denied = error.code === 'EACCES' || error.code === 'EPERM';
      reply(error.status || (denied ? 403 : 503), {
        error: error.status ? error.message : denied
          ? 'Cannot save to Documents. Allow the sequencer server access to this folder and retry.'
          : 'Could not save the export to Documents. Check available disk space and retry.',
      });
    });
  };
}

export function exportFilesPlugin(options = {}) {
  const middleware = exportFilesMiddleware({
    documents: process.env.SEQUENCER_DOCUMENTS_DIR || path.join(homedir(), 'Documents'),
    browserDownloads: process.env.SEQUENCER_DOWNLOAD_MODE === 'browser',
    ...options,
  });
  return {
    name: 'export-files',
    configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); },
  };
}
