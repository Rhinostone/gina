'use strict';

/**
 * Playwright RUNTIME e2e for the validator fix #B921 (the real built gina bundle, real forms, real
 * clicks).
 *
 * A RegExp KEY inside a `_case_` condition's `rules` (`"/^x$/": { exclude: true }`) applied only when its
 * block was not the last `_case_` key of the rule set: the condition scan skipped it (no control bears
 * that name), and only the direct-case recursion of a non-last driver expanded it. The scan now gives
 * each control the key matches a literal key of its own, so the key applies in every block position and
 * for every case shape, as a literal key does; and a field such a key names is live-checked.
 *
 *   01 #B921 — single block, `x` excluded when `mode` is `a`: not posted        (RED: posted)
 *   02 #B921 — the same block LAST of two: not posted                           (RED: posted)
 *   03 #B921 — boolean case, `/^item[/` required: the empty amount is refused   (RED: sent)
 *   04 #B921 — a block that is not the last, `/^inv[/` required: an unticked value-carrying box is
 *      refused, as with a literal key                                            (RED: sent without it)
 *   05 #B921 — a field only a RegExp key requires is live-checked: typing into it re-opens the
 *      submit control                                                            (RED: stays gated)
 *   06 CONTROL — the same block FIRST of two: not posted (applied before the fix too)
 *   07 CONTROL — a top-level RegExp key: not posted
 *   08 CONTROL — a literal key in the condition: not posted
 *   09 CONTROL — `mode` is `b`, the condition does not match: posted
 *   10 CONTROL — a `$` inside a RegExp key matches no field: the empty amount is sent, as before
 *
 * Scene: inline pages served by the runtime server (`/x76-page?b64=`) with the whisper
 * (`/js/gina.onload.b921.js`); submits go to /ac-sink, which answers {}.
 *
 * Pre-fix arm: `GINA_B921_PREFIX_BUNDLE=<path to a pre-fix gina.min.js>` serves that bundle to the
 * page instead of the working-tree dist (01 to 05 fail there, the controls pass).
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');

const PORT = process.env.GINA_E2E_PORT || '3179';
const BASE = 'http://localhost:' + PORT + '/';

// The subtract arm: the pre-fix bundle to serve, and a hit counter proving it was served.
const PREFIX_BUNDLE = process.env.GINA_B921_PREFIX_BUNDLE ? fs.readFileSync(process.env.GINA_B921_PREFIX_BUNDLE) : null;

// Same polling kicker as the other x76-page specs: runs onGinaLoaded once the framework is there.
const KICKER = '(function(){var t=0;function k(){try{if(window.gina&&window.gina.config'
    + '&&typeof window.onGinaLoaded===\'function\'&&!window.gina.isFrameworkLoaded){'
    + 'window.onGinaLoaded(window.gina);}}catch(e){}if((!window.gina||!window.gina.isFrameworkLoaded)'
    + '&&t++<100){setTimeout(k,50);}}k();}());';

// the live check validates a typed field 1 s after its last keyup
const LIVE_CHECK_WAIT = 1600;

/**
 * The form every arm uses, bound to the rule set `rule`: a required text field, a radio driver, a text
 * `x`, a hidden boolean driver, a hidden `pid`, two amounts (one empty), an unticked and a ticked
 * value-carrying checkbox, and an empty text `extra`.
 *
 * @param {string} rule - the rule set's name in the whisper
 * @returns {string}
 */
