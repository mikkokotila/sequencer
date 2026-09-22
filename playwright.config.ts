import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  retries: 0,
  reporter: [[process.env.CI ? 'dot' : 'list'], ['./e2e/qc-reporter.ts']],
  // Audio timing probes must not compete with separate browser test workers.
  workers: 1,
  use: {
    baseURL: 'http://localhost:5174',
    headless: true,
    viewport: { width: 1280, height: 900 },
  },
  webServer: {
    command: 'npx vite --port 5174',
    env: { SEQUENCER_DOWNLOAD_MODE: 'browser' },
    port: 5174,
    reuseExistingServer: true,
    timeout: 30000,
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
