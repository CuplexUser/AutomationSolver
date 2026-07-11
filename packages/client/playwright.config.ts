import { defineConfig } from '@playwright/test';

const CLIENT_PORT = 5173;
const SERVER_PORT = 4000;

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${CLIENT_PORT}`,
    trace: 'off',
  },
  webServer: [
    {
      command: `npx tsx ../server/src/index.ts`,
      env: { PORT: String(SERVER_PORT), DB_PATH: ':memory:', SESSION_SECRET: 'e2e-secret' },
      url: `http://localhost:${SERVER_PORT}/api/health`,
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: `npx vite --port ${CLIENT_PORT}`,
      env: { API_PROXY_TARGET: `http://localhost:${SERVER_PORT}` },
      url: `http://localhost:${CLIENT_PORT}`,
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
});
