'use strict';

/**
 * Playwright RUNTIME e2e for the Inspector SPA — standalone (`?target=`) acquisition.
 *
 * WHY THIS EXISTS. The Inspector was the last client surface with ZERO e2e (link 1 ·
 * nav 1 · popin 6 · validator 4 · web-components 3 · inspector 0 before this file). Its
 * 4 unit files (inspector.test.js, inspector-traversal, inspector-open, inspector-redact)
 * cover the SERVER handlers and library seams; nothing executed the 6k-line SPA itself.
 *
 * WHAT THE HARNESS SERVES. runtime-server.js serves the SPA off the SAME committed dist
 * the real bundle serves — the real handler (core/server.js:4622-4656) is a
 * templating-free static file reader, so the driven bytes are byte-identical to a booted
 * bundle's. The `/_gina/agent` data endpoint is a STUB pinned to the real connect
 * sequence (`:ok`, then the no-snapshot "connected" `data` frame with the bundle
 * identity). What this file therefore does NOT cover: server-frame drift in the real
 * handlers — that contract belongs to test/core/inspector.test.js.
 *
 * ACQUISITION MODES (inspector.js init, ~5840): agent (`?target=`) beats bound
 * (`?ch=`/advert) beats legacy global. WebSocket is the DEFAULT agent transport with
 * automatic SSE fallback; `?transport=sse` forces SSE outright. The harness has no
 * `upgrade` listener, so the default path exercises the REAL WS→SSE fallback.
 *
 * Run:
 *   npx playwright test test/e2e/inspector-boot.spec.js
 */

const { test, expect } = require('@playwright/test');

const PORT = process.env.GINA_E2E_PORT || '3179';
const BASE = 'http://localhost:' + PORT;
const SPA  = BASE + '/_gina/inspector/';

/**
 * Record every WebSocket / EventSource the SPA constructs, from before any SPA
 * code runs (the boot-smoke-recipes constructor-wrap lever): each entry is
 * `{ kind: 'ws'|'es', url }` on `window.__transports`.
 */
async function recordTransports(page) {
    await page.addInitScript(() => {
        window.__transports = [];
        const RealWS = window.WebSocket;
        window.WebSocket = function (url, protocols) {
            window.__transports.push({ kind: 'ws', url: String(url) });
            return protocols !== undefined ? new RealWS(url, protocols) : new RealWS(url);
        };
        window.WebSocket.prototype = RealWS.prototype;
        const RealES = window.EventSource;
        window.EventSource = function (url, cfg) {
            window.__transports.push({ kind: 'es', url: String(url) });
            return cfg !== undefined ? new RealES(url, cfg) : new RealES(url);
        };
        window.EventSource.prototype = RealES.prototype;
    });
}

test.describe('Inspector SPA boot — standalone ?target= mode', () => {

    test('01 — shell renders: tab strip, status dot and footer exist before any data', async ({ page }) => {
        await page.goto(SPA + '?target=' + encodeURIComponent(BASE) + '&transport=sse');
        // Static shell — present in index.html itself, no stream needed.
        await expect(page.locator('nav.bm-tabs')).toBeAttached();
        expect(await page.locator('.bm-tab').count()).toBeGreaterThan(0);
        await expect(page.locator('#bm-dot')).toBeAttached();
        await expect(page.locator('#bm-footer')).toBeAttached();
    });

    test('02 — forced SSE connects and shows the streamed bundle identity', async ({ page }) => {
        await recordTransports(page);
        await page.goto(SPA + '?target=' + encodeURIComponent(BASE) + '&transport=sse');
        // The stub's connected `data` frame carries { bundle:'e2e', env:'dev' } —
        // the SPA renders it as `bundle@env` and flips the dot to ok
        // (inspector.js:4562-4563). Positive evidence of a live stream, not
        // absence-of-error.
        await expect(page.locator('#bm-label')).toHaveText('e2e@dev');
        await expect(page.locator('#bm-dot')).toHaveClass(/\bok\b/);
        // `?transport=sse` must SKIP WebSocket entirely (inspector.js init:
        // the tryAgentWS() call is gated on transport !== 'sse').
        const transports = await page.evaluate(() => window.__transports);
        expect(transports.filter(t => t.kind === 'ws').length, 'forced SSE must construct no WebSocket').toBe(0);
        expect(
            transports.some(t => t.kind === 'es' && t.url.indexOf('/_gina/agent') > -1),
            'the agent SSE stream must have been opened'
        ).toBe(true);
    });

    test('03 — default transport tries WebSocket first, then REALLY falls back to SSE', async ({ page }) => {
        await recordTransports(page);
        await page.goto(SPA + '?target=' + encodeURIComponent(BASE));
        // The harness has no `upgrade` listener, so the WS attempt fails at the
        // socket and the SPA's documented fallback (tryAgentWS -> tryAgent) must
        // land on the SSE stream and still reach the identity.
        await expect(page.locator('#bm-label')).toHaveText('e2e@dev');
        await expect(page.locator('#bm-dot')).toHaveClass(/\bok\b/);
        const transports = await page.evaluate(() => window.__transports);
        expect(
            transports.some(t => t.kind === 'ws' && t.url.indexOf('/_gina/agent') > -1),
            'the default transport must have ATTEMPTED the WebSocket agent'
        ).toBe(true);
        expect(
            transports.some(t => t.kind === 'es' && t.url.indexOf('/_gina/agent') > -1),
            'the SSE fallback must have been opened after the WS failure'
        ).toBe(true);
    });

    test('04 — agent mode never degrades: no warn badge, no "No source" panel', async ({ page }) => {
        await page.goto(SPA + '?target=' + encodeURIComponent(BASE) + '&transport=sse');
        await expect(page.locator('#bm-label')).toHaveText('e2e@dev');
        // #B231 gave DEGRADED modes a warn-tinted badge; standalone agent mode
        // must never carry it, and the "No source" panel must never surface.
        // Deliberately NOT asserted: the badge SHOWING the word `agent`. In
        // `?target=` mode pollData is never scheduled (inspector.js init:
        // `if (!isAgent)` wraps the setInterval), so updateSourceModeBadge's
        // reachable-by-code `agent` branch is unreachable from this entry path
        // and the badge stays hidden — filed as a by-catch rather than pinned
        // here, so a fix that renders `agent` does not break this spec.
        await expect(page.locator('#bm-source-mode')).not.toHaveClass(/bm-source-mode-warn/);
        await expect(page.locator('#bm-no-source')).toBeHidden();
        await expect(page.locator('#bm-dot')).toHaveClass(/\bok\b/);
    });
});
