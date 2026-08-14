'use strict';
const SDK = process.env.CB_SDK || 'couchbase';
const couchbase = require(SDK);

const CONN   = process.env.CB_CONN   || 'couchbase://127.0.0.1';
const USER   = process.env.CB_U;
const PASS   = process.env.CB_P;
const BUCKET = process.env.CB_BUCKET || 'storage_probe';

const line = (k, v) => console.log(String(k).padEnd(34) + ' ' + v);
const classOf = (e) => !e ? '(no error)' : ((e.constructor && e.constructor.name) || e.name);

(async () => {
    // Two GENUINELY separate connections — not two handles on one.
    const A = await couchbase.connect(CONN, { username: USER, password: PASS });
    const B = await couchbase.connect(CONN, { username: USER, password: PASS });
    const collA = A.bucket(BUCKET).defaultCollection();
    const collB = B.bucket(BUCKET).defaultCollection();

    const KEY = 'probe::cas::' + process.pid;
    let failures = 0;

    line('sdk version', require(SDK + '/package.json').version);
    await collA.upsert(KEY, { n: 0 });

    // ARM 1 — POSITIVE CONTROL. Without this, a throw in ARM 2 could mean anything
    // (bad path, missing permission). This must SUCCEED.
    {
        const got = await collA.get(KEY);
        try {
            await collA.mutateIn(KEY, [couchbase.MutateInSpec.upsert('n', 1)], { cas: got.cas });
            line('ARM1 fresh-cas mutateIn', 'SUCCEEDED  <- control fires');
        } catch (e) { failures++; line('ARM1 fresh-cas mutateIn', 'FAILED ' + classOf(e) + ' — arm 2 proves nothing'); }
    }

    // ARM 2 — the measurement.
    {
        const readA = await collA.get(KEY);          // A's view -> cas_1
        await collB.upsert(KEY, { n: 42 });          // B moves it -> cas_2
        try {
            await collA.mutateIn(KEY, [couchbase.MutateInSpec.upsert('n', 99)], { cas: readA.cas });
            failures++; line('ARM2 stale-cas mutateIn', 'SUCCEEDED  <- UNEXPECTED, guard did not hold');
        } catch (e) {
            const ok = (e instanceof couchbase.CasMismatchError);
            line('ARM2 stale-cas mutateIn', classOf(e) + '  instanceof CasMismatchError=' + ok);
            if (!ok) failures++;
        }
    }

    // ARM 3 — comparison: the docs already state this for replace/remove.
    for (const op of ['replace', 'remove']) {
        const readA = await collA.get(KEY);
        await collB.upsert(KEY, { n: Math.floor(Math.random() * 1000) });
        try {
            if (op === 'replace') await collA.replace(KEY, { n: -1 }, { cas: readA.cas });
            else                  await collA.remove(KEY, { cas: readA.cas });
            failures++; line('ARM3 ' + op, 'SUCCEEDED  <- UNEXPECTED');
        } catch (e) {
            const ok = (e instanceof couchbase.CasMismatchError);
            line('ARM3 ' + op, classOf(e) + '  instanceof CasMismatchError=' + ok);
            if (!ok) failures++;
        }
    }

    // ARM 4 — which durability levels this server+SDK pair actually accepts.
    for (const lvl of ['Majority', 'MajorityAndPersistOnMaster', 'PersistToMajority']) {
        const dl = couchbase.DurabilityLevel[lvl];
        if (dl === undefined) { line('ARM4 ' + lvl, 'NOT IN SDK ENUM'); continue; }
        try { await collA.upsert(KEY + '::dur', { lvl }, { durabilityLevel: dl }); line('ARM4 ' + lvl, 'ACCEPTED'); }
        catch (e) { line('ARM4 ' + lvl, 'REJECTED ' + classOf(e)); }
    }

    for (const k of [KEY, KEY + '::dur']) { try { await collA.remove(k); } catch (e) {} }
    await A.close(); await B.close();
    console.log('FAILURES=' + failures);
    process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('HARNESS ERROR: ' + classOf(e) + ': ' + (e && e.message)); process.exit(2); });
