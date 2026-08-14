'use strict';
/**
 * self.serveFromStorage() — HTTP Range serving for stored objects (#STO1).
 *
 * Strategy, per the #B293 mandate: the success paths run the REAL bytes end to
 * end — real `lib/storage` drivers on scratch roots, the real facade obtained
 * via `createTestInstance` (the §14 bootstrap), and the real `renderStream`
 * delegate emitting onto a mock response. The two pure helpers
 * (`_parseRangeHeader`, `_resolveServedContentType`) are exercised by
 * extract-and-execute (shipped bytes, control-gated — no drift-prone replica).
 *
 * Red-first: the facade is NEW — `serveFromStorage` counts 0 in the pre-change
 * blob (`git show <pre>:.../controller.js`), so every §03 pin and §04+ arm is
 * trivially discriminating against it.
 *
 * Suites:
 *  01 — _parseRangeHeader: the RFC 9110 single-range matrix
 *  02 — _resolveServedContentType: active-content downgrade, explicit override
 *  03 — facade source pins (structure: guards, gating, error mapping)
 *  04 — behavioral: 200 / 206 / 416 / 304 / HEAD / If-Range / 404, real drivers
 *  05 — behavioral: trust + caching knobs (contentType, disposition, cacheControl)
 *  06 — behavioral: capability gate + cas released-blob 404
 */
var { describe, it, before, after } = require('node:test');
var assert   = require('node:assert');
var fs       = require('node:fs');
var os       = require('node:os');
var nodePath = require('node:path');
var Readable = require('node:stream').Readable;

var ROOT = nodePath.join(__dirname, '..', '..');
var FW   = require('../fw');

var CONTROLLER_SRC = nodePath.join(FW, 'core/controller/controller.js');
var SRC = fs.readFileSync(CONTROLLER_SRC, 'utf8');

// ─── §14 bootstrap (controller.js needs the framework globals to load) ───────
process.env.NODE_PATH = (process.env.NODE_PATH || '') + nodePath.delimiter + FW;
require('node:module').Module._initPaths();
require(nodePath.join(FW, 'helpers'));
require(nodePath.join(ROOT, 'utils', 'prototypes'));
setPath('gina', { core: nodePath.join(FW, 'core') });

var storageLib      = require(nodePath.join(FW, 'lib', 'storage'));
var SuperController = require(CONTROLLER_SRC);

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract a module-scope function's shipped bytes and compile them.
 * Control-gated per the extraction discipline: the line-start declaration must
 * appear exactly once, and the brace walk must balance.
 *
 * @inner
 * @param {string} name - The bare function name.
 * @returns {function} The compiled shipped function.
 */
function extractFn(name) {
    var re = new RegExp('^[ \\t]*function ' + name + '\\(', 'mg');
    var hits = SRC.match(re);
    assert.ok(hits && hits.length === 1, 'extraction control: exactly one declaration of ' + name + ' (got ' + (hits ? hits.length : 0) + ')');
    var declIdx = SRC.search(re);
    var i = declIdx, depth = 0, started = false;
    for (; i < SRC.length; i++) {
        if (SRC[i] === '{') { depth++; started = true; }
        else if (SRC[i] === '}') { depth--; if (started && depth === 0) { i++; break; } }
    }
    assert.ok(started && depth === 0, 'extraction control: balanced braces for ' + name);
    var fnSrc = SRC.slice(declIdx, i);
    return new Function('return (' + fnSrc + ');')();
}

var parseRange  = extractFn('_parseRangeHeader');
var resolveType = extractFn('_resolveServedContentType');

var roots = [];
var KEYS  = {};       // strategy -> published key (1000-byte pattern)
var BODY  = Buffer.alloc(1000);
for (var _i = 0; _i < 1000; _i++) { BODY[_i] = _i & 0xff; }

/**
 * Drive the real facade against a mock response; settle on end() or throwError.
 *
 * @inner
 * @param {object}   spec - `{driver, key, method, headers, opts}`.
 * @param {function} cb   - `cb({status, headers, body, threw})`.
 * @returns {void}
 */
