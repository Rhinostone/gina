'use strict';

/**
 * Playwright accessibility spec for the modernized gina dialog ("popin") system.
 *
 * Covers what jsdom cannot: native `<dialog>` top-layer + `::backdrop`, the native
 * focus trap, native `Escape`, the `@starting-style` / `transition … allow-discrete`
 * enter/exit transitions, and the non-modal shims (body scroll-lock, shim Escape,
 * focus return). It drives `fixtures/popin-dialog.html`, a framework-free harness that
 * mirrors the a11y contract popin/main.js guarantees, against the BUILT
 * `dist/.../css/gina.min.css`.
 *
 * Run:
 *   npm i -D @playwright/test && npx playwright install chromium
 *   npx playwright test test/e2e/popin-dialog.a11y.spec.js
 *
 * Not executed by the default `node --test` suite (those source/behavioral checks
 * live in test/core/popin.test.js). The full-runtime scenarios that need a served
 * gina bundle (AJAX load, partial slot replace, hover preload, legacy/deprecation)
 * run for real against the booted bundle in the sibling popin-dialog.runtime.spec.js.
 */

const path = require('path');
const { test, expect } = require('@playwright/test');

const FIXTURE = 'file://' + path.join(__dirname, 'fixtures', 'popin-dialog.html');

test.beforeEach(async ({ page }) => {
    await page.goto(FIXTURE);
});

test.describe('modal dialog (data-gina-dialog-modal)', () => {

    test('opens as a native modal (:modal) and traps focus away from the background', async ({ page }) => {
        await page.click('#open-modal');
        const dialog = page.locator('#d-modal');
        await expect(dialog).toHaveAttribute('open', '');

        // Authoritative top-layer/modal check. NB: getComputedStyle(el, '::backdrop')
        // is NOT a reliable modal probe — it returns the declared `dialog::backdrop`
        // rule even for a non-modal show() dialog whose backdrop is never painted.
        // The :modal pseudo-class is true only for showModal() dialogs.
        expect(await dialog.evaluate((el) => el.matches(':modal'))).toBe(true);

        // aria wiring
        await expect(page.locator('#open-modal')).toHaveAttribute('aria-haspopup', 'dialog');
        await expect(page.locator('#open-modal')).toHaveAttribute('aria-controls', 'd-modal');
        await expect(dialog).toHaveAttribute('aria-labelledby', /-title$/);

        // Native modal focus trap: Tab never reaches a BACKGROUND interactive control
        // (the other triggers). Chromium's wrap point can transiently be <body>, which is
        // expected — what the trap guarantees is that background controls stay unreachable.
        for (let i = 0; i < 8; i++) {
            await page.keyboard.press('Tab');
            const onBackground = await page.evaluate(() => {
                const a = document.activeElement;
                return !!a && (a.id === 'open-modal' || a.id === 'open-nonmodal');
            });
            expect(onBackground).toBe(false);
        }
    });

    test('native Escape closes it and focus returns to the trigger', async ({ page }) => {
        await page.click('#open-modal');
        await expect(page.locator('#d-modal')).toHaveAttribute('open', '');
        await page.keyboard.press('Escape');
        await expect(page.locator('#d-modal')).not.toHaveAttribute('open', '');
        const focused = await page.evaluate(() => document.activeElement && document.activeElement.id);
        expect(focused).toBe('open-modal');
    });
});

test.describe('non-modal dialog (data-gina-dialog-modal="false")', () => {

    test('opens via show() as non-modal (:modal false) and locks body scroll', async ({ page }) => {
        await page.click('#open-nonmodal');
        const dialog = page.locator('#d-nonmodal');
        await expect(dialog).toHaveAttribute('open', '');

        // Non-modal: show() does NOT promote to the top layer, so :modal is false (and no
        // ::backdrop is painted). Asserted via :modal — see the modal test for why
        // getComputedStyle('::backdrop') cannot tell the two apart.
        expect(await dialog.evaluate((el) => el.matches(':modal'))).toBe(false);

        // The non-modal shim restores the scroll-block that native showModal() gives free.
        await expect(page.locator('body')).toHaveAttribute('data-gina-popin-scroll-lock', 'true');
        const overflow = await page.evaluate(() => getComputedStyle(document.body).overflow);
        expect(overflow).toBe('hidden');
    });

    test('shim Escape closes it, clears scroll-lock and returns focus', async ({ page }) => {
        await page.click('#open-nonmodal');
        await page.locator('#n-first').focus();
        await page.keyboard.press('Escape');
        await expect(page.locator('#d-nonmodal')).not.toHaveAttribute('open', '');
        await expect(page.locator('body')).not.toHaveAttribute('data-gina-popin-scroll-lock', 'true');
        const focused = await page.evaluate(() => document.activeElement && document.activeElement.id);
        expect(focused).toBe('open-nonmodal');
    });
});

test.describe('motion preferences', () => {

    test('reduced-motion: dialog still opens and closes (no transition dependency)', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.click('#open-modal');
        await expect(page.locator('#d-modal')).toHaveAttribute('open', '');
        await page.keyboard.press('Escape');
        await expect(page.locator('#d-modal')).not.toHaveAttribute('open', '');
    });

    test('no-preference: dialog animates open (opacity transitions from 0)', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        const transition = await page.locator('#d-modal').evaluate((el) => getComputedStyle(el).transitionProperty);
        // @starting-style enter/exit relies on a declared transition on the dialog.
        expect(transition).toContain('opacity');
    });
});
