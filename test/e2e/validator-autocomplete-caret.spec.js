'use strict';

/**
 * Playwright RUNTIME e2e for #B389 (gh issue #63) — caret integrity of the
 * Safari-autocomplete keydown interception under fast typing, on a REAL
 * WebKit engine with the FULL gina stack (setObserver value descriptor +
 * live-check + handleAutoComplete together).
 *
 * webkit-project-ONLY: the interception is gated to REAL Safari UAs (#B135 —
 * `/safari/i && !/chrom(e|ium)/i`), so on the chromium/firefox projects the
 * handler never registers and every arm would pass vacuously. The default CI
 * E2E job runs chromium only — this spec runs in the on-demand cross-engine
 * job (GINA_E2E_ENGINES=all, .github/workflows/e2e-cross-engine.yml) and
 * locally via:
 *
 *   GINA_E2E_ENGINES=all npx playwright test test/e2e/validator-autocomplete-caret.spec.js --project=webkit
 *
 * Determinism: both keydowns of the fast arm are dispatched in ONE task —
 * the same state a human reaches whenever the second keystroke lands before
 * the interception's queued setTimeout(0) restore pair has run (the reported
 * bug's own reproduction shape). The synthetic events are dispatched only
 * AFTER a real click focused the field: the keydown interceptor registers on
 * focusin, and a synthetic focusin does not reach gina's handler.
 *
 * Instrument notes:
 *   - Each arm asserts its keydowns were INTERCEPTED (dispatchEvent returns
 *     false once the handler preventDefaults) — a vacuous pass on an unbound
 *     field cannot read green.
 *   - The interceptor-live poll dispatches Shift (keyCode 16): intercepted
 *     (so defaultPrevented flips true) but a value no-op, so polling never
 *     types into the field.
 *   - Validated red-first against the pre-fix dist: the fast arm read "AXB"
 *     and the Backspace arm read "" before the fix landed.
 */

const { test, expect } = require('@playwright/test');

const PORT = process.env.GINA_E2E_PORT || '3179';
const BASE = 'http://localhost:' + PORT + '/';

/** One cancelable bubbling keydown, dispatched from page context. */
const MK_KEYDOWN = `(key, keyCode) => new KeyboardEvent('keydown', {
    key: key, keyCode: keyCode, bubbles: true, cancelable: true
})`;

test.describe('#B389 — autocomplete-interception caret integrity (webkit only)', () => {

    test.skip(({ browserName }) => browserName !== 'webkit',
        'the interception is gated to REAL Safari UAs (#B135); only the webkit project carries one');

    test.beforeEach(async ({ page }) => {
        await page.goto(BASE + 'autocomplete');
        await page.waitForFunction(() => window.gina && window.gina.isFrameworkLoaded);

        // CONTROL (pre-focus): the interceptor registers on focusin, so before
        // any focus a synthetic keydown must NOT be intercepted. A red here
        // means the harness scene drifted — the arms below would be testing
        // something else.
        const preFocus = await page.evaluate(`(() => {
            const el = document.getElementById('ref-input');
            const mk = ${MK_KEYDOWN};
            return el.dispatchEvent(mk('Shift', 16));   // true = NOT intercepted
        })()`);
        expect(preFocus, 'no interception may exist before the first focusin').toBe(true);

        // Real focus registers the keydown interceptor; poll with Shift
        // (intercepted but a value no-op) until it is live.
        await page.click('#ref-input');
        await page.waitForFunction(`(() => {
            const el = document.getElementById('ref-input');
            const mk = ${MK_KEYDOWN};
            return el.dispatchEvent(mk('Shift', 16)) === false;   // false = intercepted
        })()`);
    });

    test('01 - fast typing composes at the caret: "X" caret 0 + "A","B" -> "ABX"', async ({ page }) => {
        const res = await page.evaluate(`(async () => {
            const el = document.getElementById('ref-input');
            const mk = ${MK_KEYDOWN};
            el.focus();
            el.value = 'X';
            el.setSelectionRange(0, 0);
            const iA = !el.dispatchEvent(mk('A', 65));
            const iB = !el.dispatchEvent(mk('B', 66));      // same task as A
            const fast = { value: el.value, caret: el.selectionStart };
            await new Promise(r => setTimeout(r, 120));      // let the restore pair drain
            return { iA, iB, fast, settled: { value: el.value, caret: el.selectionStart } };
        })()`);
        expect(res.iA, 'keydown "A" must be intercepted').toBe(true);
        expect(res.iB, 'keydown "B" must be intercepted').toBe(true);
        expect(res.settled.value, 'fast consecutive keystrokes must compose like a native field').toBe('ABX');
        expect(res.settled.caret).toBe(2);
    });

    test('02 - CONTROL: the same two keystrokes, drained apart, also give "ABX"', async ({ page }) => {
        // Correct pre-fix AND post-fix — proves the fast arm measures the
        // timing window, not some unrelated breakage of the interception.
        const res = await page.evaluate(`(async () => {
            const el = document.getElementById('ref-input');
            const mk = ${MK_KEYDOWN};
            el.focus();
            el.value = 'X';
            el.setSelectionRange(0, 0);
            const iA = !el.dispatchEvent(mk('A', 65));
            await new Promise(r => setTimeout(r, 120));      // restore pair fully drained
            const iB = !el.dispatchEvent(mk('B', 66));
            await new Promise(r => setTimeout(r, 120));
            return { iA, iB, settled: { value: el.value, caret: el.selectionStart } };
        })()`);
        expect(res.iA && res.iB).toBe(true);
        expect(res.settled.value).toBe('ABX');
        expect(res.settled.caret).toBe(2);
    });

    test('03 - #B390: Backspace at position 0 is a no-op (was: ate the first character)', async ({ page }) => {
        const res = await page.evaluate(`(async () => {
            const el = document.getElementById('ref-input');
            const mk = ${MK_KEYDOWN};
            el.focus();
            el.value = 'X';
            el.setSelectionRange(0, 0);
            const iBk = !el.dispatchEvent(mk('Backspace', 8));
            await new Promise(r => setTimeout(r, 120));
            return { iBk, settled: { value: el.value, caret: el.selectionStart } };
        })()`);
        expect(res.iBk, 'the Backspace keydown must be intercepted').toBe(true);
        expect(res.settled.value, 'nothing sits before the caret — the value must not change').toBe('X');
    });
});