function formOf(rule) {
    return '<form id="b921-form-1" method="post" action="/ac-sink" data-gina-form-rule="' + rule + '">'
        + '<input type="text" id="ref-1" name="ref" value="">'
        + '<input type="radio" id="mode-a-1" name="mode" value="a"><input type="radio" id="mode-b-1" name="mode" value="b">'
        + '<input type="text" id="x-1" name="x" value="xv">'
        + '<input type="hidden" id="flag-1" name="flag" value="true">'
        + '<input type="hidden" id="pid-1" name="pid" value="p1">'
        + '<input type="text" id="item0-1" name="item[0][amount]" value="5">'
        + '<input type="text" id="itemp1-1" name="item[p1][amount]" value="">'
        + '<input type="checkbox" id="inv1-1" name="inv[1][id]" value="1">'
        + '<input type="checkbox" id="inv2-1" name="inv[2][id]" value="2" checked>'
        + '<input type="text" id="extra-1" name="extra" value="">'
        + '<button type="submit" id="b921-submit-1">Send</button></form>';
}

/**
 * Opens a page holding the form bound to `rule` and waits for it to be bound; counts the POSTs to the
 * sink (with their bodies) and the page errors.
 *
 * @param {object} page
 * @param {string} rule
 * @returns {Promise<{posts: Array<string>, errors: Array<string>}>}
 */
async function open(page, rule) {
    let hits = null;
    if (PREFIX_BUNDLE) {
        hits = { n: 0 };
        await page.route('**/js/gina.min.js', (r) => { hits.n++; r.fulfill({ status: 200, contentType: 'application/javascript', body: PREFIX_BUNDLE }); });
    }
    const out = { posts: [], errors: [] };
    page.on('request', (r) => { if (r.url().indexOf('/ac-sink') > -1 && r.method() === 'POST') { out.posts.push(String(r.postData() || '')); } });
    page.on('pageerror', (e) => { out.errors.push(String(e && e.message)); });
    const html = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>b921</title><link rel="icon" href="data:,">'
        + '<script src="/js/gina.onload.b921.js"></script><script src="/js/gina.min.js"></script>'
        + '<script>' + KICKER + '</script></head><body>' + formOf(rule) + '</body></html>';
    await page.goto(BASE + 'x76-page?b64=' + Buffer.from(html).toString('base64url'));
    await page.waitForFunction(() => !!(
        window.gina
        && window.gina.isFrameworkLoaded === true
        && window.gina.validator
        && window.gina.validator.$forms
        && window.gina.validator.$forms['b921-form-1']
        && window.gina.validator.$forms['b921-form-1'].binded
    ), null, { timeout: 15000 });
    if (hits) { expect(hits.n, 'the pre-fix bundle was served').toBeGreaterThan(0); }
    return out;
}

/**
 * Types the required text field, picks `mode`, clicks Send (forced: a gated control refuses a normal
 * click) and reports how many POSTs went out, the last body, and the error marks.
 *
 * @param {object} page
 * @param {{posts: Array<string>}} run
 * @param {string} mode - `a` or `b`
 * @returns {Promise<{sent: number, body: object|null, marks: object}>}
 */
