'use strict';

/**
 * Playwright config for the gina dialog ("popin") a11y e2e spec.
 *
 * Scope-limited to test/e2e/ — the default `npm test` (node --test) suite is
 * unaffected. Requires browsers: `npx playwright install chromium`.
 */

const { defineConfig, devices } = require('@playwright/test');

const E2E_PORT = process.env.GINA_E2E_PORT || '3179';

module.exports = defineConfig({
    testDir: './test/e2e',
    testMatch: '**/*.spec.js',
    fullyParallel: true,
    reporter: 'list',
    use: {
        trace: 'on-first-retry'
    },
    // Starts the runtime harness (test/e2e/runtime-server.js) that serves the REAL
    // built gina bundle for popin-dialog.runtime.spec.js. The framework-free
    // popin-dialog.a11y.spec.js drives file:// fixtures and ignores it.
    webServer: {
        command: 'node test/e2e/runtime-server.js',
        url: 'http://localhost:' + E2E_PORT + '/',
        reuseExistingServer: !process.env.CI,
        timeout: 30 * 1000,
        env: { GINA_E2E_PORT: E2E_PORT }
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
    ]
});
