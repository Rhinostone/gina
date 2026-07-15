/**
 * Boot-time wiring for the render/output-cache redis L2 (#RC4 / #B114).
 *
 * Two boot surfaces:
 *  - core/config.js — the #B114 fold: settings.json's top-level `cache` block
 *    ({type,store}) is source-filled into the runtime `server.cache` (which carries
 *    env.json's enable/path/ttl/…), so the documented bundle-wide default actually
 *    takes effect and redis can name its `store`. Source-fill (merge override=false):
 *    env.json keys WIN, settings.json fills only type/store.
 *  - core/gna.js — the RC4 boot block: validateConfig runs, warnings ALWAYS log, and
 *    (F4) a fatal ABORTS + the ioredis store is BUILT only when the cache is enabled
 *    (server.cache.enable === 'true'); disabled → the fatal downgrades to a loud warn
 *    and no redis connection opens (the config is inert while disabled).
 *
 * §01 pins the config.js fold + a real-lib/merge direction check. §02 pins the gna.js
 * RC4 block + a behavioural replica of the F4 gate decision.
 */

'use strict';

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW         = require('../fw');
var CONFIG_SRC = fs.readFileSync(path.join(FW, 'core/config.js'), 'utf8');
var GNA_SRC    = fs.readFileSync(path.join(FW, 'core/gna.js'), 'utf8');
var merge      = require(path.join(FW, 'lib/merge/src/main'));


