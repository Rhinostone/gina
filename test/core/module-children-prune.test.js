/**
 * module-children-prune.test.js
 *
 * Dev-mode eviction leak guard.
 *
 * Per-request delete-and-re-require cycles (refreshCore() in the isaac engine,
 * refreshCoreDependencies() in the router) push a fresh Module onto the requiring
 * module's `children` array on every cache miss — Node only dedupes on cache
 * hits. Without pruning, long-lived parents accumulate dead Module instances
 * whose exports pin whole per-request graphs: measured ~1.8 MB of post-GC live
 * heap per request on a minimal dev bundle, heap-limit OOM (SIGABRT) at ~2400
 * requests.
 *
 * Locks:
 *   §01 server.isaac.js — pruneDeadModuleChildren defined + called at the END of
 *       refreshCore() (after the plugins re-require), with the cache-current
 *       filter predicate.
 *   §02 router.js — local copy defined + called inside refreshCoreDependencies()
 *       after the controller re-require.
 *   §03 pure-logic replica — eviction grows module.children; the shipped prune
 *       body keeps only cache-current instances and leaves exports functional.
 *       Includes the subtract case: without the prune, children grows unbounded.
 */

var assert = require('assert');
var test = require('node:test');
var fs = require('fs');
var os = require('os');
var path = require('path');

var BASE = path.join(__dirname, '..', '..');
var FRAMEWORK_DIR = fs.readdirSync(path.join(BASE, 'framework'))
    .filter(function(d) { return /^v\d/.test(d); })
    .sort()
    .pop();
var ISAAC_PATH = path.join(BASE, 'framework', FRAMEWORK_DIR, 'core', 'server.isaac.js');
var ROUTER_PATH = path.join(BASE, 'framework', FRAMEWORK_DIR, 'core', 'router.js');
var ISAAC_SRC = fs.readFileSync(ISAAC_PATH, 'utf8');
var ROUTER_SRC = fs.readFileSync(ROUTER_PATH, 'utf8');

test('§01 server.isaac.js: pruneDeadModuleChildren is defined', function() {
    assert.ok(
        ISAAC_SRC.indexOf('var pruneDeadModuleChildren = function()') > -1,
        'server.isaac.js must define pruneDeadModuleChildren'
    );
});

test('§01 server.isaac.js: refreshCore() ends with the prune (after the plugins re-require)', function() {
    // Structural anchor: the plugins re-assignment is the last eviction step in
    // refreshCore(); the prune call must follow it within the same function body.
    var anchor = ISAAC_SRC.indexOf('.exports.plugins = freshPlugins;');
    assert.ok(anchor > -1, 'plugins re-require anchor not found');
    assert.match(
        ISAAC_SRC.slice(anchor),
        /^\.exports\.plugins = freshPlugins;[\s\S]{0,200}?pruneDeadModuleChildren\(\);/,
        'refreshCore() must call pruneDeadModuleChildren() after the plugins re-require'
    );
});

test('§01 server.isaac.js: prune keeps only cache-current children', function() {
    assert.match(
        ISAAC_SRC,
        /cached\.children = cached\.children\.filter\(function onPruneFilter\(child\) \{\s*return require\.cache\[child\.id\] === child;/,
        'prune predicate must keep only Modules still current in require.cache'
    );
});

test('§02 router.js: local pruneDeadModuleChildren copy is defined', function() {
    assert.ok(
        ROUTER_SRC.indexOf('var pruneDeadModuleChildren = function()') > -1,
        'router.js must define its local pruneDeadModuleChildren copy'
    );
});

test('§02 router.js: refreshCoreDependencies() prunes after the controller re-require', function() {
    var anchor = ROUTER_SRC.indexOf('SuperController = require(');
    assert.ok(anchor > -1, 'controller re-require anchor not found');
    assert.match(
        ROUTER_SRC.slice(anchor),
        /^SuperController = require\([\s\S]{0,400}?pruneDeadModuleChildren\(\);/,
        'refreshCoreDependencies() must call pruneDeadModuleChildren() after re-requiring the controller'
    );
});

test('§02 router.js: prune keeps only cache-current children', function() {
    assert.match(
        ROUTER_SRC,
        /cached\.children = cached\.children\.filter\(function onPruneFilter\(child\) \{\s*return require\.cache\[child\.id\] === child;/,
        'router copy must use the same cache-current predicate'
    );
});

test('§03 replica: eviction grows children unbounded; prune releases dead Modules, exports stay functional', function() {
    var tmpFile = path.join(os.tmpdir(), 'gina-prune-replica-' + process.pid + '.js');
    fs.writeFileSync(tmpFile, 'module.exports = { marker: "live", payload: new Array(100).fill("x") };');
    var resolved = require.resolve(tmpFile);
    var baseline = module.children.length;

    try {
        // Subtract case — the leak shape without the prune: every cache-miss
        // require pushes a fresh dead Module onto this module's children.
        for (var i = 0; i < 25; i++) {
            delete require.cache[resolved];
            require(tmpFile);
        }
        assert.strictEqual(
            module.children.length,
            baseline + 25,
            'delete-and-re-require must grow children by one dead Module per cycle (leak repro)'
        );

        // Cache-hit requires must NOT grow children (why prod is bounded).
        for (var j = 0; j < 25; j++) {
            require(tmpFile);
        }
        assert.strictEqual(
            module.children.length,
            baseline + 25,
            'cache-hit requires must not grow children (Node dedupes on hits)'
        );

        // Shipped prune body, replicated verbatim.
        var cacheIds = Object.keys(require.cache);
        for (var k = 0, len = cacheIds.length; k < len; k++) {
            var cached = require.cache[cacheIds[k]];
            if (cached && cached.children && cached.children.length > 0) {
                cached.children = cached.children.filter(function onPruneFilter(child) {
                    return require.cache[child.id] === child;
                });
            }
        }

        var survivors = module.children.filter(function(c) { return c.id === resolved; });
        assert.strictEqual(survivors.length, 1, 'exactly the cache-current Module must survive the prune');
        assert.strictEqual(
            module.children.length <= baseline + 1,
            true,
            'all dead Modules must be released from children'
        );
        assert.strictEqual(require(tmpFile).marker, 'live', 'exports must remain functional after pruning');
    } finally {
        delete require.cache[resolved];
        try { fs.unlinkSync(tmpFile); } catch (e) { /* best effort */ }
        module.children = module.children.filter(function(c) { return c.id !== resolved; });
    }
});
