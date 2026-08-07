'use strict';

/**
 * Playwright RUNTIME e2e for the statusbar → Inspector popup entry path (#INS15 bound
 * mode) — the way a real user actually opens the Inspector.
 *
 * THE FIXTURE. `/inspector-host` serves the REAL statusbar template (the same
 * `dist/vendor/gina/html/statusbar.html` bytes render-swig splices into every dev-mode
 * page, nonce tags stripped) after a `window.__ginaData` script, in the real injection
 * order. Everything driven here is shipped code: the statusbar mints the per-tab
 * sessionStorage id, opens `BroadcastChannel('gina-inspector-' + id)`, advertises it on
 * `localStorage['__gina_last_tab_ch']` (#B231), and its shadow-DOM `#insp` link opens
 * the embedded popup at `/_gina/inspector/?ch=<id>`.
 *
 * THE ROUND-TRIP UNDER TEST. The freshly-opened SPA posts `{type:'request'}` on the
 * `?ch=` channel (BroadcastChannel does not replay), the statusbar answers
 * `{type:'data', payload}`, and the SPA applies it — bound mode, page-scoped. This
 * whole exchange runs between two real pages in one browser context, something jsdom
 * cannot host at all.
 *
 * Statusbar-host gotchas (boot-smoke-recipes): the host div is ZERO-SIZE (content lives
 * in its shadow root) — wait `state: 'attached'`, never the default visible wait; the
 * shadow `#insp` link clicks fine because open shadow roots pierce.
 *
 * Run:
 *   npx playwright test test/e2e/inspector-statusbar.spec.js
 */

const { test, expect } = require('@playwright/test');

const PORT = process.env.GINA_E2E_PORT || '3179';
const BASE = 'http://localhost:' + PORT;

async function gotoHost(page) {
    await page.goto(BASE + '/inspector-host');
    await page.waitForSelector('#__gina-statusbar', { state: 'attached' });
}

test.describe('Inspector — statusbar entry and bound mode', () => {

    test('01 — the statusbar attaches its shadow host and the Inspector link', async ({ page }) => {
        await gotoHost(page);
        // The link lives in the OPEN shadow root; locators pierce it.
        await expect(page.locator('#insp')).toHaveText(/Inspector/);
        // The per-tab id must have been minted and advertised (#B231).
        const ids = await page.evaluate(() => ({
            tabId:  sessionStorage.getItem('__gina_tab_id'),
            advert: localStorage.getItem('__gina_last_tab_ch')
        }));
        expect(ids.tabId, 'the statusbar must mint a per-tab id').toBeTruthy();
        expect(ids.advert, 'the advert must carry the SAME id').toBe(ids.tabId);
    });

    test('02 — clicking the link opens the embedded popup bound to THIS tab (?ch=)', async ({ page, context }) => {
        await gotoHost(page);
        const tabId = await page.evaluate(() => sessionStorage.getItem('__gina_tab_id'));
        const [popup] = await Promise.all([
            context.waitForEvent('page'),
            page.locator('#insp').click()
        ]);
        await popup.waitForLoadState('domcontentloaded');
        const u = new URL(popup.url());
        expect(u.pathname, 'the popup must be the embedded SPA').toBe('/_gina/inspector/');
        expect(u.searchParams.get('ch'), 'the popup must be bound to the OPENING tab').toBe(tabId);
    });

    test('03 — the bound SPA completes the request/data round-trip and says so', async ({ page, context }) => {
        await gotoHost(page);
        const [popup] = await Promise.all([
            context.waitForEvent('page'),
            page.locator('#insp').click()
        ]);
        // The SPA posts {type:'request'}, the statusbar answers with the host's
        // __ginaData — the label rendering proves the round-trip, not merely
        // the popup loading.
        await expect(popup.locator('#bm-label')).toHaveText('e2e@dev');
        await expect(popup.locator('#bm-dot')).toHaveClass(/\bok\b/);
        // Bound mode must SAY it is bound (#B231's badge — pollData runs in
        // this mode, unlike ?target= agent mode, so the badge renders) and
        // must not be warn-tinted; the "No source" panel never surfaces.
        const badge = popup.locator('#bm-source-mode');
        await expect(badge).toHaveText('bound');
        await expect(badge).not.toHaveClass(/bm-source-mode-warn/);
        await expect(popup.locator('#bm-no-source')).toBeHidden();
        // And the streamed page data reached the data tab through the channel.
        await expect(popup.locator('#tab-data .bm-copyable').filter({ hasText: 'e2e-harness' }).first()).toBeVisible();
    });
});
