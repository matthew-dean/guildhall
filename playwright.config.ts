import { defineConfig, devices } from '@playwright/test'

const port = Number(process.env.GUILDHALL_E2E_PORT ?? 7791)

export default defineConfig({
  testDir: './tests/rendered-ui',
  timeout: 30_000,
  expect: {
    timeout: 7_500,
  },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `node scripts/playwright-fixtures.mjs && HOME="$PWD/.playwright-fixtures/home" node dist/cli.js serve-internal --port ${port}`,
    url: `http://127.0.0.1:${port}/api/service`,
    timeout: 20_000,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
