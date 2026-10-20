'use strict';

/**
 * Playwright RUNTIME e2e for the validator fix #B922 (the real built gina bundle, real forms, real
 * clicks).
 *
 * A field that no rule of its own covers, but that a `_case_` condition names, is live-checked since
 * #B884: its own pass finds no rule, reads valid, and reset its display through `handleErrorsDisplay`,
 * which then marked the submit control ready (`updateSubmitTriggerState(form, true)`). The show branch
 * clears native `disabled`, so a page script that had just disabled the submit control natively on that
 * field's `change` saw it enabled again, before the whole-form pass gated the form. That field's pass
 * now leaves the submit control to the whole-form pass.
 *
 *   01 #B922 — a page script disables the submit on an untick, wired before the bind: the submit
 *      stays disabled, and gated; a forced click sends nothing             (RED: disabled=false)
 *   02 #B922 — the same, the page script wired after the bind              (RED: disabled=false)
 *   03 CONTROL — untick, then tick again: enabled, not gated, and a click sends the form
 *   04 CONTROL — unticked at load, then the title typed: the title's own pass still enables a
 *      submit disabled in the HTML, gated (as on v0.7.4: the fix covers `_case_` targets only)
 *   05 CONTROL — two required fields, the submit disabled in the HTML, one typed: enabled, gated
 *   06 CONTROL — both typed: enabled, not gated, and a click sends them
 *
 * Scene: inline pages served by the runtime server (`/x76-page?b64=`) with the case-target whisper
 * (`/js/gina.onload.b922.js`); submits go to /ac-sink, which answers {}.
 *
 * Pre-fix arm: `GINA_B922_PREFIX_BUNDLE=<path to a pre-fix gina.min.js>` serves that bundle to the
 * page instead of the working-tree dist (01 and 02 fail there, the controls pass).
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');

const PORT = process.env.GINA_E2E_PORT || '3179';
const BASE = 'http://localhost:' + PORT + '/';

// The subtract arm: the pre-fix bundle to serve, and a hit counter proving it was served.
const PREFIX_BUNDLE = process.env.GINA_B922_PREFIX_BUNDLE ? fs.readFileSync(process.env.GINA_B922_PREFIX_BUNDLE) : null;

// Same polling kicker as the other x76-page specs: runs onGinaLoaded once the framework is there.
const KICKER = '(function(){var t=0;function k(){try{if(window.gina&&window.gina.config'
    + '&&typeof window.onGinaLoaded===\'function\'&&!window.gina.isFrameworkLoaded){'
    + 'window.onGinaLoaded(window.gina);}}catch(e){}if((!window.gina||!window.gina.isFrameworkLoaded)'
    + '&&t++<100){setTimeout(k,50);}}k();}());';

// the live check validates a typed field 1 s after its last keyup
const LIVE_CHECK_WAIT = 1600;

// The page script under test: it disables the submit control natively when the item is unticked and
// enables it again when ticked, dispatching a bubbling `change` on the control each time.
const PAGE_SCRIPT = 'window.__b922wire=function(){var cb=document.getElementById("item-0");'
    + 'cb.addEventListener("change",function(){var b=document.getElementById("b922-submit-1");'
    + 'if(this.checked){if(b.disabled){b.disabled=false;b.dispatchEvent(new Event("change",{bubbles:true}));}}'
    + 'else{b.disabled=true;b.dispatchEvent(new Event("change",{bubbles:true}));}});};';

/**
 * The `casecheck` form: the hidden boolean driver `flag`, the required `title`, the value-carrying item
 * checkbox (no rule of its own; the `true` case requires it) and its hidden id, and a submit control
 * disabled in the HTML.
 *
 * @param {boolean} checked - the item is ticked in the HTML
 * @returns {string}
 */
function caseForm(checked) {
    return '<form id="b922-form-1" method="post" action="/ac-sink" data-gina-form-rule="casecheck">'
        + '<input type="hidden" name="flag" value="true">'
        + '<input type="text" id="title-1" name="title" value="">'
        + '<input type="checkbox" id="item-0" name="items[0][email]" value="a@example.com"' + (checked ? ' checked' : '') + '>'
        + '<input type="hidden" id="item-0-id" name="items[0][id]" value="7" data-gina-form-element-group="item-0">'
        + '<button type="submit" id="b922-submit-1" disabled>Send</button></form>';
}

/**
 * The `twofields` form: two required text fields and a submit control disabled in the HTML.
 *
 * @returns {string}
 */
function twoFieldsForm() {
    return '<form id="b922-form-1" method="post" action="/ac-sink" data-gina-form-rule="twofields">'
        + '<input type="text" id="a-1" name="a" value="">'
        + '<input type="text" id="b-1" name="b" value="">'
        + '<button type="submit" id="b922-submit-1" disabled>Send</button></form>';
}

/**
 * Opens a page holding `form` and waits for it to be bound; counts the POSTs to the sink (with their
 * bodies) and the page errors.
 *
 * @param {object} page
 * @param {string} form - the form's HTML
 * @param {string} [wire] - 'before' or 'after' the bind: when to register the page script; none if omitted
 * @returns {Promise<{posts: Array<string>, errors: Array<string>}>}
 */
