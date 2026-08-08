'use strict';

/**
 * Playwright RUNTIME e2e for #A11Y8 — a superseded non-modal popin must stop being
 * keyboard-reachable.
 *
 * WHY THIS EXISTS (the gap it closes). `popinOpen()` never closes the popin it
 * supersedes, so a second non-modal `<dialog>` would otherwise leave the first one
 * fully reachable behind it. `applyNonModalShims()` handles that by setting `inert`
 * on every OTHER `dialog[open]` in the container. The unit replica for that logic,
 * test/core/popin-nonmodal-inert.test.js, runs in jsdom — and jsdom implements no
 * `inert` at all (probed: `'inert' in element` is false, and there is no inert
 * behaviour to observe). So the replica can only assert THAT THE MARKER WAS SET;
 * it is structurally incapable of asserting that the browser honours it.
 *
 * That leaves the actual a11y guarantee — "the superseded dialog cannot be reached"
 * — verified nowhere: not in jsdom (cannot be), and not in any other e2e spec. This
 * spec closes exactly that, against the REAL built bundle, in a real engine.
 *
 * INSTRUMENT DISCIPLINE. "Focus did not land in A" is a negative reading, and a
 * probe that can never observe focus at all would produce it for free. §03 is
 * therefore a positive control: the SAME probe, pointed at the ACTIVE dialog, must
 * report focus successfully. If §03 ever fails, §02 and §04 prove nothing and their
 * greens must be discarded rather than reinterpreted.
 *
 * Run:
 *   npx playwright test test/e2e/popin-dialog.inert.spec.js
 */

const { test, expect } = require('@playwright/test');

const PORT = process.env.GINA_E2E_PORT || '3179';
const BASE = 'http://localhost:' + PORT + '/';

/** Navigate and wait for the boot phantom to construct the popin handler. */
async function gotoAndBoot(page) {
    await page.goto(BASE);
    await page.waitForFunction(
        () => !!(window.gina && window.gina.isFrameworkLoaded === true && window.gina.hasPopinHandler === true),
        null,
        { timeout: 15000 }
    );
}

/** Inject a `data-gina-dialog` trigger and click it, awaiting the resulting body. */
async function openDialog(page, id, frag, expectText) {
    await page.evaluate((a) => {
        const el = document.createElement('a');
        el.id = a.id;
        el.setAttribute('data-gina-dialog', '');
        el.setAttribute('data-gina-dialog-src', a.frag);
        el.setAttribute('href', '#');
        el.textContent = 'Open ' + a.id;
        document.body.appendChild(el);
    }, { id: id, frag: frag });

    await page.click('#' + id);
    await expect(page.locator('dialog').filter({ hasText: expectText })).toBeVisible();
}

/**
 * Open A, then B. B supersedes A; both stay open, both non-modal — which is the
 * precondition applyNonModalShims() exists for.
 */
async function openBoth(page) {
    await openDialog(page, 'inert-trigger-a', '/frag/inert-a.html', 'First body');
    await openDialog(page, 'inert-trigger-b', '/frag/inert-b.html', 'Second body');

    // Guard the precondition rather than assume it: if either dialog were modal, or
    // the first had been closed, the whole scenario would be vacuous.
    const state = await page.evaluate(() => {
        const open = Array.from(document.querySelectorAll('dialog[open]'));
        return {
            openCount: open.length,
            anyModal:  open.some((d) => d.matches(':modal'))
        };
    });
    expect(state.openCount, 'both dialogs must remain open — B must not close A').toBe(2);
    expect(state.anyModal, 'both must be non-modal; a modal dialog inerts the background natively').toBe(false);
}

test.beforeEach(async ({ page }) => {
    await gotoAndBoot(page);
});

test.describe('#A11Y8 a superseded non-modal popin is really inert (real bundle)', () => {

    test('01 - marker parity: the superseded dialog carries inert + the gina marker', async ({ page }) => {
        await openBoth(page);

        const marked = await page.evaluate(() => {
            const a = document.getElementById('inert-a-frag').closest('dialog');
            const b = document.getElementById('inert-b-frag').closest('dialog');
            return {
                aInert:  a.hasAttribute('inert'),
                aMarked: a.getAttribute('data-gina-popin-inert'),
                bInert:  b.hasAttribute('inert')
            };
        });

        expect(marked.aInert,  'the superseded dialog must be inerted').toBe(true);
        expect(marked.aMarked, 'and marked as gina-owned, so teardown cannot steal an app-owned inert').toBe('true');
        expect(marked.bInert,  'the ACTIVE dialog must never be inerted').toBe(false);
    });

    test('02 - BEHAVIOUR: a control inside the superseded dialog cannot take focus', async ({ page }) => {
        await openBoth(page);

        // .focus() on a control inside an inert subtree must be refused by the engine.
        // This is the half jsdom cannot reach: it has no inert, so there its focus()
        // would simply succeed.
        const focused = await page.evaluate(() => {
            const btn = document.getElementById('inert-a-btn');
            btn.focus();
            return document.activeElement === btn;
        });

        expect(focused, 'a control in the superseded (inert) dialog must not become activeElement').toBe(false);
    });

    test('03 - positive control: the SAME probe does observe focus in the active dialog', async ({ page }) => {
        await openBoth(page);

        // Without this arm, §02 and §04 are controls that cannot fail — a probe unable
        // to observe focus anywhere would satisfy them both.
        const focused = await page.evaluate(() => {
            const btn = document.getElementById('inert-b-btn');
            btn.focus();
            return document.activeElement === btn;
        });

        expect(focused, 'the probe MUST be able to observe focus, or §02/§04 prove nothing').toBe(true);
    });

    test('05 - SUBTRACT control: with `inert` removed, that same control IS reachable', async ({ page }) => {
        await openBoth(page);

        // §03 proves the probe can see focus SOMEWHERE. This proves the specific
        // negative in §02 is caused by `inert` and not by something incidental to
        // dialog A (being the second-from-top dialog, sitting lower in the DOM, etc.).
        // Strip only the attribute; leave everything else about the scene identical.
        const focusedAfterStrip = await page.evaluate(() => {
            const a = document.getElementById('inert-a-frag').closest('dialog');
            a.removeAttribute('inert');
            const btn = document.getElementById('inert-a-btn');
            btn.focus();
            return document.activeElement === btn;
        });

        expect(
            focusedAfterStrip,
            'with inert stripped the control must become reachable — otherwise §02 passes for an unrelated reason'
        ).toBe(true);
    });

    test('04 - BEHAVIOUR: Tab never lands inside the superseded dialog', async ({ page }) => {
        await openBoth(page);

        // Walk the tab ring. The guarantee is not "focus goes somewhere specific" —
        // it is that nothing inside the superseded dialog is ever reachable.
        for (let i = 0; i < 12; i++) {
            await page.keyboard.press('Tab');
            const insideSuperseded = await page.evaluate(() => {
                const a = document.getElementById('inert-a-frag').closest('dialog');
                const el = document.activeElement;
                return !!el && a.contains(el);
            });
            expect(insideSuperseded, 'Tab reached a control inside the superseded dialog').toBe(false);
        }
    });
});
