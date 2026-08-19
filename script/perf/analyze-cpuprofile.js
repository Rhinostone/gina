'use strict';
/**
 * analyze-cpuprofile.js — self-time aggregation of a V8 `.cpuprofile` by
 * acceleration-candidate bucket (#P34, the native-acceleration arc's gate).
 *
 * Reads one or more `.cpuprofile` files (as written by `node --cpu-prof`) and
 * reports, per file: total sampled time, self-time per candidate bucket
 * (multipart scan, ws-framing codec, getAssets, render delegates, swig engine,
 * logger, router/server/controller layers, GC, node internals, idle), and the
 * top individual frames by self-time. This is the conviction surface for
 * #P35-#P38: a candidate whose bucket stays flat under its own arm's load is
 * acquitted.
 *
 * Attribution model: `selfTime[node] = sum(timeDeltas[i] where samples[i] is
 * that node)` — the standard sampling approximation (each inter-sample delta
 * is attributed to the sample that ends it; negative deltas are clamped to 0).
 * A whole-process profile includes boot: module compile/require frames land in
 * their own visible buckets, so request-path buckets stay attributable.
 *
 * Usage:
 *   node script/perf/analyze-cpuprofile.js <file.cpuprofile> [...more]
 *   node script/perf/analyze-cpuprofile.js --json <file.cpuprofile>
 *   node script/perf/analyze-cpuprofile.js --callers JSONClone <file.cpuprofile>
 *
 * Standalone by design — no framework globals, require()-able by the
 * profile-baseline orchestrator (module.exports.analyze).
 */

var fs   = require('fs');
var path = require('path');

/**
 * Candidate buckets, first-match ordering. Frame-name tests (GC/program/idle)
 * come before URL tests because those frames carry empty urls; specific
 * framework surfaces come before the generic framework catch-all.
 *
 * @constant {Array<{key: string, test: function}>}
 */
