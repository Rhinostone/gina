'use strict';

/**
 * Playwright RUNTIME e2e for the validator fixes #B885, #B913, #B914 and #B915 (the real built gina
 * bundle, real forms, real clicks).
 *
 *  - #B885 — validate() wrote into the rule set it was handed: a matching `_case_` condition's
 *    rules replaced the field's own, and nothing put them back when the driver changed again. The
 *    form refused a valid submit. Through the registry object the click and submit passes read, one
 *    form's case also reached another form bound to the same rule set.
 *  - #B913 — the same writes replaced an unchecked optional checkbox's rule with `{ exclude: true }`,
 *    so the checkbox ticked afterwards was left out of the posted data.
 *  - #B915 — the whole-form pass after a select change collected the form with the rule registry
 *    instead of the form's own rules, so a required radio group left unpicked was not collected, the
 *    pass read valid and the submit trigger opened.
 *  - #B914 — a radio or checkbox group required only through a `_case_` was collected only once an
 *    earlier pass had written the case rule into the stored rules, so the first click after the case
 *    applied posted without it (the select-driver shape with live check on was refused only because
 *    the live-check passes had already written it). A pass now enters such a group as '' where the
 *    case rule is applied, whatever ran before.
 *
 *   01 #B885 — kind a→b→a: the trigger opens and one click sends     (RED: gated, 0 sends)
 *   02 CONTROL — the same with a `$` in the rule set (it already validated on a copy)
 *   03 #B885 — live check off: back at kind a, the click sends       (RED: 0 sends)
 *   04 #B885 — two forms bound at boot: the last form's case does not refuse the other's click
 *                                                                     (RED: 0 sends)
 *   05 #B885 — two forms bound by bindRegion share one rule object: one form's case does not gate
 *      the other                                                      (RED: gated, 0 sends)
 *   06 #B913 — an optional boolean checkbox ticked after a pass is posted
 *                                                                     (RED: the body lacks it)
 *   07 CONTROL — the same checkbox left unticked is not posted
 *   08 #B914 — a select driver, live check on: refused until a member is picked
 *                                       (passes before the fix too: it guards the copy alone)
 *   09 #B914 — live check off: the first click is refused             (RED: the first click sends)
 *   10 #B914 — a radio driver with no rule: the first click is refused
 *                                                                     (RED: the first click sends)
 *   11 CONTROL — the case does not apply: the click sends, with no `choice` in the body
 *   12 #B914 — a value-carrying checkbox, live check off: the first click is refused
 *                                                                     (RED: the first click sends)
 *   13 #B915 — a select change keeps the trigger gated while a required radio group is unpicked
 *                                                                     (RED: the trigger opens)
 *
 * Scene: inline pages served by the runtime server (`/x76-page?b64=`) with the case-rules rules
 * whisper (`/js/gina.onload.b885.js`); submits go to /ac-sink, which answers {}.
 *
 * Pre-fix arm: `GINA_B885_PREFIX_BUNDLE=<path to a pre-fix gina.min.js>` serves that bundle to the
 * page instead of the working-tree dist.
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');

const PORT = process.env.GINA_E2E_PORT || '3179';
const BASE = 'http://localhost:' + PORT + '/';

// The subtract arm: the pre-fix bundle to serve, and a hit counter proving it was served.
const PREFIX_BUNDLE = process.env.GINA_B885_PREFIX_BUNDLE ? fs.readFileSync(process.env.GINA_B885_PREFIX_BUNDLE) : null;

// Same polling kicker as the other x76-page specs: runs onGinaLoaded once the framework is there.
const KICKER = '(function(){var t=0;function k(){try{if(window.gina&&window.gina.config'
    + '&&typeof window.onGinaLoaded===\'function\'&&!window.gina.isFrameworkLoaded){'
    + 'window.onGinaLoaded(window.gina);}}catch(e){}if((!window.gina||!window.gina.isFrameworkLoaded)'
    + '&&t++<100){setTimeout(k,50);}}k();}());';

// the live check validates a typed field 1 s after its last keyup; a select or a radio at once
const LIVE_CHECK_WAIT = 1600;

/**
 * One rule-bound form with a submit trigger; every id carries the form's suffix `n`.
 *
 * @param {number} n
 * @param {string} rule - the rule set named by data-gina-form-rule
 * @param {string} fields - the form's controls (HTML), with `{n}` standing for the suffix
 * @param {string} [attrs] - extra attributes for the <form>
 * @returns {string}
 */
