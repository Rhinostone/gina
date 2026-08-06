'use strict';

/**
 * Playwright RUNTIME e2e for #B298 — a legacy popin trigger that gina has armed for the
 * duration of its own load must not dispatch a second time (the real built bundle, real
 * pointer clicks, real XHRs).
 *
 * `armPopinTrigger` marks an `<a>` trigger `aria-disabled="true"` while its popin loads
 * (and every other tag with the native `disabled`). But the only dispatch route for a
 * pure-legacy `data-gina-popin-name` trigger is the document click proxy, whose predicate
 * tests the native attribute ALONE — which an `<a>` never carries here. So the second
 * click got through and issued a SECOND XHR. `bindDelegatedOpen` returns early for a
 * pure-legacy trigger, so `openFromTrigger`'s own `aria-disabled` arm never covered it.
 *
 * The fix gates at the top of the legacy per-element open handler, reading
 * `e.currentTarget`. Arm 02 is why it lives THERE and not in the proxy: a trigger's direct
 * children each get their own listener from `proxyClick`, which fires the custom event
 * directly and never passes the proxy predicate — measured, a proxy-level gate still let
 * the child-click route fire twice.
 *
 * WHY test/e2e AND NOT test/core: the defect is a timing interaction between gina's own
 * in-flight arming and its dispatch predicate, observable only when the real bundle
 * handles real clicks against a load that is still outstanding. A replica cannot catch it.
 *
 * SCENE NOTE — two things make or break this harness, both learned by measurement:
 *   - `bindOpen` is NOT delegated: it `querySelectorAll`s at bind time, so a legacy
 *     trigger MUST be in the served HTML. A dynamically injected one is never bound.
 *     The page is therefore route-intercepted rather than injected into.
 *   - `data-gina-dialog-preload="false"` is REQUIRED. A real click hovers first, which
 *     warms the preload (warmTrigger reads `data-gina-popin-url` too), and the click then
 *     ADOPTS that in-flight fetch instead of calling popinLoad — so nothing is ever armed
 *     and the whole question goes unasked. Without this attribute every arm reads 1
 *     request for a reason that has nothing to do with the gate.
 *
 * Arms (one variable each; 03 and 04 are controls for 01/02):
 *   01 <a>, 2nd click during load        -> exactly 1 request (RED before the fix: 2)
 *   02 <a> with child markup, click CHILD-> exactly 1 request (RED before the fix: 2)
 *   03 <a>, single click                 -> 1 request + popin opens (the gate must not
 *                                           break the normal path)
 *   04 <button>, 2nd click during load   -> 1 request, and only ONE click reaches JS —
 *                                           the browser suppresses it natively, so this
 *                                           arm is unchanged by the fix
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const PORT = process.env.GINA_E2E_PORT || '3179';
const BASE = 'http://localhost:' + PORT + '/';

const SLOW_MS = 1200;   // load window — the second click lands well inside it
const GAP_MS = 400;     // realistic click spacing, not microsecond rapid-fire
const POPIN_NAME = 'gina-dialog-boot';   // the name core.js boots the popin handler with

const FRAG = '<div id="ajax-frag"><h2 id="ajax-frag-title">AJAX loaded</h2>'
           + '<button class="gina-popin-close" type="button">Close</button></div>';

/**
 * A PURE legacy trigger: `data-gina-popin-*` only. Carrying either `data-gina-dialog` or
 * `data-gina-dialog-src` would hand it to bindDelegatedOpen instead, which is a different
 * code path with its own (already correct) gate.
 */
function trigger(tag, nested) {
    const href = (tag === 'a') ? ' href="#"' : '';
    const inner = nested ? '<span data-child="c1">open</span>' : 'open';
    return '<' + tag + ' data-probe="t1"' + href + ' data-gina-dialog-preload="false"'
         + ' data-gina-popin-name="' + POPIN_NAME + '"'
         + ' data-gina-popin-url="/slow-frag.html">' + inner + '</' + tag + '>';
}

