'use strict';

/**
 * Playwright RUNTIME e2e for #B285 — a popin opened from a still-in-flight
 * hover/focus preload must show the SAME busy affordance as a cold click-time
 * load: the trigger is armed (aria-disabled on an <a>, native disabled on
 * everything else, plus the shared data-gina-loading marker) for the duration
 * of the adopted wait, and released when the adoption settles — success or
 * failure alike.
 *
 * Harness: same runtime-server + boot-phantom shape as
 * popin-dialog.runtime.spec.js (real built bundle, delegated handlers live).
 * The in-flight window is held open with page.route — the #B54 skeleton
 * scene's own technique — so the during-wait assertions are deterministic
 * rather than raced.
 *
 * Red-first: arms 01/02 (during-wait armed) and 04's during-wait step FAIL on
 * the pre-#B285 dist (nothing was ever armed on the adopted path); arm 03 is
 * the ready-branch no-arm control and passes on both sides of the fix.
 */

const { test, expect } = require('@playwright/test');

const PORT = process.env.GINA_E2E_PORT || '3179';
const BASE = 'http://localhost:' + PORT + '/';

async function gotoAndBoot(page) {
    await page.goto(BASE);
    await page.waitForFunction(
        () => !!(window.gina && window.gina.isFrameworkLoaded === true && window.gina.hasPopinHandler === true),
        null,
        { timeout: 15000 }
    );
}

// Same registration shape as popin-dialog.runtime.spec.js (#B54): inject the
// trigger FIRST (bindOpen scans the DOM at registration), then construct +
// .on('ready'). bindOpen renames the id, so callers select by attribute.
async function registerLegacyPopin(page, name, url) {
    await page.evaluate(function (a) {
        var b = document.createElement('button');
        b.id = 'legacy-' + a.name;
        b.setAttribute('data-gina-popin-name', a.name);
        b.setAttribute('data-gina-popin-url', a.url);
        b.textContent = 'Open ' + a.name;
        document.body.appendChild(b);
    }, { name: name, url: url });
    return await page.evaluate(function (a) {
        return new Promise(function (resolve) {
            setTimeout(function () { resolve('TIMEOUT'); }, 6000);
            if (typeof window.require !== 'function') { resolve('NO_REQUIRE'); return; }
            window.require(['gina/popin'], function (Popin) {
                new Popin({ 'name': a.name }).on('ready', function () { resolve('READY'); });
            });
        });
    }, { name: name });
}

function collectPageErrors(page) {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    return errors;
}

/**
 * Route `url` so the FIRST request is held until the returned release() is
 * called (then fulfilled with `firstStatus`, default 200); any later request
 * fulfils 200 immediately. Holding the first GET is what makes the adopted
 * in-flight window observable.
 */
async function holdFirstRequest(page, url, body, firstStatus) {
    let release;
    const held = new Promise((r) => { release = r; });
    let first = true;
    await page.route('**' + url, async (route) => {
        if (first) {
            first = false;
            await held;
            const status = firstStatus || 200;
            await route.fulfill({ status: status, contentType: 'text/html', body: status === 500 ? 'boom' : body });
            return;
        }
        await route.fulfill({ status: 200, contentType: 'text/html', body: body });
    });
    return release;
}

test.beforeEach(async ({ page }) => {
    await gotoAndBoot(page);
});

