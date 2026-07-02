/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2026 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */
'use strict';

/**
 * Redis connector — v1: session store + job store (no entity/ORM wiring).
 *
 * Entity/ORM wiring is not implemented in v1. Use this connector as:
 *   - a session store backend via `lib.SessionStore`
 *     (see: core/connectors/redis/lib/session-store.js), or
 *   - an async-job store backend via `app.json`'s `jobs.store`
 *     (see: core/connectors/redis/lib/job-store.js).
 *
 * To configure:
 *   1. Add a `redis` entry to `config/connectors.json` in your bundle.
 *   2. Install ioredis in your project: `npm install ioredis`
 *   3. Wire the store: session store in `bundle/index.js`, job store via
 *      `app.json` `{ "jobs": { "store": "<entry name>" } }`.
 *
 * The boot-time model scan is satisfied by the no-op `lib/connector.js`
 * (no connection is opened at boot — each store owns its client).
 * ORM / entity support is planned for a future release.
 *
 * @class Redis
 * @constructor
 */
var Redis = function Redis() {
    // v1: no entity wiring — session store + job store only
};

module.exports = Redis;
