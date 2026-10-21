'use strict';

/**
 * Playwright RUNTIME e2e for the validator fix #B926 (the real built gina bundle, real forms, real
 * clicks).
 *
 * An unticked value-carrying checkbox whose OWN rule says `isRequired` entered neither collector, so no
 * rule judged it: the form posted without the box and the required check never fired. The #B221 arm now
 * takes a checkbox as well: `isRequired` on a value-carrying checkbox means « must be ticked » (several
 * boxes under one name: at least one; distinct names: each). A boolean checkbox keeps posting its live
 * state; a disabled box is skipped; an unticked box with no rule stays absent.
 *
 *   01 #B926 — `ownbox`, unticked at load, the text field typed, Send clicked: refused, the box marked
 *      isRequired, nothing sent                                                   (RED: sent without it)
 *   02 #B926 — `ownbox`, ticked at load, typed, unticked, Send: refused           (RED: sent without it)
 *   03 CONTROL — `ownbox`, ticked, typed, Send: sent with the box's value
 *   04 CONTROL — `ownbox`, the box disabled and unticked, typed, Send: sent without it, not refused
 *   05 #B926 — `samename`, two boxes under one name, both unticked, typed, Send: refused (RED)
 *   06 CONTROL — `samename`, one of the two ticked, typed, Send: sent with that value
 *   07 CONTROL — `boolbox`, a valueless (boolean) checkbox with isRequired, unticked, typed, Send: sent
 *      with `false` (a required boolean false passes, as documented)
 *   08 CONTROL — `ownbox`, unticked at load, ticked by a click, typed, Send: sent with the box
 *
 * Scene: inline pages served by the runtime server (`/x76-page?b64=`) with the whisper
 * (`/js/gina.onload.b926.js`); submits go to /ac-sink, which answers {}.
 *
 * Pre-fix arm: `GINA_B926_PREFIX_BUNDLE=<path to a pre-fix gina.min.js>` serves that bundle to the
 * page instead of the working-tree dist (01, 02 and 05 fail there, the controls pass).
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');

const PORT = process.env.GINA_E2E_PORT || '3179';
const BASE = 'http://localhost:' + PORT + '/';

// The subtract arm: the pre-fix bundle to serve, and a hit counter proving it was served.
const PREFIX_BUNDLE = process.env.GINA_B926_PREFIX_BUNDLE ? fs.readFileSync(process.env.GINA_B926_PREFIX_BUNDLE) : null;

// Same polling kicker as the other x76-page specs: runs onGinaLoaded once the framework is there.
const KICKER = '(function(){var t=0;function k(){try{if(window.gina&&window.gina.config'
    + '&&typeof window.onGinaLoaded===\'function\'&&!window.gina.isFrameworkLoaded){'
    + 'window.onGinaLoaded(window.gina);}}catch(e){}if((!window.gina||!window.gina.isFrameworkLoaded)'
    + '&&t++<100){setTimeout(k,50);}}k();}());';

// the live check validates a typed field 1 s after its last keyup
const LIVE_CHECK_WAIT = 1600;

/**
 * The `ownbox` form: a required text field and the value-carrying checkbox whose own rule requires it.
 *
 * @param {boolean} checked - the box is ticked in the HTML
 * @param {boolean} [disabled] - the box is disabled in the HTML
 * @returns {string}
 */
function ownBoxForm(checked, disabled) {
    return '<form id="b926-form-1" method="post" action="/ac-sink" data-gina-form-rule="ownbox">'
        + '<input type="text" id="ref-1" name="ref" value="">'
        + '<input type="checkbox" id="item-0" name="items[0][email]" value="a@example.com"'
        + (checked ? ' checked' : '') + (disabled ? ' disabled' : '') + '>'
        + '<button type="submit" id="b926-submit-1">Send</button></form>';
}

/**
 * The `samename` form: two boxes under one name, required; `tickedIndex` names the one ticked (-1: none).
 *
 * @param {number} tickedIndex
 * @returns {string}
 */
