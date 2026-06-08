'use strict';

/**
 * Playwright RUNTIME e2e for the modernized gina dialog ("popin") system.
 *
 * Where popin-dialog.a11y.spec.js drives a framework-free fixture (it validates the
 * native-<dialog> + CSS a11y contract without booting gina), THIS spec boots the
 * REAL built gina bundle so the full-runtime delegated `data-gina-dialog*` handlers
 * run for real — closing the gap that pins + jsdom replicas cannot catch (a wiring
 * bug between two correct-in-isolation functions). It is the executing counterpart to
 * the framework-free popin-dialog.a11y.spec.js.
 *
 * The harness (test/e2e/runtime-server.js + fixtures/popin-dialog.runtime.html) is
 * started by playwright.config.js `webServer`: a tiny Node server that serves the
 * dist gina.min.js, the whisper-substituted onload, a stub /_gina/assets/routing.json,
 * and the in-memory AJAX fragments. The boot phantom (core.js) constructs the popin
 * handler at page load, so triggers injected into the live DOM are handled by the real
 * delegated `bindDelegatedOpen` + `installPreload` listeners.
 *
 * Run:
 *   npm i -D @playwright/test && npx playwright install chromium
 *   npx playwright test test/e2e/popin-dialog.runtime.spec.js
 */

const { test, expect } = require('@playwright/test');

const PORT = process.env.GINA_E2E_PORT || '3179';
const BASE = 'http://localhost:' + PORT + '/';

/**
 * Navigate to the harness and wait for the boot phantom to construct the popin
 * handler (the declarative API is inert until then).
 */
async function gotoAndBoot(page) {
    await page.goto(BASE);
    await page.waitForFunction(
        () => !!(window.gina && window.gina.isFrameworkLoaded === true && window.gina.hasPopinHandler === true),
        null,
        { timeout: 15000 }
    );
}

test.beforeEach(async ({ page }) => {
    await gotoAndBoot(page);
});