async function fillAndSend(page, run, mode) {
    await page.focus('#ref-1');
    await page.keyboard.type('r', { delay: 30 });
    await page.check('#mode-' + mode + '-1');
    await page.waitForTimeout(LIVE_CHECK_WAIT);
    const before = run.posts.length;
    await page.click('#b921-submit-1', { force: true, timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(LIVE_CHECK_WAIT);
    const sent = run.posts.length - before;
    const marks = await page.evaluate(() => {
        const o = {};
        ['itemp1-1', 'inv1-1', 'x-1', 'extra-1'].forEach((id) => { o[id] = document.getElementById(id).getAttribute('data-gina-form-errors'); });
        return o;
    });
    return { sent, body: sent ? JSON.parse(run.posts[run.posts.length - 1]) : null, marks };
}

test.describe('#B921 — a RegExp key inside a `_case_` condition applies in every block position', function () {

    test('01 #B921 — single block: x is not posted', async ({ page }) => {
        const run = await open(page, 'single');
        const r = await fillAndSend(page, run, 'a');
        expect(run.errors, 'no page error').toEqual([]);
        expect(r.sent).toBe(1);
        expect(r.body.ref).toBe('r');
        expect(r.body.x, 'x excluded').toBeUndefined();
    });

    test('02 #B921 — the block LAST of two: x is not posted', async ({ page }) => {
        const run = await open(page, 'last');
        const r = await fillAndSend(page, run, 'a');
        expect(run.errors, 'no page error').toEqual([]);
        expect(r.sent).toBe(1);
        expect(r.body.x, 'x excluded').toBeUndefined();
    });

    test('03 #B921 — boolean case: the empty amount is refused', async ({ page }) => {
        const run = await open(page, 'amounts');
        const r = await fillAndSend(page, run, 'a');
        expect(run.errors, 'no page error').toEqual([]);
        expect(r.sent, 'nothing sent').toBe(0);
        expect(r.marks['itemp1-1'], 'the empty amount carries the isRequired mark').toContain('isRequired');
    });

    test('04 #B921 — a block that is not the last: the unticked value-carrying box is refused', async ({ page }) => {
        const run = await open(page, 'boxes');
        const r = await fillAndSend(page, run, 'a');
        expect(run.errors, 'no page error').toEqual([]);
        expect(r.sent, 'nothing sent').toBe(0);
        expect(r.marks['inv1-1'], 'the unticked box carries the isRequired mark').toContain('isRequired');
    });

    test('05 #B921 — a field only a RegExp key requires is live-checked: typing re-opens the submit control', async ({ page }) => {
        const run = await open(page, 'live');
        await page.focus('#ref-1');
        await page.keyboard.type('r', { delay: 30 });
        await page.check('#mode-a-1');
        await page.waitForTimeout(LIVE_CHECK_WAIT);
        const gatedBefore = await page.getAttribute('#b921-submit-1', 'data-gina-form-submit-gated');
        expect(gatedBefore, 'gated while extra is empty').toBe('true');
        await page.focus('#extra-1');
        await page.keyboard.type('e', { delay: 30 });
        await page.waitForTimeout(LIVE_CHECK_WAIT);
        const gatedAfter = await page.getAttribute('#b921-submit-1', 'data-gina-form-submit-gated');
        expect(run.errors, 'no page error').toEqual([]);
        expect(gatedAfter === null || gatedAfter === 'false', 'typing into extra re-opens the submit control (got ' + gatedAfter + ')').toBe(true);
    });

    test('06 CONTROL — the block FIRST of two: x is not posted', async ({ page }) => {
        const run = await open(page, 'first');
        const r = await fillAndSend(page, run, 'a');
        expect(run.errors, 'no page error').toEqual([]);
        expect(r.sent).toBe(1);
        expect(r.body.x).toBeUndefined();
    });

    test('07 CONTROL — a top-level RegExp key: x is not posted', async ({ page }) => {
        const run = await open(page, 'toplevel');
        const r = await fillAndSend(page, run, 'a');
        expect(run.errors, 'no page error').toEqual([]);
        expect(r.sent).toBe(1);
        expect(r.body.x).toBeUndefined();
    });

    test('08 CONTROL — a literal key in the condition: x is not posted', async ({ page }) => {
        const run = await open(page, 'literal');
        const r = await fillAndSend(page, run, 'a');
        expect(run.errors, 'no page error').toEqual([]);
        expect(r.sent).toBe(1);
        expect(r.body.x).toBeUndefined();
    });

    test('09 CONTROL — the condition does not match: x is posted', async ({ page }) => {
        const run = await open(page, 'single');
        const r = await fillAndSend(page, run, 'b');
        expect(run.errors, 'no page error').toEqual([]);
        expect(r.sent).toBe(1);
        expect(r.body.x).toBe('xv');
    });

    test('10 CONTROL — a `$` inside a RegExp key matches no field: the empty amount is sent', async ({ page }) => {
        const run = await open(page, 'dollar');
        const r = await fillAndSend(page, run, 'a');
        expect(run.errors, 'no page error').toEqual([]);
        expect(r.sent).toBe(1);
    });
});
