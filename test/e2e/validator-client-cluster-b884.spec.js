'use strict';

/**
 * Playwright RUNTIME e2e for the validator client fixes #B884, #B880 + #B802, #B881 and #B886
 * (the real built gina bundle, real forms, real keystrokes).
 *
 *  - #B884 — a field with NO rule of its own that a `_case_<driver>` condition makes required got
 *    no live-check listener: after the driver picked the case, the submit trigger gated, but typing
 *    into that field never re-evaluated it, so the first click on a valid form was refused.
 *  - #B880 — the validator wrote a GLOBAL `rule` (an undeclared loop variable in sloppy mode) on the
 *    first validation that found an error.
 *  - #B802 — `reBind(formId, rules)` tested that global instead of its own `rules` argument, so the
 *    rule set it was handed applied only once some validation on the page had found an error.
 *  - #B881 — `$forms[id].unbind()` with no argument threw instead of unbinding the handle's form.
 *  - #B886 — the live check skipped `tel`, `url` and `search` inputs (and the date/time family): a
 *    required field of such a type was never live-checked, so the first click was refused.
 *
 *   01 CONTROL — a field with its own rule: typing un-gates the trigger and the first click sends
 *   02 #B884 — the case makes `extra` required (the trigger gates); typing `extra` un-gates it and
 *      the first click sends                              (RED before the fix: gated, 0 sends)
 *   03 #B880 — a form invalid at bind writes no global `rule`     (RED: `rule` === 'isRequired')
 *   04 #B802 — reBind(undefined, 'otherform') applies `otherform` with no validation error yet
 *                                                                 (RED: the rule set is kept)
 *   05 CONTROL — the same after an error (the case that already worked before the fix)
 *   06 #B881 — `$forms[id].unbind()` with no argument unbinds the form  (RED: it throws)
 *   07 #B886 — a required `tel`, `url` or `search` field: typing un-gates the trigger and the
 *      first click sends                                  (RED: gated, 0 sends — one arm per type)
 *   08 CONTROL — the same with a `text` field
 *
 * Scene: inline pages served by the runtime server (`/x76-page?b64=`) with the validator
 * client-cluster rules whisper (`/js/gina.onload.b884.js`); submits go to /ac-sink, which answers {}.
 *
 * Pre-fix arm: `GINA_B884_PREFIX_BUNDLE=<path to a pre-fix gina.min.js>` serves that bundle to the
 * page instead of the working-tree dist.
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');

const PORT = process.env.GINA_E2E_PORT || '3179';
const BASE = 'http://localhost:' + PORT + '/';

// The subtract arm: the pre-fix bundle to serve, and a hit counter proving it was served.
const PREFIX_BUNDLE = process.env.GINA_B884_PREFIX_BUNDLE ? fs.readFileSync(process.env.GINA_B884_PREFIX_BUNDLE) : null;

// Same polling kicker as the other x76-page specs: runs onGinaLoaded once the framework is there.
const KICKER = '(function(){var t=0;function k(){try{if(window.gina&&window.gina.config'
    + '&&typeof window.onGinaLoaded===\'function\'&&!window.gina.isFrameworkLoaded){'
    + 'window.onGinaLoaded(window.gina);}}catch(e){}if((!window.gina||!window.gina.isFrameworkLoaded)'
    + '&&t++<100){setTimeout(k,50);}}k();}());';

// the live check validates a typed field 1 s after its last keyup
const LIVE_CHECK_WAIT = 1600;

/**
 * A page with one rule-bound form and a submit trigger.
 *
 * @param {string} formId
 * @param {string} rule - the rule set named by data-gina-form-rule
 * @param {string} fields - the form's controls (HTML)
 * @returns {string}
 */
function pageOf(formId, rule, fields) {
    return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>b884</title><link rel="icon" href="data:,">'
        + '<script src="/js/gina.onload.b884.js"></script><script src="/js/gina.min.js"></script>'
        + '<script>' + KICKER + '</script></head><body>'
        + '<form id="' + formId + '" method="post" action="/ac-sink" data-gina-form-rule="' + rule + '">'
        + fields
        + '<button type="submit" id="cluster-submit">Send</button>'
        + '</form></body></html>';
}

