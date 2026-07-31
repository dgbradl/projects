import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:4173',
    // Local sandboxes can point at a preinstalled Chromium.
    launchOptions: process.env.PW_EXECUTABLE
      ? { executablePath: process.env.PW_EXECUTABLE }
      : {},
  },
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    port: 4173,
    reuseExistingServer: true,
  },
});
