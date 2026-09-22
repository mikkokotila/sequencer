import { defineConfig } from 'vite';
import { sampleLibraryPlugin } from './server/sample-library.mjs';
import { exportFilesPlugin } from './server/export-files.mjs';

export default defineConfig({
  plugins: [sampleLibraryPlugin(), exportFilesPlugin(), {
    name: 'isolated-dsp-benchmark',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] === '/tests/benchmark.html') {
          res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
          res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
        }
        next();
      });
    },
  }],
  server: {
    port: 5173,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
