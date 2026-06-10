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
    // built gina bundle for popin-dialog.runtime.spec.js, plus the framework-free
    // a11y fixture at /a11y — its stylesheet link resolves through the server's
    // /css route, which derives framework/v<version> from package.json so the
    // per-release framework-dir rename can't break it.
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
