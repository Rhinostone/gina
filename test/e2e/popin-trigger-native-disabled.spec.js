'use strict';

/**
 * Playwright RUNTIME e2e for #B296 — a consumer double-submit guard must not kill a
 * popin trigger (the real built gina bundle, real pointer clicks, real dialog opens).
 *
 * The popin plugin's trigger gates accepted the NATIVE `disabled` attribute as well as
 * gina's own `aria-disabled` marker — the same predicate #B293 fixed in the validator,
 * carried here verbatim. The near-universal double-submit guard (a click listener that
 * sets `disabled` immediately) runs inside the very click being handled, before gina's
 * delegated proxy reaches the gate; the gate then reads "disabled", refuses, and the
 * consumer's own handler clears the attribute again — leaving nothing marked, a
 * normal-looking control, and a popin that silently never opens.
 *
 * Fix: the native attribute counts only where `disabled` is NOT a real IDL property.
 * On a genuine form control the browser suppresses the click entirely (measured: a
 * natively-disabled <button> delivers no click to JS at all), so that arm could only
 * ever fire on a mid-dispatch write. On an <a> / custom element the browser enforces
 * nothing, so the attribute still counts — and that is also what keeps honouring
 * armPopinTrigger's own native write on a non-<a> trigger.
 *
 * WHY test/e2e AND NOT test/core: the defect is an ordering interaction between a
 * consumer's own listener and gina's delegated proxy, observable only when the real
 * bundle handles a real click. A replica cannot catch it.
 *
 * Arms (one variable each, every one a control for the others):
 *   01 dialog trigger + guard      -> must OPEN  (regression arm; RED before the fix)
 *   02 dialog trigger, no guard    -> must OPEN  (subtract control: the guard is the variable)
 *   03 <a disabled> pre-set        -> must NOT open (the arm the fix deliberately KEEPS)
 *   04 in-popin close + capture guard -> must CLOSE (the second reachable site, :1364)
 *
 * Arm 04 needs a close button inside the loaded popin body, which the stock `ajax`
 * fragment does not carry, so the fragment is routed per-test. It must carry NO id:
 * gina assigns `popin.close.<n>` only to an id-less close element and the dispatch gate
 * matches on that prefix, so a consumer id makes every arm read "did not close" — the
 * subtract control included. (That is its own defect, tracked separately as #B299.)
 */

const { test, expect } = require('@playwright/test');

const PORT = process.env.GINA_E2E_PORT || '3179';
const BASE = 'http://localhost:' + PORT + '/';

const CLOSE_SEL = 'dialog .gina-popin-close';

/** The stock `ajax` body PLUS an id-less close button (see the header note on ids). */
const FRAG_WITH_CLOSE =
    '<div id="ajax-frag"><h2 id="ajax-frag-title">AJAX loaded</h2>'
    + '<p>cold AJAX body</p>'
    + '<button class="gina-popin-close" type="button">Close</button>'
    + '</div>';

/** Boot the dialog runtime harness and wait for the popin handler to be constructed. */
async function boot(page) {
    await page.goto(BASE);
    await page.waitForFunction(
        () => !!(window.gina && window.gina.isFrameworkLoaded === true),
        null, { timeout: 20000 });
    // the harness's boot phantom constructs the popin handler after isFrameworkLoaded
    await page.waitForTimeout(1200);
}

/**
 * Inject a trigger into the live DOM. bindDelegatedOpen/installPreload are delegated,
 * so a dynamically-added trigger is picked up without re-binding.
 *
 * @param {object} page
 * @param {string} tag   - 'button' | 'a'
 * @param {object} opts  - { guard: set `disabled` inside its own click listener,
 *                           pre: pre-set `disabled` before any click }
 */
async function addTrigger(page, tag, opts) {
    await page.evaluate(([tag, guard, pre]) => {
        var el = document.createElement(tag);
        el.id = 'trig';
        el.textContent = 'open';
        el.setAttribute('data-gina-dialog', '');
        el.setAttribute('data-gina-dialog-src', '/frag/ajax.html');
        if (tag === 'a') { el.setAttribute('href', '#'); }
        if (pre) { el.setAttribute('disabled', 'disabled'); }
        if (guard) {
            el.addEventListener('click', function () {
                this.setAttribute('disabled', 'disabled');
                setTimeout(function () { el.removeAttribute('disabled'); }, 250);
            });
        }
        document.body.appendChild(el);
    }, [tag, !!opts.guard, !!opts.pre]);
    await page.waitForTimeout(400);
}

const openDialogCount = page =>
    page.evaluate(() => document.querySelectorAll('dialog[open]').length);

test('01 a mid-dispatch double-submit guard must not stop a popin trigger', async ({ page }) => {
    await boot(page);
    await addTrigger(page, 'button', { guard: true });

    await page.click('#trig', { force: true });
    await page.waitForTimeout(1500);

    expect(await openDialogCount(page)).toBe(1);
});

test('02 the same trigger without the guard opens (subtract control)', async ({ page }) => {
    await boot(page);
    await addTrigger(page, 'button', {});

    await page.click('#trig', { force: true });
    await page.waitForTimeout(1500);

    expect(await openDialogCount(page)).toBe(1);
});

test('03 <a disabled> is still refused — the native arm is KEPT where the browser does not enforce it', async ({ page }) => {
    await boot(page);
    await addTrigger(page, 'a', { pre: true });

    await page.click('#trig', { force: true });
    await page.waitForTimeout(1500);

    expect(await openDialogCount(page)).toBe(0);
});

test('04 a capture-phase guard must not stop an in-popin close button', async ({ page }) => {
    await page.route('**/frag/ajax.html', route => route.fulfill({
        status: 200, contentType: 'text/html; charset=utf-8', body: FRAG_WITH_CLOSE
    }));
    await boot(page);
    await addTrigger(page, 'button', {});

    await page.click('#trig', { force: true });
    await page.waitForSelector(CLOSE_SEL, { timeout: 10000 });
    await page.waitForTimeout(600);
    expect(await openDialogCount(page)).toBe(1);   // the scene is real before we test the close

    // capture phase, so it deterministically runs before gina's own element listener
    await page.evaluate(() => {
        document.addEventListener('click', function (e) {
            var t = e.target;
            if (t && t.classList && t.classList.contains('gina-popin-close')) {
                t.setAttribute('disabled', 'disabled');
                setTimeout(function () { t.removeAttribute('disabled'); }, 250);
            }
        }, true);
    });

    await page.click(CLOSE_SEL, { force: true });
    await page.waitForTimeout(1200);

    expect(await openDialogCount(page)).toBe(0);
});