test.describe('data-gina-dialog runtime (real bundle)', () => {

    test('AJAX (data-gina-dialog-src) opens a dialog with the loaded fragment', async ({ page }) => {
        await page.evaluate(() => {
            const a = document.createElement('a');
            a.id = 'ajax-trigger';
            a.setAttribute('data-gina-dialog', '');
            a.setAttribute('data-gina-dialog-src', '/frag/ajax.html');
            a.setAttribute('href', '#');
            a.textContent = 'Open AJAX';
            document.body.appendChild(a);
        });

        await page.click('#ajax-trigger');

        const dialog = page.locator('dialog').filter({ hasText: 'AJAX loaded' });
        await expect(dialog).toBeVisible();
        await expect(dialog.locator('#ajax-frag-title')).toHaveText('AJAX loaded');
        // The new dialog API opens non-modal by default.
        expect(await dialog.evaluate((el) => el.matches(':modal'))).toBe(false);
    });

    test('hover preload fires exactly one request; the click opens from cache (no second request)', async ({ page }) => {
        await page.evaluate(() => {
            const a = document.createElement('a');
            a.id = 'preload-trigger';
            a.setAttribute('data-gina-dialog', '');
            a.setAttribute('data-gina-dialog-src', '/frag/preload.html');
            a.setAttribute('href', '#');
            a.textContent = 'Open preload';
            document.body.appendChild(a);
        });

        let requests = 0;
        page.on('request', (req) => {
            if (req.url().endsWith('/frag/preload.html')) { requests++; }
        });

        // Hover -> installPreload issues one GET; wait for it to land (so the cache is
        // ready — a click before completion would fall through to a second GET).
        const preloaded = page.waitForResponse((r) => r.url().endsWith('/frag/preload.html'));
        await page.hover('#preload-trigger');
        await preloaded;
        await page.waitForTimeout(150);
        expect(requests).toBe(1);

        // Click -> consumePreload serves the cached body; no second network request.
        await page.click('#preload-trigger');
        await expect(page.locator('dialog').filter({ hasText: 'Preloaded body' })).toBeVisible();
        expect(requests).toBe(1);
    });

    test('legacy: a mixed (new marker + legacy-url) trigger opens AND warns exactly once', async ({ page }) => {
        const warnings = [];
        page.on('console', (msg) => {
            if (msg.type() === 'warning') { warnings.push(msg.text()); }
        });

        // Mixed: a new `data-gina-dialog` marker + the legacy `data-gina-popin-url`.
        // The gate routes it through the new path, which aliases the legacy url
        // (src === null) and emits exactly one deprecation warning while still loading.
        await page.evaluate(() => {
            const a = document.createElement('a');
            a.id = 'mixed-trigger';
            a.setAttribute('data-gina-dialog', '');
            a.setAttribute('data-gina-popin-url', '/frag/legacy.html');
            a.setAttribute('href', '#');
            a.textContent = 'Open legacy';
            document.body.appendChild(a);
        });
        await page.click('#mixed-trigger');
        await expect(page.locator('dialog').filter({ hasText: 'Legacy body' })).toBeVisible();

        const deprecations = warnings.filter((w) => /`data-gina-popin-url` is deprecated/.test(w));
        expect(deprecations).toHaveLength(1);
        expect(deprecations[0]).toContain('use `data-gina-dialog-src` instead');
        expect(deprecations[0]).toContain('mapped onto the new dialog path');
    });

    test('legacy: a pure-legacy (data-gina-popin-name only) trigger emits no deprecation warning', async ({ page }) => {
        const warnings = [];
        page.on('console', (msg) => {
            if (msg.type() === 'warning') { warnings.push(msg.text()); }
        });

        // Pure-legacy: `data-gina-popin-name` only (neither new attr). The gate defers
        // to bindOpen's per-element path, so resolveTrigger is never reached and no
        // deprecation warning is emitted. (Runs on its own fresh page so no dialog from
        // a sibling assertion intercepts the click.)
        await page.evaluate(() => {
            const a = document.createElement('a');
            a.id = 'pure-trigger';
            a.setAttribute('data-gina-popin-name', 'purelegacy');
            a.setAttribute('href', '#');
            a.textContent = 'Pure legacy';
            document.body.appendChild(a);
        });
        await page.click('#pure-trigger');
        await page.waitForTimeout(300);

        expect(warnings.filter((w) => /is deprecated/.test(w))).toHaveLength(0);
    });

    test('partial replace (data-gina-dialog-target) swaps only the slot, preserving chrome', async ({ page }) => {
        // Two triggers sharing data-gina-dialog="sp" resolve to the SAME dialog
        // (getPopinByName dedup). Trigger 1 (no target) full-loads chrome + slot;
        // trigger 2 (target="#slot") re-loads and swaps ONLY the slot. (Before the
        // popinLoad partialTarget guard, an open re-load went through popinLoadContent
        // and the swap never applied — the regression this test pins.)
        await page.evaluate(() => {
            const mk = (id, src, target) => {
                const a = document.createElement('a');
                a.id = id;
                a.setAttribute('data-gina-dialog', 'sp');
                a.setAttribute('data-gina-dialog-src', src);
                if (target) { a.setAttribute('data-gina-dialog-target', target); }
                a.setAttribute('href', '#');
                a.textContent = id;
                document.body.appendChild(a);
            };
            mk('p-full', '/frag/partial-1.html', null);
            mk('p-slot', '/frag/partial-2.html', '#slot');
        });

        // First click: full load seeds the chrome + slot.
        await page.click('#p-full');
        const dialog = page.locator('dialog').filter({ hasText: 'Chrome stays' });
        await expect(dialog.locator('#partial-chrome')).toHaveText('Chrome stays');
        await expect(dialog.locator('#slot')).toHaveText('SLOT-ONE');
        // Tag the chrome node so the swap's node-identity preservation is observable.
        await dialog.locator('#partial-chrome').evaluate((el) => el.setAttribute('data-kept', 'yes'));

        // Second click: partial re-load. The trigger sits under the open dialog, so
        // dispatch the click directly (the delegated document handler still fires) —
        // this exercises the handler's routing, not click actionability.
        await page.dispatchEvent('#p-slot', 'click');

        // Only #slot changed; the chrome text AND node identity are preserved. A full
        // replace would instead show 'REPLACED chrome' and drop the data-kept marker.
        await expect(dialog.locator('#slot')).toHaveText('SLOT-TWO');
        await expect(dialog.locator('#partial-chrome')).toHaveText('Chrome stays');
        await expect(dialog.locator('#partial-chrome')).toHaveAttribute('data-kept', 'yes');
    });
});
