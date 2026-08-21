/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2026 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */
'use strict';

/**
 * Redis connector — a STORE BACKEND only: no entity/ORM wiring.
 *
 * Redis is deliberately not a general data path here. It backs three named
 * subsystems, each of which owns its own client:
 *   - a session store backend via `lib.SessionStore`
 *     (see: core/connectors/redis/lib/session-store.js),
 *   - an async-job store backend via `app.json`'s `jobs.store`
 *     (see: core/connectors/redis/lib/job-store.js), or
 *   - the shared L2 tier of the render/output cache, behind
 *     `lib/render-cache`'s `redis` strategy — the tier that lets several
 *     replicas serve the same rendered page without each re-rendering it
 *     (see: core/connectors/redis/lib/render-cache-store.js).
 *
 * To configure:
 *   1. Add a `redis` entry to `config/connectors.json` in your bundle.
 *   2. Install ioredis in your project: `npm install ioredis`
 *   3. Wire the store: session store in `bundle/index.js`; job store via
 *      `app.json` `{ "jobs": { "store": "<entry name>" } }`; render-cache L2
 *      via `settings.json` `{ "server": { "cache": { "type": "redis",
 *      "store": "<entry name>" } } }`.
 *
 * The boot-time model scan is satisfied by the no-op `lib/connector.js`
 * (no connection is opened at boot — each store owns its client).
 * No entity/ORM wiring is currently planned — the store-backend split is
 * the design, not a stopgap. A general-purpose KV facade exists since #KV1
 * (`lib/kv`, `settings.json > kv`, reached as `gina.kv('<namespace>')`) with
 * per-NAMESPACE failure policy, precisely because the right client policy
 * (timeouts, offline queueing, fail-open vs fail-closed) differs per use —
 * the three stores above demonstrate exactly that divergence. This connector
 * does not implement a `lib/kv-store.js` backend (a kv namespace naming a
 * redis entry refuses the boot); redis-backed KV therefore means reading
 * your `connectors.json` entry via `getConfig()` and minting your own
 * client, and NON-KV redis use (data structures, queue libraries) stays
 * app-owned by design.
 *
 * Because there is no entity path, redis operations do NOT appear in the
 * Inspector's query log: its dev-mode capture hangs off the entity query
 * path, which this connector deliberately does not implement. A render-cache
 * L2 hit is observable per response via the RFC 9211 `Cache-Status` header,
 * not in the Inspector.
 *
 * @class Redis
 * @constructor
 */
var Redis = function Redis() {
    // no entity wiring — a store backend only (sessions, jobs, render-cache L2)
};

module.exports = Redis;
