/**
 * #OW3 — opt-in Subresource Integrity for emitted asset tags (OWASP A08).
 *
 * WHY THE SHAPE IS WHAT IT IS — the constraints this suite locks:
 *
 * - FAIL-OPEN is the contract, not a best effort: an asset that cannot be
 *   honestly hashed (external URL, unresolvable path, unreadable file,
 *   missing configuration) gets NO `integrity` attribute — never a guessed
 *   or partial one. An absent attribute loads the asset exactly as before;
 *   a wrong attribute hard-blocks it. §02/§03/§08 pin every skip route.
 * - The cache is STAT-VALIDATED (`mtimeMs` + `size`), so a rebuilt or
 *   re-baked asset gets a fresh hash on the next render with no restart —
 *   the emission side can never serve a stale hash for the bytes on disk.
 *   §05 proves both the cache hit (no second read) and the invalidation.
 * - sha384 is HARDCODED on a measured safety property: 48-byte digests
 *   base64-encode to exactly 64 chars with ZERO `=` padding, which makes a
 *   false `src="` match inside a hash value structurally impossible for the
 *   server's unanchored `(src|href|srcset)=` asset-catalog scan. §06 pins
 *   the no-padding invariant so an algorithm change cannot slip in quietly.
 * - The controller wiring (both `getNodeRes` cases) computes the attribute
 *   pair BEFORE the HTTP/2 preload-hint append and suppresses the hint for
 *   SRI'd assets — a hint carries no integrity metadata, so a hinted fetch
 *   may not match the integrity-checked consumer (wasted double-fetch).
 *   §10 pins the wiring; every pin was red-first validated against the
 *   pre-change source via `git show`.
 */
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');
const crypto = require('crypto');

const ROOT    = path.join(__dirname, '..', '..');
const FW      = path.join(ROOT, 'framework');
const version = fs.readdirSync(FW).filter(d => /^v/.test(d))[0];
const FWV     = path.join(FW, version);

const sri = require(path.join(FWV, 'lib', 'sri', 'src', 'main.js'));

const CONTROLLER_SRC = fs.readFileSync(
    path.join(FWV, 'core', 'controller', 'controller.js'), 'utf8');

/** Counts non-overlapping occurrences of a literal needle. */
function count(s, needle) {
    let c = 0, i = 0;
    while ((i = s.indexOf(needle, i)) > -1) { c++; i += needle.length; }
    return c;
}

// Known vector: sha384 of the literal fixture content below, computed once
// out-of-band and hardcoded so the test pins the ALGORITHM and the FORMAT,
// not merely "crypto agrees with crypto".
const FIXTURE_CONTENT   = 'gina-sri-fixture-v1\n';
const FIXTURE_INTEGRITY = 'sha384-agv0K0aWLDzvDxoOWEsm2s7uAUYBgObriGygDyUIi7eQ/fZ00JWCG74nfkKG5qtv';

let tmp = null;
let conf = null;

before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-sri-test-'));
    fs.mkdirSync(path.join(tmp, 'public', 'js'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'mapped'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'public', 'js', 'fixture.js'), FIXTURE_CONTENT);
    fs.writeFileSync(path.join(tmp, 'mapped', 'other.js'), 'mapped-content\n');
    conf = {
        publicPath : path.join(tmp, 'public'),
        content    : { statics: {} }
    };
});

after(() => {
    if (tmp) { fs.rmSync(tmp, { recursive: true, force: true }); }
});

describe('#OW3 §01 — computeIntegrity: format and known vector', () => {
    it('01.1 returns the exact known sha384 vector for the fixture content', () => {
        const got = sri.computeIntegrity(path.join(tmp, 'public', 'js', 'fixture.js'));
        assert.strictEqual(got, FIXTURE_INTEGRITY);
    });

    it('01.2 output shape: sha384- prefix + 64 base64 chars', () => {
        const got = sri.computeIntegrity(path.join(tmp, 'public', 'js', 'fixture.js'));
        assert.match(got, /^sha384-[A-Za-z0-9+/]{64}$/);
    });
});

