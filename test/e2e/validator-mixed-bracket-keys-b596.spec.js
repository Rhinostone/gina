'use strict';

/**
 * Playwright RUNTIME e2e for the bracket-nesting fix #B596 (the real built gina bundle, real forms, real
 * clicks).
 *
 * A parent whose bracket segments mix indexes and names (`items[0][id]`, `items[1][id]`, then
 * `items[selected]`) nests to ONE object keyed by both, whatever the order. Before the fix, a name
 * reaching a level that already held an array was read as index 0: a fresh `{}` replaced the first row,
 * and the name became an array property that JSON drops, so the posted body lost the first row and the
 * name. The name first already gave the object. Both nesting paths of the bundle are driven: a submit
 * (the data helper's `parseLocalObj`, through `formatData`) and `$form.send(FormData)` (the validator's
 * twin `nestBracketNotationKey`).
 *
 *   01 #B596 — indexes first, then a name: the submit posts one object with every row (RED: [{}, …])
 *   02 #B596 — a list of values, then a name: one object, nothing lost                 (RED)
 *   03 #B596 — send(FormData), indexes first, then a name: one object                  (RED)
 *   04 CONTROL — the name first, then the indexes: the same object as 01
 *   05 CONTROL — indexes only: an array
 *   06 CONTROL — send(FormData), indexes only: an array
 *
 * Scene: inline pages served by the runtime server (`/x76-page?b64=`) with the mixed bracket-keys rules
 * whisper (`/js/gina.onload.b596.js`, rule set `mixform`: `ref` required); posts go to /ac-sink, which
 * answers {}.
 *
 * Pre-fix arm: `GINA_B596_PREFIX_BUNDLE=<path to a pre-fix gina.min.js>` serves that bundle to the page
 * instead of the working-tree dist.
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');

const PORT = process.env.GINA_E2E_PORT || '3179';
const BASE = 'http://localhost:' + PORT + '/';

// The subtract arm: the pre-fix bundle to serve, and a hit counter proving it was served.
const PREFIX_BUNDLE = process.env.GINA_B596_PREFIX_BUNDLE ? fs.readFileSync(process.env.GINA_B596_PREFIX_BUNDLE) : null;

// Same polling kicker as the other x76-page specs: runs onGinaLoaded once the framework is there.
const KICKER = '(function(){var t=0;function k(){try{if(window.gina&&window.gina.config'
    + '&&typeof window.onGinaLoaded===\'function\'&&!window.gina.isFrameworkLoaded){'
    + 'window.onGinaLoaded(window.gina);}}catch(e){}if((!window.gina||!window.gina.isFrameworkLoaded)'
    + '&&t++<100){setTimeout(k,50);}}k();}());';

// the live check validates a typed field 1 s after its last keyup
const LIVE_CHECK_WAIT = 1600;
// a realistic gap between two user actions
const CLICK_GAP = 450;

// the indexed rows, and the name that joins them under the same parent
const ROWS = [['items[0][id]', 'a0'], ['items[0][qty]', '2'], ['items[1][id]', 'a1']];
const NAME = ['items[selected]', 'a1'];
const MIXED = { '0': { id: 'a0', qty: '2' }, '1': { id: 'a1' }, selected: 'a1' };

/**
 * The rule-bound form, with one text input per `[name, value]` pair, in order.
 *
 * @param {Array<Array<string>>} fields
 * @returns {string}
 */
function formOf(fields) {
    return '<form id="b596-form-1" method="post" action="/ac-sink" data-gina-form-rule="mixform">'
        + '<input type="text" id="ref-1" name="ref" value="">'
        + fields.map((f, i) => '<input type="text" id="f' + i + '-1" name="' + f[0] + '" value="' + f[1] + '">').join('')
        + '<button type="submit" id="b596-submit-1">Send</button></form>';
}

/**
 * Opens a page holding `body` and waits for the form to be bound; collects the POSTs to the sink (with
 * their bodies) and the page errors.
 *
 * @param {object} page
 * @param {string} body - the page body (HTML)
 * @returns {Promise<{posts: Array<string>, errors: Array<string>}>}
 */