function formOf(n, rule, fields, attrs) {
    return '<form id="b885-form-' + n + '" method="post" action="/ac-sink" data-gina-form-rule="' + rule + '"' + (attrs || '') + '>'
        + fields.replace(/\{n\}/g, String(n))
        + '<button type="submit" id="b885-submit-' + n + '">Send</button>'
        + '</form>';
}

/**
 * Opens a page holding `body` and waits for the forms `ids` to be bound; counts the POSTs to the
 * sink (with their bodies) and the page errors.
 *
 * @param {object} page
 * @param {string} body - the page body (HTML)
 * @param {Array<string>} ids - the form ids to wait for
 * @returns {Promise<{posts: Array<string>, errors: Array<string>}>}
 */
async function open(page, body, ids) {
    let hits = null;
    if (PREFIX_BUNDLE) {
        hits = { n: 0 };
        await page.route('**/js/gina.min.js', (r) => { hits.n++; r.fulfill({ status: 200, contentType: 'application/javascript', body: PREFIX_BUNDLE }); });
    }
    const out = { posts: [], errors: [] };
    page.on('request', (r) => { if (r.url().indexOf('/ac-sink') > -1 && r.method() === 'POST') { out.posts.push(String(r.postData() || '')); } });
    page.on('pageerror', (e) => { out.errors.push(String(e && e.message)); });
    const html = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>b885</title><link rel="icon" href="data:,">'
        + '<script src="/js/gina.onload.b885.js"></script><script src="/js/gina.min.js"></script>'
        + '<script>' + KICKER + '</script></head><body>' + body + '</body></html>';
    await page.goto(BASE + 'x76-page?b64=' + Buffer.from(html).toString('base64url'));
    await page.waitForFunction((list) => !!(
        window.gina
        && window.gina.isFrameworkLoaded === true
        && window.gina.validator
        && window.gina.validator.$forms
        && list.every(function (id) { return window.gina.validator.$forms[id] && window.gina.validator.$forms[id].binded; })
    ), ids, { timeout: 15000 });
    if (hits) { expect(hits.n, 'the pre-fix bundle was served').toBeGreaterThan(0); }
    return out;
}

/** The trigger's gate of form `n`, read in the page. */
function gate(page, n) {
    return page.evaluate((n) => {
        var b = document.getElementById('b885-submit-' + n);
        return { gated: b.getAttribute('data-gina-form-submit-gated'), disabledClass: b.classList.contains('gina-form-submit-disabled') };
    }, n);
}

/** Types into a field without leaving it: keyup drives the live check, no blur. */
async function typeInto(page, sel, text) {
    await page.focus(sel);
    await page.keyboard.type(text, { delay: 30 });
    await page.waitForTimeout(LIVE_CHECK_WAIT);
}

/** Clicks form `n`'s trigger and returns how many POSTs that click sent. */
async function clickSends(page, run, n) {
    const before = run.posts.length;
    await page.click('#b885-submit-' + n);
    await page.waitForTimeout(LIVE_CHECK_WAIT);
    return run.posts.length - before;
}

const OPEN  = { gated: null, disabledClass: false };
const GATED = { gated: 'true', disabledClass: true };

const CASE_FIELDS = '<input type="text" id="ref-{n}" name="ref" value="">'
    + '<select id="kind-{n}" name="kind"><option value="a" selected>a</option><option value="b">b</option></select>'
    + '<input type="text" id="extra-{n}" name="extra" value="">';
const CHECKBOX_FIELDS = '<input type="text" id="ref-{n}" name="ref" value="">'
    + '<input type="checkbox" id="agree-{n}" name="agree" value="true">';
const RADIO_FIELDS = '<input type="text" id="ref-{n}" name="ref" value="">'
    + '<select id="kind-{n}" name="kind"><option value="a" selected>a</option><option value="b">b</option></select>'
    + '<input type="radio" id="choice-x-{n}" name="choice" value="x"><input type="radio" id="choice-y-{n}" name="choice" value="y">';
const CHECKBOX_CASE_FIELDS = '<input type="text" id="ref-{n}" name="ref" value="">'
    + '<select id="kind-{n}" name="kind"><option value="a" selected>a</option><option value="b">b</option></select>'
    + '<input type="checkbox" id="choice-x-{n}" name="choice" value="x">';
