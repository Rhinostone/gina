'use strict';
/**
 * `s3` adapter (#STO1, the last #R10 step) — REAL adapter code + an injected
 * fake SDK (the couchbase storage-store precedent: the fake THROWS on any
 * command the tests did not implement, so an unexpected provider call fails
 * loudly instead of vanishing into a stub).
 *
 * What is deliberately NOT here: no network, no real AWS SDK — the SDK is the
 * consuming project's dependency and the adapter's `deps.requireModule` seam
 * exists precisely so the suite can stand alone.
 *
 * Suites:
 *  01 — validateConfig: the s3 branch (bucket, strategy refusals, prefix,
 *       credentials pairing, ignored-keys honesty)
 *  02 — resolveDriverConf: s3 defaults + normalisation
 *  03 — factory: SDK resolution, v3 shape gate, capabilities literal
 *  04 — put: key grammar, metadata encoding, mid-stream cap, abort paths
 *  05 — get/getRange: Range composition + the three-code error mapping
 *  06 — stat: HeadObject mapping, NotFound → null, IAM 403 passthrough
 *  07 — release: acknowledgement semantics
 *  08 — resolve: presign fields, opts → signed response-* overrides, key guard
 *  09 — stats: bounded ListObjectsV2 aggregation + truncation honesty
 *  10 — multipart-orphan sweep: age gate, abort targeting, never-throws
 *  11 — dispatch integration: start() → adapter × strategy → storeless build
 *  12 — local strategies: the additive resolve(key[, opts], fn) arity
 *  13 — source pins: gna.js injection + the three CLI adapter skips
 */
var { describe, it, before, after } = require('node:test');
var assert   = require('node:assert');
var fs       = require('node:fs');
var os       = require('node:os');
var nodePath = require('node:path');
var Readable = require('node:stream').Readable;

var ROOT = nodePath.join(__dirname, '..', '..');
var FW   = require('../fw');

var storageLib = require(nodePath.join(FW, 'lib', 'storage'));
var createS3   = require(nodePath.join(FW, 'lib', 'storage', 'src', 's3.js'));

// ─── fake SDK ────────────────────────────────────────────────────────────────

/**
 * Build a fake @aws-sdk trio around one in-memory object map.
 *
 * `objects` is keyed by PROVIDER key (prefix included):
 *   { body: Buffer, contentType: string|null, metadata: object, lastModified: Date }
 *
 * Every command records itself on `calls`; `send()` THROWS on a command class
 * the fake does not implement. Error doubles carry `name` + `$metadata` the
 * way SDK v3 errors do.
 *
 * @inner
 * @param {object} objects - The bucket double.
 * @returns {object} `{ packages, calls, state }` — `packages` maps the three
 *                   package names to their fake exports.
 */