test.describe('#B285 adopted-preload busy affordance (real bundle)', () => {

    test('01 an <a> trigger is armed for the adopted in-flight wait, and released when it lands', async ({ page }) => {
        const errors = collectPageErrors(page);
        const release = await holdFirstRequest(page, '/frag/b285-a.html', '<div id="b285-a-t">B285 A loaded</div>');
        await page.evaluate(() => {
            const a = document.createElement('a');
            a.id = 'b285-held-a';
            a.setAttribute('data-gina-dialog', '');
            a.setAttribute('data-gina-dialog-src', '/frag/b285-a.html');
            a.setAttribute('href', '#');
            a.textContent = 'Open held A';
            document.body.appendChild(a);
        });
        const started = page.waitForRequest((r) => r.url().endsWith('/frag/b285-a.html'));
        await page.hover('#b285-held-a');   // intent -> warmTrigger reserves the slot + GETs (held)
        await started;
        await page.click('#b285-held-a');   // adopts the in-flight preload

        // During the adopted wait: armed exactly like a cold load of an <a>.
        const t = page.locator('#b285-held-a');
        await expect(t).toHaveAttribute('aria-disabled', 'true');
        await expect(t).toHaveAttribute('data-gina-loading', 'true');
        expect(await t.getAttribute('disabled')).toBe(null); // <a> arm is aria, never native

        release();

        await expect(page.locator('dialog').filter({ hasText: 'B285 A loaded' })).toBeVisible();
        // Released: attribute removed (not 'false'), marker disarmed to "false".
        expect(await t.getAttribute('aria-disabled')).toBe(null);
        await expect(t).toHaveAttribute('data-gina-loading', 'false');
        expect(errors).toEqual([]);
    });

    test('02 a <button> legacy trigger is armed with native disabled for the adopted wait', async ({ page }) => {
        const errors = collectPageErrors(page);
        const release = await holdFirstRequest(page, '/frag/b285-b.html', '<div id="b285-b-t">B285 B loaded</div>');
        const reg = await registerLegacyPopin(page, 'b285btn', '/frag/b285-b.html');
        expect(reg).toBe('READY');
        const sel = '[data-gina-popin-name="b285btn"]';
        const started = page.waitForRequest((r) => r.url().endsWith('/frag/b285-b.html'));
        await page.hover(sel);              // warmTrigger reads data-gina-popin-url too
        await started;
        await page.click(sel);              // the legacy click adopts the in-flight preload

        const t = page.locator(sel);
        await expect(t).toHaveAttribute('disabled', /.+/);   // native arm on a real form control
        await expect(t).toHaveAttribute('data-gina-loading', 'true');
        expect(await t.getAttribute('aria-disabled')).toBe(null);

        release();

        await expect(page.locator('dialog').filter({ hasText: 'B285 B loaded' })).toBeVisible();
        expect(await t.getAttribute('disabled')).toBe(null);
        await expect(t).toHaveAttribute('data-gina-loading', 'false');
        expect(errors).toEqual([]);
    });

    test('03 the ready (cached) branch never arms — no transient writes (control)', async ({ page }) => {
        const errors = collectPageErrors(page);
        await page.evaluate(() => {
            const a = document.createElement('a');
            a.id = 'b285-ready-a';
            a.setAttribute('data-gina-dialog', '');
            a.setAttribute('data-gina-dialog-src', '/frag/ajax.html');  // real harness fragment
            a.setAttribute('href', '#');
            a.textContent = 'Open ready';
            document.body.appendChild(a);
        });
        const landed = page.waitForResponse((r) => r.url().endsWith('/frag/ajax.html'));
        await page.hover('#b285-ready-a');
        await landed;                        // the slot is READY before the click
        await page.evaluate(() => {
            const t = document.getElementById('b285-ready-a');
            window.__b285records = [];
            const mo = new MutationObserver((muts) => {
                muts.forEach((m) => window.__b285records.push(m.attributeName));
            });
            mo.observe(t, { attributes: true, attributeFilter: ['data-gina-loading', 'aria-disabled', 'disabled', 'data-obs-control'] });
        });
        await page.click('#b285-ready-a');
        await expect(page.locator('dialog').filter({ hasText: 'AJAX loaded' })).toBeVisible();
        // Instrument control: prove the observer fires at all before trusting its zero.
        await page.evaluate(() => document.getElementById('b285-ready-a').setAttribute('data-obs-control', 'x'));
        await page.waitForFunction(() => (window.__b285records || []).indexOf('data-obs-control') > -1);
        const records = await page.evaluate(() => window.__b285records);
        expect(records.filter((r) => r !== 'data-obs-control')).toEqual([]);
        expect(errors).toEqual([]);
    });

    test('04 a FAILED adoption releases the trigger and the click-time fallback still opens', async ({ page }) => {
        const errors = collectPageErrors(page);
        const release = await holdFirstRequest(page, '/frag/b285-f.html', '<div id="b285-f-t">B285 F loaded</div>', 500);
        await page.evaluate(() => {
            const a = document.createElement('a');
            a.id = 'b285-fail-a';
            a.setAttribute('data-gina-dialog', '');
            a.setAttribute('data-gina-dialog-src', '/frag/b285-f.html');
            a.setAttribute('href', '#');
            a.textContent = 'Open failing';
            document.body.appendChild(a);
        });
        let requests = 0;
        page.on('request', (r) => { if (r.url().endsWith('/frag/b285-f.html')) { requests++; } });
        const started = page.waitForRequest((r) => r.url().endsWith('/frag/b285-f.html'));
        await page.hover('#b285-fail-a');
        await started;
        await page.click('#b285-fail-a');

        const t = page.locator('#b285-fail-a');
        await expect(t).toHaveAttribute('aria-disabled', 'true');   // armed during the adopted wait

        release();  // preload resolves 500 -> adoption fails -> release -> click-time fallback (2nd GET, 200)

        await expect(page.locator('dialog').filter({ hasText: 'B285 F loaded' })).toBeVisible({ timeout: 5000 });
        expect(await t.getAttribute('aria-disabled')).toBe(null);   // never stuck
        await expect(t).toHaveAttribute('data-gina-loading', 'false');
        await page.waitForTimeout(200);
        expect(requests).toBe(2);           // the adopted GET + the fallback's own GET
        expect(errors).toEqual([]);
    });

    test('05 a second click during the adopted wait is refused by the entry gate (guard)', async ({ page }) => {
        const errors = collectPageErrors(page);
        const release = await holdFirstRequest(page, '/frag/b285-g.html', '<div id="b285-g-t">B285 G loaded</div>');
        await page.evaluate(() => {
            const a = document.createElement('a');
            a.id = 'b285-guard-a';
            a.setAttribute('data-gina-dialog', '');
            a.setAttribute('data-gina-dialog-src', '/frag/b285-g.html');
            a.setAttribute('href', '#');
            a.textContent = 'Open guarded';
            document.body.appendChild(a);
        });
        const started = page.waitForRequest((r) => r.url().endsWith('/frag/b285-g.html'));
        await page.hover('#b285-guard-a');
        await started;
        await page.click('#b285-guard-a');
        await expect(page.locator('#b285-guard-a')).toHaveAttribute('aria-disabled', 'true');
        // force: Playwright's own actionability now reads the armed <a> as disabled
        // (the a11y tree reports [disabled] — the affordance working) and would wait
        // forever; a real pointer is NOT blocked on an aria-disabled anchor, so force
        // keeps the trusted input pipeline and lets gina's entry gate do the refusing.
        await page.click('#b285-guard-a', { force: true });  // refused: openFromTrigger's gate reads the arm
        release();
        await expect(page.locator('dialog').filter({ hasText: 'B285 G loaded' })).toBeVisible();
        expect(await page.locator('dialog').filter({ hasText: 'B285 G loaded' }).count()).toBe(1);
        expect(errors).toEqual([]);
    });
});
