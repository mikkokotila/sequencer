import { defineConfig } from 'vite';
import { sampleLibraryPlugin } from './server/sample-library.mjs';

export default defineConfig({
  plugins: [sampleLibraryPlugin(), {
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
