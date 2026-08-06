'use strict';

/**
 * Playwright RUNTIME e2e for #B302 — a `data-gina-link` anchor carrying an author-supplied
 * `id` was a DEAD link.
 *
 * THE DEFECT. `bindLinks` KEEPS a pre-existing `id` (only an empty/missing/`popin.link` id
 * gets the generated `link.click.gina-link-<instance>-<uuid>` form), while the document
 * click proxy gated on that id SHAPE before triggering the anchor's custom event. So an
 * author-id'd anchor registered its `$links` entry and its listener normally, the proxy
 * refused to trigger it, and the per-anchor listener had already suppressed the default —
 * the click did nothing at all. The fix dispatches on REGISTRATION (`instance.$links`)
 * instead of on the id's shape.
 *
 * WHY THIS CANNOT BE A UNIT TEST. All four existing link test files are SOURCE PINS — they
 * read `link/main.js` as text and never execute it — so none of them could observe a click
 * being swallowed. The behaviour only exists in a real engine with a real anchor.
 *
 * ANCHOR SHAPE IS LOAD-BEARING. §01/§02 use BARE-TEXT anchors so `event.target` is the
 * anchor (a text node is not an event target) — that is the repaired path. §04 uses an
 * anchor wrapping a `<span>`, which dispatches through `proxyClick`, a separate path that
 * was never shape-gated and worked before the fix; keeping it distinct is what stops §01
 * and §04 from silently becoming the same test. A mislabelled click target caused exactly
 * that confusion while this bug was being characterised.
 *
 * Run:
 *   npx playwright test test/e2e/link-preset-id.spec.js
 */

const { test, expect } = require('@playwright/test');

const PORT = process.env.GINA_E2E_PORT || '3179';
const BASE = 'http://localhost:' + PORT;

/** Load the fixture and wait until the link plugin has been constructed and has bound. */
async function gotoLink(page) {
    await page.goto(BASE + '/link');
    await page.waitForFunction(
        () => window.gina && window.gina.isFrameworkLoaded === true
            && (window.__linkActivated === true || window.__linkActivateError),
        null,
        { timeout: 15000 }
    );
    // Positive activation evidence, never absence-of-error: the plugin must actually have
    // constructed and registered its links before any click means anything.
    const state = await page.evaluate(() => ({
        error: window.__linkActivateError || null,
        binded: window.gina.linkIsBinded === true,
        registered: window.gina.link && window.gina.link.$links
            ? Object.keys(window.gina.link.$links).length : 0
    }));
    expect(state.error, 'the link handler must construct cleanly').toBeNull();
    expect(state.binded, 'gina.linkIsBinded must be true before clicking').toBe(true);
    expect(state.registered, 'all three data-gina-link anchors must be registered').toBe(3);
}

/**
 * Collect the plugin's own XHRs during `run`.
 * Classified per the #B288 trap: a real plugin request is (xhr|fetch) AND not a navigation
 * AND issued by the main frame — anything else is the browser doing its own thing.
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

test.describe('#B302 link plugin — an author-supplied id must still dispatch', () => {

    test('01 - an anchor with a PRESET id issues its request', async ({ page }) => {
        await gotoLink(page);

        const reqs = await pluginRequests(page, async () => {
            await page.click('#preset-link');
            await page.waitForTimeout(600);
        });

        // Pre-fix this was 0: the proxy's `/^link\.click\./` gate refused to trigger, and
        // the per-anchor preventDefault still ran, so the anchor was simply dead.
        expect(reqs, 'a preset-id anchor must reach the wire').toEqual(['?arm=preset']);
        expect(page.url(), 'and it must not fall through to a native navigation').toBe(BASE + '/link');
    });

    test('02 - REGRESSION GUARD: an auto-id anchor still issues its request', async ({ page }) => {
        await gotoLink(page);

        const reqs = await pluginRequests(page, async () => {
            await page.click('a.auto-link');
            await page.waitForTimeout(600);
        });

        // The generated-id path is what every existing consumer relies on. If the fix had
        // traded one shape for the other this goes red, which is the whole point of it.
        expect(reqs, 'the generated-id path must be untouched').toEqual(['?arm=auto']);
        expect(page.url()).toBe(BASE + '/link');
    });

    test('03 - the author\'s id is preserved, and the auto id keeps its generated shape', async ({ page }) => {
        await gotoLink(page);

        const ids = await page.evaluate(() => ({
            preset: document.getElementById('preset-link').id,
            auto: document.querySelector('a.auto-link').id,
            registered: Object.keys(window.gina.link.$links)
        }));

        // The cheap fix would have been to overwrite the author's id with the generated
        // form. That silently breaks whatever the author set it for (CSS, their own JS, an
        // anchor target), so it is explicitly NOT what shipped.
        expect(ids.preset, 'the author id must survive binding').toBe('preset-link');
        expect(ids.auto, 'an id-less anchor still gets the generated form').toMatch(/^link\.click\.gina-link-/);
        expect(ids.registered, '$links is keyed by whatever id the element ended up with').toContain('preset-link');
    });

    test('04 - a click on a CHILD of a preset-id anchor still dispatches (the proxyClick path)', async ({ page }) => {
        await gotoLink(page);

        const reqs = await pluginRequests(page, async () => {
            await page.click('#child-span');
            await page.waitForTimeout(600);
        });

        // This path never consulted the id shape — proxyClick takes the id as a parameter —
        // so it worked BEFORE the fix too. Asserted here so the two dispatch paths stay
        // distinguishable: if a future change collapses them, one of §01/§04 goes red.
        expect(reqs, 'the child-delegation path must keep working').toEqual(['?arm=child']);
    });

    test('05 - SUBTRACT: an id-bearing anchor that is NOT a gina link is left alone', async ({ page }) => {
        await gotoLink(page);

        const reqs = await pluginRequests(page, async () => {
            // Cancel the real navigation: we only care that the plugin issued no XHR.
            await page.evaluate(() => document.getElementById('plain-anchor')
                .addEventListener('click', e => e.preventDefault()));
            await page.click('#plain-anchor');
            await page.waitForTimeout(600);
        });

        // The fix looks ids up in $links rather than matching a prefix, so this guards the
        // obvious failure mode of that swap: claiming any element that happens to have an
        // id. Without it, §01 would still pass for an over-matching proxy.
        expect(reqs, 'a non-gina anchor must not be claimed by the plugin').toEqual([]);
    });
});
