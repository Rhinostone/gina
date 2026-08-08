'use strict';

/**
 * Playwright RUNTIME e2e for the Inspector SPA's per-tab restore.
 *
 * THE MECHANISM (inspector.js). `switchTab(name)` (~1895) toggles `.active` on the
 * `.bm-tab` button and its `#tab-<name>` panel, then persists the name to
 * `localStorage['__gina_inspector_tab']`. Boot (~5405) wires the click handlers, reads
 * that key back, and — `if (_savedTab) switchTab(_savedTab)` — restores the tab. The
 * static default in index.html is `data` (the only `.bm-tab.active` in the markup), so a
 * restore to any OTHER tab is positive evidence the persisted value drove the switch —
 * never the markup default passing the test for a wrong reason.
 *
 * Runs against the same stubbed standalone (`?target=` + `transport=sse`) acquisition as
 * inspector-boot.spec.js; tab state is pure client state, so the stub is exhaustive here.
 *
 * Run:
 *   npx playwright test test/e2e/inspector-tab-restore.spec.js
 */

const { test, expect } = require('@playwright/test');

const PORT = process.env.GINA_E2E_PORT || '3179';
const BASE = 'http://localhost:' + PORT;
const SPA  = BASE + '/_gina/inspector/';
const URL  = SPA + '?target=' + encodeURIComponent(BASE) + '&transport=sse';

/** Wait for the SPA to be live (streamed identity rendered), not merely parsed. */
async function gotoInspector(page) {
    await page.goto(URL);
    await expect(page.locator('#bm-label')).toHaveText('e2e@dev');
}

test.describe('Inspector SPA — per-tab restore', () => {

    test('01 — the default active tab is `data` (the control the restore asserts against)', async ({ page }) => {
        await gotoInspector(page);
        await expect(page.locator('.bm-tab.active')).toHaveAttribute('data-tab', 'data');
        await expect(page.locator('.bm-panel.active')).toHaveId('tab-data');
    });

    test('02 — switching to `query` persists and survives a reload', async ({ page }) => {
        await gotoInspector(page);
        await page.locator('.bm-tab[data-tab="query"]').click();
        await expect(page.locator('.bm-tab.active')).toHaveAttribute('data-tab', 'query');
        // The persisted value must be written BEFORE the reload — assert it,
        // so a restore-looking pass can never come from a cached page state.
        expect(await page.evaluate(() => localStorage.getItem('__gina_inspector_tab'))).toBe('query');

        await page.reload();
        await expect(page.locator('#bm-label')).toHaveText('e2e@dev');
        await expect(page.locator('.bm-tab.active')).toHaveAttribute('data-tab', 'query');
        await expect(page.locator('.bm-panel.active')).toHaveId('tab-query');
        // Exactly one tab and one panel active after the restore — the switch
        // must MOVE the active state, not add a second one.
        expect(await page.locator('.bm-tab.active').count()).toBe(1);
        expect(await page.locator('.bm-panel.active').count()).toBe(1);
    });

    test('03 — the restored tab persists across a SECOND reload without re-clicking', async ({ page }) => {
        await gotoInspector(page);
        await page.locator('.bm-tab[data-tab="events"]').click();
        await page.reload();
        await expect(page.locator('#bm-label')).toHaveText('e2e@dev');
        await expect(page.locator('.bm-tab.active')).toHaveAttribute('data-tab', 'events');
        // Second reload — the restore path itself must re-persist (switchTab
        // writes the key on every call, including the boot-time restore call).
        await page.reload();
        await expect(page.locator('#bm-label')).toHaveText('e2e@dev');
        await expect(page.locator('.bm-tab.active')).toHaveAttribute('data-tab', 'events');
    });
});