function serve(spec, cb) {
    var headers = {}, chunks = [], settled = false;
    var settle = function(threw) {
        if (settled) { return; }
        settled = true;
        cb({ status: res.statusCode, headers: headers, body: Buffer.concat(chunks), threw: threw || null });
    };
    var res = {
        getHeaders : function() { var o = {}; for (var k in headers) { o[k] = headers[k]; } return o; },
        setHeader  : function(k, v) { headers[k.toLowerCase()] = v; },
        write      : function(d) { chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(String(d))); },
        end        : function(d) { if (d) { chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(String(d))); } setTimeout(function() { settle(); }, 20); },
        statusCode : 200, headersSent: false, writableEnded: false, destroyed: false
    };
    var inst = SuperController.createTestInstance({
        req : { method: spec.method || 'GET', headers: spec.headers || {} },
        res : res
    });
    inst.throwError = function(r, code, e) { res.statusCode = code; settle({ code: code, err: e }); };
    inst.serveFromStorage(spec.driver, spec.key, spec.opts);
    // bounded outer guard — a never-settling serve FAILS instead of hanging
    setTimeout(function() { if (!settled) { settled = true; cb({ status: 'TIMEOUT', headers: headers, body: Buffer.concat(chunks), threw: null }); } }, 3000);
}

before(function(t, done) {
    var mk = function(pfx) { var d = fs.mkdtempSync(nodePath.join(os.tmpdir(), pfx)); roots.push(d); return d; };
    var ok = storageLib.start({
        drivers : {
            media  : { adapter: 'local', strategy: 'sharded', root: mk('sfs-sharded-') },
            blobs  : { adapter: 'local', strategy: 'cas',     root: mk('sfs-cas-'), fsync: false, sweepInterval: '0s' },
            assets : { adapter: 'local', strategy: 'stream',  root: mk('sfs-stream-'), fsync: false, sessionSweepInterval: '0s' }
        },
        default : 'media'
    });
    assert.ok(ok, 'storage must adopt the test drivers (a prior adoption would poison every arm)');
    var puts = [['media', 'sharded'], ['blobs', 'cas'], ['assets', 'stream']];
    var n = 0;
    puts.forEach(function(pair) {
        storageLib.get(pair[0]).put(Readable.from([BODY]), { originalName: 'clip.bin', contentType: 'video/mp4' }, function(err, r) {
            assert.ifError(err);
            KEYS[pair[1]] = r.key;
            if (++n === puts.length) { done(); }
        });
    });
});

after(function() {
    try { storageLib.reset(); } catch (e) { /* already closed */ }
    roots.forEach(function(d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} });
});


// ─── 01 — _parseRangeHeader matrix ───────────────────────────────────────────

describe('01 - _parseRangeHeader: the RFC 9110 single-range matrix (shipped bytes)', function() {

    it('absent / non-string → null (full 200)', function() {
        assert.strictEqual(parseRange(undefined, 1000), null);
        assert.strictEqual(parseRange(null, 1000), null);
        assert.strictEqual(parseRange(42, 1000), null);
    });

    it('other units, multi-range, garbage → null', function() {
        assert.strictEqual(parseRange('tokens=0-5', 1000), null);
        assert.strictEqual(parseRange('bytes=0-1,5-9', 1000), null);
        assert.strictEqual(parseRange('bytes=abc', 1000), null);
        assert.strictEqual(parseRange('bytes=-', 1000), null);
        assert.strictEqual(parseRange('0-5', 1000), null);
    });

    it('a-b with a > b is an invalid spec → null (ignore), not 416', function() {
        assert.strictEqual(parseRange('bytes=5-2', 1000), null);
    });

    it('interior, first byte, exact end', function() {
        assert.deepStrictEqual(parseRange('bytes=100-199', 1000), { start: 100, end: 199 });
        assert.deepStrictEqual(parseRange('bytes=0-0', 1000), { start: 0, end: 0 });
        assert.deepStrictEqual(parseRange('bytes=999-999', 1000), { start: 999, end: 999 });
    });

    it('open-ended a- → through the last byte', function() {
        assert.deepStrictEqual(parseRange('bytes=500-', 1000), { start: 500, end: 999 });
    });

    it('suffix -n → the last n bytes; over-long suffix → the whole object', function() {
        assert.deepStrictEqual(parseRange('bytes=-10', 1000), { start: 990, end: 999 });
        assert.deepStrictEqual(parseRange('bytes=-5000', 1000), { start: 0, end: 999 });
    });

    it('over-long end is CLAMPED to size-1, matching the driver contract', function() {
        assert.deepStrictEqual(parseRange('bytes=990-99999', 1000), { start: 990, end: 999 });
    });

    it('unsatisfiable: start >= size, -0 suffix, any range on a zero-length object', function() {
        assert.deepStrictEqual(parseRange('bytes=1000-', 1000), { unsatisfiable: true });
        assert.deepStrictEqual(parseRange('bytes=1000-2000', 1000), { unsatisfiable: true });
        assert.deepStrictEqual(parseRange('bytes=-0', 1000), { unsatisfiable: true });
        assert.deepStrictEqual(parseRange('bytes=0-', 0), { unsatisfiable: true });
        assert.deepStrictEqual(parseRange('bytes=-5', 0), { unsatisfiable: true });
    });

    it('tolerates optional whitespace', function() {
        assert.deepStrictEqual(parseRange(' bytes = 0 - 5 ', 1000), { start: 0, end: 5 });
    });
});


