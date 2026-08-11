'use strict';

/**
 * Playwright RUNTIME e2e for #B332/#B333/#B334 — the submit-vs-async-query
 * collision, on the EXACT consumer shape the sibling spec's fixture cannot
 * reach: a submit trigger WITHOUT an id in markup, live-check OFF, and a
 * `query` rule declared last on a field.
 *
 * Why the sibling (#B295) spec stayed green through this defect: its fixture
 * button carries `id="parent-submit"`, so `getOwnedElements`' id-keyed dedup
 * caught the double collection and only ONE submit listener was ever bound.
 * An id-less button (gina auto-assigns `click.<uuid>` later) entered the
 * collection twice -> two `bindSubmitEl` listeners -> one click ran TWO
 * validate() passes; pass 2 found pass 1's `asyncCompleted.<id>` waiter,
 * zeroed its own pending-async counter and completed on the sync-only
 * verdict -> `send()` fired BEFORE the query answered (measured live: the
 * "already registered" error rendered ~200ms after the POST had left).
 *
 * Both arms strip the button id and disable live-check by rewriting the
 * served fixture HTML in flight — no fixture/server change, and each rewrite
 * carries its own extraction control so anchor drift reads as inconclusive
 * instead of silently testing the stock scene.
 *
 * Arms (each a control for the other):
 *   01 query answers {"isValid":false} after a delay -> the click must send
 *      NOTHING, ever, and the field must carry the query error state
 *      (the user-reported scene: an already-registered email)
 *   02 query answers {"isValid":true} after the same delay -> the click must
 *      send EXACTLY ONCE, after the settle (proves the instrument can see a
 *      POST, the id-less binding still submits, and no duplicate send rides
 *      the settle)
 */

const { test, expect } = require('@playwright/test');

const PORT = process.env.GINA_E2E_PORT || '3179';
const BASE = 'http://localhost:' + PORT + '/';

/** The rules literal the /face harness ships, URL-encoded into gina.onload.face.js. */
const STOCK_RULES = '{"rules":{"faceform":{"agree":{"isRequired":true}}}}';

/** `note` gains an async `query` declared LAST — the consumer shape. */
const ASYNC_RULES = JSON.stringify({
    rules: {
        faceform: {
            agree: { isRequired: true },
            note: { isRequired: true, query: { url: '/uniq', method: 'GET', validIf: true } }
        }
    }
});

const QUERY_DELAY_MS = 600;

/**
 * Rewrite the served scene: async rules in, button id OUT, live-check OFF,
 * and a DELAYED `/uniq` verdict so the pre-settle window is wide enough to
 * catch a premature send.
 */
async function installScene(page, uniqBody) {
    const seen = { rulesRewritten: null, idStripped: null, liveCheckOff: null, queryCalls: 0, queryAnswered: 0 };

    await page.route('**/js/gina.onload.face.js', async (route) => {
        const body = await (await route.fetch()).text();
        const from = encodeURIComponent(STOCK_RULES);
        seen.rulesRewritten = body.indexOf(from) > -1;
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: seen.rulesRewritten ? body.split(from).join(encodeURIComponent(ASYNC_RULES)) : body
        });
    });

    await page.route('**/face', async (route) => {
        let html = await (await route.fetch()).text();
        seen.idStripped   = html.indexOf(' id="parent-submit"') > -1;
        seen.liveCheckOff = html.indexOf('data-gina-form-live-check-enabled="true"') > -1;
        html = html
            .split(' id="parent-submit"').join('')
            .split('data-gina-form-live-check-enabled="true"').join('data-gina-form-live-check-enabled="false"');
        await route.fulfill({ status: 200, contentType: 'text/html', body: html });
    });

    await page.route('**/uniq*', async (route) => {
        seen.queryCalls++;
        await new Promise((r) => setTimeout(r, QUERY_DELAY_MS));
        seen.queryAnswered++;
        await route.fulfill({ status: 200, contentType: 'application/json', body: uniqBody });
    });

    return seen;
}