async function open(page, body) {
    let hits = null;
    if (PREFIX_BUNDLE) {
        hits = { n: 0 };
        await page.route('**/js/gina.min.js', (r) => { hits.n++; r.fulfill({ status: 200, contentType: 'application/javascript', body: PREFIX_BUNDLE }); });
    }
    const out = { posts: [], errors: [] };
    page.on('request', (r) => { if (r.url().indexOf('/ac-sink') > -1 && r.method() === 'POST') { out.posts.push(String(r.postData() || '')); } });
    page.on('pageerror', (e) => { out.errors.push(String(e && e.message)); });
    const html = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>b596</title><link rel="icon" href="data:,">'
        + '<script src="/js/gina.onload.b596.js"></script><script src="/js/gina.min.js"></script>'
        + '<script>' + KICKER + '</script></head><body>' + body + '</body></html>';
    await page.goto(BASE + 'x76-page?b64=' + Buffer.from(html).toString('base64url'));
    await page.waitForFunction(() => !!(
        window.gina
        && window.gina.isFrameworkLoaded === true
        && window.gina.validator
        && window.gina.validator.$forms
        && window.gina.validator.$forms['b596-form-1']
        && window.gina.validator.$forms['b596-form-1'].binded
    ), null, { timeout: 15000 });
    if (hits) { expect(hits.n, 'the pre-fix bundle was served').toBeGreaterThan(0); }
    return out;
}

/**
 * Fills `ref`, clicks Send and returns the posted body (parsed).
 *
 * @param {object} page
 * @param {{posts: Array<string>}} run
 * @returns {Promise<object>}
 */
async function submit(page, run) {
    await page.fill('#ref-1', 'x');
    await page.waitForTimeout(LIVE_CHECK_WAIT);
    const before = run.posts.length;
    await page.click('#b596-submit-1');
    await page.waitForTimeout(LIVE_CHECK_WAIT);
    expect(run.posts.length - before, 'the click sends').toBe(1);
    return JSON.parse(run.posts[run.posts.length - 1]);
}

/**
 * Posts a FormData holding `entries` through `$form.send()` and returns the posted body (parsed).
 *
 * @param {object} page
 * @param {{posts: Array<string>}} run
 * @param {Array<Array<string>>} entries
 * @returns {Promise<object>}
 */
async function sendFormData(page, run, entries) {
    await page.waitForTimeout(CLICK_GAP);
    const before = run.posts.length;
    await page.evaluate((list) => {
        const fd = new FormData();
        list.forEach((e) => fd.append(e[0], e[1]));
        window.gina.validator.$forms['b596-form-1'].send(fd);
    }, entries);
    await page.waitForTimeout(LIVE_CHECK_WAIT);
    expect(run.posts.length - before, 'send() posts').toBe(1);
    return JSON.parse(run.posts[run.posts.length - 1]);
}

test.describe('validator bracket nesting — #B596, a parent mixing indexes and names is one object', function () {

    test('01 - #B596: indexes first, then a name — the submit posts one object with every row', async ({ page }) => {
        const run = await open(page, formOf(ROWS.concat([NAME])));
        const body = await submit(page, run);
        expect(body).toEqual({ ref: 'x', items: MIXED });
        expect(run.errors).toEqual([]);
    });

    test('02 - #B596: a list of values, then a name — one object, nothing lost', async ({ page }) => {
        const run = await open(page, formOf([['tags[0]', 'red'], ['tags[1]', 'blue'], ['tags[main]', 'red']]));
        const body = await submit(page, run);
        expect(body).toEqual({ ref: 'x', tags: { '0': 'red', '1': 'blue', main: 'red' } });
        expect(run.errors).toEqual([]);
    });

    test('03 - #B596: send(FormData), indexes first, then a name — one object', async ({ page }) => {
        const run = await open(page, formOf([]));
        const body = await sendFormData(page, run, [['ref', 'x']].concat(ROWS, [NAME]));
        expect(body).toEqual({ ref: 'x', items: MIXED });
        expect(run.errors).toEqual([]);
    });

    test('04 - CONTROL: the name first, then the indexes — the same object', async ({ page }) => {
        const run = await open(page, formOf([NAME].concat(ROWS)));
        const body = await submit(page, run);
        expect(body).toEqual({ ref: 'x', items: MIXED });
        expect(run.errors).toEqual([]);
    });

    test('05 - CONTROL: indexes only — an array', async ({ page }) => {
        const run = await open(page, formOf(ROWS));
        const body = await submit(page, run);
        expect(body).toEqual({ ref: 'x', items: [{ id: 'a0', qty: '2' }, { id: 'a1' }] });
        expect(run.errors).toEqual([]);
    });

    test('06 - CONTROL: send(FormData), indexes only — an array', async ({ page }) => {
        const run = await open(page, formOf([]));
        const body = await sendFormData(page, run, [['ref', 'x']].concat(ROWS));
        expect(body).toEqual({ ref: 'x', items: [{ id: 'a0', qty: '2' }, { id: 'a1' }] });
        expect(run.errors).toEqual([]);
    });
});
