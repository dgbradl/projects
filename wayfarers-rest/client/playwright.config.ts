import { defineConfig } from '@playwright/test';

const SERVER_PORT = 3050;
const CLIENT_PORT = 5174;

export default defineConfig({
  testDir: './playwright',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${CLIENT_PORT}`,
    headless: true,
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'npm start -w @wayfarers/server',
      env: {
        TICK_INTERVAL_MS: '60000',
        SUBTICK_INTERVAL_MS: '200',
        PORT: String(SERVER_PORT),
        DB_PATH: ':memory:',
        FLAVOR_MODE: 'recorded',
        FLAVOR_WORKER_INTERVAL_MS: '300',
      },
      cwd: '..',
      port: SERVER_PORT,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 30_000,
    },
    {
      command: 'vite --port ' + CLIENT_PORT + ' --strictPort',
      env: {
        WAYFARERS_SERVER_URL: `http://127.0.0.1:${SERVER_PORT}`,
      },
      port: CLIENT_PORT,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 30_000,
    },
  ],
});
