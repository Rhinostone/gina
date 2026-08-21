/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2026 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */
'use strict';

/**
 * A fake promise-style `ioredis` driver, good enough to drive the real redis
 * KV store (#KV1) in tests — CI has no redis server.
 *
 * NOT a test file (no `.test.js` suffix), so the suite glob
 * (`test/lib/*.test.js`) does not run it.
 *
 * Two properties make it an instrument rather than a stub:
 *   1. it throws on any command it does not implement, so a store reaching for
 *      an unexpected redis command fails by construction; and
 *   2. `eval` dispatches on the three known script TEXTS rather than
 *      interpreting Lua, so an unrecognised script is likewise a throw.
 *
 * ⚠️ Known divergence from a real server, stated rather than hidden:
 * `INCRBY` here enforces JavaScript's SAFE-INTEGER range, while redis
 * enforces int64. The overflow BOUNDARY therefore differs; the observable
 * contract (an overflow rejects, and the store normalises the message) is the
 * same, which is what the parity spec asserts.
 *
 * @module test/lib/fake-ioredis
 */

/**
 * Build a fake ioredis constructor over a keyspace.
 *
 * @param {object}   [opts]             - Behaviour switches.
 * @param {boolean}  [opts.getdel=true] - Whether the server knows `GETDEL` (redis >= 6.2).
 * @param {Map}      [opts.state]       - Keyspace to adopt (durability analogs).
 * @param {string[]} [opts.calls]       - Array collecting every command name issued.
 * @returns {function} An ioredis-shaped constructor carrying `.Cluster`, `._store`, `._calls`.
 */
function makeFakeIoredis(opts) {
    opts = opts || {};
    var store     = opts.state || new Map();
    var calls     = opts.calls || [];
    var hasGetDel = (opts.getdel !== false);

    /**
     * Live record for a physical key (lazy expiry).
     * @inner
     * @param {string} key - Physical key.
     * @returns {?{v: string, exp: ?number}}
     */
    function live(key) {
        var rec = store.get(key);
        if (!rec) { return null; }
        if (rec.exp !== null && rec.exp <= Date.now()) { store.delete(key); return null; }
        return rec;
    }

    /**
     * One fake client.
     * @inner
     * @class
     * @param {object} [conf] - Construction config, retained for assertions.
     */
    function Client(conf) {
        var self = this;
        this.conf      = conf;
        this.quitCalls = 0;
        this.handlers  = {};

        this.on   = function (evt, fn) { self.handlers[evt] = fn; return self; };
        this.quit = function () { self.quitCalls++; return Promise.resolve('OK'); };

        this.get = function (key) {
            calls.push('get');
            var rec = live(key);
            return Promise.resolve(rec ? rec.v : null);
        };

        this.set = function () {
            calls.push('set');
            var args = Array.prototype.slice.call(arguments);
            var key = args[0], val = args[1];
            var px = null, nx = false;
            for (var i = 2; i < args.length; i++) {
                var a = String(args[i]).toUpperCase();
                if (a === 'PX') { px = +args[i + 1]; i++; }
                else if (a === 'NX') { nx = true; }
                else { throw new Error('fake ioredis: unsupported SET option `' + args[i] + '`'); }
            }
            if (nx && live(key)) { return Promise.resolve(null); }
            store.set(key, { v: String(val), exp: px ? Date.now() + px : null });
            return Promise.resolve('OK');
        };

        this.del = function (key) {
            calls.push('del');
            var existed = !!live(key);
            store.delete(key);
            return Promise.resolve(existed ? 1 : 0);
        };

        this.exists = function (key) {
            calls.push('exists');
            return Promise.resolve(live(key) ? 1 : 0);
        };

        this.pttl = function (key) {
            calls.push('pttl');
            var rec = live(key);
            if (!rec) { return Promise.resolve(-2); }
            if (rec.exp === null) { return Promise.resolve(-1); }
            return Promise.resolve(Math.max(0, rec.exp - Date.now()));
        };

        this.pexpire = function (key, ms) {
            calls.push('pexpire');
            var rec = live(key);
            if (!rec) { return Promise.resolve(0); }
            rec.exp = Date.now() + (+ms);
            return Promise.resolve(1);
        };

        this.getdel = hasGetDel
            ? function (key) {
                calls.push('getdel');
                var rec = live(key);
                store.delete(key);
                return Promise.resolve(rec ? rec.v : null);
            }
            : function () {
                // A pre-6.2 server: ioredis exposes the method, the SERVER rejects.
                calls.push('getdel');
                return Promise.reject(new Error("ERR unknown command 'GETDEL'"));
            };

        this.eval = function (script, numKeys, key) {
            var argv = Array.prototype.slice.call(arguments, 3);

            if (/local v = redis\.call\('GET'/.test(script)) {
                calls.push('eval:consume');
                var rec = live(key);
                store.delete(key);
                return Promise.resolve(rec ? rec.v : null);
            }

            if (/local existed = redis\.call\('EXISTS'/.test(script)) {
                calls.push('eval:incr');
                var by  = Number(argv[0]);
                var ttl = argv[1];
                var cur = live(key);
                var base = 0;
                if (cur) {
                    if (!/^-?\d+$/.test(cur.v)) {
                        return Promise.reject(new Error('ERR value is not an integer or out of range'));
                    }
                    base = Number(cur.v);
                }
                var next = base + by;
                if (!Number.isSafeInteger(next)) {
                    // see the module header's divergence note
                    return Promise.reject(new Error('ERR value is not an integer or out of range'));
                }
                store.set(key, {
                    v: String(next),
                    exp: cur ? cur.exp : (ttl ? Date.now() + Number(ttl) : null)
                });
                return Promise.resolve(next);
            }

            if (/if redis\.call\('GET', KEYS\[1\]\) == ARGV\[1\]/.test(script)) {
                calls.push('eval:compareDel');
                var r = live(key);
                if (r && r.v === argv[0]) { store.delete(key); return Promise.resolve(1); }
                return Promise.resolve(0);
            }

            throw new Error('fake ioredis: unsupported script `' + String(script).slice(0, 40) + '`');
        };

        this.scan = function (cursor, matchKw, pattern, countKw) {
            calls.push('scan');
            if (String(matchKw).toUpperCase() !== 'MATCH' || String(countKw).toUpperCase() !== 'COUNT') {
                throw new Error('fake ioredis: unexpected SCAN form');
            }
            var re = new RegExp('^' + String(pattern)
                .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                .replace(/\\\*/g, '.*') + '$');
            var all = Array.from(store.keys()).filter(function (kk) { return re.test(kk); });
            return Promise.resolve(['0', all]);
        };

        // Deliberately unimplemented — reaching for one fails by construction.
        ['keys', 'flushdb', 'flushall', 'mget', 'mset', 'incr', 'incrby', 'getset', 'setex', 'ttl']
            .forEach(function (cmd) {
                self[cmd] = function () { throw new Error('fake ioredis: unsupported command `' + cmd + '`'); };
            });
    }

    /**
     * @param {object} conf - Standalone client config.
     * @returns {object} A fake client.
     */
    function Driver(conf) { return new Client(conf); }

    Driver.Cluster = function (nodes, clusterOpts) {
        var c = new Client({ cluster: nodes, clusterOpts: clusterOpts });
        c.isClusterClient = true;
        c.nodes = function () { return [c]; };
        return c;
    };
    Driver._store = store;
    Driver._calls = calls;
    return Driver;
}

module.exports = { makeFakeIoredis: makeFakeIoredis };