async function gotoFaceAndBoot(page) {
    await page.goto(BASE + 'face');
    await page.waitForFunction(() => !!customElements.get('x-agree'), null, { timeout: 15000 });
    await page.waitForFunction(
        () => !!(
            window.gina
            && window.gina.isFrameworkLoaded === true
            && window.gina.validator
            && window.gina.validator.$forms
            && window.gina.validator.$forms['parent']
        ), null, { timeout: 15000 });
}

/** Satisfy `agree` (FACE) and fill `note` — live-check is OFF, so no query fires here. */
async function fillFormQuietly(page) {
    await page.click('#parent x-agree button');
    await page.click('#note');
    await page.keyboard.type('someone@example.com', { delay: 15 });
    // no Tab-blur settle dance: with live-check off nothing validates until the click
}

function countPosts(page) {
    const posts = [];
    page.on('request', (r) => {
        if (r.url().indexOf('/face-sink') > -1 && r.method() === 'POST') { posts.push(Date.now()); }
    });
    return posts;
}

test.describe('#B332/#B333 — id-less trigger + async query rule (live-check off)', function () {

    test('01 - a failing query blocks the send entirely (the user-reported scene)', async ({ page }) => {
        const seen  = await installScene(page, '{"isValid":false}');
        const posts = countPosts(page);

        await gotoFaceAndBoot(page);
        expect(seen.rulesRewritten, 'rules anchor drifted — scene inconclusive').toBe(true);
        expect(seen.idStripped, 'button-id anchor drifted — scene inconclusive').toBe(true);
        expect(seen.liveCheckOff, 'live-check anchor drifted — scene inconclusive').toBe(true);

        await fillFormQuietly(page);
        await page.click('#parent button[type="submit"]');

        // the query must actually run (the click is what drives it, live-check off)
        await expect.poll(() => seen.queryCalls, {
            message: 'the async query rule must run on submit, or the scene proves nothing',
            timeout: 10000
        }).toBeGreaterThan(0);

        // wait past the delayed settle + completion path
        await expect.poll(() => seen.queryAnswered, { timeout: 10000 }).toBeGreaterThan(0);
        await page.waitForTimeout(1200);

        expect(posts.length, 'a failing async query must block the submit — nothing may POST').toBe(0);

        // the field carries the query error state (what the user sees)
        const errState = await page.evaluate(() => {
            const el = document.getElementById('note');
            return {
                errAttr: el.getAttribute('data-gina-form-errors') || '',
                ariaInvalid: el.getAttribute('aria-invalid') || ''
            };
        });
        expect(errState.errAttr.indexOf('query') > -1,
            'the note field must carry the query error marker, got: ' + JSON.stringify(errState)).toBe(true);
    });

    test('02 - positive control: a passing query sends EXACTLY once, after the settle', async ({ page }) => {
        const seen  = await installScene(page, '{"isValid":true}');
        const posts = countPosts(page);

        await gotoFaceAndBoot(page);
        expect(seen.rulesRewritten, 'rules anchor drifted — scene inconclusive').toBe(true);
        expect(seen.idStripped, 'button-id anchor drifted — scene inconclusive').toBe(true);

        await fillFormQuietly(page);
        const clickedAt = Date.now();
        await page.click('#parent button[type="submit"]');

        await expect.poll(() => posts.length, {
            message: 'a valid form with a passing query must send',
            timeout: 10000
        }).toBeGreaterThan(0);
        await page.waitForTimeout(1500); // room for any duplicate to surface

        expect(posts.length, 'exactly ONE POST per click — a duplicate means a second validation cycle survived').toBe(1);
        expect(posts[0] - clickedAt,
            'the POST must not leave before the delayed query settles').toBeGreaterThanOrEqual(QUERY_DELAY_MS - 50);
    });
});
