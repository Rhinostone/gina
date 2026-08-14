'use strict';
/**
 * self.serveFromStorage() — the OFFLOAD path (#STO1 s3): an offload-capable
 * driver answers GET/HEAD with a 307 to a short-lived presigned URL instead of
 * proxying the bytes.
 *
 * Same harness family as serve-from-storage.test.js (its own process, so
 * `storage.start()` adopts fresh): the REAL facade via `createTestInstance`,
 * a REAL `s3` driver built through the REAL boot wiring — `start()` →
 * `resolveDriverConf` → the adapter × strategy composition map — against an
 * injected fake SDK, which is exactly the seam the adapter ships for.
 *
 * The security pin this file exists for: a stored `text/html` contentType is
 * uploader-supplied, and on the offload path the PROVIDER serves the bytes —
 * so the facade's fail-closed downgrade must reach the provider's response
 * through the SIGNED `response-content-type` override, or the redirect
 * re-opens the stored-XSS hole the proxy path closed.
 *
 * Suites:
 *  01 — source structure: branch placement + literals
 *  02 — behavioural: 307 mechanics + the signed response-* overrides
 *  03 — behavioural: 304-before-presign, HEAD, 404
 *  04 — behavioural: opts.offload:false → the proxy path, POST → proxy
 *  05 — behavioural: resolve-error mapping + the contract-violation guard
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

// ─── fake SDK (the storage-s3.test.js shape, trimmed to this file's needs) ───

var objects  = {};   // providerKey -> { body, contentType, metadata, lastModified }
var presigns = [];
var state    = { presignFail: null };

function sdkErr(nm, status) {
    var e = new Error(nm);
    e.name = nm;
    e.$metadata = { httpStatusCode: status };
    return e;
}
function cmdClass(nm) {
    var C = function(input) { this.input = input; };
    Object.defineProperty(C, 'name', { value: nm });
    return C;
}
var HeadObjectCommand           = cmdClass('HeadObjectCommand');
var GetObjectCommand            = cmdClass('GetObjectCommand');
var ListMultipartUploadsCommand = cmdClass('ListMultipartUploadsCommand');

function S3Client() {}
S3Client.prototype.destroy = function() {};
S3Client.prototype.send = function(cmd) {
    if ( cmd instanceof HeadObjectCommand ) {
        var oH = objects[cmd.input.Key];
        if ( !oH ) { return Promise.reject(sdkErr('NotFound', 404)); }
        return Promise.resolve({
            ContentLength : oH.body.length,
            ContentType   : oH.contentType || undefined,
            LastModified  : oH.lastModified || new Date(1700000000000),
            Metadata      : oH.metadata || {}
        });
    }
    if ( cmd instanceof GetObjectCommand ) {
        var oG = objects[cmd.input.Key];
        if ( !oG ) { return Promise.reject(sdkErr('NoSuchKey', 404)); }
        var body = oG.body;
        if ( cmd.input.Range ) {
            var m = /^bytes=(\d+)-(\d+)$/.exec(cmd.input.Range);
            var s = parseInt(m[1], 10), e = parseInt(m[2], 10);
            if ( s >= body.length ) { return Promise.reject(sdkErr('InvalidRange', 416)); }
            body = body.subarray(s, Math.min(e, body.length - 1) + 1);
        }
        return Promise.resolve({ Body: Readable.from([body]) });
    }
    if ( cmd instanceof ListMultipartUploadsCommand ) {
        return Promise.resolve({ Uploads: [] });
    }
    throw new Error('fake SDK: unimplemented command ' + (cmd && cmd.constructor && cmd.constructor.name));
};

function Upload(opts) { this._params = opts.params; }
Upload.prototype.done = function() {
    var p = this._params;
    return new Promise(function(resolveP, rejectP) {
        var chunks = [];
        p.Body.on('data', function(c) { chunks.push(c); });
        p.Body.on('error', rejectP);
        p.Body.on('end', function() {
            objects[p.Key] = { body: Buffer.concat(chunks), contentType: p.ContentType || null, metadata: p.Metadata || {}, lastModified: new Date(1700000000000) };
            resolveP({});
        });
    });
};
Upload.prototype.abort = function() { return Promise.resolve(); };

var PACKAGES = {
    '@aws-sdk/client-s3' : {
        S3Client                    : S3Client,
        HeadObjectCommand           : HeadObjectCommand,
        GetObjectCommand            : GetObjectCommand,
        ListMultipartUploadsCommand : ListMultipartUploadsCommand,
        DeleteObjectCommand         : cmdClass('DeleteObjectCommand'),
        ListObjectsV2Command        : cmdClass('ListObjectsV2Command'),
        AbortMultipartUploadCommand : cmdClass('AbortMultipartUploadCommand')
    },
    '@aws-sdk/lib-storage' : { Upload: Upload },
    '@aws-sdk/s3-request-presigner' : {
        getSignedUrl: function(client, cmd, opts) {
            if ( state.presignFail ) { return Promise.reject(state.presignFail); }
            presigns.push({ input: cmd.input, expiresIn: opts.expiresIn });
            return Promise.resolve('https://signed.test/' + cmd.input.Bucket + '/' + cmd.input.Key + '?sig=test');
        }
    }
};

// ─── serve() — the facade driver (mirrors serve-from-storage.test.js) ────────

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
    setTimeout(function() { if (!settled) { settled = true; cb({ status: 'TIMEOUT', headers: headers, body: Buffer.concat(chunks), threw: null }); } }, 3000);
}

var KEY = null;   // seeded object's opaque key

before(function(t, done) {
    var ok = storageLib.start({
        drivers : {
            remote : { adapter: 's3', bucket: 'serve-bucket', prefix: 'app/' }
        },
        default : 'remote',
        requireProjectModule : function(pkg) {
            if ( !PACKAGES[pkg] ) { throw new Error('Cannot find module \'' + pkg + '\''); }
            return PACKAGES[pkg];
        }
    });
    assert.ok(ok, 'storage must adopt the test driver');
    // seed through the REAL put so key grammar and metadata are the shipped ones;
    // contentType text/html ON PURPOSE — the downgrade pin depends on it
    storageLib.get('remote').put(Readable.from([Buffer.from('<h1>payload</h1>')]), {
        originalName: 'page.html', contentType: 'text/html'
    }, function(err, r) {
        assert.ifError(err);
        KEY = r.key;
        done();
    });
});

after(function() {
    try { storageLib.reset(); } catch (e) { /* already closed */ }
});