/**
 * Opens a page and waits for its form to be bound; counts the form's POSTs and the page errors.
 *
 * @param {object} page
 * @param {string} formId
 * @param {string} rule
 * @param {string} fields
 * @returns {Promise<{posts: Array, errors: Array}>}
 */
async function open(page, formId, rule, fields) {
    let hits = null;
    if (PREFIX_BUNDLE) {
        hits = { n: 0 };
        await page.route('**/js/gina.min.js', (r) => { hits.n++; r.fulfill({ status: 200, contentType: 'application/javascript', body: PREFIX_BUNDLE }); });
    }
    const out = { posts: [], errors: [] };
    page.on('request', (r) => { if (r.url().indexOf('/ac-sink') > -1 && r.method() === 'POST') { out.posts.push(1); } });
    page.on('pageerror', (e) => { out.errors.push(String(e && e.message)); });
    await page.goto(BASE + 'x76-page?b64=' + Buffer.from(pageOf(formId, rule, fields)).toString('base64url'));
    await page.waitForFunction((id) => !!(
        window.gina
        && window.gina.isFrameworkLoaded === true
        && window.gina.validator
        && window.gina.validator.$forms
        && window.gina.validator.$forms[id]
        && window.gina.validator.$forms[id].binded
    ), formId, { timeout: 15000 });
    if (hits) { expect(hits.n, 'the pre-fix bundle was served').toBeGreaterThan(0); }
    return out;
}

/** The trigger's gate, read in the page. */
function gate(page) {
    return page.evaluate(() => {
        var b = document.getElementById('cluster-submit');
        return { gated: b.getAttribute('data-gina-form-submit-gated'), disabledClass: b.classList.contains('gina-form-submit-disabled') };
    });
}

/** The names of the record's rules, read in the page. */
function ruleNames(page, formId) {
    return page.evaluate((id) => {
        var r = window.gina.validator.$forms[id].rules || {};
        return Object.keys(r).filter(function (k) { return typeof r[k] !== 'function'; }).sort();
    }, formId);
}

/** Types into a field without leaving it: keyup drives the live check, no blur. */
async function typeInto(page, sel, text) {
    await page.focus(sel);
    await page.keyboard.type(text, { delay: 30 });
}

const OPEN  = { gated: null, disabledClass: false };
const GATED = { gated: 'true', disabledClass: true };

const CASE_FIELDS = '<input type="text" id="ref-field" name="ref" value="">'
    + '<select id="kind-field" name="kind"><option value="a" selected>a</option><option value="b">b</option></select>'
    + '<input type="text" id="extra-field" name="extra" value="">';

