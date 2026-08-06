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
    // Default is Chromium ONLY — the per-push E2E job stays ~10s of test time.
    // `GINA_E2E_ENGINES=all` adds Firefox + WebKit, used by the on-demand
    // cross-engine job (.github/workflows/e2e-cross-engine.yml).
    //
    // The specs cover APIs where engines historically diverged most and which jsdom
    // implements NOT AT ALL — `showModal`/`:modal`, `inert`, `matchMedia` — so
    // Chromium is currently the only engine that ever exercises them. Whether that
    // single-engine coverage is hiding real divergence is an OPEN QUESTION: run the
    // cross-engine job once and let the result decide, rather than adopting (or
    // dismissing) permanent multi-engine CI on a guess.
    //
    // NB: the PW_CHROME override below is scoped to the chromium project on purpose.
    // At top level it would also be handed to Firefox and WebKit, which would then
    // try to launch a Chromium binary.
    projects: [
        {
            name: 'chromium',
            use: {
                ...devices['Desktop Chrome'],
                // Local escape hatch: point at an already-installed chromium build so a
                // maintainer whose cache lags the @playwright/test version doesn't have to
                // download the exact bundled build (`npx playwright install`, ~150 MB). CI
                // leaves PW_CHROME unset and uses the bundled build it installs.
                ...(process.env.PW_CHROME ? { launchOptions: { executablePath: process.env.PW_CHROME } } : {})
            }
        },
        ...((process.env.GINA_E2E_ENGINES || '').toLowerCase() === 'all'
            ? [
                { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
                { name: 'webkit',  use: { ...devices['Desktop Safari'] } }
            ]
            : [])
    ]
});
