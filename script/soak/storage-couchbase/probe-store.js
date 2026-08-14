'use strict';
const STORE_PATH = process.env.STORE_PATH;   // .../core/connectors/couchbase/lib/storage-store.js
const SDK        = process.env.CB_SDK || 'couchbase';

const CouchbaseStorageStore = require(STORE_PATH);
const couchbase = require(SDK);

const connConf = {
    protocol  : 'couchbase://',
    host      : process.env.CB_HOST   || '127.0.0.1',
    username  : process.env.CB_U,
    password  : process.env.CB_P,
    database  : process.env.CB_BUCKET || 'storage_probe',
    scope     : '_default',
    collection: '_default',
    prefix    : 'stor:'
};

const KEY  = process.env.PROBE_KEY || 'sha256:deadbeefcafe0001';
const mode = process.argv[2];
const arg  = process.argv[3];
const tag  = process.env.TAG || ('pid' + process.pid);

const store = CouchbaseStorageStore(connConf, 'app', 'assets', { driver: couchbase });
const line = (k, v) => console.log(String(k).padEnd(30) + ' ' + v);
const done = (c) => { try { store.close(); } catch (e) {} setTimeout(() => process.exit(c), 250); };

// ---- storm: N concurrent acquireRef on ONE key. Run it in several PROCESSES too:
//      the cross-process case is the one the dedup claim is actually about.
if (mode === 'storm') {
    const N = parseInt(arg, 10) || 16;
    let created = 0, errs = [], pending = N;
    for (let i = 0; i < N; i++) {
        store.acquireRef(KEY, { size: 123, mime: 'application/pdf' }, (err, res) => {
            if (err) errs.push((err.constructor && err.constructor.name) + ': ' + err.message);
            else if (res.created) created++;
            if (--pending === 0) store.get(KEY, (e, meta) => {
                line('acquireRef calls', N);
                line('errors', errs.length + (errs.length ? '  ' + errs.slice(0, 3).join(' | ') : ''));
                line('created:true count', created + '   (expect exactly 1 ACROSS ALL PROCESSES)');
                line('final refs', e ? ('GET FAILED: ' + e.message) : meta.refs);
                done(errs.length === 0 ? 0 : 1);
            });
        });
    }
}

// ---- zero: arm a blob for the sweep (acquire, then release to 0).
else if (mode === 'zero') {
    store.acquireRef(KEY, { size: 123, mime: 'application/pdf' }, (err) => {
        if (err) { console.error('acquire failed: ' + err.message); return done(2); }
        store.releaseRef(KEY, (e2, r2) => {
            if (e2) { console.error('release failed: ' + e2.message); return done(2); }
            line('refs after release', r2.refs + '   (expect 0)');
            done(r2.refs === 0 ? 0 : 1);
        });
    });
}

// ---- claim <epochMs>: barrier-synchronised race on the CAS-guarded claim step.
//
// NOTE, and this is the whole point of the mode existing: do NOT route this through
// listZeroRefs. That is a GSI query, and a just-zeroed blob can be invisible to it for a
// short window — so one sweeper finds an empty list, the two never contend, and the run
// passes while measuring nothing. Ask for exactly one `true` and one `false`, and check
// the WINNER VARIES across trials; if it never varies, the arms are not racing.
else if (mode === 'claim') {
    const startAt = parseInt(arg, 10);
    setTimeout(() => {
        store.removeIfZero(KEY, (err, removed) => {
            if (err) { console.log('CLAIM ' + tag + ' ERROR ' + ((err.constructor && err.constructor.name) || '') + ': ' + err.message); return done(2); }
            console.log('CLAIM ' + tag + ' removed=' + removed);
            done(0);
        });
    }, Math.max(0, startAt - Date.now()));
}

// ---- sweep <epochMs>: the realistic path, via listZeroRefs. Expect it to be flaky by
//      design near the grace boundary — that flakiness IS the GSI-lag observation.
else if (mode === 'sweep') {
    const startAt = parseInt(arg, 10);
    setTimeout(() => {
        store.listZeroRefs(Date.now(), 100, (err, keys) => {
            if (err) { console.log('SWEEP ' + tag + ' listZeroRefs ERROR ' + err.message); return done(2); }
            if (keys.indexOf(KEY) === -1) { console.log('SWEEP ' + tag + ' key NOT in zero-refs list (n=' + keys.length + ') — index lag, not a pass'); return done(3); }
            store.removeIfZero(KEY, (e2, removed) => {
                if (e2) { console.log('SWEEP ' + tag + ' removeIfZero ERROR ' + e2.message); return done(2); }
                console.log('SWEEP ' + tag + ' removed=' + removed); done(0);
            });
        });
    }, Math.max(0, startAt - Date.now()));
}

else if (mode === 'inspect') {
    store.get(KEY, (err, meta) => {
        console.log('get -> ' + (err ? ((err.constructor && err.constructor.name) + ': ' + err.message) : JSON.stringify(meta)));
        store.stats((e2, s) => { console.log('stats -> ' + (e2 ? e2.message : JSON.stringify(s))); done(0); });
    });
}

else { console.error('modes: storm <n> | zero | claim <epochMs> | sweep <epochMs> | inspect'); process.exit(64); }
