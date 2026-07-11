'use strict';

/**
 * Playwright RUNTIME e2e for client-side components inside popin/XHR-injected
 * content (real built gina bundle).
 *
 * Verifies the platform contract the conventions rely on: custom elements
 * inside a popin-injected body upgrade automatically on DOM insertion — no
 * rebinding hook, no re-scan — and a body may carry its own external
 * definition <script src>, which the popin open path re-creates in <head>
 * (deduped via parentScripts) so the definition lands and already-inserted
 * elements upgrade retroactively.
 *
 * Same harness as popin-dialog.runtime.spec.js (runtime-server.js webServer):
 * dist gina.min.js + whisper-substituted onload + in-memory fragments. The
 * component definition is the REAL view-scaffold boilerplate file
 * (public/js/components/x-checklist.js), served by the harness.
 */

const { test, expect } = require('@playwright/test');

const PORT = process.env.GINA_E2E_PORT || '3179';
const BASE = 'http://localhost:' + PORT + '/';

/**
 * Navigate to the harness and wait for the boot phantom to construct the popin
 * handler (the declarative API is inert until then).
 */
async function gotoAndBoot(page) {
    await page.goto(BASE);
    await page.waitForFunction(
        () => !!(window.gina && window.gina.isFrameworkLoaded === true && window.gina.hasPopinHandler === true),
        null,
        { timeout: 15000 }
    );
}

/** Injects a declarative data-gina-dialog trigger into the live DOM. */
async function injectDialogTrigger(page, id, src) {
    await page.evaluate((a) => {
        const el = document.createElement('a');
        el.id = a.id;
        el.setAttribute('data-gina-dialog', '');
        el.setAttribute('data-gina-dialog-src', a.src);
        el.setAttribute('href', '#');
        el.textContent = 'Open ' + a.id;
        document.body.appendChild(el);
    }, { id: id, src: src });
}

test.beforeEach(async ({ page }) => {
    await gotoAndBoot(page);
});

test.describe('components in popin-injected bodies (real bundle)', () => {

    test('a component inside an AJAX-loaded body upgrades and functions with no rebinding', async ({ page }) => {
        // definition loaded on the host page — the conventions' default
        // (a templates.json javascripts entry -> plain external script)
        await page.addScriptTag({ url: '/js/components/x-checklist.js' });
        await page.waitForFunction(() => !!customElements.get('x-checklist'));

        await injectDialogTrigger(page, 'component-trigger', '/frag/component.html');
        await page.click('#component-trigger');

        const host = page.locator('dialog x-checklist');
        await expect(host).toBeVisible();

        // upgraded on insertion — no rebind call anywhere in this test
        expect(await host.evaluate((el) => el.matches(':defined'))).toBe(true);

        // hydration ran inside the injected body (JSON data-* applied)
        await expect(page.locator('dialog x-checklist [data-role="status"]')).toHaveText('1 / 2');

        // and it functions: toggling updates, template-clone appends
        await page.locator('dialog x-checklist ul input[type="checkbox"]').nth(1).check();
        await expect(page.locator('dialog x-checklist [data-role="status"]')).toHaveText('2 / 2');

        await page.fill('dialog x-checklist form[data-role="add"] input[name="label"]', 'gamma');
        await page.click('dialog x-checklist form[data-role="add"] button');
        await expect(page.locator('dialog x-checklist ul li')).toHaveCount(3);
        await expect(page.locator('dialog x-checklist [data-role="status"]')).toHaveText('2 / 3');
    });

    test('a body carrying its own definition <script src> upgrades retroactively', async ({ page }) => {
        // control: the definition must NOT be on the host page yet — the
        // retroactive-upgrade reading below is only a signal if this holds
        expect(await page.evaluate(() => !!customElements.get('x-checklist'))).toBe(false);

        await injectDialogTrigger(page, 'script-trigger', '/frag/component-script.html');
        await page.click('#script-trigger');

        // the popin open path re-creates the fragment's external <script src>
        // in <head>; once it executes, the already-inserted element upgrades
        await page.waitForFunction(() => !!customElements.get('x-checklist'), null, { timeout: 10000 });
        await page.waitForFunction(() => {
            const el = document.querySelector('dialog x-checklist');
            return !!(el && el.matches(':defined'));
        }, null, { timeout: 10000 });

        await expect(page.locator('dialog x-checklist')).toBeVisible();
        await expect(page.locator('dialog x-checklist [data-role="status"]')).toHaveText('1 / 2');
    });
});