// ─── 02 — _resolveServedContentType ──────────────────────────────────────────

describe('02 - _resolveServedContentType: fail-closed active-content downgrade (shipped bytes)', function() {

    it('an explicit opts.contentType wins verbatim — even active content', function() {
        assert.strictEqual(resolveType('image/svg+xml', 'x/y'), 'image/svg+xml');
        assert.strictEqual(resolveType('text/html', null), 'text/html');
    });

    it('stored active-content types downgrade to application/octet-stream', function() {
        ['text/html', 'application/xhtml+xml', 'image/svg+xml', 'text/xml',
         'application/xml', 'text/javascript', 'application/ecmascript'].forEach(function(t) {
            assert.strictEqual(resolveType(null, t), 'application/octet-stream', t + ' must downgrade');
        });
    });

    it('stored passive types pass through', function() {
        ['image/png', 'video/mp4', 'application/pdf', 'audio/mpeg', 'text/plain'].forEach(function(t) {
            assert.strictEqual(resolveType(null, t), t);
        });
    });

    it('nothing stored → application/octet-stream', function() {
        assert.strictEqual(resolveType(null, null), 'application/octet-stream');
        assert.strictEqual(resolveType('', ''), 'application/octet-stream');
    });
});


// ─── 03 — facade source pins ─────────────────────────────────────────────────

describe('03 - serveFromStorage: source structure', function() {

    // anchor on the DECLARATION form — the bare name also appears in JSDoc
    var blk;
    before(function() {
        var i = SRC.indexOf('this.serveFromStorage = function');
        assert.ok(i > -1, 'declaration anchor must exist');
        var j = SRC.indexOf('this.store = async function', i);
        assert.ok(j > i, 'the facade sits before this.store');
        blk = SRC.slice(i, j);
    });

    it('opens with the released-response guard (#B31/#B38 family)', function() {
        var g = blk.indexOf('if ( local.res == null )');
        assert.ok(g > -1 && g < 400, 'guard first, before any work');
    });

    it('acquires the driver via lib.storage.get inside a try', function() {
        assert.ok(blk.indexOf('driver = lib.storage.get(driverName)') > -1);
        assert.ok(blk.indexOf('try {') < blk.indexOf('driver = lib.storage.get(driverName)'));
    });

    it('is stat-gated: the 404 fires on a null meta, before any byte read', function() {
        var statIdx = blk.indexOf('driver.stat(key');
        var nullIdx = blk.indexOf('if ( !meta )');
        var getIdx  = blk.indexOf('driver.get(key');
        assert.ok(statIdx > -1 && nullIdx > statIdx && getIdx > nullIdx);
    });

    it('maps STORAGE_NO_OBJECT to 404 on every driver callback', function() {
        var hits = blk.match(/\.code === 'STORAGE_NO_OBJECT' \) \? 404 : 500/g);
        assert.ok(hits && hits.length === 3, 'getRange + get + offload resolve error mappings (got ' + (hits ? hits.length : 0) + ')');
    });

    it('gates Range evaluation on capabilities.ranges and GET', function() {
        assert.ok(blk.indexOf('driver.capabilities && driver.capabilities.ranges') > -1);
        assert.ok(/method === 'GET' && rangesOn/.test(blk));
    });

    it('the 416 carries Content-Range: bytes */<size> and nulls the locals', function() {
        var i = blk.indexOf("'bytes */' + size");
        assert.ok(i > -1);
        var tail = blk.slice(i, i + 300);
        assert.ok(tail.indexOf('local.req = null; local.res = null; local.next = null;') > -1,
            'terminal-exit triplet at the 416 exit');
    });

    it('every response path sets nosniff (the shared header helper)', function() {
        assert.ok(blk.indexOf("setHeader('x-content-type-options', 'nosniff')") > -1);
    });

    it('the download filename strips control chars before the disposition header', function() {
        assert.ok(/replace\(\/\[\\x00-\\x1f\\x7f\]\/g, ''\)/.test(blk),
            'header-injection strip on the uploader-supplied name');
    });
});