var BUCKETS = [
    { key: 'GC',                            test: function (fn, url) { return fn === '(garbage collector)'; } },
    { key: 'idle',                          test: function (fn, url) { return fn === '(idle)'; } },
    { key: 'program (V8/native)',           test: function (fn, url) { return fn === '(program)'; } },
    { key: 'multipart scan (streamsearch/busboy)', test: function (fn, url) { return /streamsearch|@rhinostone\/busboy/.test(url); } },
    { key: 'ws codec (lib/ws-framing)',     test: function (fn, url) { return /lib\/ws-framing/.test(url); } },
    { key: 'ws session (lib/ws-session)',   test: function (fn, url) { return /lib\/ws-session/.test(url); } },
    { key: 'getAssets (core/server.js)',    test: function (fn, url) { return fn === 'getAssets'; } },
    { key: 'render delegates (controller.render-*)', test: function (fn, url) { return /controller\/controller\.render-/.test(url); } },
    { key: 'swig engine (@rhinostone/swig)', test: function (fn, url) { return /@rhinostone\/swig/.test(url); } },
    { key: 'logger (lib/logger)',           test: function (fn, url) { return /lib\/logger/.test(url); } },
    { key: 'deep clone (utils/prototypes JSONClone)', test: function (fn, url) { return /utils\/prototypes\.json_clone/.test(url); } },
    { key: 'framework utils (utils/)',      test: function (fn, url) { return /gina[^/]*\/utils\//.test(url); } },
    { key: 'merge/collection (lib)',        test: function (fn, url) { return /\/(merge|collection)\/src\//.test(url); } },
    { key: 'router (core/router.js)',       test: function (fn, url) { return /core\/router\.js/.test(url); } },
    { key: 'server core (core/server*.js)', test: function (fn, url) { return /core\/server/.test(url); } },
    { key: 'controller core (core/controller)', test: function (fn, url) { return /core\/controller/.test(url); } },
    { key: 'framework other',               test: function (fn, url) { return /framework\/v[0-9]|node_modules\/gina\//.test(url); } },
    { key: 'bundle app code',               test: function (fn, url) { return /\/releases\/|\/src\/[^/]+\/(controllers|templates|index\.js)/.test(url); } },
    { key: 'node internals',                test: function (fn, url) { return url.indexOf('node:') === 0; } },
    { key: 'other JS',                      test: function ()        { return true; } }
];

/**
 * Aggregate one parsed profile into bucket self-times.
 *
 * @param   {object} profile - parsed `.cpuprofile` JSON ({nodes, samples, timeDeltas})
 * @returns {{totalUs: number, buckets: object, frames: Array}} totals in microseconds
 */
function analyze(profile) {
    var byId = {};
    var i;
    for (i = 0; i < profile.nodes.length; i++) {
        byId[profile.nodes[i].id] = profile.nodes[i];
    }

    var selfUs = {};
    var samples = profile.samples || [];
    var deltas  = profile.timeDeltas || [];
    for (i = 0; i < samples.length; i++) {
        var d = deltas[i] > 0 ? deltas[i] : 0;
        selfUs[samples[i]] = (selfUs[samples[i]] || 0) + d;
    }

    var buckets = {};
    var frames  = [];
    var totalUs = 0;
    for (i = 0; i < BUCKETS.length; i++) {
        buckets[BUCKETS[i].key] = 0;
    }

    Object.keys(selfUs).forEach(function (id) {
        var node = byId[id];
        if (!node) { return; }
        var cf  = node.callFrame || {};
        var fn  = cf.functionName || '';
        var url = cf.url || '';
        var us  = selfUs[id];
        totalUs += us;

        for (var b = 0; b < BUCKETS.length; b++) {
            if (BUCKETS[b].test(fn, url)) {
                buckets[BUCKETS[b].key] += us;
                break;
            }
        }
        frames.push({
            us   : us,
            fn   : fn || '(anonymous)',
            url  : url,
            line : (typeof cf.lineNumber === 'number') ? cf.lineNumber + 1 : null
        });
    });

    frames.sort(function (a, b) { return b.us - a.us; });
    return { totalUs: totalUs, buckets: buckets, frames: frames };
}

/**
 * Render one analysis as a human-readable table.
 *
 * @param   {string} label
 * @param   {{totalUs: number, buckets: object, frames: Array}} result
 * @param   {number} [topN=15]
 * @returns {string}
 */
function format(label, result, topN) {
    topN = topN || 15;
    var out = [];
    out.push('══ ' + label + ' — total sampled self-time: ' + (result.totalUs / 1000).toFixed(1) + ' ms');
    Object.keys(result.buckets)
        .map(function (k) { return { k: k, us: result.buckets[k] }; })
        .sort(function (a, b) { return b.us - a.us; })
        .forEach(function (row) {
            if (row.us === 0) { return; }
            var pct = (100 * row.us / result.totalUs).toFixed(2);
            out.push('  ' + pad(pct + '%', 8) + pad((row.us / 1000).toFixed(1) + ' ms', 12) + row.k);
        });
    out.push('  ── top ' + topN + ' frames by self-time:');
    result.frames.slice(0, topN).forEach(function (f) {
        var loc = f.url ? (shorten(f.url) + (f.line ? ':' + f.line : '')) : '';
        out.push('  ' + pad((f.us / 1000).toFixed(1) + ' ms', 12) + f.fn + (loc ? '  @ ' + loc : ''));
    });
    return out.join('\n');
}

/**
 * Attribute one function's self-time to its CALLERS — the §8 caller-attribution
 * walk, promoted out of session scratch (audit `2026-07-28-rust-acceleration.md`
 * § 8 harness micro-followup).
 *
 * Self-time is aggregated per *nearest non-recursive ancestor*: walking up from
 * a matching node, ancestors bearing the SAME function name are skipped, so a
 * self-recursive callee (`JSONClone` recursing through an object graph) is
 * attributed to the frame that entered the recursion rather than to itself.
 * Without that skip a recursive function reports itself as its own top caller
 * and the reading is worthless.
 *
 * @param   {object} profile - parsed `.cpuprofile` JSON ({nodes, samples, timeDeltas})
 * @param   {string} fnName  - exact `callFrame.functionName` to attribute
 * @returns {{fn: string, totalUs: number, callers: Array<{fn: string, url: string, line: ?number, us: number}>}}
 * @example
 * // which call sites pay for the deep clone?
 * callers(profile, 'JSONClone').callers[0];  // => { fn: 'getInstance', url: '.../swig-filters/src/main.js', us: 11050000 }
 */
function callers(profile, fnName) {
    var byId     = {};
    var parentOf = {};
    var i;
    for (i = 0; i < profile.nodes.length; i++) {
        var n = profile.nodes[i];
        byId[n.id] = n;
        var kids = n.children || [];
        for (var k = 0; k < kids.length; k++) { parentOf[kids[k]] = n.id; }
    }

    var selfUs  = {};
    var samples = profile.samples || [];
    var deltas  = profile.timeDeltas || [];
    for (i = 0; i < samples.length; i++) {
        var d = deltas[i] > 0 ? deltas[i] : 0;
        selfUs[samples[i]] = (selfUs[samples[i]] || 0) + d;
    }

    var agg     = {};
    var totalUs = 0;
    Object.keys(selfUs).forEach(function (id) {
        var node = byId[id];
        if (!node) { return; }
        if (((node.callFrame || {}).functionName || '') !== fnName) { return; }

        var us = selfUs[id];
        totalUs += us;

        // nearest ancestor whose name differs — skips the recursive chain
        var pid = parentOf[id];
        var anc = null;
        while (typeof pid !== 'undefined') {
            var p = byId[pid];
            if (!p) { break; }
            if (((p.callFrame || {}).functionName || '') !== fnName) { anc = p; break; }
            pid = parentOf[pid];
        }

        var cf  = anc ? (anc.callFrame || {}) : {};
        var key = (cf.functionName || '(root)') + '\u0000' + (cf.url || '') + '\u0000' + (cf.lineNumber || '');
        if (!agg[key]) {
            agg[key] = {
                fn   : cf.functionName || '(root)',
                url  : cf.url || '',
                line : (typeof cf.lineNumber === 'number') ? cf.lineNumber + 1 : null,
                us   : 0
            };
        }
        agg[key].us += us;
    });

    var rows = Object.keys(agg).map(function (k) { return agg[k]; });
    rows.sort(function (a, b) { return b.us - a.us; });
    return { fn: fnName, totalUs: totalUs, callers: rows };
}

/**
 * Render a caller attribution as a human-readable table.
 *
 * @param   {string} label
 * @param   {{fn: string, totalUs: number, callers: Array}} result
 * @param   {number} [topN=15]
 * @returns {string}
 * @example
 * formatCallers('render.cpuprofile', callers(profile, 'JSONClone'));
 */
function formatCallers(label, result, topN) {
    topN = topN || 15;
    var out = [];
    out.push('== ' + label + ' - callers of `' + result.fn + '` - attributed self-time: '
             + (result.totalUs / 1000).toFixed(1) + ' ms');
    if (!result.totalUs) {
        out.push('  (no samples matched `' + result.fn + '` - check the exact functionName)');
        return out.join('\n');
    }
    result.callers.slice(0, topN).forEach(function (c) {
        var pct = (100 * c.us / result.totalUs).toFixed(2);
        var loc = c.url ? (shorten(c.url) + (c.line ? ':' + c.line : '')) : '';
        out.push('  ' + pad(pct + '%', 8) + pad((c.us / 1000).toFixed(1) + ' ms', 12) + c.fn + (loc ? '  @ ' + loc : ''));
    });
    return out.join('\n');
}

/**
 * @param   {string} s
 * @param   {number} n
 * @returns {string} left-padded to n + two trailing spaces
 * @inner
 */
function pad(s, n) {
    while (s.length < n) { s = ' ' + s; }
    return s + '  ';
}

/**
 * @param   {string} url
 * @returns {string} the last 3 path segments — enough to identify a frame
 * @inner
 */
function shorten(url) {
    var parts = url.split('/');
    return parts.slice(Math.max(0, parts.length - 3)).join('/');
}

module.exports = { analyze: analyze, format: format, callers: callers, formatCallers: formatCallers, BUCKETS: BUCKETS };

if (require.main === module) {
    var args       = process.argv.slice(2);
    var asJson     = args.indexOf('--json') > -1;
    var callersIdx = args.indexOf('--callers');
    var callersFn  = (callersIdx > -1) ? args[callersIdx + 1] : null;
    // `--callers` takes a value, so its operand must not be mistaken for a file
    var files  = args.filter(function (a, i) {
        if (a.indexOf('--') === 0) { return false; }
        if (callersIdx > -1 && i === callersIdx + 1) { return false; }
        return true;
    });
    var USAGE = 'usage: node script/perf/analyze-cpuprofile.js [--json] [--callers <functionName>] <file.cpuprofile> [...]\n';
    if (callersIdx > -1 && (!callersFn || callersFn.indexOf('--') === 0)) {
        process.stderr.write('--callers requires a functionName operand\n' + USAGE);
        process.exit(2);
    }
    if (!files.length) {
        process.stderr.write(USAGE);
        process.exit(2);
    }
    var all = {};
    files.forEach(function (f) {
        var profile = JSON.parse(fs.readFileSync(f, 'utf8'));
        if (callersFn) {
            var attr = callers(profile, callersFn);
            if (asJson) {
                all[path.basename(f)] = { fn: attr.fn, totalUs: attr.totalUs, callers: attr.callers.slice(0, 20) };
            } else {
                process.stdout.write(formatCallers(path.basename(f), attr) + '\n\n');
            }
            return;
        }
        var result = analyze(profile);
        if (asJson) {
            all[path.basename(f)] = { totalUs: result.totalUs, buckets: result.buckets, top: result.frames.slice(0, 20) };
        } else {
            process.stdout.write(format(path.basename(f), result) + '\n\n');
        }
    });
    if (asJson) {
        process.stdout.write(JSON.stringify(all, null, 2) + '\n');
    }
}