describe('#OW3 §02 — fail-open: every no-honest-hash route yields nothing', () => {
    it('02.1 missing file: computeIntegrity → null, attributes → empty string', () => {
        assert.strictEqual(sri.computeIntegrity(path.join(tmp, 'public', 'js', 'absent.js')), null);
        assert.strictEqual(sri.getIntegrityAttributes('/js/absent.js', conf, '/'), '');
    });

    it('02.2 directory instead of file → null / empty', () => {
        assert.strictEqual(sri.computeIntegrity(path.join(tmp, 'public', 'js')), null);
        assert.strictEqual(sri.getIntegrityAttributes('/js', conf, '/'), '');
    });

    it('02.3 missing or incomplete conf → empty, no throw', () => {
        assert.strictEqual(sri.getIntegrityAttributes('/js/fixture.js', null, '/'), '');
        assert.strictEqual(sri.getIntegrityAttributes('/js/fixture.js', {}, '/'), '');
        assert.strictEqual(sri.getIntegrityAttributes('/js/fixture.js', { publicPath: '' }, '/'), '');
    });

    it('02.4 non-string / empty url → empty, no throw', () => {
        assert.strictEqual(sri.getIntegrityAttributes('', conf, '/'), '');
        assert.strictEqual(sri.getIntegrityAttributes(null, conf, '/'), '');
        assert.strictEqual(sri.getIntegrityAttributes(undefined, conf, '/'), '');
    });
});

describe('#OW3 §03 — external URLs are never hashed from disk', () => {
    it('03.1 scheme-qualified urls are skipped', () => {
        assert.strictEqual(sri.getIntegrityAttributes('https://cdn.example.com/lib.js', conf, '/'), '');
        assert.strictEqual(sri.getIntegrityAttributes('http://cdn.example.com/lib.js', conf, '/'), '');
    });

    it('03.2 protocol-relative urls are skipped', () => {
        assert.strictEqual(sri.getIntegrityAttributes('//cdn.example.com/lib.js', conf, '/'), '');
    });
});

describe('#OW3 §04 — URL handling before resolution', () => {
    it('04.1 query and fragment suffixes are stripped for the on-disk identity', () => {
        const base = sri.getIntegrityAttributes('/js/fixture.js', conf, '/');
        assert.notStrictEqual(base, '');
        assert.strictEqual(sri.getIntegrityAttributes('/js/fixture.js?v=123', conf, '/'), base);
        assert.strictEqual(sri.getIntegrityAttributes('/js/fixture.js#frag', conf, '/'), base);
    });

    it('04.2 a webroot-prefixed url resolves against the webroot-free path', () => {
        const base = sri.getIntegrityAttributes('/js/fixture.js', conf, '/');
        assert.strictEqual(sri.getIntegrityAttributes('/myapp/js/fixture.js', conf, '/myapp/'), base);
    });

    it('04.3 webroot "/" strips nothing', () => {
        const base = sri.getIntegrityAttributes('/js/fixture.js', conf, '/');
        assert.strictEqual(sri.getIntegrityAttributes('/js/fixture.js', conf, '/'), base);
    });

    it('04.4 exact-match statics mapping wins over the publicPath fallback', () => {
        const mappedFile = path.join(tmp, 'mapped', 'other.js');
        const withMap = {
            publicPath : conf.publicPath,
            content    : { statics: { '/js/fixture.js': mappedFile } }
        };
        const got = sri.getIntegrityAttributes('/js/fixture.js', withMap, '/');
        const expected = ' integrity="' + sri.computeIntegrity(mappedFile) + '" crossorigin="anonymous"';
        assert.strictEqual(got, expected);
        // …and the mapped hash differs from the publicPath file's hash,
        // otherwise this arm could not tell the two routes apart.
        assert.notStrictEqual(sri.computeIntegrity(mappedFile),
            sri.computeIntegrity(path.join(tmp, 'public', 'js', 'fixture.js')));
    });
});

describe('#OW3 §05 — stat-validated cache', () => {
    it('05.1 second lookup is a cache hit (no re-read); a content change re-reads and re-hashes', () => {
        const file = path.join(tmp, 'public', 'js', 'cached.js');
        fs.writeFileSync(file, 'cache-arm-content-A\n');

        const realRead = fs.readFileSync;
        let reads = 0;
        fs.readFileSync = function (p) {
            if (p === file) { reads++; }
            return realRead.apply(fs, arguments);
        };
        try {
            const first = sri.computeIntegrity(file);
            assert.strictEqual(reads, 1, 'first lookup must read the file');

            const second = sri.computeIntegrity(file);
            assert.strictEqual(reads, 1, 'second lookup must be served from cache');
            assert.strictEqual(second, first);

            // Same byte LENGTH, different content — only mtime distinguishes.
            fs.writeFileSync(file, 'cache-arm-content-B\n');
            const t = new Date(Date.now() + 5000);
            fs.utimesSync(file, t, t); // force an unambiguous mtime move
            const third = sri.computeIntegrity(file);
            assert.strictEqual(reads, 2, 'a changed file must be re-read');
            assert.notStrictEqual(third, first, 'a changed file must re-hash');
        } finally {
            fs.readFileSync = realRead;
        }
    });

    it('05.2 a file deleted after being cached fails open again', () => {
        const file = path.join(tmp, 'public', 'js', 'transient.js');
        fs.writeFileSync(file, 'transient\n');
        assert.notStrictEqual(sri.computeIntegrity(file), null);
        fs.rmSync(file);
        assert.strictEqual(sri.computeIntegrity(file), null);
        assert.strictEqual(sri.getIntegrityAttributes('/js/transient.js', conf, '/'), '');
    });
});