// ─── 04 — behavioral: the protocol arms, real drivers ────────────────────────

describe('04 - serveFromStorage: protocol behaviour (real drivers, real delegate)', function() {

    it('200 full: byte-exact body, Accept-Ranges, Content-Length, ETag, nosniff, immutable cache', function(t, done) {
        serve({ driver: 'media', key: KEYS.sharded }, function(r) {
            assert.strictEqual(r.status, 200);
            assert.ok(BODY.equals(r.body), 'the full kilobyte, byte-exact');
            assert.strictEqual(r.headers['accept-ranges'], 'bytes');
            assert.strictEqual(r.headers['content-length'], '1000');
            assert.strictEqual(r.headers['etag'], '"' + KEYS.sharded + '"');
            assert.strictEqual(r.headers['x-content-type-options'], 'nosniff');
            assert.strictEqual(r.headers['cache-control'], 'private, max-age=31536000, immutable');
            assert.strictEqual(r.headers['content-type'], 'video/mp4');
            done();
        });
    });

    it('206 interior: byte-exact slice, Content-Range and exact Content-Length', function(t, done) {
        serve({ driver: 'media', key: KEYS.sharded, headers: { range: 'bytes=100-199' } }, function(r) {
            assert.strictEqual(r.status, 206);
            assert.ok(BODY.subarray(100, 200).equals(r.body));
            assert.strictEqual(r.headers['content-range'], 'bytes 100-199/1000');
            assert.strictEqual(r.headers['content-length'], '100');
            done();
        });
    });

    it('206 on the stream strategy too (whole-arc parity across strategies)', function(t, done) {
        serve({ driver: 'assets', key: KEYS.stream, headers: { range: 'bytes=990-' } }, function(r) {
            assert.strictEqual(r.status, 206);
            assert.ok(BODY.subarray(990).equals(r.body));
            assert.strictEqual(r.headers['content-range'], 'bytes 990-999/1000');
            done();
        });
    });

    it('suffix range -10 → the last ten bytes', function(t, done) {
        serve({ driver: 'media', key: KEYS.sharded, headers: { range: 'bytes=-10' } }, function(r) {
            assert.strictEqual(r.status, 206);
            assert.ok(BODY.subarray(990).equals(r.body));
            done();
        });
    });

    it('unsatisfiable → 416, Content-Range: bytes */1000, empty body', function(t, done) {
        serve({ driver: 'media', key: KEYS.sharded, headers: { range: 'bytes=1000-' } }, function(r) {
            assert.strictEqual(r.status, 416);
            assert.strictEqual(r.headers['content-range'], 'bytes */1000');
            assert.strictEqual(r.body.length, 0);
            done();
        });
    });

    it('multi-range is ignored → full 200 (RFC-sanctioned)', function(t, done) {
        serve({ driver: 'media', key: KEYS.sharded, headers: { range: 'bytes=0-1,5-9' } }, function(r) {
            assert.strictEqual(r.status, 200);
            assert.strictEqual(r.body.length, 1000);
            done();
        });
    });

    it('If-Range mismatch → full 200; If-Range exact ETag match → 206', function(t, done) {
        serve({ driver: 'media', key: KEYS.sharded, headers: { range: 'bytes=0-9', 'if-range': '"other"' } }, function(r1) {
            assert.strictEqual(r1.status, 200);
            assert.strictEqual(r1.body.length, 1000);
            serve({ driver: 'media', key: KEYS.sharded,
                headers: { range: 'bytes=0-9', 'if-range': '"' + KEYS.sharded + '"' } }, function(r2) {
                assert.strictEqual(r2.status, 206);
                assert.strictEqual(r2.body.length, 10);
                done();
            });
        });
    });

    it('If-None-Match with the key ETag → 304, no body, no driver read; W/-prefixed echo matches too', function(t, done) {
        serve({ driver: 'media', key: KEYS.sharded, headers: { 'if-none-match': '"' + KEYS.sharded + '"' } }, function(r1) {
            assert.strictEqual(r1.status, 304);
            assert.strictEqual(r1.body.length, 0);
            assert.strictEqual(r1.headers['etag'], '"' + KEYS.sharded + '"');
            serve({ driver: 'media', key: KEYS.sharded, headers: { 'if-none-match': 'W/"' + KEYS.sharded + '"' } }, function(r2) {
                assert.strictEqual(r2.status, 304, 'weak comparison per RFC 9110');
                done();
            });
        });
    });

    it('HEAD: headers + Content-Length, zero body bytes', function(t, done) {
        serve({ driver: 'media', key: KEYS.sharded, method: 'HEAD' }, function(r) {
            assert.strictEqual(r.status, 200);
            assert.strictEqual(r.body.length, 0);
            assert.strictEqual(r.headers['content-length'], '1000');
            assert.strictEqual(r.headers['accept-ranges'], 'bytes');
            done();
        });
    });

    it('unknown key → throwError 404 with the no-object diagnostic', function(t, done) {
        serve({ driver: 'media', key: '2026/01/01/01ARZ3NDEKTSV4RRFFQ69G5FAV.bin' }, function(r) {
            assert.ok(r.threw, 'must route through throwError');
            assert.strictEqual(r.threw.code, 404);
            assert.match(r.threw.err.message, /no object for key/);
            done();
        });
    });

    it('unknown DRIVER → throwError 500 (an app config error, never a 404)', function(t, done) {
        serve({ driver: 'nope', key: KEYS.sharded }, function(r) {
            assert.ok(r.threw);
            assert.strictEqual(r.threw.code, 500);
            done();
        });
    });
});


