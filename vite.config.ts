import { defineConfig } from 'vite';
import { sampleLibraryPlugin } from './server/sample-library.mjs';

export default defineConfig({
  plugins: [sampleLibraryPlugin()],
  server: {
    port: 5173,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
