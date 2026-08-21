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
 * the design, not a stopgap. The same stance covers a general-purpose KV
 * facade (get/set/del/TTL): deliberately not provided, because the right
 * client policy (timeouts, offline queueing, fail-open vs fail-closed)
 * differs per subsystem — the three stores above demonstrate exactly that
 * divergence. App code that needs raw key-value access reads its
 * `connectors.json` entry via `getConfig()` and mints its own client with
 * the failure policy its use case requires.
 *
 * Because there is no entity path, redis operations do NOT appear in the
 * Inspector's query log: `_devQueryLog` capture hangs off the entity query
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