async function open(page, form, wire) {
    let hits = null;
    if (PREFIX_BUNDLE) {
        hits = { n: 0 };
        await page.route('**/js/gina.min.js', (r) => { hits.n++; r.fulfill({ status: 200, contentType: 'application/javascript', body: PREFIX_BUNDLE }); });
    }
    const out = { posts: [], errors: [] };
    page.on('request', (r) => { if (r.url().indexOf('/ac-sink') > -1 && r.method() === 'POST') { out.posts.push(String(r.postData() || '')); } });
    page.on('pageerror', (e) => { out.errors.push(String(e && e.message)); });
    const html = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>b922</title><link rel="icon" href="data:,">'
        + '<script>' + PAGE_SCRIPT + '</script>'
        + '<script src="/js/gina.onload.b922.js"></script><script src="/js/gina.min.js"></script>'
        + '<script>' + KICKER + '</script></head><body>' + form
        + (wire === 'before' ? '<script>window.__b922wire();</script>' : '') + '</body></html>';
    await page.goto(BASE + 'x76-page?b64=' + Buffer.from(html).toString('base64url'));
    await page.waitForFunction(() => !!(
        window.gina
        && window.gina.isFrameworkLoaded === true
        && window.gina.validator
        && window.gina.validator.$forms
        && window.gina.validator.$forms['b922-form-1']
        && window.gina.validator.$forms['b922-form-1'].binded
    ), null, { timeout: 15000 });
    if (wire === 'after') { await page.evaluate(() => window.__b922wire()); }
    if (hits) { expect(hits.n, 'the pre-fix bundle was served').toBeGreaterThan(0); }
    return out;
}

/**
 * Reads the submit control's native `disabled`, its gated mark and its class.
 *
 * @param {object} page
 * @returns {Promise<{disabled: boolean, gated: (string|null), cls: boolean}>}
 */
function submitState(page) {
    return page.evaluate(() => {
        const b = document.getElementById('b922-submit-1');
        return {
            disabled: b.disabled,
            gated: b.getAttribute('data-gina-form-submit-gated'),
            cls: b.classList.contains('gina-form-submit-disabled')
        };
    });
}

/**
 * Types `text` into the field `sel` and waits for the live check.
 *
 * @param {object} page
 * @param {string} sel
 * @param {string} text
 * @returns {Promise<void>}
 */
async function typeInto(page, sel, text) {
    await page.focus(sel);
    await page.keyboard.type(text, { delay: 30 });
    await page.waitForTimeout(LIVE_CHECK_WAIT);
}

/**
 * Clicks `sel` and waits for the live check.
 *
 * @param {object} page
 * @param {string} sel
 * @returns {Promise<void>}
 */
async function clickAndWait(page, sel) {
    await page.click(sel);
    await page.waitForTimeout(LIVE_CHECK_WAIT);
}

const READY = { disabled: false, gated: null, cls: false };

test.describe('validator submit control — #B922, a `_case_` target\'s own pass leaves the control to the whole-form pass', function () {

    for (const wire of ['before', 'after']) {
        const n = wire === 'before' ? '01' : '02';
        test(n + ' - #B922: a page script disables the submit on an untick (wired ' + wire + ' the bind) — it stays disabled, and gated', async ({ page }) => {
            const run = await open(page, caseForm(true), wire);
            await typeInto(page, '#title-1', 'x');
            expect(await submitState(page), 'the form is valid with the item ticked').toEqual(READY);
            await clickAndWait(page, '#item-0');
            expect(await submitState(page)).toEqual({ disabled: true, gated: 'true', cls: true });
            const before = run.posts.length;
            await page.click('#b922-submit-1', { force: true });
            await page.waitForTimeout(LIVE_CHECK_WAIT);
            expect(run.posts.length - before, 'nothing is sent').toBe(0);
            expect(run.errors).toEqual([]);
        });
    }

    test('03 - CONTROL: untick, then tick again — enabled, not gated, and a click sends the form', async ({ page }) => {
        const run = await open(page, caseForm(true), 'before');
        await typeInto(page, '#title-1', 'x');
        await clickAndWait(page, '#item-0');
        await clickAndWait(page, '#item-0');
        expect(await submitState(page)).toEqual(READY);
        const before = run.posts.length;
        await page.click('#b922-submit-1');
        await page.waitForTimeout(LIVE_CHECK_WAIT);
        expect(run.posts.length - before, 'the click sends').toBe(1);
        const body = JSON.parse(run.posts[run.posts.length - 1]);
        expect(body.title).toBe('x');
        expect(body.items).toEqual([{ email: 'a@example.com', id: '7' }]);
        expect(run.errors).toEqual([]);
    });

    test('04 - CONTROL: unticked at load, the title typed — enabled and gated (the title has a rule of its own)', async ({ page }) => {
        const run = await open(page, caseForm(false), 'before');
        await typeInto(page, '#title-1', 'x');
        expect(await submitState(page)).toEqual({ disabled: false, gated: 'true', cls: true });
        expect(run.errors).toEqual([]);
    });

    test('05 - CONTROL: two required fields, the submit disabled in the HTML, one typed — enabled and gated', async ({ page }) => {
        const run = await open(page, twoFieldsForm());
        await typeInto(page, '#a-1', 'x');
        expect(await submitState(page)).toEqual({ disabled: false, gated: 'true', cls: true });
        expect(run.errors).toEqual([]);
    });

    test('06 - CONTROL: both typed — enabled, not gated, and a click sends them', async ({ page }) => {
        const run = await open(page, twoFieldsForm());
        await typeInto(page, '#a-1', 'x');
        await typeInto(page, '#b-1', 'y');
        expect(await submitState(page)).toEqual(READY);
        const before = run.posts.length;
        await page.click('#b922-submit-1');
        await page.waitForTimeout(LIVE_CHECK_WAIT);
        expect(run.posts.length - before, 'the click sends').toBe(1);
        expect(JSON.parse(run.posts[run.posts.length - 1])).toEqual({ a: 'x', b: 'y' });
        expect(run.errors).toEqual([]);
    });
});
