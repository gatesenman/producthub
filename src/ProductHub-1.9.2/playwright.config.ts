import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e', timeout: 30000, retries: 0, workers: 1, fullyParallel: false, reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:18790', channel: 'chrome', viewport: { width: 1440, height: 900 }, locale: 'zh-CN', screenshot: 'only-on-failure' },
  webServer: [
    { command: 'npx tsx tests/e2e/prepare.ts /tmp/ph-e2e && node dist-server/server.js --port 18790 --host 127.0.0.1 --data /tmp/ph-e2e --no-scheduler --web-fixtures tests/fixtures/web', url: 'http://127.0.0.1:18790/api/meta', reuseExistingServer: false, timeout: 60000 },
    { command: 'sleep 8 && node dist-server/server.js --readonly --port 18791 --host 127.0.0.1 --data /tmp/ph-e2e --web-fixtures tests/fixtures/web', url: 'http://127.0.0.1:18791/api/meta', reuseExistingServer: false, timeout: 60000 },
  ],
});