function makeFakeSdk(objects) {
    var calls = [];
    var state = {
        clients      : [],
        presigns     : [],
        uploads      : [],
        listUploads  : [],   // ListMultipartUploads fixtures the test seeds
        abortedIds   : [],
        listPages    : null, // optional ListObjectsV2 page script
        presignFail  : null,
        destroyCount : 0
    };

    function S3Client(conf) { this.conf = conf || {}; state.clients.push(this); }
    S3Client.prototype.destroy = function() { state.destroyCount++; };
    S3Client.prototype.send = function(cmd) {
        calls.push(cmd);
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
                assert.ok(m, 'fake: Range must be bytes=a-b, got ' + cmd.input.Range);
                var s = parseInt(m[1], 10), e = parseInt(m[2], 10);
                if ( s >= body.length ) { return Promise.reject(sdkErr('InvalidRange', 416)); }
                body = body.subarray(s, Math.min(e, body.length - 1) + 1);
            }
            return Promise.resolve({ Body: Readable.from([body]) });
        }
        if ( cmd instanceof DeleteObjectCommand ) {
            delete objects[cmd.input.Key];
            return Promise.resolve({});
        }
        if ( cmd instanceof ListObjectsV2Command ) {
            if ( state.listPages ) {
                var page = state.listPages(cmd.input);
                return page instanceof Error ? Promise.reject(page) : Promise.resolve(page);
            }
            var keys = Object.keys(objects).filter(function(k) {
                return !cmd.input.Prefix || k.indexOf(cmd.input.Prefix) === 0;
            });
            return Promise.resolve({
                Contents    : keys.map(function(k) { return { Key: k, Size: objects[k].body.length }; }),
                KeyCount    : keys.length,
                IsTruncated : false
            });
        }
        if ( cmd instanceof ListMultipartUploadsCommand ) {
            return Promise.resolve({ Uploads: state.listUploads });
        }
        if ( cmd instanceof AbortMultipartUploadCommand ) {
            state.abortedIds.push(cmd.input.UploadId);
            if ( cmd.input.UploadId === 'abort-rejects' ) {
                return Promise.reject(sdkErr('NoSuchUpload', 404));
            }
            return Promise.resolve({});
        }
        throw new Error('fake SDK: unimplemented command ' + (cmd && cmd.constructor && cmd.constructor.name));
    };

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
    var DeleteObjectCommand         = cmdClass('DeleteObjectCommand');
    var ListObjectsV2Command        = cmdClass('ListObjectsV2Command');
    var ListMultipartUploadsCommand = cmdClass('ListMultipartUploadsCommand');
    var AbortMultipartUploadCommand = cmdClass('AbortMultipartUploadCommand');

    /**
     * lib-storage double: consumes the Body stream into the object map.
     * Single-part semantics are enough — the adapter's contract with Upload
     * is done()/abort(), not part arithmetic.
     */
    function Upload(opts) {
        this._client = opts.client;
        this._params = opts.params;
        this._aborted = false;
        state.uploads.push(this);
    }
    Upload.prototype.done = function() {
        var self2 = this;
        return new Promise(function(resolveP, rejectP) {
            var chunks = [];
            self2._params.Body.on('data', function(c) { chunks.push(c); });
            self2._params.Body.on('error', function(e) { rejectP(e); });
            self2._params.Body.on('end', function() {
                if ( self2._aborted ) { return rejectP(new Error('fake: aborted')); }
                objects[self2._params.Key] = {
                    body         : Buffer.concat(chunks),
                    contentType  : self2._params.ContentType || null,
                    metadata     : self2._params.Metadata || {},
                    lastModified : new Date()
                };
                resolveP({});
            });
        });
    };
    Upload.prototype.abort = function() {
        this._aborted = true;
        state.abortedIds.push('upload-abort');
        return Promise.resolve();
    };

    var getSignedUrl = function(client, cmd, opts) {
        if ( state.presignFail ) { return Promise.reject(state.presignFail); }
        state.presigns.push({ input: cmd.input, expiresIn: opts.expiresIn });
        var q = '?sig=test';
        if ( cmd.input.ResponseContentType )        { q += '&rct='  + encodeURIComponent(cmd.input.ResponseContentType); }
        if ( cmd.input.ResponseContentDisposition ) { q += '&rcd='  + encodeURIComponent(cmd.input.ResponseContentDisposition); }
        if ( cmd.input.ResponseCacheControl )       { q += '&rcc='  + encodeURIComponent(cmd.input.ResponseCacheControl); }
        return Promise.resolve('https://signed.test/' + cmd.input.Bucket + '/' + cmd.input.Key + q);
    };

    return {
        calls : calls,
        state : state,
        packages : {
            '@aws-sdk/client-s3' : {
                S3Client                    : S3Client,
                HeadObjectCommand           : HeadObjectCommand,
                GetObjectCommand            : GetObjectCommand,
                DeleteObjectCommand         : DeleteObjectCommand,
                ListObjectsV2Command        : ListObjectsV2Command,
                ListMultipartUploadsCommand : ListMultipartUploadsCommand,
                AbortMultipartUploadCommand : AbortMultipartUploadCommand
            },
            '@aws-sdk/lib-storage'          : { Upload: Upload },
            '@aws-sdk/s3-request-presigner' : { getSignedUrl: getSignedUrl }
        }
    };
}

/**
 * A loader over a fake's packages — unknown names throw like a real project
 * resolution failure would.
 *
 * @inner
 * @param {object} fake - `makeFakeSdk()` result.
 * @returns {function}
 */
function loaderFor(fake) {
    return function(pkg) {
        if ( !fake.packages[pkg] ) { throw new Error('Cannot find module \'' + pkg + '\''); }
        return fake.packages[pkg];
    };
}

/**
 * Build a driver straight through the factory with resolved-shape config.
 *
 * @inner
 * @param {object} objects   - Bucket double.
 * @param {object} [overlay] - Resolved-conf overrides.
 * @returns {{driver: object, fake: object}}
 */
function build(objects, overlay) {
    var fake = makeFakeSdk(objects);
    var conf = {
        bucket        : 'test-bucket',
        prefix        : '',
        maxObjectSize : 100 * 1024 * 1024,
        presignExpiry : 15 * 60 * 1000,
        sweepGrace    : 60 * 60 * 1000
    };
    for (var k in (overlay || {})) { conf[k] = overlay[k]; }
    var driver = createS3('remote', conf, null, { requireModule: loaderFor(fake) });
    return { driver: driver, fake: fake };
}

var VALID = { adapter: 's3', bucket: 'b' };

// ─── 01 — validateConfig: the s3 branch ──────────────────────────────────────

