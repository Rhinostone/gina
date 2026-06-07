'use strict';

/**
 * Playwright config for the gina dialog ("popin") a11y e2e spec.
 *
 * Scope-limited to test/e2e/ — the default `npm test` (node --test) suite is
 * unaffected. Requires browsers: `npx playwright install chromium`.
 */

const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './test/e2e',
    testMatch: '**/*.spec.js',
    fullyParallel: true,
    reporter: 'list',
    use: {
        trace: 'on-first-retry'
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
    ]
});
