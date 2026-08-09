'use strict';

/**
 * Playwright RUNTIME e2e for #B287 — two `data-gina-link` anchors sharing one url
 * attributed the whole request (and the `data-gina-loading` state) to whichever anchor
 * registered FIRST, regardless of which one was clicked.
 *
 * THE DEFECT. `linkRequest(url, options)` re-derived its element from the url —
 * `getLinkByUrl` returns the first registration whose `.url` matches — discarding the
 * registration the dispatch listener had already resolved from the click. The fix hands
 * the operated registration through to `linkRequest`; the url lookup survives only for
 * the public `gina.link.request(url)` path, which genuinely has nothing but a url.
 *
 * WHY THIS CANNOT BE A UNIT TEST. The observable is WHICH anchor carries
 * `data-gina-loading` after a real click travels a real dispatch path (direct anchor
 * listener vs `proxyClick` child delegation). The link unit files are source pins.
 *
 * OBSERVATION IS RACE-FREE BY CONTRACT. The loading release leaves the attribute
 * PRESENT with value "false" on the anchor that was armed (the documented resting
 * state), and the attribute is entirely ABSENT from an anchor that was never armed —
 * so post-completion presence is the attribution record, no mid-flight timing needed.
 * A MutationObserver installed before the click captures the arm/release sequence as
 * corroboration.
 *
 * Run:
 *   npx playwright test test/e2e/link-same-url-attribution.spec.js
 */

const { test, expect } = require('@playwright/test');

const PORT = process.env.GINA_E2E_PORT || '3179';
const BASE = 'http://localhost:' + PORT;

/** Load the fixture and wait until the link plugin has been constructed and has bound. */
async function gotoLinkShared(page) {
    await page.goto(BASE + '/link-shared');
    await page.waitForFunction(
        () => window.gina && window.gina.isFrameworkLoaded === true
            && (window.__linkActivated === true || window.__linkActivateError),
        null,
        { timeout: 15000 }
    );
    // Positive activation evidence, never absence-of-error.
    const state = await page.evaluate(() => ({
        error: window.__linkActivateError || null,
        binded: window.gina.linkIsBinded === true,
        registered: window.gina.link && window.gina.link.$links
            ? Object.keys(window.gina.link.$links).length : 0
    }));
    expect(state.error, 'the link handler must construct cleanly').toBeNull();
    expect(state.binded, 'gina.linkIsBinded must be true before clicking').toBe(true);
    expect(state.registered, 'all five data-gina-link anchors must be registered').toBe(5);
}

/** Watch `data-gina-loading` mutations on every anchor from before the click. */
async function armObserver(page) {
    await page.evaluate(() => {
        window.__loadingLog = [];
        const mo = new MutationObserver((muts) => {
            for (const m of muts) {
                if (m.attributeName === 'data-gina-loading') {
                    window.__loadingLog.push({
                        id: m.target.id,
                        value: m.target.getAttribute('data-gina-loading')
                    });
                }
            }
        });
        mo.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['data-gina-loading'] });
    });
}

/** Post-completion census: which anchors carry the attribute at all, and the observer log. */
async function attribution(page, ids) {
    return page.evaluate((idList) => {
        const out = { present: [], log: window.__loadingLog || [] };
        for (const id of idList) {
            const el = document.getElementById(id);
            if (el && el.hasAttribute('data-gina-loading')) { out.present.push(id); }
        }
        return out;
    }, ids);
}

/**
 * Collect the plugin's own XHRs during `run`.
 * Classified per the #B288 trap: a real plugin request is (xhr|fetch) AND not a
 * navigation AND issued by the main frame — anything else is the browser's own traffic.
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

test.describe('#B287 link plugin — the CLICKED anchor owns the request, even on a shared url', () => {

    test('01 - pair A: a DIRECT click on the second same-url anchor arms the second, not the first', async ({ page }) => {
        await gotoLinkShared(page);
        await armObserver(page);

        const reqs = await pluginRequests(page, async () => {
            await page.click('#a2');
            await page.waitForTimeout(600);
        });

        expect(reqs, 'the click must reach the wire exactly once').toEqual(['?arm=sharedA']);

        const att = await attribution(page, ['a1', 'a2']);
        // Pre-fix this reads ['a1']: getLinkByUrl matched the first registration and the
        // loading state (and every element-scoped side effect) landed on an anchor the
        // user never touched.
        expect(att.present, 'only the CLICKED anchor may carry the loading record').toEqual(['a2']);
        expect(att.log.length, 'the observer must have seen the arm/release cycle').toBeGreaterThanOrEqual(2);
        expect(att.log[0], 'the first mutation is the clicked anchor arming').toEqual({ id: 'a2', value: 'true' });
    });

    test('02 - pair B: a CHILD click (proxyClick path) on the second same-url anchor arms the second', async ({ page }) => {
        await gotoLinkShared(page);
        await armObserver(page);

        const reqs = await pluginRequests(page, async () => {
            await page.click('#b2-span');
            await page.waitForTimeout(600);
        });

        expect(reqs, 'the child click must reach the wire exactly once').toEqual(['?arm=sharedB']);

        const att = await attribution(page, ['b1', 'b2']);
        // Both dispatch paths converge on the same handler, so the child path must be
        // repaired by the same hand-off — asserted separately so the two paths stay
        // distinguishable if a future change forks them again.
        expect(att.present, 'the child click must attribute to ITS anchor').toEqual(['b2']);
        expect(att.log[0], 'the first mutation is the clicked anchor arming').toEqual({ id: 'b2', value: 'true' });
    });

    test('03 - arm C: a child click on a DISTINCT-url anchor issues its request and arms its anchor', async ({ page }) => {
        await gotoLinkShared(page);
        await armObserver(page);

        const reqs = await pluginRequests(page, async () => {
            await page.click('#c1-span');
            await page.waitForTimeout(600);
        });

        // An earlier characterisation smoke reported a nested click on a distinct-url
        // anchor producing NO transition at all, and the ledger carries it as
        // unresolved. This arm is the empirical answer: if it fails, that is a real,
        // separate defect to chase — not a variant of the same-url collapse.
        expect(reqs, 'the distinct-url child click must reach the wire').toEqual(['?arm=distinctC']);

        const att = await attribution(page, ['c1']);
        expect(att.present, 'and its own anchor carries the loading record').toEqual(['c1']);
    });

    test('04 - CONTROL: a direct click on the FIRST same-url anchor still attributes to itself', async ({ page }) => {
        await gotoLinkShared(page);
        await armObserver(page);

        const reqs = await pluginRequests(page, async () => {
            await page.click('#a1');
            await page.waitForTimeout(600);
        });

        expect(reqs, 'the first anchor keeps working').toEqual(['?arm=sharedA']);

        const att = await attribution(page, ['a1', 'a2']);
        // The non-discriminating control: this passes BEFORE and AFTER the fix. If it
        // ever fails the scene itself is broken and the other arms carry no information.
        expect(att.present, 'first-anchor attribution was always correct').toEqual(['a1']);
    });
});