// ─── 01 — source structure ───────────────────────────────────────────────────

describe('01 - offload branch: source structure', function() {

    var start = SRC.indexOf('this.serveFromStorage = function');
    var blk   = SRC.slice(start, SRC.indexOf('Store file(s) to a targeted directory', start));

    it('sits AFTER the 304 check and BEFORE the HEAD branch', function() {
        var i304  = blk.indexOf('response.statusCode = 304');
        var iOff  = blk.indexOf('var offloadOn =');
        var iHead = blk.indexOf('// HEAD — full-size accounting');
        assert.ok(i304 > -1 && iOff > -1 && iHead > -1, 'all three anchors must exist');
        assert.ok(i304 < iOff, 'the key-ETag 304 must be answered before a presign is spent');
        assert.ok(iOff < iHead, 'offload must claim GET/HEAD before the proxy HEAD branch');
    });

    it('is opt-OUT (opts.offload !== false) and capability-gated', function() {
        assert.ok(blk.indexOf('opts.offload !== false') > -1);
        assert.ok(blk.indexOf('driver.capabilities.offload') > -1);
    });

    it('the redirect is 307 + no-store; the violation guard is loud', function() {
        assert.ok(blk.indexOf("response.statusCode = 307") > -1);
        assert.ok(blk.indexOf("'private, no-store'") > -1);
        assert.ok(blk.indexOf('driver contract violation') > -1);
    });

    it('hands resolve() the DOWNGRADED type, not the stored one', function() {
        var iOff = blk.indexOf('var offloadOn =');
        var seg  = blk.slice(iOff, blk.indexOf('onServeResolve'));
        assert.ok(seg.indexOf('contentType  : contentType') > -1,
            'the resolve opts must carry the facade\'s post-downgrade variable');
    });
});

// ─── 02 — 307 mechanics + signed overrides ───────────────────────────────────