describe('01 - validateConfig: the s3 branch', function() {

    var v = function(driverConf) {
        return storageLib.validateConfig({ drivers: { d1: driverConf } });
    };

    it('accepts a minimal s3 driver (bucket only, strategy omitted)', function() {
        var out = v({ adapter: 's3', bucket: 'my-bucket' });
        assert.strictEqual(out.fatal, null, out.fatal || '');
        assert.strictEqual(out.driverCount, 1);
    });

    it('accepts strategy: sharded explicitly', function() {
        assert.strictEqual(v({ adapter: 's3', bucket: 'b', strategy: 'sharded' }).fatal, null);
    });

    it('refuses cas with the provider-owns-placement explanation', function() {
        var out = v({ adapter: 's3', bucket: 'b', strategy: 'cas' });
        assert.match(out.fatal, /does not run on the `s3` adapter/);
        assert.match(out.fatal, /ETags are not content digests/);
    });

    it('refuses stream naming the provider\'s own resumable', function() {
        var out = v({ adapter: 's3', bucket: 'b', strategy: 'stream' });
        assert.match(out.fatal, /multipart is the provider's own resumable/);
    });

    it('refuses an unknown strategy naming sharded as the only/default value', function() {
        var out = v({ adapter: 's3', bucket: 'b', strategy: 'zfs' });
        assert.match(out.fatal, /supports `sharded` only/);
    });

    it('requires bucket', function() {
        assert.match(v({ adapter: 's3' }).fatal, /`bucket` must be a non-empty/);
    });

    it('refuses an unresolved placeholder in bucket', function() {
        assert.match(v({ adapter: 's3', bucket: '${S3_BUCKET}' }).fatal, /unresolved/);
    });

    it('refuses an absolute or traversing prefix', function() {
        assert.match(v({ adapter: 's3', bucket: 'b', prefix: '/abs' }).fatal, /relative key prefix/);
        assert.match(v({ adapter: 's3', bucket: 'b', prefix: 'a/../b' }).fatal, /relative key prefix/);
    });

    it('warns on a half credential pair and falls back to the SDK chain', function() {
        var out = v({ adapter: 's3', bucket: 'b', accessKeyId: 'AK' });
        assert.strictEqual(out.fatal, null);
        assert.ok(out.warnings.some(function(w) { return /static credentials need BOTH/.test(w); }));
    });

    it('warns on sessionToken without the pair', function() {
        var out = v({ adapter: 's3', bucket: 'b', sessionToken: 'tok' });
        assert.ok(out.warnings.some(function(w) { return /`sessionToken` is set without/.test(w); }));
    });

    it('names ignored filesystem keys — root, store, inlineThreshold', function() {
        var out = v({ adapter: 's3', bucket: 'b', root: '/tmp/x', store: 'cbStore', inlineThreshold: '64KB' });
        assert.strictEqual(out.fatal, null, out.fatal || '');
        var w = out.warnings.join('\n');
        assert.match(w, /root, store, inlineThreshold/);
        assert.match(w, /not used by the `s3` adapter/);
    });

    it('lints presignExpiry and sweepGrace as unit-required durations', function() {
        var out = v({ adapter: 's3', bucket: 'b', presignExpiry: 15, sweepGrace: '0s' });
        var w = out.warnings.join('\n');
        assert.match(w, /`presignExpiry` must carry a unit/);
        assert.match(w, /`sweepGrace` must be greater than zero/);
    });

    it('the unknown-adapter message now enumerates both adapters', function() {
        var out = v({ adapter: 'gcs' });
        assert.match(out.fatal, /expected local\|s3/);
    });

    it('control — a local driver still demands root (the branch is self-contained)', function() {
        var out = v({ adapter: 'local', strategy: 'sharded' });
        assert.match(out.fatal, /`root` must be a non-empty absolute path/);
    });
});

// ─── 02 — resolveDriverConf: s3 defaults + normalisation ─────────────────────

describe('02 - resolveDriverConf: s3 defaults + normalisation', function() {

    var r = storageLib._resolveDriverConf;

    it('defaults strategy to sharded and presign/sweep to 15m/1h', function() {
        var c = r({ adapter: 's3', bucket: 'b' });
        assert.strictEqual(c.strategy, 'sharded');
        assert.strictEqual(c.presignExpiry, 15 * 60 * 1000);
        assert.strictEqual(c.sweepGrace, 60 * 60 * 1000);
        assert.strictEqual(c.bucket, 'b');
        assert.strictEqual(c.prefix, '');
    });

    it('normalises the prefix to a trailing slash', function() {
        assert.strictEqual(r({ adapter: 's3', bucket: 'b', prefix: 'tenant-a' }).prefix, 'tenant-a/');
        assert.strictEqual(r({ adapter: 's3', bucket: 'b', prefix: 'tenant-a/' }).prefix, 'tenant-a/');
    });

    it('prepends https:// to a scheme-less endpoint and keeps a schemed one', function() {
        assert.strictEqual(r({ adapter: 's3', bucket: 'b', endpoint: 's3.fr-par.scw.cloud' }).endpoint, 'https://s3.fr-par.scw.cloud');
        assert.strictEqual(r({ adapter: 's3', bucket: 'b', endpoint: 'http://127.0.0.1:9000' }).endpoint, 'http://127.0.0.1:9000');
    });

    it('defaults the region ONLY beside a custom endpoint', function() {
        assert.strictEqual(r({ adapter: 's3', bucket: 'b', endpoint: 'minio.local' }).region, 'us-east-1');
        assert.strictEqual(r({ adapter: 's3', bucket: 'b' }).region, undefined);
        assert.strictEqual(r({ adapter: 's3', bucket: 'b', region: 'eu-west-3' }).region, 'eu-west-3');
    });

    it('passes static credentials through only as a complete pair', function() {
        var c = r({ adapter: 's3', bucket: 'b', accessKeyId: 'AK', secretAccessKey: 'SK', sessionToken: 'ST' });
        assert.strictEqual(c.accessKeyId, 'AK');
        assert.strictEqual(c.secretAccessKey, 'SK');
        assert.strictEqual(c.sessionToken, 'ST');
        var half = r({ adapter: 's3', bucket: 'b', accessKeyId: 'AK' });
        assert.strictEqual(half.accessKeyId, undefined);
    });

    it('control — a local sharded conf keeps its shape (early return did not leak)', function() {
        var c = r({ adapter: 'local', strategy: 'sharded', root: '/tmp/x' });
        assert.strictEqual(c.strategy, 'sharded');
        assert.strictEqual(c.root, '/tmp/x');
        assert.strictEqual(c.bucket, undefined);
    });
});

// ─── 03 — factory: SDK resolution + capabilities ─────────────────────────────

describe('03 - factory: SDK resolution, v3 gate, capabilities', function() {

    it('throws a named error without deps.requireModule', function() {
        assert.throws(function() { createS3('remote', { bucket: 'b' }, null, {}); },
            /requires `deps\.requireModule`/);
    });

    it('throws the npm-install hint when a package is missing', function() {
        assert.throws(function() {
            createS3('remote', { bucket: 'b' }, null, { requireModule: function() { throw new Error('Cannot find module'); } });
        }, /npm install @aws-sdk\/client-s3 @aws-sdk\/lib-storage @aws-sdk\/s3-request-presigner/);
    });

    it('refuses a client without S3Client (the v2 shape) by name', function() {
        var fake = makeFakeSdk({});
        var broken = { '@aws-sdk/client-s3': {}, '@aws-sdk/lib-storage': fake.packages['@aws-sdk/lib-storage'], '@aws-sdk/s3-request-presigner': fake.packages['@aws-sdk/s3-request-presigner'] };
        assert.throws(function() {
            createS3('remote', { bucket: 'b' }, null, { requireModule: function(p) { return broken[p]; } });
        }, /v2 `aws-sdk` package is not supported/);
    });

    it('capabilities: the exact literal — the layer\'s first offload:true', function() {
        var b = build({});
        assert.deepStrictEqual(b.driver.capabilities,
            { offload: true, ranges: true, dedup: false, resumable: false, inline: false });
    });

    it('passes endpoint/forcePathStyle/credentials into the client config', function() {
        var objects = {};
        var fake = makeFakeSdk(objects);
        createS3('remote', {
            bucket: 'b', prefix: '', maxObjectSize: 1, presignExpiry: 1000, sweepGrace: 1000,
            endpoint: 'https://minio.local', forcePathStyle: true, region: 'us-east-1',
            accessKeyId: 'AK', secretAccessKey: 'SK'
        }, null, { requireModule: loaderFor(fake) });
        var cc = fake.state.clients[0].conf;
        assert.strictEqual(cc.endpoint, 'https://minio.local');
        assert.strictEqual(cc.forcePathStyle, true);
        assert.strictEqual(cc.region, 'us-east-1');
        assert.deepStrictEqual(cc.credentials, { accessKeyId: 'AK', secretAccessKey: 'SK' });
    });

    it('omits credentials entirely when unset — the SDK default chain', function() {
        var b = build({});
        assert.strictEqual(b.fake.state.clients[0].conf.credentials, undefined);
    });
});

// ─── 04 — put ────────────────────────────────────────────────────────────────

describe('04 - put: key grammar, metadata, cap, abort', function() {

    it('mints a dated sharded key under the prefix; the OPAQUE key excludes it', function(t, done) {
        var objects = {};
        var b = build(objects, { prefix: 'tenant-a/' });
        b.driver.put(Readable.from([Buffer.from('hello')]), { originalName: 'a.pdf', contentType: 'application/pdf' }, function(err, res) {
            assert.ifError(err);
            assert.match(res.key, /^\d{4}\/\d{2}\/\d{2}\/[0-9A-HJKMNP-TV-Z]{26}\.pdf$/);
            assert.strictEqual(res.size, 5);
            assert.strictEqual(res.contentType, 'application/pdf');
            var stored = Object.keys(objects);
            assert.strictEqual(stored.length, 1);
            assert.strictEqual(stored[0], 'tenant-a/' + res.key);
            assert.strictEqual(objects[stored[0]].contentType, 'application/pdf');
            done();
        });
    });

    it('URI-encodes the original name into gina-name metadata, truncated past the cap', function(t, done) {
        var objects = {};
        var b = build(objects);
        var longName = 'é'.repeat(600) + '.bin';   // encodes to ~5.4KB
        b.driver.put(Readable.from([Buffer.from('x')]), { originalName: longName }, function(err, res) {
            assert.ifError(err);
            var meta = objects[res.key].metadata;
            assert.ok(meta['gina-name']);
            assert.ok(meta['gina-name'].length <= 1024, 'encoded name capped, got ' + meta['gina-name'].length);
            assert.match(meta['gina-name'], /^(%C3%A9)+/);
            done();
        });
    });

    it('enforces maxObjectSize MID-STREAM and aborts the upload', function(t, done) {
        var b = build({}, { maxObjectSize: 10 });
        b.driver.put(Readable.from([Buffer.alloc(8), Buffer.alloc(8)]), function(err) {
            assert.ok(err, 'the cap must surface');
            assert.match(err.message, /exceeds maxObjectSize \(10 bytes\)/);
            assert.ok(b.fake.state.abortedIds.indexOf('upload-abort') > -1, 'Upload.abort() must have been attempted');
            done();
        });
    });

    it('reports a SOURCE error verbatim (never fabricated) and aborts', function(t, done) {
        var b = build({});
        var src = new Readable({ read: function() {} });
        b.driver.put(src, function(err) {
            assert.strictEqual(err.message, 'boom-source');
            assert.ok(b.fake.state.abortedIds.indexOf('upload-abort') > -1);
            done();
        });
        setImmediate(function() { src.destroy(new Error('boom-source')); });
    });

    it('throws synchronously without a callback; errors a non-stream body', function(t, done) {
        var b = build({});
        assert.throws(function() { b.driver.put(Readable.from([])); }, /requires a callback/);
        b.driver.put({}, function(err) {
            assert.match(err.message, /requires a readable stream/);
            done();
        });
    });
});

// ─── 05 — get / getRange ─────────────────────────────────────────────────────

describe('05 - get/getRange: Range composition + error mapping', function() {

    var objects, b;
    before(function() {
        objects = { 'k1.bin': { body: Buffer.from('0123456789'), contentType: 'application/octet-stream' } };
        b = build(objects);
    });

    it('get streams the whole object', function(t, done) {
        b.driver.get('k1.bin', function(err, s) {
            assert.ifError(err);
            var chunks = [];
            s.on('data', function(c) { chunks.push(c); });
            s.on('end', function() {
                assert.strictEqual(Buffer.concat(chunks).toString(), '0123456789');
                done();
            });
        });
    });

    it('getRange rides the provider\'s bytes=a-b (end inclusive)', function(t, done) {
        b.driver.getRange('k1.bin', 2, 5, function(err, s) {
            assert.ifError(err);
            var chunks = [];
            s.on('data', function(c) { chunks.push(c); });
            s.on('end', function() {
                assert.strictEqual(Buffer.concat(chunks).toString(), '2345');
                var rangeCall = b.fake.calls.filter(function(c) { return c.input && c.input.Range; })[0];
                assert.strictEqual(rangeCall.input.Range, 'bytes=2-5');
                done();
            });
        });
    });

    it('refuses malformed bounds up front — STORAGE_INVALID_RANGE', function(t, done) {
        b.driver.getRange('k1.bin', -1, 5, function(err) {
            assert.strictEqual(err.code, 'STORAGE_INVALID_RANGE');
            done();
        });
    });

    it('maps the provider 416 to STORAGE_RANGE_UNSATISFIABLE', function(t, done) {
        b.driver.getRange('k1.bin', 50, 60, function(err) {
            assert.strictEqual(err.code, 'STORAGE_RANGE_UNSATISFIABLE');
            done();
        });
    });

    it('maps NoSuchKey to STORAGE_NO_OBJECT', function(t, done) {
        b.driver.get('gone.bin', function(err) {
            assert.strictEqual(err.code, 'STORAGE_NO_OBJECT');
            done();
        });
    });

    it('raw-forwards any other provider error (the typed class is the signal)', function(t, done) {
        var objects2 = {};
        var b2 = build(objects2);
        var boom = new Error('SlowDown');
        boom.name = 'SlowDown';
        boom.$metadata = { httpStatusCode: 503 };
        b2.fake.packages['@aws-sdk/client-s3'].S3Client.prototype.send = function() { return Promise.reject(boom); };
        b2.driver.get('any', function(err) {
            assert.strictEqual(err, boom);
            done();
        });
    });

    it('guards hostile keys before any provider call', function(t, done) {
        b.driver.get('../secrets', function(err) {
            assert.match(err.message, /not in canonical form/);
            done();
        });
    });
});

// ─── 06 — stat ───────────────────────────────────────────────────────────────

describe('06 - stat: HeadObject mapping', function() {

    it('maps size/contentType/createdAt and decodes the stored name', function(t, done) {
        var objects = { 'k2.pdf': {
            body: Buffer.alloc(42), contentType: 'application/pdf',
            metadata: { 'gina-name': encodeURIComponent('déjà vu.pdf') },
            lastModified: new Date(1700000000000)
        } };
        build(objects).driver.stat('k2.pdf', function(err, meta) {
            assert.ifError(err);
            assert.deepStrictEqual(meta, {
                originalName: 'déjà vu.pdf',
                contentType: 'application/pdf',
                size: 42,
                createdAt: 1700000000000
            });
            done();
        });
    });

    it('surfaces a raw metadata value when decoding fails', function(t, done) {
        var objects = { 'k3': { body: Buffer.alloc(1), metadata: { 'gina-name': '%E0%A4%A' } } };
        build(objects).driver.stat('k3', function(err, meta) {
            assert.ifError(err);
            assert.strictEqual(meta.originalName, '%E0%A4%A');
            done();
        });
    });

    it('answers null for a missing key (the contract), never an error', function(t, done) {
        build({}).driver.stat('absent', function(err, meta) {
            assert.ifError(err);
            assert.strictEqual(meta, null);
            done();
        });
    });

    it('passes a 403 through RAW — the ListBucket IAM trap stays visible', function(t, done) {
        var b = build({});
        var denied = new Error('AccessDenied');
        denied.name = 'AccessDenied';
        denied.$metadata = { httpStatusCode: 403 };
        b.fake.packages['@aws-sdk/client-s3'].S3Client.prototype.send = function() { return Promise.reject(denied); };
        b.driver.stat('anything', function(err, meta) {
            assert.strictEqual(err, denied);
            assert.strictEqual(meta, undefined);
            done();
        });
    });
});

// ─── 07 — release ────────────────────────────────────────────────────────────

describe('07 - release: acknowledgement semantics', function() {

    it('deletes and reports the DOCUMENTED acknowledgement (true)', function(t, done) {
        var objects = { 'k4': { body: Buffer.alloc(1) } };
        var b = build(objects);
        b.driver.release('k4', function(err, existed) {
            assert.ifError(err);
            assert.strictEqual(existed, true);
            assert.strictEqual(Object.keys(objects).length, 0);
            done();
        });
    });

    it('acknowledges a missing key too — S3 deletes are idempotent', function(t, done) {
        build({}).driver.release('never-was', function(err, existed) {
            assert.ifError(err);
            assert.strictEqual(existed, true);
            done();
        });
    });
});

// ─── 08 — resolve ────────────────────────────────────────────────────────────

describe('08 - resolve: presigned URLs + signed response overrides', function() {

    it('answers {kind:url} with expiresAt, 2-arg arity', function(t, done) {
        var b = build({ 'k5': { body: Buffer.alloc(1) } }, { presignExpiry: 120000 });
        var t0 = Date.now();
        b.driver.resolve('k5', function(err, r) {
            assert.ifError(err);
            assert.strictEqual(r.kind, 'url');
            assert.match(r.url, /^https:\/\/signed\.test\/test-bucket\/k5\?sig=test/);
            assert.ok(r.expiresAt >= t0 + 120000 && r.expiresAt <= Date.now() + 120000);
            assert.strictEqual(b.fake.state.presigns[0].expiresIn, 120);
            done();
        });
    });

    it('presigns WITHOUT an existence check — pure computation, documented', function(t, done) {
        var b = build({});
        b.driver.resolve('ghost-key', function(err, r) {
            assert.ifError(err);
            assert.strictEqual(r.kind, 'url');
            assert.strictEqual(b.fake.calls.length, 0, 'no provider round-trip');
            done();
        });
    });

    it('rides opts onto the SIGNED response-* params', function(t, done) {
        var b = build({});
        b.driver.resolve('k6', {
            contentType  : 'application/octet-stream',
            download     : true,
            filename     : 'safe\r\nname.pdf',
            cacheControl : 'private, max-age=60'
        }, function(err, r) {
            assert.ifError(err);
            var p = b.fake.state.presigns[0].input;
            assert.strictEqual(p.ResponseContentType, 'application/octet-stream');
            assert.strictEqual(p.ResponseContentDisposition, 'attachment; filename="safename.pdf"');
            assert.strictEqual(p.ResponseCacheControl, 'private, max-age=60');
            assert.match(r.url, /rct=application%2Foctet-stream/);
            done();
        });
    });

    it('guards hostile keys before presigning', function(t, done) {
        build({}).driver.resolve('/etc/passwd', function(err) {
            assert.match(err.message, /not in canonical form/);
            done();
        });
    });
});

// ─── 09 — stats ──────────────────────────────────────────────────────────────

describe('09 - stats: bounded aggregation', function() {

    it('aggregates count/bytes and reports provider identity, store null', function(t, done) {
        var objects = {
            'p/a': { body: Buffer.alloc(10) },
            'p/b': { body: Buffer.alloc(30) },
            'other/c': { body: Buffer.alloc(500) }
        };
        var b = build(objects, { prefix: 'p/', endpoint: 'https://minio.local' });
        b.driver.stats(function(err, s) {
            assert.ifError(err);
            assert.strictEqual(s.adapter, 's3');
            assert.strictEqual(s.strategy, 'sharded');
            assert.strictEqual(s.bucket, 'test-bucket');
            assert.strictEqual(s.prefix, 'p/');
            assert.strictEqual(s.endpoint, 'https://minio.local');
            assert.strictEqual(s.store, null);
            assert.deepStrictEqual(s.objects, { count: 2, bytes: 40, truncated: false });
            done();
        });
    });

    it('stops at the page bound and says so — truncated: true', function(t, done) {
        var b = build({});
        b.fake.state.listPages = function() {
            return { Contents: [{ Key: 'x', Size: 1 }], IsTruncated: true, NextContinuationToken: 'more' };
        };
        b.driver.stats(function(err, s) {
            assert.ifError(err);
            assert.strictEqual(s.objects.count, 10, 'one key per page, ten pages');
            assert.strictEqual(s.objects.truncated, true);
            done();
        });
    });
});

// ─── 10 — multipart-orphan sweep ─────────────────────────────────────────────

describe('10 - multipart-orphan sweep: age gate + never-throws', function() {

    it('aborts ONLY provably old uploads; unaged and undated survive', function(t, done) {
        var b = build({}, { sweepGrace: 60 * 60 * 1000 });
        // let the factory's build-time auto-sweep drain against the EMPTY
        // fixture list FIRST — seeding synchronously would hand the same
        // fixtures to both passes and double-count the aborts
        setTimeout(function() {
            b.fake.state.abortedIds.length = 0;
            b.fake.state.listUploads = [
                { Key: 'k/old',   UploadId: 'old-1',  Initiated: new Date(Date.now() - 2 * 60 * 60 * 1000) },
                { Key: 'k/young', UploadId: 'young-1', Initiated: new Date() },
                { Key: 'k/nodate', UploadId: 'nodate-1' }
            ];
            b.driver._sweepMultipartOrphans();
            setTimeout(function() {
                assert.deepStrictEqual(b.fake.state.abortedIds, ['old-1']);
                done();
            }, 50);
        }, 25);
    });

    it('a rejecting abort is swallowed — best-effort, the sharded shape', function(t, done) {
        var b = build({});
        setTimeout(function() {
            b.fake.state.abortedIds.length = 0;
            b.fake.state.listUploads = [
                { Key: 'k/1', UploadId: 'abort-rejects', Initiated: new Date(0) },
                { Key: 'k/2', UploadId: 'old-2',         Initiated: new Date(0) }
            ];
            b.driver._sweepMultipartOrphans();
            setTimeout(function() {
                assert.deepStrictEqual(b.fake.state.abortedIds, ['abort-rejects', 'old-2'],
                    'the rejection must not stop the pass');
                done();
            }, 50);
        }, 25);
    });
});

// ─── 11 — dispatch integration ───────────────────────────────────────────────

describe('11 - start(): adapter × strategy dispatch, storeless build', function() {

    var scratch, objects, fake;
    before(function() {
        scratch = fs.mkdtempSync(nodePath.join(os.tmpdir(), 's3-dispatch-'));
        objects = {};
        fake = makeFakeSdk(objects);
        var ok = storageLib.start({
            drivers : {
                media  : { adapter: 'local', strategy: 'sharded', root: scratch },
                remote : { adapter: 's3', bucket: 'boot-bucket', prefix: 'app/' }
            },
            default : 'remote',
            requireProjectModule : loaderFor(fake)
        });
        assert.ok(ok, 'start() must adopt (a prior adoption in this process would poison the arm)');
    });
    after(function() {
        try { storageLib.reset(); } catch (e) { /* already closed */ }
        try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (e) {}
    });

    it('builds the s3 driver through the composition map, storeless', function(t, done) {
        var d = storageLib.get('remote');
        assert.strictEqual(d.capabilities.offload, true);
        d.put(Readable.from([Buffer.from('via-boot')]), { originalName: 'x.txt' }, function(err, res) {
            assert.ifError(err);
            assert.strictEqual(Object.keys(objects)[0], 'app/' + res.key);
            done();
        });
    });

    it('creates NO metadata database anywhere for the s3 driver', function() {
        // the local sibling gets its .meta.db inside ITS root; the s3 driver
        // has no root at all — the scratch dir holding the local driver is the
        // only filesystem this start() touched
        assert.ok(fs.existsSync(nodePath.join(scratch, '.meta.db')), 'control: the local sibling did get one');
        var entries = fs.readdirSync(scratch);
        assert.strictEqual(entries.filter(function(e) { return e === '.meta.db'; }).length, 1);
    });

    it('the local sibling is unaffected — same-boot coexistence', function(t, done) {
        storageLib.get('media').put(Readable.from([Buffer.from('local-bytes')]), function(err, res) {
            assert.ifError(err);
            storageLib.get('media').stat(res.key, function(sErr, meta) {
                assert.ifError(sErr);
                assert.strictEqual(meta.size, 11);
                done();
            });
        });
    });

    it('building an s3 driver WITHOUT the resolver is the documented throw', function() {
        assert.throws(function() {
            storageLib._ADAPTER_FACTORIES.s3.sharded('lone', { bucket: 'b', prefix: '', maxObjectSize: 1, presignExpiry: 1, sweepGrace: 1 }, null, {});
        }, /requires `deps\.requireModule`/);
    });
});

// ─── 12 — local strategies: the additive resolve arity ───────────────────────

describe('12 - local strategies accept and IGNORE resolve opts', function() {

    var scratch2, key2, driver2;
    before(function(t, done) {
        scratch2 = fs.mkdtempSync(nodePath.join(os.tmpdir(), 's3-arity-'));
        driver2 = storageLib._FACTORIES.sharded('arity', {
            root: scratch2, strategy: 'sharded', maxObjectSize: 1024 * 1024, inlineThreshold: 0
        }, storageLib._createEmbeddedMetaStore(nodePath.join(scratch2, '.meta.db')));
        driver2.put(Readable.from([Buffer.from('abc')]), function(err, r) {
            assert.ifError(err);
            key2 = r.key;
            done();
        });
    });
    after(function() {
        try { driver2.close(); } catch (e) {}
        try { fs.rmSync(scratch2, { recursive: true, force: true }); } catch (e) {}
    });

    it('resolve(key, fn) and resolve(key, opts, fn) answer identically', function(t, done) {
        driver2.resolve(key2, function(err, a) {
            assert.ifError(err);
            driver2.resolve(key2, { contentType: 'ignored/anyway', download: true }, function(err2, b2) {
                assert.ifError(err2);
                assert.deepStrictEqual(a, b2);
                assert.strictEqual(a.kind, 'path');
                done();
            });
        });
    });
});

// ─── 13 — source pins: the wiring outside lib/storage ────────────────────────

describe('13 - source pins: gna injection + CLI adapter skips', function() {

    it('gna.js injects requireProjectModule into lib.storage.start', function() {
        var src = fs.readFileSync(nodePath.join(FW, 'core', 'gna.js'), 'utf8');
        assert.ok(src.indexOf('requireProjectModule: function(stoPkgName)') > -1);
        assert.ok(src.indexOf("getPath('project') + '/node_modules/' + stoPkgName") > -1);
    });

    it('all three storage CLI verbs skip the s3 adapter BEFORE building', function() {
        ['stats', 'gc', 'verify'].forEach(function(verb) {
            var src = fs.readFileSync(nodePath.join(FW, 'lib', 'cmd', 'storage', verb + '.js'), 'utf8');
            var skip  = src.indexOf("d.adapter === 's3'");
            var store = src.indexOf('connector-backed store');
            assert.ok(skip > -1, verb + '.js must carry the adapter skip');
            assert.ok(store > -1, 'extraction control: the store skip must still exist in ' + verb + '.js');
            assert.ok(skip < store, verb + '.js: the adapter skip must run BEFORE the store skip');
        });
    });

    it('the flat _FACTORIES stays local-only and the composition map carries both adapters', function() {
        assert.deepStrictEqual(Object.keys(storageLib._FACTORIES).sort(), ['cas', 'sharded', 'stream']);
        assert.deepStrictEqual(Object.keys(storageLib._ADAPTER_FACTORIES).sort(), ['local', 's3']);
        assert.strictEqual(storageLib._ADAPTER_FACTORIES.local, storageLib._FACTORIES);
        assert.deepStrictEqual(Object.keys(storageLib._ADAPTER_FACTORIES.s3), ['sharded']);
    });
});
