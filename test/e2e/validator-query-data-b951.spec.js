'use strict';

/**
 * Playwright RUNTIME e2e for #B951 — a browser-side `query` rule must send its `data` when its
 * method carries no body (the real built gina bundle, a real live check, a real request).
 *
 * The defect: `queryFromFrontend` (form-validator.js) built the request url from the rule's
 * `url` alone and handed the rule's `data` to `xhr.send()` only. The XHR standard drops a body
 * for GET and HEAD, so a GET rule — GET being the documented default method — sent none of its
 * data; and a gina receiver reads a DELETE's data from the query string only, so a DELETE rule's
 * JSON body reached nothing. Measured before the fix in Chromium: `GET /uniq` with no query
 * string and no body, for `method: "GET"` and for a rule declaring no method.
 *
 * The fix puts the data of a GET, HEAD or DELETE rule in the url's query string, the way the
 * server side's self.query() does: each key once, an object value as its JSON text, joined with
 * `&` to a query string the url already holds, a key that query string holds not sent again.
 *
 * Arms (every one a control for the others):
 *   01 GET rule with data                 -> the url carries the data, no body   (RED before the fix)
 *   02 rule with no method (default GET)  -> same                                (RED before the fix)
 *   03 DELETE rule with data              -> the url carries the data, no body   (RED before the fix)
 *   04 url already holding a query string -> joined with &, its own value kept   (RED before the fix)
 *   05 POST rule with data                -> a JSON body, the url untouched       (control, both sides)
 *   06 GET rule without data              -> the url untouched, no body           (control, both sides)
 *
 * Red-first, repeatable: `B951_PREFIX_BUNDLE=<path to a pre-fix gina.min.js>` serves those bytes
 * at /js/gina.min.js to every arm; `routeHits` proves they executed. Run bare: all green. Run
 * with the env: arms 01–04 red, 05–06 green.
 */

const fs = require('fs');
const { test, expect } = require('@playwright/test');

const PORT = process.env.GINA_E2E_PORT || '3179';
const BASE = 'http://localhost:' + PORT + '/';
const PREFIX_BUNDLE = process.env.B951_PREFIX_BUNDLE || '';

/** The rules literal the /face harness ships, URL-encoded into gina.onload.face.js. */
const STOCK_RULES = '{"rules":{"faceform":{"agree":{"isRequired":true}}}}';

/** Stock + a `note` field whose last rule is the `query` rule under test. */
function rulesWith(query) {
    return JSON.stringify({ rules: { faceform: { agree: { isRequired: true }, note: { isRequired: true, query: query } } } });
}

const DATA = { email: '$note', fixed: 'k1' };

/**
 * Swap the harness's form rules, capture what the browser sends to /uniq, and (under
 * B951_PREFIX_BUNDLE) serve the pre-fix bundle. `rulesRewritten` is the extraction control: if
 * the anchor drifts it reads false and the arm is inconclusive rather than silently testing the
 * stock rules.
 */
async function installScene(page, query) {
    const seen = { rulesRewritten: null, requests: [], routeHits: 0 };

    if (PREFIX_BUNDLE) {
        const prefix = fs.readFileSync(PREFIX_BUNDLE, 'utf8');
        await page.route('**/js/gina.min.js', async (route) => {
            seen.routeHits++;
            await route.fulfill({ status: 200, contentType: 'application/javascript', body: prefix });
        });
    }
    await page.route('**/js/gina.onload.face.js', async (route) => {
        const body = await (await route.fetch()).text();
        const from = encodeURIComponent(STOCK_RULES);
        seen.rulesRewritten = body.indexOf(from) > -1;
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: seen.rulesRewritten ? body.split(from).join(encodeURIComponent(rulesWith(query))) : body
        });
    });
    await page.route('**/uniq*', async (route) => {
        const r = route.request();
        seen.requests.push({ method: r.method(), url: r.url(), postData: r.postData() });
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{"isValid":true}' });
    });
    return seen;
}

