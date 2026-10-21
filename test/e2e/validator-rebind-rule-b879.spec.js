'use strict';

/**
 * Playwright RUNTIME e2e for #B879 — `reBind()` keeps the rule set a form names with
 * `data-gina-form-rule`, so typing still re-evaluates the submit trigger's gate (the real built
 * gina bundle, a real form, real keystrokes).
 *
 * The defect: a bind given no rule looked the form's rule set up by the form's id only. The first
 * bind is handed the `data-gina-form-rule` rule by its caller, but `reBind()` re-binds with no
 * rule — and so do `.bind()` and `getFormById()` on an unbound form — so a form whose id names no
 * rule set was re-bound with an EMPTY rule set: no field live-checked, no bind-time silent
 * validation, and the trigger kept the gated mark of the previous bind, refusing the first click
 * on a valid form. Until 0.7.4 the previous bind's listeners stayed attached across a `reBind()`
 * and could hide it; #B585 detaches them, so nothing re-evaluates the gate any more.
 *
 * Why the #B585 e2e could not see it: its form's id names its rule set (`acform`), and it fills
 * fields with `fill()` (an `input` event, which the live check does not listen to) and never reads
 * the gate after typing. Here the form's id names NO rule set, the fields are TYPED
 * (`keyboard.type`, no blur), and the gate is read after the re-bind.
 *
 *   01 CONTROL — no re-bind: typing un-gates the trigger (the first bind live-checks the field)
 *   02 type, then reBind(): read in the same task, the rule set is kept and the trigger is open
 *                                                        (RED before the fix: 0 rules, gated)
 *   03 reBind() on the empty form, then type: the trigger un-gates     (RED: it stays gated)
 *   04 type, reBind(), type a second field, click at once: the first click sends (RED: 0 sends)
 *   05 unbind(form) then .bind() with no argument, and unbind(form) then getFormById(): the rule
 *      set is kept                                                    (RED: 0 rules, both paths)
 *   06 CONTROL — a form whose id names its rule set: reBind() keeps it (green on both sides)
 *
 * Scene: an inline page served by the runtime server (`/x76-page?b64=`), the `acform` rules
 * whisper (`ref` isRequired), sink /ac-sink answers {}.
 *
 * Pre-fix arm: `GINA_B879_PREFIX_BUNDLE=<path to a pre-fix gina.min.js>` serves that bundle to the
 * page instead of the working-tree dist. Measured on the published 0.7.4 bundle (2026-10-15):
 * 02, 03, 04 and 05 red, 01 and 06 green.
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');

const PORT = process.env.GINA_E2E_PORT || '3179';
const BASE = 'http://localhost:' + PORT + '/';

// The subtract arm: the pre-fix bundle to serve, and a hit counter proving it was served.
const PREFIX_BUNDLE = process.env.GINA_B879_PREFIX_BUNDLE ? fs.readFileSync(process.env.GINA_B879_PREFIX_BUNDLE) : null;

// Same polling kicker as the other x76-page specs: runs onGinaLoaded once the framework is there.
const KICKER = '(function(){var t=0;function k(){try{if(window.gina&&window.gina.config'
    + '&&typeof window.onGinaLoaded===\'function\'&&!window.gina.isFrameworkLoaded){'
    + 'window.onGinaLoaded(window.gina);}}catch(e){}if((!window.gina||!window.gina.isFrameworkLoaded)'
    + '&&t++<100){setTimeout(k,50);}}k();}());';

const RULE     = 'acform';         // the rules whisper's set: { ref: { isRequired: true } }
const OTHER_ID = 'rebind-target';  // an id that names no rule set

/**
 * A page with one rule-bound form: `ref` (required by the rule set), `note` (no rule) and a submit
 * trigger. The form takes its rule set from `data-gina-form-rule`; its id is the variable.
 *
 * @param {string} formId
 * @returns {string}
 */
function pageOf(formId) {
    return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>b879</title><link rel="icon" href="data:,">'
        + '<script src="/js/gina.onload.autocomplete.js"></script><script src="/js/gina.min.js"></script>'
        + '<script>' + KICKER + '</script></head><body>'
        + '<form id="' + formId + '" method="post" action="/ac-sink" data-gina-form-rule="' + RULE + '">'
        + '<input type="text" id="ref-field" name="ref" value="">'
        + '<input type="text" id="note-field" name="note" value="">'
        + '<button type="submit" id="rebind-submit">Send</button>'
        + '</form></body></html>';
}

/**
 * Opens the page and waits for the form to be bound; counts the form's POSTs.
 *
 * @param {object} page
 * @param {string} formId
 * @returns {Promise<Array>} the POST log
 */
async function open(page, formId) {
    let hits = null;
    if (PREFIX_BUNDLE) {
        hits = { n: 0 };
        await page.route('**/js/gina.min.js', (r) => { hits.n++; r.fulfill({ status: 200, contentType: 'application/javascript', body: PREFIX_BUNDLE }); });
    }
    const posts = [];
    page.on('request', (r) => { if (r.url().indexOf('/ac-sink') > -1 && r.method() === 'POST') { posts.push(1); } });
    await page.goto(BASE + 'x76-page?b64=' + Buffer.from(pageOf(formId)).toString('base64url'));
    await page.waitForFunction((id) => !!(
        window.gina
        && window.gina.isFrameworkLoaded === true
        && window.gina.validator
        && window.gina.validator.$forms
        && window.gina.validator.$forms[id]
        && window.gina.validator.$forms[id].binded
    ), formId, { timeout: 15000 });
    if (hits) { expect(hits.n, 'the pre-fix bundle was served').toBeGreaterThan(0); }
    return posts;
}

