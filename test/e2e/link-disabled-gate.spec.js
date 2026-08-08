'use strict';

/**
 * Playwright RUNTIME e2e for #B310 — a `data-gina-link` anchor marked disabled
 * still fired its XHR: the link plugin had NO disabled gate at all (the only
 * click-time bail was the modifier guard; measured with a firing control:
 * `aria-disabled` occurred 0x in the whole plugin vs 12x in popin and 24x in
 * the validator, so the zero was a real absence).
 *
 * THE FIX. The popin trigger gate's predicate (#B296, itself mirroring the
 * validator's #B293) is consulted at the TWO dispatch sites that turn a click
 * into a request — the document proxy's dispatch branch and proxyClick (the
 * child-node path) — AFTER their cancelEvent, so a registered link keeps
 * suppressing its default, gated or not: a disabled link goes NOWHERE (no
 * XHR, and no navigation fallback either). Deliberately ungated: linkRequest
 * (the public API + the redirect funnel — a programmatic call is not
 * operating the control, the same scope reasoning as #B308's untrusted leg)
 * and the per-anchor CSP suppression listener (a gated link still suppresses
 * its default).
 *
 * Arms: 01/02/03 are RED pre-fix — the aria-marked anchor, its child-span
 * path, and the native-attribute arm each fired 1 XHR. 04 pins the un-gated
 * control (exactly 1 XHR — the zeros above are the gate, not a broken
 * scene); 05 pins the API staying ungated (gina.link.request on the GATED
 * link's registered url fires).
 *
 * RED-FIRST: point B310_PREFIX_BUNDLE at a pre-fix bundle —
 *   git show <pre-fix-sha>:framework/v<ver>/core/asset/plugin/dist/vendor/gina/js/gina.min.js > /tmp/prefix.min.js
 *   B310_PREFIX_BUNDLE=/tmp/prefix.min.js npx playwright test test/e2e/link-disabled-gate.spec.js
 * Arms 01/02/03 then fail on the request count (1 each); 04/05 hold on both
 * sides.
 */

const fs = require('fs');
const { test, expect } = require('@playwright/test');

const PORT = process.env.GINA_E2E_PORT || '3179';
const BASE = 'http://localhost:' + PORT;

const PREFIX_BUNDLE = process.env.B310_PREFIX_BUNDLE
    ? fs.readFileSync(process.env.B310_PREFIX_BUNDLE)
    : null;

/** Load the fixture and wait until the link plugin has constructed and bound. */
async function gotoLinkGate(page) {
    if (PREFIX_BUNDLE) {
        await page.route('**/js/gina.min.js', (route) => route.fulfill({
            status: 200,
            contentType: 'application/javascript; charset=utf-8',
            body: PREFIX_BUNDLE
        }));
    }
    await page.goto(BASE + '/link-gate');
    await page.waitForFunction(
        () => window.gina && window.gina.isFrameworkLoaded === true
            && (window.__linkActivated === true || window.__linkActivateError),
        null,
        { timeout: 15000 }
    );
    // Positive activation evidence, never absence-of-error (same discipline as
    // the preset-id harness).
    const state = await page.evaluate(() => ({
        error: window.__linkActivateError || null,
        binded: window.gina.linkIsBinded === true,
        registered: window.gina.link && window.gina.link.$links
            ? Object.keys(window.gina.link.$links).length : 0
    }));
    expect(state.error, 'the link handler must construct cleanly').toBeNull();
    expect(state.binded, 'gina.linkIsBinded must be true before clicking').toBe(true);
    expect(state.registered, 'all four data-gina-link anchors must be registered').toBe(4);
}

/**
 * Collect the plugin's own XHRs during `run` (the #B288 classification: a real
 * plugin request is xhr/fetch, non-navigation, main-frame, at the sink).
 */
async function pluginRequests(page, run) {
    const seen = [];
    const onReq = (req) => {
        if (['xhr', 'fetch'].includes(req.resourceType())
            && !req.isNavigationRequest()
            && req.frame() === page.mainFrame()
            && /\/link\/sink/.test(req.url())) {
            seen.push(new URL(req.url()).search);
        }
    };
    page.on('request', onReq);
    try { await run(); } finally { page.off('request', onReq); }
    return seen;
}

test.describe('#B310 link plugin — a disabled link must not fire its request', () => {

    test('01 - an aria-disabled anchor swallows the click: no XHR, no navigation (RED pre-fix)', async ({ page }) => {
        await gotoLinkGate(page);
        const before = page.url();
        const seen = await pluginRequests(page, async () => {
            // force: aria-disabled fails Playwright's actionability while a real
            // pointer is not blocked — force keeps the trusted input pipeline
            // and lets gina do the refusing (same note as the validator specs).
            await page.click('#gated-link', { force: true });
            await page.waitForTimeout(700);
        });
        expect(seen, 'a gated link must not fire (pre-fix: 1 request)').toEqual([]);
        expect(page.url(), 'the default stays suppressed — no navigation fallback').toBe(before);
    });

    test('02 - the child-span path is gated too: proxyClick refuses (RED pre-fix)', async ({ page }) => {
        await gotoLinkGate(page);
        const before = page.url();
        const seen = await pluginRequests(page, async () => {
            await page.click('#gated-span', { force: true });
            await page.waitForTimeout(700);
        });
        expect(seen, 'a gated link\'s child click must not fire (pre-fix: 1 request)').toEqual([]);
        expect(page.url()).toBe(before);
    });

    test('03 - the native attribute counts on an anchor (no IDL `disabled` there) (RED pre-fix)', async ({ page }) => {
        await gotoLinkGate(page);
        const before = page.url();
        const seen = await pluginRequests(page, async () => {
            await page.click('#native-gated', { force: true });
            await page.waitForTimeout(700);
        });
        expect(seen, 'the native-attribute arm of the predicate must gate too').toEqual([]);
        expect(page.url()).toBe(before);
    });

    test('04 - the un-gated control fires exactly once (the zeros above are the gate, not a broken scene)', async ({ page }) => {
        await gotoLinkGate(page);
        const seen = await pluginRequests(page, async () => {
            await page.click('#open-link');
            await page.waitForTimeout(700);
        });
        expect(seen).toEqual(['?arm=open']);
    });

    test('05 - the programmatic API stays ungated: request() on the GATED link\'s url fires', async ({ page }) => {
        await gotoLinkGate(page);
        const seen = await pluginRequests(page, async () => {
            await page.evaluate(() => {
                const links = window.gina.link.$links;
                const key = Object.keys(links).find((k) => links[k].id === 'gated-link');
                window.gina.link.request(links[key].url);
            });
            await page.waitForTimeout(700);
        });
        expect(seen, 'a programmatic call is not operating the control — it must fire').toEqual(['?arm=gated']);
    });
});