function sameNameForm(tickedIndex) {
    return '<form id="b926-form-1" method="post" action="/ac-sink" data-gina-form-rule="samename">'
        + '<input type="text" id="ref-1" name="ref" value="">'
        + '<input type="checkbox" id="tag-0" name="tags[]" value="a"' + (tickedIndex === 0 ? ' checked' : '') + '>'
        + '<input type="checkbox" id="tag-1" name="tags[]" value="b"' + (tickedIndex === 1 ? ' checked' : '') + '>'
        + '<button type="submit" id="b926-submit-1">Send</button></form>';
}

/**
 * The `boolbox` form: a valueless (boolean) checkbox with isRequired, unticked.
 *
 * @returns {string}
 */
function boolBoxForm() {
    return '<form id="b926-form-1" method="post" action="/ac-sink" data-gina-form-rule="boolbox">'
        + '<input type="text" id="ref-1" name="ref" value="">'
        + '<input type="checkbox" id="agree-1" name="agree">'
        + '<button type="submit" id="b926-submit-1">Send</button></form>';
}

/**
 * Opens a page holding `form` and waits for it to be bound; counts the POSTs to the sink (with their
 * bodies) and the page errors.
 *
 * @param {object} page
 * @param {string} form - the form's HTML
 * @returns {Promise<{posts: Array<string>, errors: Array<string>}>}
 */
async function open(page, form) {
    let hits = null;
    if (PREFIX_BUNDLE) {
        hits = { n: 0 };
        await page.route('**/js/gina.min.js', (r) => { hits.n++; r.fulfill({ status: 200, contentType: 'application/javascript', body: PREFIX_BUNDLE }); });
    }
    const out = { posts: [], errors: [] };
    page.on('request', (r) => { if (r.url().indexOf('/ac-sink') > -1 && r.method() === 'POST') { out.posts.push(String(r.postData() || '')); } });
    page.on('pageerror', (e) => { out.errors.push(String(e && e.message)); });
    const html = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>b926</title><link rel="icon" href="data:,">'
        + '<script src="/js/gina.onload.b926.js"></script><script src="/js/gina.min.js"></script>'
        + '<script>' + KICKER + '</script></head><body>' + form + '</body></html>';
    await page.goto(BASE + 'x76-page?b64=' + Buffer.from(html).toString('base64url'));
    await page.waitForFunction(() => !!(
        window.gina
        && window.gina.isFrameworkLoaded === true
        && window.gina.validator
        && window.gina.validator.$forms
        && window.gina.validator.$forms['b926-form-1']
        && window.gina.validator.$forms['b926-form-1'].binded
    ), null, { timeout: 15000 });
    if (hits) { expect(hits.n, 'the pre-fix bundle was served').toBeGreaterThan(0); }
    return out;
}

/**
 * Types into the text field, clicks Send (forced: a gated control refuses a normal click) and
 * reports how many POSTs went out, the last body, and the error marks of the named controls.
 *
 * @param {object} page
 * @param {{posts: Array<string>}} run
 * @param {Array<string>} ids - the ids whose `data-gina-form-errors` to read
 * @returns {Promise<{sent: number, body: object|null, marks: object}>}
 */
