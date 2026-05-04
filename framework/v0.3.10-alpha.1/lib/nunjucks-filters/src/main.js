/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2026 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * NunjucksFilters
 * ---------------
 * Setup
 * ---------------
 *   var filters = NunjucksFilters({
 *     options     : local.options,
 *     isProxyHost : isProxyHost,
 *     throwError  : self.throwError,
 *     req         : local.req,
 *     res         : local.res
 *   });
 * ---------------
 * Call
 * ---------------
 *   env.addFilter('getUrl', filters.getUrl);
 *
 * Mirror of `lib/swig-filters` for the nunjucks render path. The filter
 * implementations themselves are template-engine-agnostic (they compute
 * URLs, format dates, transform strings); only the registration call is
 * different (`env.addFilter` vs `swig.setFilter`). Registration happens
 * per-request in `controller.render-nunjucks.js` because two filters
 * (`getUrl`, `getWebroot`) need access to per-request context (`req`,
 * `options`, `isProxyHost`). Per-request mutation of the cached
 * `nunjucks.Environment` is safe: `env.render()` is synchronous and
 * Node's event loop serialises requests.
 *
 * @module lib/nunjucks-filters
 * @memberof module:lib
 */

/**
 * Factory that builds the filter registry from the per-request context.
 *
 * Singleton-ish — a `NunjucksFilters.instance` is kept so subsequent
 * filter calls (during the synchronous `env.render()` pass) can read the
 * just-set context via `NunjucksFilters.instance._options`. Replaces its
 * own `_options` on every call; safe under Node's single-threaded event
 * loop because `env.render()` does not yield.
 *
 * @class NunjucksFilters
 * @constructor
 * @param {object}   conf              - Per-request context passed by the render delegate
 * @param {object}   conf.options      - The controller's `localOptions` (deep-cloned at the call site)
 * @param {boolean}  conf.isProxyHost  - Whether the bundle is running behind a reverse proxy
 * @param {function} conf.throwError   - SuperController's `throwError` reference
 * @param {object}   conf.req          - The HTTP request (`local.req`)
 * @param {object}   conf.res          - The HTTP response (`local.res`)
 * @returns {NunjucksFilters} The filter registry — a plain object with one method per filter
 *
 * @example
 *   var NunjucksFilters = require('lib/nunjucks-filters');
 *   var filters = NunjucksFilters({
 *       options:     JSON.clone(localOptions),
 *       isProxyHost: isProxyHost,
 *       throwError:  self.throwError,
 *       req:         local.req,
 *       res:         local.res
 *   });
 *   for (var name in filters) {
 *       if (typeof filters[name] === 'function' && name !== 'getConfig') {
 *           env.addFilter(name, filters[name]);
 *       }
 *   }
 */