describe('01 - config.js #B114 settings→server.cache fold', function() {

    it('folds only when settings.cache is present', function() {
        assert.match(CONFIG_SRC, /if\s*\(\s*conf\[bundle\]\[env\]\.content\.settings\s*&&\s*conf\[bundle\]\[env\]\.content\.settings\.cache\s*\)/);
    });

    it('merges server.cache (target) with settings.cache (source) — source-fill direction', function() {
        // target = server.cache (env.json) first ⇒ env keys win; source = settings.cache
        // second ⇒ fills type/store only.
        assert.match(CONFIG_SRC, /conf\[bundle\]\[env\]\.server\.cache\s*=\s*merge\(\s*conf\[bundle\]\[env\]\.server\.cache\s*,\s*conf\[bundle\]\[env\]\.content\.settings\.cache\s*\)/);
    });

    it('creates server.cache when env.json omitted it', function() {
        assert.match(CONFIG_SRC, /if\s*\(\s*typeof\(conf\[bundle\]\[env\]\.server\.cache\)\s*==\s*'undefined'\s*\)\s*\{\s*conf\[bundle\]\[env\]\.server\.cache\s*=\s*\{\}/);
    });

    it('carries the #B114 rationale comment', function() {
        assert.match(CONFIG_SRC, /#B114 — fold the bundle-wide render\/output-cache defaults/);
    });

    // Behavioural: the REAL lib/merge, in the fold's exact argument order.
    it('BEHAVIOUR: env.json keys win; settings fills type/store (real lib/merge)', function() {
        var serverCache = { enable: false, path: '/c', ttl: 3600, sliding: false, maxEntries: 1000 };
        var settings    = { type: 'redis', store: 'cacheRedis', ttl: 99 };
        var folded = merge(serverCache, settings);
        assert.equal(folded.type, 'redis', 'type filled from settings');
        assert.equal(folded.store, 'cacheRedis', 'store filled from settings');
        assert.equal(folded.ttl, 3600, 'env.json ttl WINS over the settings default (override=false)');
        assert.equal(folded.enable, false, 'env.json enable preserved');
    });

    it('BEHAVIOUR: an env.json `type` override beats the settings default', function() {
        var folded = merge({ type: 'memory', enable: true }, { type: 'redis', store: 'x' });
        assert.equal(folded.type, 'memory', 'a per-env env.json type wins over the bundle-wide settings type');
        assert.equal(folded.store, 'x', 'store still filled (env.json had none)');
    });
});


describe('02 - gna.js RC4 boot block (validate + F4 enable-gate + store build)', function() {

    var rcStart = GNA_SRC.indexOf('// #RC4 — render/output-cache redis L2.');
    var rcEnd   = GNA_SRC.indexOf("console.warn('[render-cache] config validation skipped:", rcStart);
    var rcBlock = GNA_SRC.slice(rcStart, rcEnd > rcStart ? rcEnd + 120 : rcStart + 3000);

    it('locates the RC4 boot block', function() {
        assert.ok(rcStart > -1 && rcEnd > rcStart, 'RC4 block present');
    });

    it('reads the resolved server.cache and calls validateConfig with the routing map + bundle', function() {
        assert.match(rcBlock, /config\.getInstance\(\)\[gna\.core\.startingApp\]\[env\]\.server\.cache/);
        assert.match(rcBlock, /lib\.RenderCache\.validateConfig\(\s*_rcServerCache\s*,\s*_rcRouting\s*\|\|\s*\{\}\s*,\s*gna\.core\.startingApp\s*\)/);
    });

    it('F4: derives _rcEnabled from server.cache.enable === "true"', function() {
        assert.match(rcBlock, /var\s+_rcEnabled\s*=\s*String\(_rcServerCache\.enable\)\.toLowerCase\(\)\s*===\s*'true'/);
    });

    it('logs warnings UNCONDITIONALLY (the for-loop precedes the fatal/enable gates)', function() {
        var warnLoop = rcBlock.indexOf('for (var _rcW = 0');
        var fatalAt  = rcBlock.indexOf('if (_rcCheck.fatal)');
        assert.ok(warnLoop > -1 && fatalAt > -1 && warnLoop < fatalAt, 'warnings log before any gate');
    });

    it('F4: a fatal ABORTS only when enabled, else downgrades to a loud warn', function() {
        var fatalAt = rcBlock.indexOf('if (_rcCheck.fatal)');
        assert.ok(fatalAt > -1);
        // enabled arm (structural, span-robust): emerg BEFORE exit(1), both inside it.
        var enAt   = rcBlock.indexOf('if (_rcEnabled) {', fatalAt);
        var elseAt = rcBlock.indexOf('} else {', enAt);
        assert.ok(enAt > fatalAt && elseAt > enAt, 'the fatal block has an _rcEnabled arm + else');
        var enabledArm = rcBlock.slice(enAt, elseAt);
        var emergIdx = enabledArm.indexOf('console.emerg(_rcFatalMsg)');
        var exitIdx  = enabledArm.indexOf('process.exit(1)');
        assert.ok(emergIdx > -1 && exitIdx > emergIdx, 'enabled arm: emerg then exit(1)');
        // disabled arm warns about the future abort.
        assert.match(rcBlock.slice(elseAt, elseAt + 400), /WOULD abort boot once enabled/);
    });

    it('F4: the store is built only when redisConfigured AND enabled', function() {
        assert.match(rcBlock, /if\s*\(_rcCheck\.redisConfigured\s*&&\s*_rcEnabled\)/);
        assert.match(rcBlock, /process\.gina\._renderCacheStore\s*=\s*lib\.RenderCacheStore\(_rcServerCache\.store\)/);
    });

    it('a store BUILD failure is fatal (fail-fast, boot-exit-flush)', function() {
        var buildAt = rcBlock.indexOf('lib.RenderCacheStore(_rcServerCache.store)');
        var catchAt = rcBlock.indexOf('catch (rcStoreErr)', buildAt);
        assert.ok(catchAt > buildAt, 'the build is wrapped in a rcStoreErr catch');
        var catchArm = rcBlock.slice(catchAt, catchAt + 600);
        assert.match(catchArm, /console\.emerg/);
        assert.match(catchArm, /process\.exit\(1\)/);
    });

    // Behavioural replica of the F4 gate decision.
    function decide(check, enabled) {
        var out = { warnings: (check.warnings || []).slice(), aborted: false, downgradedWarn: null, storeBuilt: false };
        // warnings ALWAYS (surfaced above the gates in the real block)
        if (check.fatal) {
            if (enabled) { out.aborted = true; return out; } // process.exit(1) — nothing below runs
            out.downgradedWarn = check.fatal;                // disabled → warn, fall through (no build)
        }
        if (check.redisConfigured && enabled) { out.storeBuilt = true; }
        return out;
    }

    it('REPLICA: fatal + enabled → abort, no store', function() {
        var d = decide({ fatal: 'no store', warnings: [], redisConfigured: true }, true);
        assert.equal(d.aborted, true);
        assert.equal(d.storeBuilt, false, 'never reaches the build past the abort');
    });

    it('REPLICA: fatal + DISABLED → no abort, downgraded warn, no store (inert config)', function() {
        var d = decide({ fatal: 'no store', warnings: [], redisConfigured: true }, false);
        assert.equal(d.aborted, false);
        assert.equal(d.downgradedWarn, 'no store');
        assert.equal(d.storeBuilt, false, 'no ioredis connection opens for a disabled cache');
    });

    it('REPLICA: redisConfigured + enabled (no fatal) → store built', function() {
        var d = decide({ fatal: null, warnings: [], redisConfigured: true }, true);
        assert.equal(d.aborted, false);
        assert.equal(d.storeBuilt, true);
    });

    it('REPLICA: redisConfigured + DISABLED → no store built', function() {
        var d = decide({ fatal: null, warnings: [], redisConfigured: true }, false);
        assert.equal(d.storeBuilt, false);
    });

    it('REPLICA: warnings always surface regardless of enabled', function() {
        var d1 = decide({ fatal: null, warnings: ['w1'], redisConfigured: false }, true);
        var d2 = decide({ fatal: null, warnings: ['w1'], redisConfigured: false }, false);
        assert.deepEqual(d1.warnings, ['w1']);
        assert.deepEqual(d2.warnings, ['w1']);
    });
});