/** The record's rule count and the trigger's gate, read in the page. */
function state(page, formId) {
    return page.evaluate((id) => {
        var r = window.gina.validator.$forms[id].rules || {};
        var b = document.getElementById('rebind-submit');
        return {
            rules: Object.keys(r).filter(function (k) { return typeof r[k] !== 'function'; }).length,
            gated: b.getAttribute('data-gina-form-submit-gated'),
            disabledClass: b.classList.contains('gina-form-submit-disabled')
        };
    }, formId);
}

/** Types into a field without leaving it: keyup drives the live check, no blur. */
async function typeInto(page, sel, text) {
    await page.focus(sel);
    await page.keyboard.type(text, { delay: 30 });
}

// the live check validates a typed field 1 s after its last keyup
const LIVE_CHECK_WAIT = 1600;

test.describe('#B879 — reBind() keeps the rule set named by data-gina-form-rule', function () {

    test('01 - CONTROL: without a re-bind, typing un-gates the trigger', async ({ page }) => {
        await open(page, OTHER_ID);
        const s0 = await state(page, OTHER_ID);
        expect(s0.rules, 'the first bind took the rule set from data-gina-form-rule').toBeGreaterThan(0);
        expect(s0.gated, 'the empty required field gates the trigger').toBe('true');
        await typeInto(page, '#ref-field', 'abc');
        await page.waitForTimeout(LIVE_CHECK_WAIT);
        const s1 = await state(page, OTHER_ID);
        expect(s1.gated).toBeNull();
        expect(s1.disabledClass).toBe(false);
    });

    test('02 - type, then reBind(): the rule set is kept and the trigger opens in the same task', async ({ page }) => {
        await open(page, OTHER_ID);
        await typeInto(page, '#ref-field', 'abc');
        await page.waitForTimeout(300);
        const s = await page.evaluate((id) => {
            window.gina.validator.$forms[id].reBind();
            var r = window.gina.validator.$forms[id].rules || {};
            var b = document.getElementById('rebind-submit');
            return {
                rules: Object.keys(r).filter(function (k) { return typeof r[k] !== 'function'; }).length,
                gated: b.getAttribute('data-gina-form-submit-gated')
            };
        }, OTHER_ID);
        expect(s.rules, 'the re-bind kept the rule set').toBeGreaterThan(0);
        expect(s.gated, 'the re-bind validated the form and opened the trigger').toBeNull();
    });

    test('03 - reBind() on the empty form, then type: typing still un-gates the trigger', async ({ page }) => {
        await open(page, OTHER_ID);
        await page.evaluate((id) => { window.gina.validator.$forms[id].reBind(); }, OTHER_ID);
        const s0 = await state(page, OTHER_ID);
        expect(s0.gated, 'still gated: the required field is empty').toBe('true');
        await typeInto(page, '#ref-field', 'abc');
        await page.waitForTimeout(LIVE_CHECK_WAIT);
        const s1 = await state(page, OTHER_ID);
        expect(s1.rules).toBeGreaterThan(0);
        expect(s1.gated, 'typing re-evaluated the gate').toBeNull();
        expect(s1.disabledClass).toBe(false);
    });

    test('04 - type, reBind(), type a second field, click at once: the first click sends', async ({ page }) => {
        const posts = await open(page, OTHER_ID);
        await typeInto(page, '#ref-field', 'abc');
        await page.waitForTimeout(300);
        await page.evaluate((id) => { window.gina.validator.$forms[id].reBind(); }, OTHER_ID);
        await typeInto(page, '#note-field', 'x');
        await page.click('#rebind-submit');
        await page.waitForTimeout(1500);
        expect(posts.length, 'one send from the first click').toBe(1);
    });

    test('05 - unbind(form) then .bind(), and unbind(form) then getFormById(): the rule set is kept', async ({ page }) => {
        await open(page, OTHER_ID);
        const s = await page.evaluate((id) => {
            var count = function () {
                var r = window.gina.validator.$forms[id].rules || {};
                return Object.keys(r).filter(function (k) { return typeof r[k] !== 'function'; }).length;
            };
            var f = window.gina.validator.$forms[id];
            var out = { before: count() };
            f.unbind(f.target);
            f.bind();
            out.afterBind = count();
            f.unbind(f.target);
            window.gina.validator.getFormById(id);
            out.afterGetFormById = count();
            out.binded = window.gina.validator.$forms[id].binded;
            return out;
        }, OTHER_ID);
        expect(s.before).toBeGreaterThan(0);
        expect(s.afterBind, '.bind() with no argument kept the rule set').toBe(s.before);
        expect(s.afterGetFormById, 'getFormById() on the unbound form kept the rule set').toBe(s.before);
        expect(s.binded).toBe(true);
    });

    test('06 - CONTROL: a form whose id names its rule set keeps it across reBind()', async ({ page }) => {
        await open(page, RULE);
        await typeInto(page, '#ref-field', 'abc');
        await page.waitForTimeout(300);
        await page.evaluate((id) => { window.gina.validator.$forms[id].reBind(); }, RULE);
        const s = await state(page, RULE);
        expect(s.rules).toBeGreaterThan(0);
        expect(s.gated).toBeNull();
    });
});
