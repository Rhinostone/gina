'use strict';

/**
 * Playwright RUNTIME e2e for the validator fix #B931 (the real built gina bundle, real forms, a real
 * popin, real clicks).
 *
 * Every form bound to one rule set shared one rule object, and the submit and click passes resolved
 * the rules by name again: the state a binding derived from its own markup and wrote into its rules
 * (`exclude` on a `data-gina-form-element-group` member, `isBoolean` on a boolean checkbox) reached
 * every other form bound to the same set. Each form now holds its own copy, and the passes validate
 * with it.
 *
 *   01 #B931 — a popin loads form A (its grouped hidden `rows[1][id]` under an unticked master), an
 *      in-dialog link swaps in form B under the SAME id, where `rows[1][id]` is the master checkbox,
 *      ticked: B posts `rows[1][id]`                                    (RED: posted without it)
 *   02 #B931 — the same with A's members enabled (no master in A)        (RED on develop)
 *   03 #B931 — one page, A then B, two ids, one rule set: B posts it     (RED)
 *   04 #B931 — one page, B then A: B posts it                            (RED)
 *   05 #B931 — A holds a valueless checkbox `flag`; B's `flag` carries a value and is ticked: B posts
 *      the value, not `true`                                             (RED: posted `true`)
 *   06 CONTROL — B alone posts it
 *   07 CONTROL — A then B under two different rule sets posts it (the shape a consumer could use meanwhile)
 *   08 CONTROL — A's own grouped members: absent under an unticked master, posted once it is ticked (the
 *      per-form toggles still work on the copy)
 *   09 CONTROL — a required valueless checkbox unticked posts `false` and the submit passes (the
 *      collector's `isBoolean` write the pass must still see)
 *
 * Scene: inline pages served by the runtime server (`/x76-page?b64=`) with the whisper
 * (`/js/gina.onload.b931.js`: rule sets `shared`, `other`, `boolreq`); the popin is registered WITH the
 * validator and opened through a legacy trigger (the path that binds a popin's forms), its fragments
 * are page.route'd; submits go to /ac-sink, which answers {}.
 *
 * Pre-fix arm: `GINA_B931_PREFIX_BUNDLE=<path to a pre-fix gina.min.js>` serves that bundle to the
 * page instead of the working-tree dist (01 to 05 fail there, the controls pass).
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');

const PORT = process.env.GINA_E2E_PORT || '3179';
const BASE = 'http://localhost:' + PORT + '/';

// The subtract arm: the pre-fix bundle to serve, and a hit counter proving it was served.
const PREFIX_BUNDLE = process.env.GINA_B931_PREFIX_BUNDLE ? fs.readFileSync(process.env.GINA_B931_PREFIX_BUNDLE) : null;

// Same polling kicker as the other x76-page specs: runs onGinaLoaded once the framework is there.
const KICKER = '(function(){var t=0;function k(){try{if(window.gina&&window.gina.config'
    + '&&typeof window.onGinaLoaded===\'function\'&&!window.gina.isFrameworkLoaded){'
    + 'window.onGinaLoaded(window.gina);}}catch(e){}if((!window.gina||!window.gina.isFrameworkLoaded)'
    + '&&t++<100){setTimeout(k,50);}}k();}());';

const SETTLE = 600;

/**
 * Form A: `rows[1][id]` and `rows[1][amount]` are hidden members of the group `rows-1-group-1`; with
 * `master`, A carries that master as an unticked checkbox under another name (its members disabled
 * at bind), without it the members are enabled.
 *
 * @param {string} id - the form id
 * @param {string} rule - the rule set
 * @param {boolean} master - whether A holds the group's master
 * @returns {string}
 */
function formA(id, rule, master) {
    return '<form id="' + id + '" data-gina-form-rule="' + rule + '" action="/ac-sink" method="post">'
        + '<input type="text" name="ref" value="r">'
        + (master ? '<input type="checkbox" id="rows-1-group-1" name="rows[1][on]" value="yes">' : '')
        + '<input type="hidden" name="rows[1][id]" value="77" data-gina-form-element-group="rows-1-group-1">'
        + '<input type="hidden" name="rows[1][amount]" value="10" data-gina-form-element-group="rows-1-group-1">'
        + '<button type="submit" id="' + id + '-submit">Save</button>'
        + '</form>';
}

/**
 * Form B: `rows[1][id]` IS the group's master checkbox (value `77`, ticked); the members are hidden.
 *
 * @param {string} id
 * @param {string} rule
 * @returns {string}
 */
function formB(id, rule) {
    return '<form id="' + id + '" data-gina-form-rule="' + rule + '" action="/ac-sink" method="post">'
        + '<input type="text" name="ref" value="r">'
        + '<input type="checkbox" id="' + id + '-master" name="rows[1][id]" value="77" checked>'
        + '<input type="hidden" name="rows[1][amount]" value="10" data-gina-form-element-group="' + id + '-master">'
        + '<input type="hidden" name="rows[1][label]" value="x" data-gina-form-element-group="' + id + '-master">'
        + '<button type="submit" id="' + id + '-submit">Save</button>'
        + '</form>';
}

