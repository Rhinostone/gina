'use strict';

/**
 * Playwright RUNTIME e2e for the Inspector's copy-to-clipboard family.
 *
 * WHY HERE. All `navigator.clipboard` call sites in the framework live inside
 * inspector.js — this is the whole clipboard surface, and it had never executed in a
 * real engine. Two DISTINCT code paths are driven (not two buttons through one path):
 *   - the delegated `.bm-copyable` handler (`setupCopy`, ~4898) — click any rendered
 *     copyable leaf; `.copied` feedback is applied BEFORE the clipboard attempt, so
 *     the feedback assertion is transport-independent;
 *   - the environment copy button (`setupEnvCopy`, ~5232) — builds `k: v` lines from
 *     `ginaData.user.environment`, which under the harness stub is exactly
 *     `{ bundle:'e2e', env:'dev' }`, making the copied TEXT deterministic.
 *
 * ENGINE SCOPING. The `.copied` feedback assertions run on every engine. Reading the
 * clipboard back needs `clipboard-read`/`clipboard-write` permission grants, which only
 * Chromium's grantPermissions understands — so the content read is an ADDITIONAL
 * Chromium-only assertion inside an always-running test (never test.skip, which would
 * unbalance the cross-engine job's per-engine tallies).
 *
 * Run:
 *   npx playwright test test/e2e/inspector-copy.spec.js
 */

const { test, expect } = require('@playwright/test');

const PORT = process.env.GINA_E2E_PORT || '3179';
const BASE = 'http://localhost:' + PORT;
const SPA  = BASE + '/_gina/inspector/';
const URL  = SPA + '?target=' + encodeURIComponent(BASE) + '&transport=sse';

async function gotoInspector(page) {
    await page.goto(URL);
    await expect(page.locator('#bm-label')).toHaveText('e2e@dev');
}

test.describe('Inspector SPA — copy to clipboard', () => {

    test('01 — a .bm-copyable leaf gives `.copied` feedback through the delegated handler', async ({ page, context, browserName }) => {
        if (browserName === 'chromium') {
            await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        }
        await gotoInspector(page);
        // The data tab renders `user.data` from the second streamed frame; the
        // harness plants a root-level `engine: 'e2e-harness'` primitive so a
        // `.bm-copyable` leaf is visible without expanding any fold.
        const leaf = page.locator('#tab-data .bm-copyable').filter({ hasText: 'e2e-harness' }).first();
        await expect(leaf).toBeVisible();
        const leafText = (await leaf.textContent()).trim();
        expect(leafText).toBe('e2e-harness');

        await leaf.click();
        await expect(leaf).toHaveClass(/\bcopied\b/);
        // Feedback must be transient (removed after ~900ms), not sticky.
        await expect(leaf).not.toHaveClass(/\bcopied\b/);

        if (browserName === 'chromium') {
            const clip = await page.evaluate(() => navigator.clipboard.readText());
            expect(clip.trim(), 'the clipboard must hold the clicked leaf text').toBe(leafText);
        }
    });

    test('02 — the environment copy button copies the exact streamed identity', async ({ page, context, browserName }) => {
        if (browserName === 'chromium') {
            await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        }
        await gotoInspector(page);
        // The button lives in the settings drawer — open it first.
        await page.locator('#bm-settings-toggle').click();
        const btn = page.locator('#bm-env-copy');
        await expect(btn).toBeVisible();

        await btn.click();
        await expect(btn).toHaveClass(/\bcopied\b/);
        await expect(btn).not.toHaveClass(/\bcopied\b/);

        if (browserName === 'chromium') {
            // setupEnvCopy joins `k: v` lines from user.environment, skipping
            // object values — with the stub frame that is exactly these two.
            const clip = await page.evaluate(() => navigator.clipboard.readText());
            expect(clip, 'copied environment must match the stubbed identity').toBe('bundle: e2e\nenv: dev');
        }
    });
});
