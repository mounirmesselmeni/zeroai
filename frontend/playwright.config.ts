import { defineConfig, devices } from '@playwright/test';

// The browser app starts the Orval-generated MSW handlers in E2E mode. Playwright needs only Vite.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5273',
    trace: 'on-first-retry',
    // Most specs use Classic. theme.spec.ts opts out to cover the real first-visit default and
    // explicitly selects Terminal where needed.
    storageState: {
      cookies: [],
      origins: [
        {
          origin: 'http://localhost:5273',
          localStorage: [
            {
              name: 'zeroai-ui',
              value: JSON.stringify({
                state: { themeMode: 'classic' },
                version: 1,
              }),
            },
          ],
        },
      ],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'VITE_USE_MSW=true yarn dev --port 5273 --strictPort',
    url: 'http://localhost:5273',
    reuseExistingServer: false,
  },
});
