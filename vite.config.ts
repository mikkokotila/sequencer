import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 8090,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