/** The real runtime fixture with the legacy trigger appended, extraction-controlled. */
function pageHtml(tag, nested) {
    const src = fs.readFileSync(path.join(__dirname, 'fixtures', 'popin-dialog.runtime.html'), 'utf8');
    const n = src.split('</body>').length - 1;
    if (n !== 1) {
        throw new Error('EXTRACTION CONTROL FAILED: expected exactly 1 `</body>` in the fixture, found ' + n);
    }
    return src.replace('</body>', '<p>' + trigger(tag, nested) + '</p>\n</body>');
}

/**
 * Boot the harness with the legacy trigger present, then click it once (and optionally a
 * second time mid-load), returning what the run observed.
 */
async function drive(page, opts) {
    const reqs = [];
    page.on('request', r => { if (r.url().indexOf('/slow-frag.html') > -1) { reqs.push(1); } });

    await page.route('**/slow-frag.html', async route => {
        await new Promise(res => setTimeout(res, SLOW_MS));
        await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: FRAG });
    });
    await page.route(BASE, route => route.fulfill({
        status: 200, contentType: 'text/html; charset=utf-8', body: pageHtml(opts.tag, opts.nested)
    }));

    await page.goto(BASE);
    await page.waitForFunction(
        () => !!(window.gina && window.gina.isFrameworkLoaded === true), null, { timeout: 20000 });
    await page.waitForTimeout(1500);   // the boot phantom constructs the popin handler

    // Scene control: bindOpen rewrites the trigger's id to its own event name. If that did
    // not happen the trigger was never bound and every number below is meaningless.
    const bound = await page.evaluate(() => {
        var el = document.querySelector('[data-probe="t1"]');
        return !!(el && /^popin\.click\./.test(el.id || ''));
    });

    await page.evaluate(() => {
        window.__clicks = 0;
        document.addEventListener('click', function (e) {
            var t = (e.target && e.target.closest) ? e.target.closest('[data-probe="t1"]') : null;
            if (t) { window.__clicks++; }
        }, true);
    });

    const sel = opts.nested ? '[data-child="c1"]' : '[data-probe="t1"]';
    await page.click(sel, { force: true });
    await page.waitForTimeout(GAP_MS);

    // Instrument validation: the trigger must ACTUALLY be armed when the second click
    // lands. If it is not, the arm proves nothing about the gate and is void, not passing.
    const armed = await page.evaluate(() => {
        var el = document.querySelector('[data-probe="t1"]');
        return { aria: el.getAttribute('aria-disabled'), nativeDisabled: el.getAttribute('disabled') };
    });

    if (opts.second) { await page.click(sel, { force: true }); }
    await page.waitForTimeout(SLOW_MS + 1500);

    const state = await page.evaluate(() => ({
        clicks: window.__clicks,
        openDialogs: document.querySelectorAll('dialog[open]').length
    }));

    return { bound, armed, requests: reqs.length, clicks: state.clicks, openDialogs: state.openDialogs };
}

test('01 an armed legacy <a> trigger must not start a second load', async ({ page }) => {
    const r = await drive(page, { tag: 'a', second: true });

    expect(r.bound).toBe(true);              // the scene is real
    expect(r.armed.aria).toBe('true');       // gina did arm it before the second click
    expect(r.clicks).toBe(2);                // both clicks reached JS (nothing else ate one)
    expect(r.requests).toBe(1);
});

test('02 a click on the trigger\'s child markup must not start a second load either', async ({ page }) => {
    const r = await drive(page, { tag: 'a', nested: true, second: true });

    expect(r.bound).toBe(true);
    expect(r.armed.aria).toBe('true');
    expect(r.clicks).toBe(2);
    expect(r.requests).toBe(1);
});

test('03 a single click still loads and opens the popin (the gate must not break the normal path)', async ({ page }) => {
    const r = await drive(page, { tag: 'a', second: false });

    expect(r.bound).toBe(true);
    expect(r.requests).toBe(1);
    expect(r.openDialogs).toBe(1);
});

test('04 a legacy <button> trigger is stopped by the browser itself, not by the gate', async ({ page }) => {
    const r = await drive(page, { tag: 'button', second: true });

    expect(r.bound).toBe(true);
    expect(r.armed.nativeDisabled).toBe('true');   // armPopinTrigger uses the native attr here
    expect(r.clicks).toBe(1);                      // the browser never delivered the second
    expect(r.requests).toBe(1);
});