/** Form A for arm 05: a valueless (boolean) checkbox `flag`. */
function formABool(id) {
    return '<form id="' + id + '" data-gina-form-rule="shared" action="/ac-sink" method="post">'
        + '<input type="text" name="ref" value="r"><input type="checkbox" name="flag">'
        + '<button type="submit" id="' + id + '-submit">Save</button></form>';
}

/** Form B for arm 05: `flag` carries a value and is ticked. */
function formBValue(id) {
    return '<form id="' + id + '" data-gina-form-rule="shared" action="/ac-sink" method="post">'
        + '<input type="text" name="ref" value="r"><input type="checkbox" name="flag" value="77" checked>'
        + '<button type="submit" id="' + id + '-submit">Save</button></form>';
}

/** Arm 09: a required valueless checkbox, unticked. */
function formBoolReq(id) {
    return '<form id="' + id + '" data-gina-form-rule="boolreq" action="/ac-sink" method="post">'
        + '<input type="text" name="ref" value="r"><input type="checkbox" id="agree-1" name="agree">'
        + '<button type="submit" id="' + id + '-submit">Save</button></form>';
}

/**
 * Opens a page holding `body` and, with `frags`, routes the popin fragments; counts the POSTs to the
 * sink (with their bodies) and the page errors.
 *
 * @param {object} page
 * @param {string} body - the page body's HTML
 * @param {object} [frags] - `{ '<name>.html': <html> }`, served at /frag/<name>.html
 * @returns {Promise<{posts: Array<string>, errors: Array<string>}>}
 */
async function open(page, body, frags) {
    let hits = null;
    if (PREFIX_BUNDLE) {
        hits = { n: 0 };
        await page.route('**/js/gina.min.js', (r) => { hits.n++; r.fulfill({ status: 200, contentType: 'application/javascript', body: PREFIX_BUNDLE }); });
    }
    const out = { posts: [], errors: [] };
    page.on('request', (r) => { if (r.url().indexOf('/ac-sink') > -1 && r.method() === 'POST') { out.posts.push(String(r.postData() || '')); } });
    page.on('pageerror', (e) => { out.errors.push(String(e && e.message)); });
    for (const name of Object.keys(frags || {})) {
        await page.route('**/frag/' + name, (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: frags[name] }));
    }
    const html = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>b931</title><link rel="icon" href="data:,">'
        + '<link rel="stylesheet" href="/css/vendor/gina/gina.min.css">'
        + '<script src="/js/gina.onload.b931.js"></script><script src="/js/gina.min.js"></script>'
        + '<script>' + KICKER + '</script></head><body>' + body + '</body></html>';
    await page.goto(BASE + 'x76-page?b64=' + Buffer.from(html).toString('base64url'));
    await page.waitForFunction(() => !!(window.gina && window.gina.isFrameworkLoaded === true && window.gina.validator && window.gina.validator.$forms), null, { timeout: 15000 });
    if (hits) { expect(hits.n, 'the pre-fix bundle was served').toBeGreaterThan(0); }
    return out;
}

/** The legacy trigger for the popin `swp`, loading /frag/a.html at click time. */
const TRIGGER = '<button data-gina-popin-name="swp" data-gina-popin-url="/frag/a.html" data-gina-dialog-preload="false">Open</button>';

/** Registers the popin `swp` with the validator. */
async function registerPopin(page) {
    const reg = await page.evaluate(() => new Promise((resolve) => {
        setTimeout(() => resolve('TIMEOUT'), 8000);
        window.require(['gina/popin'], function (Popin) {
            new Popin({ name: 'swp', validator: window.gina.validator }).on('ready', function () { resolve('READY'); });
        });
    }));
    expect(reg, 'popin swp must register').toBe('READY');
}

/** Opens the popin on fragment A, then swaps in fragment B through the in-dialog link. */
async function openAThenB(page) {
    await page.click('[data-gina-popin-name="swp"]');
    await page.waitForFunction(() => !!document.getElementById('fa'), null, { timeout: 8000 });
    await page.waitForTimeout(SETTLE);
    await page.click('#fa a');
    await page.waitForFunction(() => !!document.getElementById('fb'), null, { timeout: 8000 });
    await page.waitForTimeout(SETTLE);
}

/** Waits for the form to be bound. */
async function bound(page, id) {
    await page.waitForFunction((fid) => !!(window.gina.validator.$forms[fid] && window.gina.validator.$forms[fid].binded), id, { timeout: 8000 });
    await page.waitForTimeout(SETTLE);
}

/**
 * Clicks the form's submit control and reports how many POSTs went out and the last body.
 *
 * @param {object} page
 * @param {{posts: Array<string>}} run
 * @param {string} id - the form id
 * @returns {Promise<{sent: number, body: object|null}>}
 */
async function send(page, run, id) {
    const before = run.posts.length;
    await page.click('#' + id + '-submit', { timeout: 3000 });
    await page.waitForTimeout(1500);
    const sent = run.posts.length - before;
    return { sent, body: sent ? JSON.parse(run.posts[run.posts.length - 1]) : null };
}

