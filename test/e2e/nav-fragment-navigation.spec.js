'use strict';

/**
 * Playwright RUNTIME e2e for #SPA1 Tier 1 fragment navigation (gina/nav).
 *
 * WHY THIS EXISTS. `nav/main.js` had NO test of any kind — no `test/core/*nav*`, no
 * `test/lib/*nav*`, no e2e — while `link` and the Inspector each already had four unit
 * files. It is also the client module least reachable from the node --test suite: its
 * contract is made of `history.pushState`/`popstate`, focus movement, real modifier-key
 * clicks and genuine full-page navigations, none of which jsdom performs. A unit test
 * there could assert that nav *decided* to swap; only a real engine shows that the
 * document survived, that Back re-rendered, and that a fallback actually left the page.
 *
 * THE INSTRUMENT. Every document load stamps a fresh `window.__pageInstance` (fixture
 * head, at parse time). Unchanged across an action => the fragment path kept the
 * document alive; changed => a full page load happened. The two directions are each
 * other's controls: §01 would be meaningless if the token changed on every action, and
 * §04/§05 would be meaningless if it never changed. Both readings appear below, so a
 * stuck token in either position fails a test rather than quietly passing one.
 *
 * The second instrument is request observation: a fragment fetch is identified by its
 * `X-Gina-Navigate: fragment` header, which is what distinguishes "nav intercepted and
 * then fell back" (§04) from "nav never intercepted at all" (§05) — two paths that look
 * identical from the address bar.
 *
 * Run:
 *   npx playwright test test/e2e/nav-fragment-navigation.spec.js
 */

const { test, expect } = require('@playwright/test');

const PORT = process.env.GINA_E2E_PORT || '3179';
const BASE = 'http://localhost:' + PORT;

/** Navigate to the nav home and wait until gina/nav has activated. */
async function gotoNav(page, path) {
    await page.goto(BASE + (path || '/nav'));
    // `hasNavHandler` is set at the end of nav's init, AFTER the routing table landed
    // and the listeners were installed — so it is the activation signal, and waiting on
    // it avoids racing the boot with a fixed sleep.
    await page.waitForFunction(() => window.gina && window.gina.hasNavHandler === true,
        null, { timeout: 15000 });
}

const instanceOf = (page) => page.evaluate(() => window.__pageInstance);
const regionText = (page) => page.evaluate(() => {
    const el = document.getElementById('frag-title');
    return el ? el.textContent.trim() : null;
});

/** Collect the URLs of every fragment-negotiation request made during `run`. */
async function fragmentRequests(page, run) {
    const seen = [];
    const onReq = (req) => {
        const h = req.headers();
        if (h['x-gina-navigate']) {
            seen.push(new URL(req.url()).pathname);
        }
    };
    page.on('request', onReq);
    try {
        await run();
    } finally {
        page.off('request', onReq);
    }
    return seen;
}