describe('#OW3 §06 — the sha384 no-padding invariant (asset-catalog immunity)', () => {
    it('06.1 no `=` ever appears in an emitted integrity value', () => {
        // The server-side asset catalog extracts URLs with an unanchored
        // `(src|href|srcset)=` scan; `=` inside an attribute VALUE is the one
        // character that could manufacture a false match. sha384 digests are
        // 48 bytes → 64 base64 chars → zero padding, so the alphabet is
        // padding-free by construction. Pin it on several distinct contents.
        for (const content of ['a', 'bb', 'ccc', FIXTURE_CONTENT, crypto.randomBytes(1024).toString('hex')]) {
            const file = path.join(tmp, 'public', 'js', 'pad-probe.js');
            fs.writeFileSync(file, content);
            const t = new Date(Date.now() + 10000);
            fs.utimesSync(file, t, t);
            const integrity = sri.computeIntegrity(file);
            assert.doesNotMatch(integrity, /=/, 'padding appeared — algorithm no longer sha384?');
        }
    });
});

describe('#OW3 §07 — attribute string shape', () => {
    it('07.1 leading space + integrity + crossorigin="anonymous", nothing else', () => {
        const got = sri.getIntegrityAttributes('/js/fixture.js', conf, '/');
        assert.match(got, /^ integrity="sha384-[A-Za-z0-9+/]{64}" crossorigin="anonymous"$/);
    });
});

describe('#OW3 §10 — controller wiring pins (red-first validated via git show)', () => {
    it('10.1 both getNodeRes cases call lib/sri with the conf slice and webroot', () => {
        assert.strictEqual(
            count(CONTROLLER_SRC, 'lib.sri.getIntegrityAttributes(obj.url, local.options.conf, local.options.conf.server.webroot)'),
            2, 'expected exactly one call site per getNodeRes case (css + js)');
    });

    it('10.2 both HTTP/2 preload-hint appends are suppressed for SRI\'d assets', () => {
        assert.strictEqual(count(CONTROLLER_SRC, '&& !sriAttributes'), 2);
    });

    it('10.3 both script emission branches carry the attribute pair', () => {
        assert.strictEqual(count(CONTROLLER_SRC, "sriAttributes +'></script>'"), 2);
    });

    it('10.4 both stylesheet emission branches carry the attribute pair', () => {
        assert.strictEqual(count(CONTROLLER_SRC, "sriAttributes +'>';"), 2);
    });

    it('10.5 the opt-in is read off the merged template conf, once', () => {
        assert.strictEqual(
            count(CONTROLLER_SRC, 'var sriEnabled = (local.options.template.sriEnabled)'), 1);
    });

    it('10.6 ORDER: the attribute pair is computed before the preload-hint append in each case', () => {
        const fnStart = CONTROLLER_SRC.indexOf('var getNodeRes = function');
        const fnEnd   = CONTROLLER_SRC.indexOf('var isValidURL');
        assert.ok(fnStart > -1 && fnEnd > fnStart, 'getNodeRes region not found');
        const fn = CONTROLLER_SRC.substring(fnStart, fnEnd);
        const cssRegion = fn.substring(fn.indexOf("case 'css':"), fn.indexOf("case 'js':"));
        const jsRegion  = fn.substring(fn.indexOf("case 'js':"));
        for (const [label, region] of [['css', cssRegion], ['js', jsRegion]]) {
            const a = region.indexOf('getIntegrityAttributes');
            const b = region.indexOf('h2Links');
            assert.ok(a > -1, label + ': sri call missing from case region');
            assert.ok(b > -1, label + ': h2Links append missing from case region');
            assert.ok(a < b, label + ': sri attributes must be computed before the preload hint');
        }
    });

    it('10.7 the framework template conf seeds the knob OFF', () => {
        const tplConf = fs.readFileSync(
            path.join(FWV, 'core', 'template', 'conf', 'templates.json'), 'utf8');
        assert.match(tplConf, /"sriEnabled":\s*false/);
    });
});
