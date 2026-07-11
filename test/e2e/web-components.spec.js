'use strict';

/**
 * Playwright e2e for the client-side components conventions (framework-free).
 *
 * Drives the REAL reference component shipped in the view-scaffold boilerplate
 * (public/js/components/x-checklist.js — runtime-server.js serves that exact
 * file), against static fixtures mirroring the partial's server-rendered
 * output. Scenarios:
 *
 *   - SSR hydration: attributes + the component-owned JSON `data-*` payload
 *     reach the class; repeatable markup clones from the server-rendered
 *     <template data-role="item"> (never from JS strings); data DOWN via the
 *     observed `collapsed` attribute; events UP via the composed bubbling
 *     `x-checklist:changed` CustomEvent.
 *   - Strict CSP: a REAL Content-Security-Policy response header with a
 *     per-request script nonce and style-src 'self' (no 'unsafe-inline') —
 *     the component hydrates and is styled by the external stylesheet; a
 *     deliberate inline-<style> canary is the only violation (proving the
 *     policy is enforced, not silently absent).
 *   - No-JS crawler equivalence (SEO/GEO): the component's meaningful content
 *     is present in the RAW served HTML — asserted with no browser at all.
 *
 * The popin/XHR-injection scenario lives in web-components.runtime.spec.js
 * (it needs the real built gina bundle).
 */

const { test, expect } = require('@playwright/test');

const PORT = process.env.GINA_E2E_PORT || '3179';
const BASE = 'http://localhost:' + PORT;

/** Waits for the <x-checklist> on the current page to be upgraded. */
async function waitForUpgrade(page) {
    await page.waitForFunction(() => {
        var el = document.querySelector('x-checklist');
        return !!(el && el.matches(':defined'));
    }, null, { timeout: 10000 });
}

test.describe('SSR hydration (attributes + JSON data-*)', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto(BASE + '/components');
        await waitForUpgrade(page);
    });

    test('hydrates from the JSON data-* payload (configured status format)', async ({ page }) => {
        const status = page.locator('x-checklist [data-role="status"]');
        // 'completed' proves JSON.parse ran — the class default says 'done'
        await expect(status).toBeVisible();
        await expect(status).toHaveText('1 of 4 completed');
    });

    test('toggling a server-rendered checkbox updates the status', async ({ page }) => {
        await page.locator('x-checklist ul input[type="checkbox"]').nth(1).check();
        await expect(page.locator('x-checklist [data-role="status"]')).toHaveText('2 of 4 completed');
    });

    test('adds an item by cloning the server-rendered <template data-role="item">', async ({ page }) => {
        await page.fill('x-checklist form[data-role="add"] input[name="label"]', 'Write a component');
        await page.click('x-checklist form[data-role="add"] button');
        await expect(page.locator('x-checklist ul li')).toHaveCount(5);
        await expect(page.locator('x-checklist ul li').nth(4)).toContainText('Write a component');
        await expect(page.locator('x-checklist [data-role="status"]')).toHaveText('1 of 5 completed');
    });

    test('data DOWN — the observed `collapsed` attribute hides/shows the list', async ({ page }) => {
        const list = page.locator('x-checklist ul');
        await expect(list).toBeVisible();
        await page.evaluate(() => document.querySelector('x-checklist').setAttribute('collapsed', ''));
        await expect(list).toBeHidden();
        await page.evaluate(() => document.querySelector('x-checklist').removeAttribute('collapsed'));
        await expect(list).toBeVisible();
    });

    test('events UP — x-checklist:changed bubbles composed to document with a detail payload', async ({ page }) => {
        const detail = await page.evaluate(() => new Promise((resolve) => {
            document.addEventListener('x-checklist:changed', (e) => resolve(e.detail), { once: true });
            document.querySelector('x-checklist ul input[type="checkbox"]:not(:checked)').click();
        }));
        expect(detail).toEqual({ done: 2, total: 4 });
    });
});

test.describe('strict CSP (real header, nonce script-src, no unsafe-inline style-src)', () => {

    test('component hydrates + is styled by the external stylesheet; only the canary violates', async ({ page }) => {
        await page.addInitScript(() => {
            window.__cspViolations = [];
            document.addEventListener('securitypolicyviolation', (e) => {
                window.__cspViolations.push({ directive: e.violatedDirective || e.effectiveDirective });
            });
        });

        const response = await page.goto(BASE + '/components-csp');
        // positive control: the policy arrives as a real HTTP header, nonce'd
        const cspHeader = response.headers()['content-security-policy'] || '';
        expect(cspHeader).toContain("script-src 'nonce-");
        expect(cspHeader).toContain("style-src 'self'");
        expect(cspHeader).not.toContain('unsafe-inline');

        await waitForUpgrade(page);

        // hydration ran under the strict policy
        await expect(page.locator('x-checklist [data-role="status"]')).toHaveText('1 of 4 completed');

        // styled via the external stylesheet — 4px from /css/web-components.css,
        // NOT the canary's 99px (the inline <style> element must be blocked)
        const borderLeftWidth = await page.locator('x-checklist').evaluate(
            (el) => getComputedStyle(el).borderLeftWidth
        );
        expect(borderLeftWidth).toBe('4px');

        // exactly ONE violation: the deliberate style canary — the component
        // itself needs nothing the policy forbids
        const violations = await page.evaluate(() => window.__cspViolations);
        expect(violations.length).toBe(1);
        expect(violations[0].directive).toContain('style-src');
    });
});

test.describe('no-JS crawler equivalence (SEO/GEO)', () => {

    test('meaningful content is present in the RAW served HTML — no browser, no JS', async ({ request }) => {
        const res = await request.get(BASE + '/components');
        expect(res.status()).toBe(200);
        const raw = await res.text();

        // the server-rendered light DOM carries the rankable content
        expect(raw).toContain('<x-checklist');
        expect(raw).toContain('Getting started checklist');
        expect(raw).toContain('Add a route in');
        expect(raw).toContain('<a href="https://gina.io/docs/"');
        // the dynamic-markup source is server-rendered too
        expect(raw).toContain('<template data-role="item">');

        // control: JS-computed output must NOT be in the raw HTML — this
        // assertion can fail, so the positive reads above are a real signal
        expect(raw).not.toContain('1 of 4 completed');
    });
});