const RADIO_DRIVER_FIELDS = '<input type="text" id="ref-{n}" name="ref" value="">'
    + '<input type="radio" id="mode-a-{n}" name="mode" value="a"><input type="radio" id="mode-b-{n}" name="mode" value="b">'
    + '<input type="radio" id="choice-x-{n}" name="choice" value="x"><input type="radio" id="choice-y-{n}" name="choice" value="y">';
const SELECT_FIELDS = '<input type="text" id="ref-{n}" name="ref" value="">'
    + '<input type="text" id="other-{n}" name="other" value="">'
    + '<select id="kind-{n}" name="kind"><option value="a" selected>a</option><option value="b">b</option></select>'
    + '<input type="radio" id="choice-x-{n}" name="choice" value="x"><input type="radio" id="choice-y-{n}" name="choice" value="y">';
const LIVE_CHECK_OFF = ' data-gina-form-live-check-enabled="false"';

test.describe('validator case rules — #B885, #B913, #B914, #B915', function () {

    for (const [num, label, rule] of [['01', '#B885', 'caseform'], ['02', 'CONTROL (a `$` in the rule set)', 'caseformdollar']]) {
        test(num + ' - ' + label + ': kind a→b→a — the trigger opens and one click sends', async ({ page }) => {
            const run = await open(page, formOf(1, rule, CASE_FIELDS), ['b885-form-1']);
            await typeInto(page, '#ref-1', 'x');
            expect(await gate(page, 1), 'open while the case does not apply').toEqual(OPEN);
            await page.selectOption('#kind-1', 'b');
            await page.waitForTimeout(LIVE_CHECK_WAIT);
            expect(await gate(page, 1), 'the case applied: extra is required and empty').toEqual(GATED);
            await page.selectOption('#kind-1', 'a');
            await page.waitForTimeout(LIVE_CHECK_WAIT);
            expect(await gate(page, 1), 'the case no longer applies').toEqual(OPEN);
            expect(await page.evaluate(() => JSON.stringify(window.gina.validator.$forms['b885-form-1'].rules.extra)),
                'the bound rule set still holds extra\'s own rule').toBe('{"isRequired":false}');
            expect(await clickSends(page, run, 1)).toBe(1);
            expect(run.errors).toEqual([]);
        });
    }

    test('03 - #B885: live check off — back at kind a, the click sends', async ({ page }) => {
        const run = await open(page, formOf(1, 'caseform', CASE_FIELDS, LIVE_CHECK_OFF), ['b885-form-1']);
        await typeInto(page, '#ref-1', 'x');
        await page.selectOption('#kind-1', 'b');
        expect(await clickSends(page, run, 1), 'at kind b, extra is required and empty').toBe(0);
        await page.selectOption('#kind-1', 'a');
        expect(await clickSends(page, run, 1), 'at kind a, extra is optional again').toBe(1);
        expect(run.errors).toEqual([]);
    });

    test('04 - #B885: two forms bound at boot — the last form\'s case does not refuse the other\'s click', async ({ page }) => {
        const run = await open(page, formOf(1, 'caseform', CASE_FIELDS) + formOf(2, 'caseform', CASE_FIELDS), ['b885-form-1', 'b885-form-2']);
        await typeInto(page, '#ref-2', 'x');
        await page.selectOption('#kind-2', 'b');
        await page.waitForTimeout(LIVE_CHECK_WAIT);
        expect(await gate(page, 2), 'form 2 at kind b').toEqual(GATED);
        await typeInto(page, '#ref-1', 'x');
        expect(await gate(page, 1), 'form 1 at kind a').toEqual(OPEN);
        expect(await clickSends(page, run, 1), 'form 1 is valid at kind a').toBe(1);
        expect(run.errors).toEqual([]);
    });

    test('05 - #B885: two forms bound by bindRegion — one form\'s case does not gate the other', async ({ page }) => {
        // a form bound at boot, so the validator is up before the region is bound
        const run = await open(page, formOf(9, 'cbform', CHECKBOX_FIELDS) + '<div id="region"></div>', ['b885-form-9']);
        const bound = await page.evaluate((html) => {
            var $r = document.getElementById('region');
            $r.innerHTML = html;
            return window.gina.validator.bindRegion($r);
        }, formOf(3, 'caseform', CASE_FIELDS) + formOf(4, 'caseform', CASE_FIELDS));
        expect(bound).toBe(2);
        expect(await page.evaluate(() => window.gina.validator.$forms['b885-form-3'].rules === window.gina.validator.$forms['b885-form-4'].rules),
            'forms bound after boot share the registry rule object').toBe(true);
        await typeInto(page, '#ref-3', 'x');
        await page.selectOption('#kind-3', 'b');
        await page.waitForTimeout(LIVE_CHECK_WAIT);
        expect(await gate(page, 3), 'form 3 at kind b').toEqual(GATED);
        await typeInto(page, '#ref-4', 'x');
        expect(await gate(page, 4), 'form 4 at kind a').toEqual(OPEN);
        expect(await clickSends(page, run, 4)).toBe(1);
        expect(run.errors).toEqual([]);
    });

    for (const [num, label, tick] of [['06', '#B913: ticked after a pass, it is posted', true], ['07', 'CONTROL: left unticked, it is not posted', false]]) {
        test(num + ' - ' + label, async ({ page }) => {
            const run = await open(page, formOf(1, 'cbform', CHECKBOX_FIELDS), ['b885-form-1']);
            await typeInto(page, '#ref-1', 'x');
            if (tick) {
                await page.check('#agree-1');
                await page.waitForTimeout(LIVE_CHECK_WAIT);
            }
            expect(await clickSends(page, run, 1)).toBe(1);
            expect(JSON.parse(run.posts[0])).toEqual(tick ? { ref: 'x', agree: true } : { ref: 'x' });
            expect(run.errors).toEqual([]);
        });
    }

    for (const [num, label, rule, fields, attrs, setDriver] of [
        ['08', 'a select driver, live check on', 'radioform', RADIO_FIELDS, '', (page) => page.selectOption('#kind-1', 'b')],
        ['09', 'live check off', 'radioform', RADIO_FIELDS, LIVE_CHECK_OFF, (page) => page.selectOption('#kind-1', 'b')],
        ['10', 'a radio driver with no rule', 'radiodriverform', RADIO_DRIVER_FIELDS, '', (page) => page.check('#mode-b-1')],
        ['12', 'a value-carrying checkbox, live check off', 'radioform', CHECKBOX_CASE_FIELDS, LIVE_CHECK_OFF, (page) => page.selectOption('#kind-1', 'b')]
    ]) {
        test(num + ' - #B914: ' + label + ' — the first click is refused until a member is picked', async ({ page }) => {
            const run = await open(page, formOf(1, rule, fields, attrs), ['b885-form-1']);
            await typeInto(page, '#ref-1', 'x');
            await setDriver(page);
            await page.waitForTimeout(LIVE_CHECK_WAIT);
            expect(await clickSends(page, run, 1), 'the case requires choice, which is unpicked').toBe(0);
            expect(await page.evaluate(() => document.getElementById('choice-x-1').getAttribute('data-gina-form-errors')),
                'the group carries its error').toBe('isRequired');
            await page.check('#choice-x-1');
            await page.waitForTimeout(LIVE_CHECK_WAIT);
            expect(await clickSends(page, run, 1), 'picked').toBe(1);
            expect(JSON.parse(run.posts[0]).choice).toBe('x');
            expect(run.errors).toEqual([]);
        });
    }

    test('11 - CONTROL: the case does not apply — the click sends, with no `choice` in the body', async ({ page }) => {
        const run = await open(page, formOf(1, 'radioform', RADIO_FIELDS), ['b885-form-1']);
        await typeInto(page, '#ref-1', 'x');
        expect(await clickSends(page, run, 1)).toBe(1);
        expect(JSON.parse(run.posts[0])).toEqual({ ref: 'x', kind: 'a' });
        expect(run.errors).toEqual([]);
    });

    test('13 - #B915: a select change keeps the trigger gated while a required radio group is unpicked', async ({ page }) => {
        const run = await open(page, formOf(1, 'selform', SELECT_FIELDS), ['b885-form-1']);
        await typeInto(page, '#ref-1', 'x');
        expect(await gate(page, 1), 'choice is required and unpicked').toEqual(GATED);
        await page.selectOption('#kind-1', 'b');
        await page.waitForTimeout(LIVE_CHECK_WAIT);
        expect(await gate(page, 1), 'the select\'s whole-form check still sees the unpicked group').toEqual(GATED);
        expect(await clickSends(page, run, 1), 'nothing is sent while the group is unpicked').toBe(0);
        await page.check('#choice-x-1');
        await page.waitForTimeout(LIVE_CHECK_WAIT);
        expect(await gate(page, 1), 'picked').toEqual(OPEN);
        expect(await clickSends(page, run, 1)).toBe(1);
        expect(JSON.parse(run.posts[0]).choice).toBe('x');
        expect(run.errors).toEqual([]);
    });
});