describe('02 - GET → 307 with signed response-* overrides', function() {

    it('redirects with location, no-store, nosniff — and NO body', function(t, done) {
        presigns.length = 0;
        serve({ driver: 'remote', key: KEY }, function(out) {
            assert.strictEqual(out.status, 307);
            assert.match(out.headers.location, /^https:\/\/signed\.test\/serve-bucket\/app\//);
            assert.strictEqual(out.headers['cache-control'], 'private, no-store');
            assert.strictEqual(out.headers['x-content-type-options'], 'nosniff');
            assert.strictEqual(out.body.length, 0);
            done();
        });
    });

    it('SECURITY — the stored text/html is DOWNGRADED on the signed response-content-type', function(t, done) {
        presigns.length = 0;
        serve({ driver: 'remote', key: KEY }, function(out) {
            assert.strictEqual(out.status, 307);
            assert.strictEqual(presigns.length, 1);
            assert.strictEqual(presigns[0].input.ResponseContentType, 'application/octet-stream',
                'uploader-supplied text/html must not reach the provider response verbatim');
            done();
        });
    });

    it('an explicit opts.contentType rides verbatim — the app\'s informed choice', function(t, done) {
        presigns.length = 0;
        serve({ driver: 'remote', key: KEY, opts: { contentType: 'text/html; charset=utf-8' } }, function(out) {
            assert.strictEqual(presigns[0].input.ResponseContentType, 'text/html; charset=utf-8');
            done();
        });
    });

    it('download/filename ride response-content-disposition, control chars stripped', function(t, done) {
        presigns.length = 0;
        serve({ driver: 'remote', key: KEY, opts: { download: true, filename: 'inv\r\noice.pdf' } }, function(out) {
            assert.strictEqual(presigns[0].input.ResponseContentDisposition, 'attachment; filename="invoice.pdf"');
            done();
        });
    });

    it('the PAYLOAD cache policy rides response-cache-control (default immutable; opts win)', function(t, done) {
        presigns.length = 0;
        serve({ driver: 'remote', key: KEY }, function() {
            assert.strictEqual(presigns[0].input.ResponseCacheControl, 'private, max-age=31536000, immutable');
            serve({ driver: 'remote', key: KEY, opts: { cacheControl: 'private, max-age=30' } }, function() {
                assert.strictEqual(presigns[1].input.ResponseCacheControl, 'private, max-age=30');
                done();
            });
        });
    });
});

// ─── 03 — 304-before-presign, HEAD, 404 ──────────────────────────────────────

describe('03 - conditional GET, HEAD, 404', function() {

    it('If-None-Match answers 304 with NO presign spent', function(t, done) {
        presigns.length = 0;
        serve({ driver: 'remote', key: KEY, headers: { 'if-none-match': '"' + KEY + '"' } }, function(out) {
            assert.strictEqual(out.status, 304);
            assert.strictEqual(presigns.length, 0, 'the key ETag needs no signature');
            done();
        });
    });

    it('HEAD stays HEAD — 307, empty body (method-preserving is why 307)', function(t, done) {
        serve({ driver: 'remote', key: KEY, method: 'HEAD' }, function(out) {
            assert.strictEqual(out.status, 307);
            assert.ok(out.headers.location);
            assert.strictEqual(out.body.length, 0);
            done();
        });
    });

    it('an unknown key is the facade\'s 404, never a provider redirect', function(t, done) {
        presigns.length = 0;
        serve({ driver: 'remote', key: '2026/01/01/00000000000000000000000000.bin' }, function(out) {
            assert.strictEqual(out.status, 404);
            assert.ok(out.threw && out.threw.code === 404);
            assert.strictEqual(presigns.length, 0);
            done();
        });
    });
});

// ─── 04 — the proxy escape hatch ─────────────────────────────────────────────

describe('04 - opts.offload:false and non-GET/HEAD proxy the bytes', function() {

    it('opts.offload:false streams through get() with the standard headers', function(t, done) {
        presigns.length = 0;
        serve({ driver: 'remote', key: KEY, opts: { offload: false } }, function(out) {
            assert.strictEqual(out.status, 200);
            assert.strictEqual(out.body.toString(), '<h1>payload</h1>');
            assert.strictEqual(out.headers['cache-control'], 'private, max-age=31536000, immutable');
            assert.strictEqual(out.headers['content-type'], 'application/octet-stream',
                'the proxy path downgrades locally, as shipped');
            assert.strictEqual(presigns.length, 0);
            done();
        });
    });

    it('Range proxies too under offload:false — 206 from the provider bytes', function(t, done) {
        serve({ driver: 'remote', key: KEY, opts: { offload: false }, headers: { range: 'bytes=0-3' } }, function(out) {
            assert.strictEqual(out.status, 206);
            assert.strictEqual(out.body.toString(), '<h1>');
            assert.strictEqual(out.headers['content-range'], 'bytes 0-3/16');
            done();
        });
    });

    it('POST is never redirected — the method split keeps offload on GET/HEAD', function(t, done) {
        presigns.length = 0;
        serve({ driver: 'remote', key: KEY, method: 'POST' }, function(out) {
            assert.strictEqual(out.status, 200);
            assert.strictEqual(out.body.toString(), '<h1>payload</h1>');
            assert.strictEqual(presigns.length, 0);
            done();
        });
    });
});

// ─── 05 — error mapping + the violation guard ────────────────────────────────

describe('05 - resolve errors and the contract-violation guard', function() {

    it('a presign failure maps to 500 with the real error', function(t, done) {
        state.presignFail = new Error('sig-backend-down');
        serve({ driver: 'remote', key: KEY }, function(out) {
            state.presignFail = null;
            assert.strictEqual(out.status, 500);
            assert.ok(out.threw && /sig-backend-down/.test(out.threw.err.message));
            done();
        });
    });

    it('an offload driver whose resolve answers no url is a LOUD 500', function(t, done) {
        // stub driver: capability says offload, resolve answers a path —
        // the guard must refuse to silently degrade
        var stub = {
            capabilities : { offload: true, ranges: true },
            stat    : function(k, fn) { fn(null, { originalName: 'x', contentType: 'text/plain', size: 1, createdAt: 1 }); },
            resolve : function(k, opts, fn) { fn(null, { kind: 'path', path: '/tmp/x' }); }
        };
        var realGet = storageLib.get;
        storageLib.get = function() { return stub; };
        serve({ driver: 'remote', key: 'any/key' }, function(out) {
            storageLib.get = realGet;
            assert.strictEqual(out.status, 500);
            assert.match(out.threw.err.message, /driver contract violation/);
            done();
        });
    });
});
