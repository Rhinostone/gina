/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2026 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * Gina.Core.Plugins Class
 *
 * @package    Gina.Core
 * @author     Rhinostone <contact@gina.io>
 */

function Plugins() {

    var _require = function(path) {
        var isCacheless = (process.env.NODE_ENV_IS_DEV == 'false') ? false : true;
        if (isCacheless) {
            try {
                delete require.cache[require.resolve(path)];
                return require(path)
            } catch (err) {
                throw err
            }

        } else {
            return require(path)
        }
    }


    var self =  {
        Validator           : _require('./lib/validator'),
        // #CSRF1 — hardened session-cookie wrapper around express-session.
        Session             : _require('./lib/session'),
        // #CSRF2 — signed double-submit token CSRF middleware.
        Csrf                : _require('./lib/csrf'),
        // #HDR1 — X-Content-Type-Options: nosniff response header.
        XContentTypeOptions : _require('./lib/x-content-type-options'),
        // #HDR2 — X-Frame-Options clickjacking-defense response header.
        XFrameOptions       : _require('./lib/x-frame-options'),
        // #HDR3 — Referrer-Policy response header.
        ReferrerPolicy      : _require('./lib/referrer-policy'),
        // #HDR4 — HSTS (Strict-Transport-Security) response header.
        Hsts                : _require('./lib/hsts'),
        // #HDR5 — Content-Security-Policy response header.
        Csp                 : _require('./lib/csp'),
        // #HDR7 — Origin-Agent-Cluster response header (origin-keyed isolation).
        OriginAgentCluster  : _require('./lib/origin-agent-cluster')
    };

    return self
};

module.exports = Plugins()