/** The popin swap under one id: A (with or without its master) then B. */
function swapFrags(master, aRule, bRule) {
    return {
        'a.html': '<div id="fa">' + formA('groupform', aRule || 'shared', master) + '<a href="/frag/b.html">Edit</a></div>',
        'b.html': '<div id="fb">' + formB('groupform', bRule || 'shared') + '</div>'
    };
}

test.describe('#B931 — a form\'s rules are its own copy', function () {

    test('01 #B931 — popin swap under one id, A\'s members disabled by an unticked master: B posts rows[1][id]', async ({ page }) => {
        const run = await open(page, TRIGGER, swapFrags(true));
        await registerPopin(page);
        await openAThenB(page);
        const r = await send(page, run, 'groupform');
        expect(run.errors, 'no page error').toEqual([]);
        expect(r.sent).toBe(1);
        expect(r.body.rows[1].id, 'the ticked master checkbox is posted').toBe('77');
        expect(r.body.rows[1].amount).toBe('10');
    });

    test('02 #B931 — popin swap under one id, A\'s members enabled: B posts rows[1][id]', async ({ page }) => {
        const run = await open(page, TRIGGER, swapFrags(false));
        await registerPopin(page);
        await openAThenB(page);
        const r = await send(page, run, 'groupform');
        expect(run.errors, 'no page error').toEqual([]);
        expect(r.sent).toBe(1);
        expect(r.body.rows[1].id).toBe('77');
    });

    test('03 #B931 — one page, A then B, two ids, one rule set: B posts rows[1][id]', async ({ page }) => {
        const run = await open(page, formA('grpa', 'shared', true) + formB('grpb', 'shared'));
        await bound(page, 'grpb');
        const r = await send(page, run, 'grpb');
        expect(run.errors, 'no page error').toEqual([]);
        expect(r.sent).toBe(1);
        expect(r.body.rows[1].id).toBe('77');
    });

    test('04 #B931 — one page, B then A: B posts rows[1][id]', async ({ page }) => {
        const run = await open(page, formB('grpb', 'shared') + formA('grpa', 'shared', true));
        await bound(page, 'grpa');
        const r = await send(page, run, 'grpb');
        expect(run.errors, 'no page error').toEqual([]);
        expect(r.sent).toBe(1);
        expect(r.body.rows[1].id).toBe('77');
    });

    test('05 #B931 — A\'s valueless `flag`, then B\'s value-carrying `flag` ticked: B posts the value', async ({ page }) => {
        const run = await open(page, TRIGGER, {
            'a.html': '<div id="fa">' + formABool('groupform') + '<a href="/frag/b.html">Edit</a></div>',
            'b.html': '<div id="fb">' + formBValue('groupform') + '</div>'
        });
        await registerPopin(page);
        await openAThenB(page);
        const r = await send(page, run, 'groupform');
        expect(run.errors, 'no page error').toEqual([]);
        expect(r.sent).toBe(1);
        expect(r.body.flag, 'the value, not the other form\'s boolean').toBe('77');
    });

    test('06 CONTROL — B alone posts rows[1][id]', async ({ page }) => {
        const run = await open(page, formB('grpb', 'shared'));
        await bound(page, 'grpb');
        const r = await send(page, run, 'grpb');
        expect(run.errors, 'no page error').toEqual([]);
        expect(r.sent).toBe(1);
        expect(r.body.rows[1].id).toBe('77');
    });

    test('07 CONTROL — popin swap, A and B under two different rule sets: B posts rows[1][id]', async ({ page }) => {
        const run = await open(page, TRIGGER, swapFrags(true, 'shared', 'other'));
        await registerPopin(page);
        await openAThenB(page);
        const r = await send(page, run, 'groupform');
        expect(run.errors, 'no page error').toEqual([]);
        expect(r.sent).toBe(1);
        expect(r.body.rows[1].id).toBe('77');
    });

    test('08 CONTROL — A\'s own grouped members: absent under an unticked master, posted once ticked', async ({ page }) => {
        const run = await open(page, formA('grpa', 'shared', true));
        await bound(page, 'grpa');
        const r1 = await send(page, run, 'grpa');
        expect(run.errors, 'no page error').toEqual([]);
        expect(r1.sent).toBe(1);
        expect(r1.body.rows, 'the disabled members are absent').toBeUndefined();
        await page.click('#rows-1-group-1');
        await page.waitForTimeout(SETTLE);
        const r2 = await send(page, run, 'grpa');
        expect(r2.sent).toBe(1);
        expect(r2.body.rows[1].id).toBe('77');
        expect(r2.body.rows[1].amount).toBe('10');
        expect(r2.body.rows[1].on).toBe('yes');
    });

    test('09 CONTROL — a required valueless checkbox unticked posts false and the submit passes', async ({ page }) => {
        const run = await open(page, formBoolReq('boolform'));
        await bound(page, 'boolform');
        const r = await send(page, run, 'boolform');
        expect(run.errors, 'no page error').toEqual([]);
        expect(r.sent).toBe(1);
        expect(r.body.agree).toBe(false);
    });
});
