'use strict';

/**
 * Playwright RUNTIME e2e for `gina.setOptions()` (#B305).
 *
 * The unit suite (test/core/gina-set-options.test.js) executes the shipped
 * setOptions bytes in isolation; THIS spec boots the REAL built bundle so the
 * whole chain runs for real:
 *   - the whisper-substituted loader's own boot call
 *     (`gina["setOptions"](options)` with `options` being `gina.config` itself
 *     — the identity-guard no-op that keeps boot behaviour unchanged);
 *   - a page-side `setOptions` call landing on the exposed `gina.config`,
 *     in place, for every key;
 *   - the real `lib/loading-state` reader writing the RENAMED attribute onto a
 *     live element — the #B247 documented opt-in, working through setOptions.
 *
 * The harness (test/e2e/runtime-server.js) is started by playwright.config.js
 * `webServer` and serves the committed dist bundle.
 *
 * Run:
 *   npx playwright test test/e2e/gina-set-options.runtime.spec.js
 */

const { test, expect } = require('@playwright/test');

const PORT = process.env.GINA_E2E_PORT || '3179';
const BASE = 'http://localhost:' + PORT + '/';

async function gotoAndBoot(page) {
    await page.goto(BASE);
    await page.waitForFunction(
        () => !!(window.gina && window.gina.isFrameworkLoaded === true),
        null,
        { timeout: 15000 }
    );
}

test('boot survives the loader\'s own setOptions call — whispered config intact', async ({ page }) => {
    await gotoAndBoot(page);
    const boot = await page.evaluate(() => ({
        webroot: window.gina.config.webroot,
        bundle: window.gina.config.bundle,
        env: window.gina.config.env,
        hasSetOptions: typeof window.gina.setOptions === 'function'
    }));
    expect(boot.hasSetOptions).toBe(true);
    // the loader passed gina.config itself through setOptions at boot; the
    // identity guard makes that a no-op, so the whispered values must be intact
    expect(boot.webroot).toBe('/');
    expect(boot.bundle).toBe('e2e');
    expect(boot.env).toBe('prod');
});

test('setOptions writes the exposed config, in place, for every key', async ({ page }) => {
    await gotoAndBoot(page);
    const r = await page.evaluate(() => {
        const refBefore = window.gina.config;
        window.gina.setOptions({ loadingAttribute: 'data-loading', culture: 'zz-ZZ-control' });
        return {
            sameObject: window.gina.config === refBefore,
            loadingAttribute: window.gina.config.loadingAttribute,
            culture: window.gina.config.culture,
            webrootIntact: window.gina.config.webroot
        };
    });
    expect(r.sameObject).toBe(true);                 // lazy readers keep their object
    expect(r.loadingAttribute).toBe('data-loading'); // the documented opt-in (#B247)
    expect(r.culture).toBe('zz-ZZ-control');         // every key, not just loadingAttribute
    expect(r.webrootIntact).toBe('/');               // merge, never replace
});

test('end to end: the real lib/loading-state reader arms with the RENAMED attribute', async ({ page }) => {
    await gotoAndBoot(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
        window.gina.setOptions({ loadingAttribute: 'data-loading' });
        setTimeout(() => resolve('REQUIRE_TIMEOUT'), 6000);
        window.require(['lib/loading-state'], function (loadingState) {
            const el = document.createElement('button');
            el.id = 'b305-probe';
            el.type = 'submit';
            el.textContent = 'probe';
            document.body.appendChild(el);
            loadingState.arm(el);
            const armed = {
                renamed: el.getAttribute('data-loading'),
                stock: el.hasAttribute('data-gina-loading')
            };
            loadingState.disarm(el);
            resolve({
                armed: armed,
                released: el.getAttribute('data-loading'),
                stockAfter: el.hasAttribute('data-gina-loading')
            });
        });
    }));
    expect(r).not.toBe('REQUIRE_TIMEOUT');
    expect(r.armed.renamed).toBe('true');   // armed under the renamed attribute
    expect(r.armed.stock).toBe(false);      // and NOT under the default one
    expect(r.released).toBe('false');       // released keeps the value form ("false", not removal)
    expect(r.stockAfter).toBe(false);
});
