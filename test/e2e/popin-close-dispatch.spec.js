'use strict';

/**
 * Playwright RUNTIME e2e for #B299 + #B301 — a popin's close button must close the popin
 * whatever its id is, and wherever inside it the click lands.
 *
 * Both defects came from the same line: the close branch of register()'s click listener
 * re-derived "is this a close button" from `event.target.id`, testing it against the
 * `popin.close.` prefix gina mints at bind time.
 *
 *   #B299 — gina assigns that prefixed id ONLY to an id-less element; a consumer id is
 *           taken verbatim, matches neither prefix, and the button goes inert.
 *   #B301 — `event.target` is whatever was CLICKED, so an icon nested inside the button
 *           matches neither prefix either. This is the ordinary
 *           `<button class="gina-popin-close"><svg/></button>` shape, so it is the wider
 *           of the two.
 *
 * Both are silent: `cancelEvent` runs at the top of the listener, so the button also
 * swallows its own default and there is no error to see.
 *
 * Fix: read `event.currentTarget` — the element register() bound, which IS the close
 * button, since register('close', …) has one call site fed only from
 * `querySelectorAll('.gina-popin-close')` — and treat a `popin.click.*` id as the sole
 * exception, preserving the dual-role element (a trigger that is also a close button).
 *
 * The element's id is deliberately untouched by the fix: teardown removes this listener
 * via `gina.events[eId] == eId`, so the event name and the id must stay the same string.
 *
 * Arms (one variable each, every one a control for the others):
 *   01 consumer-assigned id     -> must CLOSE (#B299; RED before the fix)
 *   02 id-less close button     -> must CLOSE (positive control: the scene can close)
 *   03 click a nested <span>    -> must CLOSE (#B301; RED before the fix)
 *   04 nested span, id-less     -> the two variables are independent, not a pair
 */

const { test, expect } = require('@playwright/test');

const PORT = process.env.GINA_E2E_PORT || '3179';
const BASE = 'http://localhost:' + PORT + '/';
const CLOSE_SEL = 'dialog .gina-popin-close';

/**
 * Build the routed AJAX fragment carrying a close button.
 *
 * @param {object} opts - { consumerId: give the button an id, nested: put a <span> inside }
 * @returns {string}
 */
function frag(opts) {
    var idAttr = opts.consumerId ? ' id="consumer-close"' : '';
    var inner  = opts.nested ? '<span id="close-icon">&times;</span>' : 'Close';
    return '<div id="ajax-frag"><h2 id="ajax-frag-title">AJAX loaded</h2>'
         + '<p>cold AJAX body</p>'
         + '<button class="gina-popin-close" type="button"' + idAttr + '>' + inner + '</button>'
         + '</div>';
}

/** Boot the harness, open the AJAX dialog, and wait for the routed body to land. */
async function openWith(page, opts) {
    await page.route('**/frag/ajax.html', route => route.fulfill({
        status: 200, contentType: 'text/html; charset=utf-8', body: frag(opts)
    }));

    await page.goto(BASE);
    await page.waitForFunction(
        () => !!(window.gina && window.gina.isFrameworkLoaded === true),
        null, { timeout: 20000 });
    await page.waitForTimeout(1200);   // the boot phantom constructs the popin handler

    await page.evaluate(() => {
        var el = document.createElement('button');
        el.id = 'trig';
        el.type = 'button';
        el.textContent = 'open';
        el.setAttribute('data-gina-dialog', '');
        el.setAttribute('data-gina-dialog-src', '/frag/ajax.html');
        document.body.appendChild(el);
    });
    await page.waitForTimeout(400);
    await page.click('#trig', { force: true });
    await page.waitForSelector(CLOSE_SEL, { timeout: 10000 });
    await page.waitForTimeout(600);
}

const openCount = page => page.evaluate(() => document.querySelectorAll('dialog[open]').length);

test('01 a close button with a consumer-assigned id still closes the popin', async ({ page }) => {
    await openWith(page, { consumerId: true });
    expect(await openCount(page)).toBe(1);

    await page.click(CLOSE_SEL, { force: true });
    await page.waitForTimeout(1200);

    expect(await openCount(page)).toBe(0);
});

test('02 an id-less close button closes the popin (positive control)', async ({ page }) => {
    await openWith(page, {});
    expect(await openCount(page)).toBe(1);

    await page.click(CLOSE_SEL, { force: true });
    await page.waitForTimeout(1200);

    expect(await openCount(page)).toBe(0);
});

test('03 clicking an icon nested inside the close button closes the popin', async ({ page }) => {
    await openWith(page, { nested: true });
    expect(await openCount(page)).toBe(1);

    await page.click('#close-icon', { force: true });
    await page.waitForTimeout(1200);

    expect(await openCount(page)).toBe(0);
});

test('04 a nested icon inside a consumer-id close button closes it too', async ({ page }) => {
    await openWith(page, { consumerId: true, nested: true });
    expect(await openCount(page)).toBe(1);

    await page.click('#close-icon', { force: true });
    await page.waitForTimeout(1200);

    expect(await openCount(page)).toBe(0);
});