async function send(page, run, ids) {
    await page.focus('#ref-1');
    await page.keyboard.type('r', { delay: 30 });
    await page.waitForTimeout(LIVE_CHECK_WAIT);
    const before = run.posts.length;
    await page.click('#b926-submit-1', { force: true, timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(LIVE_CHECK_WAIT);
    const sent = run.posts.length - before;
    const marks = await page.evaluate((list) => {
        const o = {};
        list.forEach((id) => { const el = document.getElementById(id); o[id] = el ? el.getAttribute('data-gina-form-errors') : null; });
        return o;
    }, ids);
    return { sent, body: sent ? JSON.parse(run.posts[run.posts.length - 1]) : null, marks };
}

test.describe('#B926 — a required value-carrying checkbox must be ticked', function () {

    test('01 #B926 — unticked at load: refused, the box marked isRequired, nothing sent', async ({ page }) => {
        const run = await open(page, ownBoxForm(false));
        const r = await send(page, run, ['item-0']);
        expect(run.errors, 'no page error').toEqual([]);
        expect(r.sent, 'nothing sent').toBe(0);
        expect(r.marks['item-0'], 'the box carries the isRequired mark').toContain('isRequired');
    });

    test('02 #B926 — ticked at load, then unticked: refused', async ({ page }) => {
        const run = await open(page, ownBoxForm(true));
        await page.click('#item-0');
        await page.waitForTimeout(LIVE_CHECK_WAIT);
        const r = await send(page, run, ['item-0']);
        expect(run.errors, 'no page error').toEqual([]);
        expect(r.sent, 'nothing sent').toBe(0);
        expect(r.marks['item-0'], 'the box carries the isRequired mark').toContain('isRequired');
    });

    test('03 CONTROL — ticked: sent with the box', async ({ page }) => {
        const run = await open(page, ownBoxForm(true));
        const r = await send(page, run, ['item-0']);
        expect(run.errors, 'no page error').toEqual([]);
        expect(r.sent).toBe(1);
        expect(r.body.ref).toBe('r');
        expect(r.body.items[0].email).toBe('a@example.com');
    });

    test('04 CONTROL — disabled and unticked: sent without it, not refused', async ({ page }) => {
        const run = await open(page, ownBoxForm(false, true));
        const r = await send(page, run, ['item-0']);
        expect(run.errors, 'no page error').toEqual([]);
        expect(r.sent).toBe(1);
        expect(r.body.ref).toBe('r');
        expect(r.body.items, 'the disabled box is absent from the payload').toBeUndefined();
        expect(r.marks['item-0'] || '', 'no mark on the disabled box').not.toContain('isRequired');
    });

    test('05 #B926 — two boxes under one name, both unticked: refused', async ({ page }) => {
        const run = await open(page, sameNameForm(-1));
        const r = await send(page, run, ['tag-0', 'tag-1']);
        expect(run.errors, 'no page error').toEqual([]);
        expect(r.sent, 'nothing sent').toBe(0);
        expect((r.marks['tag-0'] || '') + (r.marks['tag-1'] || ''), 'the group carries the isRequired mark').toContain('isRequired');
    });

    test('06 CONTROL — two boxes under one name, one ticked: sent with that value', async ({ page }) => {
        const run = await open(page, sameNameForm(1));
        const r = await send(page, run, ['tag-0', 'tag-1']);
        expect(run.errors, 'no page error').toEqual([]);
        expect(r.sent).toBe(1);
        // the ticked value travels under `tags` (the `[]` name nests as an empty key, as it did before
        // this change); the unticked one does not
        expect(JSON.stringify(r.body.tags)).toContain('"b"');
        expect(JSON.stringify(r.body.tags)).not.toContain('"a"');
    });

    test('07 CONTROL — a boolean (valueless) checkbox with isRequired, unticked: sent with false', async ({ page }) => {
        const run = await open(page, boolBoxForm());
        const r = await send(page, run, ['agree-1']);
        expect(run.errors, 'no page error').toEqual([]);
        expect(r.sent).toBe(1);
        expect(r.body.agree).toBe(false);
    });

    test('08 CONTROL — unticked at load, ticked by a click: sent with the box', async ({ page }) => {
        const run = await open(page, ownBoxForm(false));
        await page.click('#item-0');
        await page.waitForTimeout(LIVE_CHECK_WAIT);
        const r = await send(page, run, ['item-0']);
        expect(run.errors, 'no page error').toEqual([]);
        expect(r.sent).toBe(1);
        expect(r.body.items[0].email).toBe('a@example.com');
    });
});