test.describe('validator client fixes — #B884, #B880 + #B802, #B881, #B886', function () {

    test('01 - CONTROL: a field with its own rule — typing un-gates the trigger and the first click sends', async ({ page }) => {
        const run = await open(page, 'case-target-x', 'caseform', CASE_FIELDS);
        expect(await gate(page), 'gated at bind (ref is empty)').toEqual(GATED);
        await typeInto(page, '#ref-field', 'x');
        await page.waitForTimeout(LIVE_CHECK_WAIT);
        expect(await gate(page)).toEqual(OPEN);
        await page.click('#cluster-submit');
        await expect.poll(() => run.posts.length, { timeout: 5000 }).toBe(1);
        expect(run.errors).toEqual([]);
    });

    test('02 - #B884: a field a `_case_` makes required is live-checked — typing it un-gates the trigger and the first click sends', async ({ page }) => {
        const run = await open(page, 'case-target-x', 'caseform', CASE_FIELDS);
        await typeInto(page, '#ref-field', 'x');
        await page.waitForTimeout(LIVE_CHECK_WAIT);
        expect(await gate(page), 'open while the case does not apply').toEqual(OPEN);
        await page.selectOption('#kind-field', 'b');
        await page.waitForTimeout(LIVE_CHECK_WAIT);
        expect(await gate(page), 'the case applied: extra is required and empty').toEqual(GATED);
        await typeInto(page, '#extra-field', 'y');
        await page.waitForTimeout(LIVE_CHECK_WAIT);
        expect(await gate(page), 'typing the case-only field re-evaluated the gate').toEqual(OPEN);
        await page.click('#cluster-submit');
        await expect.poll(() => run.posts.length, { timeout: 5000 }).toBe(1);
        expect(run.errors).toEqual([]);
    });

    test('03 - #B880: a form invalid at bind writes no global `rule`', async ({ page }) => {
        await page.addInitScript(() => {
            window.__b880 = [];
            var v;
            Object.defineProperty(window, 'rule', {
                configurable: true,
                get: function () { return v; },
                set: function (x) { v = x; window.__b880.push(String(x)); }
            });
        });
        const run = await open(page, 'global-rule-x', 'acform', '<input type="text" id="ref-field" name="ref" value="">');
        expect(await gate(page), 'the bind-time validation found the error').toEqual(GATED);
        expect(await page.evaluate(() => window.__b880)).toEqual([]);
        expect(await page.evaluate(() => typeof window.rule)).toBe('undefined');
        expect(run.errors).toEqual([]);
    });

    test('04 - #B802: reBind(undefined, rules) applies the rule set it is handed, with no validation error on the page yet', async ({ page }) => {
        const run = await open(page, 'rebind-arg-x', 'acform',
            '<input type="text" id="ref-field" name="ref" value="x"><input type="text" id="note-field" name="note" value="">');
        expect(await ruleNames(page, 'rebind-arg-x')).toEqual(['ref']);
        await page.evaluate(() => { window.gina.validator.$forms['rebind-arg-x'].reBind(undefined, 'otherform'); });
        expect(await ruleNames(page, 'rebind-arg-x')).toEqual(['note']);
        expect(run.errors).toEqual([]);
    });

    test('05 - CONTROL: reBind(undefined, rules) after a validation error applies the rule set too', async ({ page }) => {
        const run = await open(page, 'rebind-arg-x', 'acform',
            '<input type="text" id="ref-field" name="ref" value=""><input type="text" id="note-field" name="note" value="">');
        await page.evaluate(() => { window.gina.validator.$forms['rebind-arg-x'].reBind(undefined, 'otherform'); });
        expect(await ruleNames(page, 'rebind-arg-x')).toEqual(['note']);
        expect(run.errors).toEqual([]);
    });

    test('06 - #B881: $forms[id].unbind() with no argument unbinds the handle\'s form', async ({ page }) => {
        const run = await open(page, 'unbind-x', 'acform', '<input type="text" id="ref-field" name="ref" value="">');
        const r = await page.evaluate(() => {
            var f = window.gina.validator.$forms['unbind-x'];
            try { f.unbind(); } catch (e) { return { threw: String(e && e.message).split('\n')[0] }; }
            return { threw: null, binded: window.gina.validator.$forms['unbind-x'].binded };
        });
        expect(r).toEqual({ threw: null, binded: false });
        expect(run.errors).toEqual([]);
    });

    for (const [type, value] of [['tel', '0612345678'], ['url', 'https://example.org'], ['search', 'abc']]) {
        test('07 - #B886: a required `' + type + '` field is live-checked — typing un-gates the trigger and the first click sends', async ({ page }) => {
            const run = await open(page, type + '-form-x', 'telform', '<input type="' + type + '" id="phone-field" name="phone" value="">');
            expect(await gate(page), 'gated at bind (the field is empty)').toEqual(GATED);
            await typeInto(page, '#phone-field', value);
            await page.waitForTimeout(LIVE_CHECK_WAIT);
            expect(await gate(page)).toEqual(OPEN);
            await page.click('#cluster-submit');
            await expect.poll(() => run.posts.length, { timeout: 5000 }).toBe(1);
            expect(run.errors).toEqual([]);
        });
    }

    test('08 - CONTROL: a required `text` field — typing un-gates the trigger and the first click sends', async ({ page }) => {
        const run = await open(page, 'text-form-x', 'telform', '<input type="text" id="phone-field" name="phone" value="">');
        expect(await gate(page)).toEqual(GATED);
        await typeInto(page, '#phone-field', '0612345678');
        await page.waitForTimeout(LIVE_CHECK_WAIT);
        expect(await gate(page)).toEqual(OPEN);
        await page.click('#cluster-submit');
        await expect.poll(() => run.posts.length, { timeout: 5000 }).toBe(1);
        expect(run.errors).toEqual([]);
    });
});
