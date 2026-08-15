# Couchbase storage-store soak probes

On-demand verification for the Couchbase metadata store behind the object-storage
layer (`connectors/couchbase/lib/storage-store.js`). **Not a CI gate** — CI has no
cluster — so these are run by hand against a real deployment, before touching the
store or when diagnosing a report from one.

They answer the questions a fake SDK structurally cannot. The unit suite drives a
stub that pattern-matches statement shapes and never parses N1QL or evaluates CAS,
so it can neither see a reserved word (how `#B356` reached a release) nor tell a
genuine compare-and-swap failure from a lucky one.

## The probes

**`probe-cas.js`** — SDK level; needs no store code at all. Opens **two genuinely
separate connections** (not two handles on one) and reports the error CLASS raised
by a stale-CAS `mutateIn`, with a fresh-CAS arm as a positive control so a throw
cannot be mistaken for a bad path or a missing permission. Also compares the
`replace` and `remove` arms and checks durability-level acceptance.

```bash
CB_U=… CB_P=… CB_CONN=couchbase://host CB_BUCKET=storage_probe node probe-cas.js
```

**`probe-store.js`** — drives the store itself through `STORE_PATH` and its
injected-driver seam. Takes a mode as its first argument:

```bash
STORE_PATH=/path/to/storage-store.js CB_U=… CB_P=… node probe-store.js <mode> [arg]
```

| Mode | What it exercises |
| --- | --- |
| `storm` | Identical-put storm. Run it cross-PROCESS for the real case — in-process it shares one event loop and proves less. |
| `zero` | Zero-reference accounting. |
| `claim <epochMs>` | Barrier race on the CAS claim. Deliberately NOT driven through `listZeroRefs`, whose GSI lag lets the arms never actually contend. |
| `sweep <epochMs>` | The realistic sweep path. Flaky by design near the grace boundary — that flakiness IS the GSI-lag observation, not a defect in the probe. |
| `inspect` | Dump current rows. |

## Environment

`CB_CONN` (default `couchbase://127.0.0.1`), `CB_U`, `CB_P`, `CB_BUCKET` (default
`storage_probe`), `CB_SDK` (default `couchbase` — point it at a specific major),
`CB_HOST`, `STORE_PATH`, `PROBE_KEY`, `TAG`.

**Requires** a reachable cluster, a bucket, index-create rights, and SDK major 3 or
4 resolvable.

**Not covered:** the failover drill, and the driver dispatcher (these drive the
store directly).

## Provenance

Contributed by a deployment operator running the store against a real four-node
cluster, in response to the `#B356` fix. Framework-generic by construction — every
input is an environment variable and nothing names a particular deployment.
Verified against the store's real API before being tracked: the factory signature
`(connConf, bundle, driverName, injected)` and the `injected.driver` seam, all
seven driven verbs (`get` / `acquireRef` / `releaseRef` / `listZeroRefs` /
`removeIfZero` / `stats` / `close`) with matching arities, and every `connConf` key
the harness passes is one the store reads.
