import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream';

/** Restrict serving to the package-local drum and synth libraries, including their root symlinks. */
export function sampleLibraryMiddleware(root, openFile = open) {
  return (req, res, next) => {
    const respond = (status, message) => {
      if (res.headersSent) return res.destroy();
      res.writeHead(status, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(message);
    };
    void (async () => {
      let filename;
      try {
        filename = decodeURIComponent((req.url || '').split('?')[0]);
      } catch {
        respond(400, 'Invalid sample path.');
        return;
      }
      if (!/^\/samples(?:\/|$)/i.test(filename)) return next();
      const match = /^\/samples\/(drums|synths)\/(.+)$/.exec(filename);
      if (!match || !/\.wav$/i.test(filename) || filename.includes('\0')) {
        respond(404, 'Sample not found.');
        return;
      }
      const library = path.resolve(root, 'samples', match[1]);
      const file = path.resolve(library, match[2]);
      if (!file.startsWith(library + path.sep)) {
        respond(403, 'Sample path is outside the library.');
        return;
      }
      // Permit the library root itself to be a symlink, but not a nested link
      // escaping that root. Neither an OS error nor a client disconnect may
      // become an unhandled ReadStream error that terminates Vite.
      const [libraryReal, fileReal] = await Promise.all([realpath(library), realpath(file)]);
      if (!fileReal.startsWith(libraryReal + path.sep)) {
        respond(403, 'Sample path is outside the library.');
        return;
      }
      const handle = await openFile(fileReal, 'r');
      let handedOff = false;
      try {
        const stat = await handle.stat();
        if (!stat.isFile()) {
          respond(404, 'Sample not found.');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': stat.size });
        if (req.method === 'HEAD') {
          res.end();
          return;
        }
        const stream = handle.createReadStream();
        handedOff = true;
        pipeline(stream, res, () => {
          /* pipeline closes both ends on read errors or disconnects. */
        });
      } finally {
        if (!handedOff) await handle.close();
      }
    })().catch((error) => {
      if (error.code === 'EACCES' || error.code === 'EPERM') {
        respond(
          403,
          'Sample library access denied. Allow access to the library folder or move it to an accessible location.',
        );
      } else if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
        respond(404, 'Sample not found. Check the sample library location.');
      } else {
        respond(503, 'Sample library is temporarily unavailable.');
      }
    });
  };
}

export function sampleLibraryPlugin() {
  let root;
  return {
    name: 'sample-library',
    configResolved(config) {
      root = config.root;
    },
    configureServer(server) {
      server.middlewares.use(sampleLibraryMiddleware(root));
    },
    configurePreviewServer(server) {
      server.middlewares.use(sampleLibraryMiddleware(root));
    },
  };
}