test.describe('#SPA1 nav — fragment navigation (real bundle, real history)', () => {

    test('01 - a negotiated click swaps the region without reloading the document', async ({ page }) => {
        await gotoNav(page);
        const before = await instanceOf(page);
        expect(await regionText(page), 'the harness must start on the home region').toBe('HOME');

        await page.click('#to-one');

        await expect.poll(() => regionText(page), { timeout: 10000 }).toBe('ONE');
        expect(page.url(), 'the navigated URL must be pushed to the address bar').toBe(BASE + '/nav/one');
        // The whole point of a fragment navigation: same document, new content.
        expect(await instanceOf(page), 'the document must NOT have been reloaded').toBe(before);
    });

    test('02 - Back re-renders the previous fragment, still without reloading', async ({ page }) => {
        await gotoNav(page);
        const before = await instanceOf(page);

        await page.click('#to-one');
        await expect.poll(() => regionText(page), { timeout: 10000 }).toBe('ONE');

        await page.goBack();

        // popstate carries the `ginaNav` stamp nav wrote on the entry page, so the Back
        // is re-rendered as a fragment rather than reloaded.
        await expect.poll(() => regionText(page), { timeout: 10000 }).toBe('HOME');
        expect(page.url()).toBe(BASE + '/nav');
        expect(await instanceOf(page), 'Back must be served from the fragment path').toBe(before);
    });

    test('03 - the fragment fetch carries both negotiation headers', async ({ page }) => {
        await gotoNav(page);

        let headers = null;
        page.on('request', (req) => {
            if (req.headers()['x-gina-navigate'] && !headers) {
                headers = req.headers();
            }
        });
        await page.click('#to-one');
        await expect.poll(() => regionText(page), { timeout: 10000 }).toBe('ONE');

        expect(headers, 'a fragment request must have been observed').not.toBeNull();
        // X-Gina-Navigate is the negotiation signal; X-Requested-With keeps the request
        // on the established XHR paths (without it the render path re-wraps the
        // layoutless body into a full <html> shell).
        expect(headers['x-gina-navigate']).toBe('fragment');
        expect(headers['x-requested-with']).toBe('XMLHttpRequest');
    });

    test('04 - a 2xx answer without `Vary: X-Gina-Navigate` falls back to a full page load', async ({ page }) => {
        await gotoNav(page);
        const before = await instanceOf(page);

        const fetched = await fragmentRequests(page, async () => {
            await Promise.all([
                page.waitForURL(BASE + '/nav/bare', { timeout: 15000 }),
                page.click('#to-bare')
            ]);
        });

        // nav DID intercept and fetch — this is the un-negotiated-answer branch, not
        // the never-intercepted one. Without this assertion §04 and §05 are the same
        // test written twice.
        expect(fetched, 'nav must have attempted a fragment fetch first').toContain('/nav/bare');
        await expect.poll(() => regionText(page), { timeout: 10000 }).toBe('BARE');
        expect(await instanceOf(page), 'an un-negotiated answer must degrade to a real navigation')
            .not.toBe(before);
    });

    test('05 - SUBTRACT: a route without `negotiate: true` is never intercepted', async ({ page }) => {
        await gotoNav(page);
        const before = await instanceOf(page);

        const fetched = await fragmentRequests(page, async () => {
            await Promise.all([
                page.waitForURL(BASE + '/nav/plain', { timeout: 15000 }),
                page.click('#to-plain')
            ]);
        });

        // The matcher is an interception FILTER: same shape as the others but no
        // `negotiate`, so the click belongs to the browser and no XHR is opened.
        expect(fetched, 'a non-negotiable route must not be fetched as a fragment').toEqual([]);
        expect(await regionText(page)).toBe('PLAIN');
        expect(await instanceOf(page), 'the browser must have performed a real navigation')
            .not.toBe(before);
    });

    test('06 - SUBTRACT: a modified click is left to the browser', async ({ page }) => {
        await gotoNav(page);
        const before = await instanceOf(page);

        const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
        const fetched = await fragmentRequests(page, async () => {
            await page.click('#to-one', { modifiers: [modifier] });
            // Nothing should happen; give the click a window in which it could have.
            await page.waitForTimeout(400);
        });

        // ctrl/cmd-click means "open in a new tab" — intercepting it would break a
        // native affordance. jsdom cannot express this at all.
        expect(fetched, 'a modified click must not trigger a fragment fetch').toEqual([]);
        expect(await regionText(page), 'the current page must be untouched').toBe('HOME');
        expect(page.url()).toBe(BASE + '/nav');
        expect(await instanceOf(page)).toBe(before);
    });

    test('07 - the swap applies the fragment title and moves focus to the region', async ({ page }) => {
        await gotoNav(page);

        await page.click('#to-one');
        await expect.poll(() => regionText(page), { timeout: 10000 }).toBe('ONE');

        // `data-gina-nav-title` is how a layoutless fragment sets the document title,
        // and the region takes focus (tabindex=-1) so keyboard and screen-reader users
        // land on the new content instead of staying where the old page was.
        await expect.poll(() => page.title(), { timeout: 5000 }).toBe('Section one');
        const focus = await page.evaluate(() => ({
            isRegion: document.activeElement === document.querySelector('[data-gina-nav]'),
            tabindex: document.querySelector('[data-gina-nav]').getAttribute('tabindex')
        }));
        expect(focus.isRegion, 'focus must move to the swapped region').toBe(true);
        expect(focus.tabindex, 'the region is made programmatically focusable').toBe('-1');
    });
});
