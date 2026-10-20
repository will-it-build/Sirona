import { defineConfig } from '@playwright/test';
const storage = '.wrangler/browser-' + process.pid;
export default defineConfig({
  testDir: './test/browser', workers: 1, timeout: 45000,
  use: { baseURL: 'http://localhost:8788', browserName: 'chromium', channel: process.env.CI ? undefined : 'chrome', trace: 'retain-on-failure' },
  webServer: {
    command: `npx wrangler d1 migrations apply sirona-db --local --persist-to ${storage} && npx wrangler dev --local --port 8788 --persist-to ${storage} --var PUBLIC_SIGNUP:true`,
    url: 'http://localhost:8788', reuseExistingServer: false, timeout: 60000,
  },
});