function NunjucksFilters(conf) {

    var isGFFCtx = ((typeof (module) !== 'undefined') && module.exports) ? false : true;

    if ( typeof(merge) == 'undefined' ) {
        merge = null;
    }
    if ( !merge || typeof(merge) != 'function' ) {
        merge = require(_(GINA_FRAMEWORK_DIR+"/lib/merge", true));
    }
    if ( typeof(routing) == 'undefined' ) {
        routing = null;
    }
    if ( !routing || typeof(routing) != 'function' ) {
        routing = require(_(GINA_FRAMEWORK_DIR+"/lib/routing", true));
    }

    var self = { options: conf };

    var init = function() {
        if ( typeof(NunjucksFilters.initialized) != 'undefined' ) {
            return getInstance();
        } else {
            NunjucksFilters.instance = self;
            if (self.options) {
                NunjucksFilters.instance._options = self.options;
            }
            NunjucksFilters.initialized = true;
            return NunjucksFilters.instance;
        }
    };

    var getInstance = function() {
        if (conf) {
            self.options = NunjucksFilters.instance._options = JSON.clone(conf);
        }
        return NunjucksFilters.instance;
    };

    /**
     * Internal accessor — returns a deep clone of the current `_options`
     * so callers cannot mutate the singleton state. Excluded from
     * `env.addFilter()` registration in render-nunjucks.js.
     *
     * @memberof NunjucksFilters
     * @returns {object} Deep clone of the current per-request context
     */
    self.getConfig = function() {
        return JSON.clone(self.options);
    };

    /**
     * Resolve the bundle's web root URL.
     *
     * Mirror of `SwigFilters.getWebroot`. Uses `ctx.options.envObj.getConf`
     * to look up bundle config; intended for templates that need the
     * absolute origin (scheme + host[:port] + webroot) for rendering links
     * to other bundles.
     *
     * @memberof NunjucksFilters
     * @param {string} input - Pipe input (typically a path string)
     * @param {object} obj   - Bundle name passed to `envObj.getConf`
     * @returns {string} Absolute URL: `scheme://host[:port]/webroot`
     *
     * @example
     *   {{ 'admin' | getWebroot }}
     */
    self.getWebroot = function (input, obj) {

        var ctx  = NunjucksFilters.instance._options || self.options;

        var url     = null
            , prop  = self.options.envObj.getConf(obj, options.conf.env)
            , isProxyHost  = ( ctx.isProxyHost && String(ctx.isProxyHost).toLowerCase() === 'true' ) ? true : (( typeof(process.gina.PROXY_HOSTNAME) != 'undefined' ) ? true : false)
        ;
        if ( isProxyHost ) {
            url = prop.server.scheme + '://'+ prop.host;
        } else {
            url = prop.server.scheme + '://'+ prop.host +':'+ prop.port[prop.server.protocol][prop.server.scheme];
        }

        if ( typeof(prop.server['webroot']) != 'undefined') {
            url += prop.server['webroot'];
        }
        return url;
    };

    /**
     * Build a URL for a named route.
     *
     * Mirror of `SwigFilters.getUrl`. Accepts a route name (`'home'`),
     * a route@bundle string (`'home@admin'`), an absolute path
     * (`'/dashboard'`), or — in standalone mode — a path that needs the
     * bundle webroot prepended. Honours proxy mode via
     * `process.gina.PROXY_HOSTNAME` / `PROXY_HOST`.
     *
     * @memberof NunjucksFilters
     * @param {string} route    - Route name, `route@bundle`, or absolute path
     * @param {object} [params] - Path/query parameters; pass `null` if `base` is needed but params aren't
     * @param {string} [base]   - Optional base — a CDN URL, `http://domain.com`, or another bundle name
     * @returns {string} The resolved relative or absolute URL
     *
     * @example
     *   <a href="{{ '/homepage' | getUrl }}">Homepage</a>
     *   <a href="{{ 'users-edit' | getUrl({ id: user.id }) }}">Edit user</a>
     *   <a href="{{ 'home@admin' | getUrl }}">Open admin dashboard</a>
     *   <script src="{{ '/js/vendor/modernizr.min.js' | getUrl }}"></script>
     */
    self.getUrl = function (route, params, base) {

        if (typeof(params) == 'undefined') {
            params = {};
        }
        var ctx  = NunjucksFilters.instance._options || self.options;

        var config              = null
            , scheme            = null
            , hostname          = null
            , requestPort       = null
            , wroot             = null
            , wrootRe           = null
            , isStandalone      = null
            , isMaster          = null
            , isProxyHost       = ( ctx.isProxyHost && String(ctx.isProxyHost).toLowerCase() === 'true' ) ? true : (( typeof(process.gina) != 'undefined' && typeof(process.gina.PROXY_HOSTNAME) != 'undefined' ) ? true : false)
            , routingRules      = null
            , rule              = null
            , url               = NaN
            , urlStr            = null
            , method            = 'GET'
        ;

        if (ctx.options.method != 'undefined') {
            method = ctx.options.method;
        }

        // if no route, returns current route
        if ( !route || typeof(route) == 'undefined') {
            route = ctx.options.rule;
        }

        config = {};
        if (/\@/.test(route) && typeof(base) == 'undefined') {
            var r = route.split(/\@/);
            route = r[0].toLowerCase();
            base = config.bundle = r[1];
            r = null;
        } else {
            if (
                !/\@/.test(route)
                && !/\.(.*)$/.test(route)
                && typeof(base) == 'undefined'
            ) {
                base = config.bundle = ctx.options.conf.bundle;
            }
        }

        // setting default config
        config          = merge(config, ctx.options.conf);
        hostname        = '';
        wroot           = config.server.webroot;
        isStandalone    = (config.bundles.length > 1) ? true : false;
        isMaster        = (config.bundles[0] === config.bundle) ? true : false;
        routingRules    = config.routing;


        if ( typeof(base) != 'undefined' ) {

            // if base is not an URL, must be a bundle
            if ( !/^(http|https)\:/.test(base) ) {
                var mainConf = getContext('gina').Config.instance;
                if ( mainConf.allBundles.indexOf(base) > -1 ) {
                    config          = mainConf.Env.getConf(base, mainConf.env);
                    hostname        = config.hostname + config.server.webroot;

                    scheme          = hostname.match(/^(https|http)/)[0];
                    requestPort = (ctx.req.headers.port||ctx.req.headers[':port']||parseInt(process.gina.PROXY_PORT));
                    var hostPort = config.hostname.match(/(\:d+\/|\:\d+)$/);
                    hostPort = (hostPort) ? ~~(hostPort[0].replace(/\:/g, '')) : config.port[config.server.protocol][config.server.scheme];
                    var isSpecialCase = (
                            getContext('bundle') != config.bundle
                            && requestPort != hostPort
                            && ctx.req.headers[':host'] != process.gina.PROXY_HOST
                    ) ? true : false;

                    if (isSpecialCase) {
                        hostname = config.hostname;
                        if (isProxyHost) {
                            hostname = scheme + '://'+ (process.gina.PROXY_HOST||ctx.req.headers.host||ctx.req.headers[':host']);
                        }
                    }

                    if (
                        isProxyHost
                        && !isSpecialCase
                    ) {
                        hostname    = scheme + '://'+ (process.gina.PROXY_HOST||ctx.req.headers.host||ctx.req.headers[':host']);

                        if (
                            requestPort !== '80' && requestPort !== '443' && requestPort !== 80 && requestPort !== 443
                            && !hostname.endsWith('' + requestPort)
                        ) {
                            hostname += ':'+ requestPort;
                        }
                    }


                    config.bundle   = base;
                    isStandalone    = (mainConf.bundles.length > 1) ? true : false;
                    isMaster        = (mainConf.bundles[0] === config.bundle) ? true : false;

                } else {
                    ctx.throwError(ctx.res, 500, new Error('bundle `'+ base +'` not found: NunjucksFilters.getUrl() filter encountered a problem while trying to compile base `'+base+'` and route `'+route+'`').stack);
                }
            } else {
                scheme = base.match(/^(https|http)/)[0];
            }
        }

        wrootRe = new RegExp('^'+ config.server.webroot);

        // is path ?
        if (/^\//.test(route)) {

            if ( !wrootRe.test(route) ) {
                route = config.server.webroot + route.substring(1);
                hostname =   hostname.replace(new RegExp( config.server.webroot +'$'), '');
            } else if (
                config.server.webroot != '/'
                && config.server.webroot != ''
            ) {
                route = route.substring(1);
            }

            return hostname + route;
        }

        // rules are now unique per bundle : route@bundle
        rule = route + '@' + config.bundle;
        try {
            url = routing.getRoute(route +'@'+ config.bundle, params);
            if (isProxyHost) {
                url.proxy_hostname    = (isGFFCtx) ? window.location.protocol +'//'+ document.location.hostname : process.gina.PROXY_HOSTNAME;
                url.proxy_host        = url.hostname.replace(/(https|http)\:\/\//, '');
            }
            url = url.toUrl();

        } catch (routingErr) {
            url = '404:['+ ctx.req.method +']'+rule;
            console.error('[nunjucks-filter] Routing Exception on route "', rule, '" \n', 'isProxy: '+ isProxyHost +'\n', 'process.gina.PROXY_HOSTNAME: '+ process.gina.PROXY_HOSTNAME +'\n' , routingErr.stack);
        }

        return url;
    };

    /**
     * Extends the default `length` filter to honour collection-style
     * objects that expose a `.count()` method (e.g. Gina collections).
     *
     * @memberof NunjucksFilters
     * @param {*} input - Any value with a `.length` or `.count()`
     * @param {*} [obj] - Unused — kept for swig parity
     * @returns {number} The length / count
     *
     * @example
     *   {{ users | length }}
     */
    self.length = function (input, obj) {
        // Match upstream nunjucks `runtime.length` / Jinja2: undefined or null → 0.
        // Without this guard, `typeof(input.count)` dereferences `.count` first
        // and throws on undefined — crashing any template that pipes a missing
        // variable through `| length`.
        if ( input == null ) {
            return 0;
        }
        if ( typeof(input.count) != 'undefined' ) {
            return input.count();
        } else {
            return input.length;
        }
    };

    /**
     * Replace newlines with `<br/>` (or a custom replacement).
     *
     * @memberof NunjucksFilters
     * @param {string} text          - Source string
     * @param {string} [replacement='<br/>'] - Replacement string
     * @returns {string} Transformed string
     *
     * @example
     *   {{ post.body | nl2br | safe }}
     */
    self.nl2br = function(text, replacement) {
        replacement = ( typeof( replacement ) != 'undefined' ) ? replacement : '<br/>';
        return text.replace(/(\n|\r)/g, replacement);
    };

    /**
     * Add or subtract hours from a date.
     * Mirrors `helpers/dateFormat.js::addHours`.
     *
     * @memberof NunjucksFilters
     * @param {Date|string} input - Date value piped from the template
     * @param {number} h          - Hours to add (negative to subtract)
     * @returns {Date}
     *
     * @example
     *   {{ post.publishedAt | addHours(2) | date('Y-m-d H:i') }}
     */
    self.addHours = function(input, h) {
        var d = (input instanceof Date) ? new Date(input.getTime()) : new Date(input);
        d.setHours(d.getHours() + h);
        return d;
    };

    /**
     * Add or subtract days from a date.
     * Mirrors `helpers/dateFormat.js::addDays`.
     *
     * @memberof NunjucksFilters
     * @param {Date|string} input - Date value piped from the template
     * @param {number} d          - Days to add (negative to subtract)
     * @returns {Date}
     *
     * @example
     *   {{ event.startDate | addDays(7) | date('Y-m-d') }}
     */
    self.addDays = function(input, d) {
        var copied = (input instanceof Date) ? new Date(input.getTime()) : new Date(input);
        copied.setHours(copied.getHours() + d * 24);
        return copied;
    };

    /**
     * Add or subtract years from a date.
     * Mirrors `helpers/dateFormat.js::addYears`.
     *
     * @memberof NunjucksFilters
     * @param {Date|string} input - Date value piped from the template
     * @param {number} y          - Years to add (negative to subtract)
     * @returns {Date}
     *
     * @example
     *   {{ user.birthDate | addYears(18) | date('Y-m-d') }}
     */
    self.addYears = function(input, y) {
        var d = (input instanceof Date) ? new Date(input.getTime()) : new Date(input);
        d.setFullYear(d.getFullYear() + y);
        return d;
    };

    return init();
}

if ((typeof (module) !== 'undefined') && module.exports) {

    // Loading logger
    if ( typeof(console.err) == 'undefined' ) {
        console = require('../../logger');
    }

    module.exports = NunjucksFilters;
} else if (typeof (define) === 'function' && define.amd) {
    define(function() { return NunjucksFilters; });
}