/** Navigate to the FACE harness, wait for the bind, engage the FACE, then live-check `note`. */
async function driveNote(page, seen) {
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
    await page.click('#parent x-agree button');
    await page.waitForTimeout(300);
    await page.click('#note');
    await page.keyboard.type('someone@example.com', { delay: 20 });
    await page.keyboard.press('Tab');
    await expect.poll(() => seen.requests.length, {
        message: 'the query rule must actually run, or the arm proves nothing',
        timeout: 10000
    }).toBeGreaterThan(0);
    await page.waitForTimeout(500);
}

/** The scene checks shared by every arm. */
function assertScene(seen) {
    expect(seen.rulesRewritten, 'the rules anchor must still match').toBe(true);
    if (PREFIX_BUNDLE) {
        expect(seen.routeHits, 'the pre-fix bundle must have been served').toBeGreaterThan(0);
    }
}

test.describe('#B951 — a browser query rule sends its data when its method carries no body', function () {

    test('01 - a GET rule sends its data in the url, and no body', async ({ page }) => {
        const seen = await installScene(page, { url: '/uniq', method: 'GET', validIf: true, data: DATA });
        await driveNote(page, seen);
        assertScene(seen);
        const r = seen.requests[0];
        const u = new URL(r.url);
        expect(r.method).toBe('GET');
        expect(u.pathname).toBe('/uniq');
        expect(u.searchParams.get('email'), 'the field value must travel').toBe('someone@example.com');
        expect(u.searchParams.get('fixed')).toBe('k1');
        expect(u.searchParams.getAll('email').length, 'each key once').toBe(1);
        expect(r.postData, 'a GET carries no body').toBeNull();
    });

    test('02 - a rule declaring no method (GET by default) sends its data in the url', async ({ page }) => {
        const seen = await installScene(page, { url: '/uniq', validIf: true, data: DATA });
        await driveNote(page, seen);
        assertScene(seen);
        const r = seen.requests[0];
        const u = new URL(r.url);
        expect(r.method).toBe('GET');
        expect(u.searchParams.get('email')).toBe('someone@example.com');
        expect(u.searchParams.get('fixed')).toBe('k1');
        expect(r.postData).toBeNull();
    });

    test('03 - a DELETE rule sends its data in the url, and no body', async ({ page }) => {
        const seen = await installScene(page, { url: '/uniq', method: 'DELETE', validIf: true, data: DATA });
        await driveNote(page, seen);
        assertScene(seen);
        const r = seen.requests[0];
        const u = new URL(r.url);
        expect(r.method).toBe('DELETE');
        expect(u.searchParams.get('email')).toBe('someone@example.com');
        expect(u.searchParams.get('fixed')).toBe('k1');
        expect(r.postData, 'the data travels in the url only').toBeNull();
    });

    test('04 - a url that already holds a query string is joined with &, and keeps its own value', async ({ page }) => {
        const seen = await installScene(page, { url: '/uniq?fixed=url&src=form', method: 'GET', validIf: true, data: DATA });
        await driveNote(page, seen);
        assertScene(seen);
        const r = seen.requests[0];
        const u = new URL(r.url);
        expect(r.url.split('?').length, 'one ? only').toBe(2);
        expect(u.searchParams.get('src')).toBe('form');
        expect(u.searchParams.getAll('fixed'), 'the url\'s own value travels, once').toEqual(['url']);
        expect(u.searchParams.get('email')).toBe('someone@example.com');
    });

    test('05 - control: a POST rule sends a JSON body, and the url untouched', async ({ page }) => {
        const seen = await installScene(page, { url: '/uniq', method: 'POST', validIf: true, data: DATA });
        await driveNote(page, seen);
        assertScene(seen);
        const r = seen.requests[0];
        expect(r.method).toBe('POST');
        expect(new URL(r.url).search, 'a POST keeps its data out of the url').toBe('');
        expect(JSON.parse(r.postData)).toEqual({ email: 'someone@example.com', fixed: 'k1' });
    });

    test('06 - control: a GET rule without data keeps its url, and sends no body', async ({ page }) => {
        const seen = await installScene(page, { url: '/uniq', method: 'GET', validIf: true });
        await driveNote(page, seen);
        assertScene(seen);
        const r = seen.requests[0];
        expect(new URL(r.url).search).toBe('');
        expect(r.postData).toBeNull();
    });
});