// ─── 05 — behavioral: trust + caching knobs ──────────────────────────────────

describe('05 - serveFromStorage: contentType trust, disposition, cacheControl', function() {

    var htmlKey;
    before(function(t, done) {
        // an uploader-declared active type + a header-injection-shaped name
        storageLib.get('media').put(Readable.from([Buffer.from('<b>x</b>')]),
            { originalName: 'evil\r\nX-Injected: 1.html', contentType: 'text/html' }, function(err, r) {
            assert.ifError(err);
            htmlKey = r.key;
            done();
        });
    });

    it('a stored active type serves as application/octet-stream (fail-closed)', function(t, done) {
        serve({ driver: 'media', key: htmlKey }, function(r) {
            assert.strictEqual(r.status, 200);
            assert.strictEqual(r.headers['content-type'], 'application/octet-stream');
            done();
        });
    });

    it('an explicit opts.contentType wins verbatim', function(t, done) {
        serve({ driver: 'media', key: htmlKey, opts: { contentType: 'text/html' } }, function(r) {
            assert.strictEqual(r.headers['content-type'], 'text/html');
            done();
        });
    });

    it('download: attachment disposition with the stored name, control chars stripped', function(t, done) {
        serve({ driver: 'media', key: htmlKey, opts: { download: true } }, function(r) {
            var cd = r.headers['content-disposition'];
            assert.ok(cd && cd.indexOf('attachment;') === 0);
            assert.ok(!/[\r\n]/.test(cd), 'no CR/LF may survive into the header');
            assert.ok(cd.indexOf('X-Injected') > -1, 'the name survives minus its control chars');
            done();
        });
    });

    it('opts.filename overrides; opts.cacheControl replaces the immutable default', function(t, done) {
        serve({ driver: 'media', key: htmlKey, opts: { filename: 'safe.bin', cacheControl: 'no-store' } }, function(r) {
            assert.match(r.headers['content-disposition'], /filename="safe\.bin"/);
            assert.strictEqual(r.headers['cache-control'], 'no-store');
            done();
        });
    });
});


// ─── 06 — behavioral: capability gate + cas invisibility ─────────────────────

describe('06 - serveFromStorage: capability gate + released-blob 404', function() {

    it('capabilities.ranges === false → Range ignored, no Accept-Ranges, full 200', function(t, done) {
        var driver = storageLib.get('media');
        var saved  = driver.capabilities.ranges;
        driver.capabilities.ranges = false;   // the capability literal is shared — restore below
        serve({ driver: 'media', key: KEYS.sharded, headers: { range: 'bytes=0-9' } }, function(r) {
            driver.capabilities.ranges = saved;
            assert.strictEqual(r.status, 200);
            assert.strictEqual(r.body.length, 1000);
            assert.strictEqual(typeof r.headers['accept-ranges'], 'undefined');
            done();
        });
    });

    it('a released cas blob answers 404 (stat hides zero-ref rows)', function(t, done) {
        storageLib.get('blobs').release(KEYS.cas, function(rerr) {
            assert.ifError(rerr);
            serve({ driver: 'blobs', key: KEYS.cas }, function(r) {
                assert.ok(r.threw);
                assert.strictEqual(r.threw.code, 404);
                done();
            });
        });
    });
});
