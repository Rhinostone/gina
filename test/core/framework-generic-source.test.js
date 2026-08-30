'use strict';
/**
 * Shipped framework source must be framework-GENERIC — no consuming app's name
 * in it (#B445).
 *
 * gina is a general-purpose framework whose source ships verbatim in the npm
 * tarball, so a comment naming a particular consuming application is published
 * to every user of the package. It also ages badly as documentation: a future
 * maintainer reading "patched for <SomeCompany>" learns who asked for the code,
 * not what it does or why it is needed.
 *
 * Measured origin: `core/model/entity.js` carried `// patched for <consumer>:
 * case when emit occurs before listener is ready` on the preemptive-buffer
 * `.once()` handler, and it was present in the PUBLISHED `gina@0.6.20` tarball
 * at `package/framework/v0.6.20/core/model/entity.js` (extracted and grepped,
 * with a firing control). Reworded to describe the behaviour — the reason the
 * handler exists is preserved, the name is gone.
 *
 * Scope of this guard, stated honestly: it is a CURATED marker list, not a
 * general "is this text generic" detector — no such test is possible. It locks
 * the markers actually known to have leaked plus a few whose appearance would
 * always be a leak. Ordinary English words that could legitimately occur in
 * framework prose are deliberately NOT listed; a scan broad enough to catch
 * those would false-positive and get weakened, which is worse than a narrow
 * scan that stays trustworthy.
 *
 * Excluded from the scan, with reasons:
 *   - `dist/`      — build output; a leak there originates in src and is caught there
 *   - vendored     — third-party payloads we do not author (the public-suffix
 *                    list legitimately contains `encoreapi.com`, which matches a
 *                    naive `coreapi` needle; measured, and the reason vendored
 *                    trees are excluded rather than the needle narrowed)
 *
 * Red-first: validated against `git show HEAD:` bytes of entity.js before the
 * fix — the scan reports the marker there and passes on the corrected source.
 */

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs     = require('fs');
var path   = require('path');
var { execFileSync } = require('child_process');

var FW   = require(path.join(__dirname, '..', 'fw'));
var REPO = path.resolve(__dirname, '..', '..');

/**
 * Markers whose presence in authored framework source is always a leak.
 * Case-insensitive substring match.
 * @constant {string[]}
 */
var CONSUMER_MARKERS = [
    'Air Liquide',
    'vatExemption',
    'Seqino',
    'freelancer-app',
    'freelancerapp'
];

/** Path fragments whose contents this guard does not author. @constant {string[]} */
var EXCLUDED = ['/dist/', '/vendor/', '/node_modules/'];

/**
 * Tracked, authored source files of the active framework directory.
 * Uses git so untracked scratch files can never influence the result.
 * @inner
 */
function trackedSource() {
    var rel = path.relative(REPO, FW);
    var out = execFileSync('git', ['ls-files', '--', rel], { cwd: REPO, encoding: 'utf8' });
    return out.split('\n').filter(function (p) {
        if (!p) { return false; }
        if (!/\.(js|json|md|txt|scss|css|html)$/.test(p)) { return false; }
        for (var i = 0; i < EXCLUDED.length; i++) {
            if (p.indexOf(EXCLUDED[i]) > -1) { return false; }
        }
        return true;
    });
}

/** Every (file, marker) hit across the scanned corpus. @inner */
function scan(files, markers) {
    var hits = [];
    files.forEach(function (rel) {
        var body;
        try { body = fs.readFileSync(path.join(REPO, rel), 'utf8'); } catch (e) { return; }
        var lower = body.toLowerCase();
        markers.forEach(function (m) {
            if (lower.indexOf(m.toLowerCase()) > -1) { hits.push(rel + ' :: ' + m); }
        });
    });
    return hits;
}

var FILES = trackedSource();


describe('01 - the scan instrument (a scan that cannot fire is not a guard)', function () {

    it('the corpus is non-empty and contains the file the leak was found in', function () {
        assert.ok(FILES.length > 50, 'scanned only ' + FILES.length + ' files - the corpus collapsed');
        assert.ok(FILES.some(function (p) { return /core\/model\/entity\.js$/.test(p); }),
            'entity.js must be inside the scanned corpus');
    });

    it('CONTROL: the scan fires on a marker that IS present', function () {
        // 'mergeArray' is real framework source text; if this reads zero the
        // scanner is broken and every zero it reports below is meaningless.
        var control = scan(FILES, ['mergeArray']);
        assert.ok(control.length > 0, 'the scanner failed to find a known-present token');
    });

    it('CONTROL: the scan does NOT fire on a token that is absent', function () {
        assert.equal(scan(FILES, ['zzz-not-a-real-marker-zzz']).length, 0);
    });

    it('the vendored exclusion is load-bearing, not decorative', function () {
        // The vendored public-suffix list contains 'encoreapi.com'. Without the
        // exclusion a naive consumer-name needle would match upstream data.
        var vendored = FILES.filter(function (p) { return p.indexOf('/vendor/') > -1; });
        assert.equal(vendored.length, 0, 'vendored paths leaked into the scanned corpus');
    });
});


describe('02 - no consuming application is named in shipped framework source (#B445)', function () {

    it('every curated consumer marker is absent', function () {
        var hits = scan(FILES, CONSUMER_MARKERS);
        assert.deepEqual(hits, [],
            'consumer name(s) found in authored framework source:\n  ' + hits.join('\n  '));
    });

    it('the preemptive-buffer comment still explains WHY the handler exists', function () {
        // Genericising must not degrade the comment into a bare marker: the
        // reason (an emit arriving before its listener) is the load-bearing part.
        var src = fs.readFileSync(path.join(FW, 'core/model/entity.js'), 'utf8');
        var idx = src.indexOf('.once(trigger, function () {');
        assert.ok(idx > -1, 'the preemptive-buffer handler is still present');
        var line = src.substring(idx, src.indexOf('\n', idx));
        assert.ok(/before its listener is attached/.test(line),
            'the emit-before-listener rationale must survive the rewording');
    });
});
