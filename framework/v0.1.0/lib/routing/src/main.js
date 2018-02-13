/*
 * This file is part of the gina package.
 * Copyright (c) 2017 Rhinostone <gina@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */
if (typeof (module) !== 'undefined' && module.exports) {
    var lib     = require('../../index');
    var console = lib.logger;
    var merge   = lib.merge;
}


/**
 * Routing
 *
 * @package     Gina.Lib
 * @namespace   Gina.Lib.Routing
 * @author      Rhinostone <gina@rhinostone.com>
 * */

function Routing() {

    var self        = {};
    var isGFFCtx    = ((typeof (module) !== 'undefined') && module.exports) ? false :  true;

    /**
     * Compare urls
     *
     * @param {object} params - Route params containing the given url to be compared with
     * @param {string|array} url - routing.json url
     * @param {object} [request]
     *
     * @return {object|false} foundRoute
     * */
    self.compareUrls = function(params, url, request) {

        if ( typeof(request) == 'undefined' ) {
            var request = { routing: {} }
        }

        if (Array.isArray(url)) {
            var i = 0
                , foundRoute = {
                    past: false,
                    request: request
                };


            while (i < url.length && !foundRoute.past) {
                foundRoute = parseRouting(params, url[i], request);
                ++i
            }

            return foundRoute
        } else {
            return parseRouting(params, url, request)
        }
    }

    /**
     * Check if rule has params
     *
     * @param {string} pathname
     * @return {boolean} found
     *
     * @private
     * */
    var hasParams = function(pathname) {
        return (/:/.test(pathname)) ? true : false
    }

    /**
     * Parse routing for mathcing url
     *
     * @param {object} params
     * @param {string} url
     * @param {object} request
     *
     * @return {object} foundRoute
     *
     * */
    var parseRouting = function(params, url, request) {

        var uRe = params.url.split(/\//)
            , uRo = url.split(/\//)
            , maxLen = uRo.length
            , score = 0
            , foundRoute = {}
            , i = 0;

        //attaching routing description for this request
        request.routing = params; // can be retried in controller with: req.routing

        if (uRe.length === uRo.length) {
            for (; i < maxLen; ++i) {
                if (uRe[i] === uRo[i]) {
                    ++score
                } else if (score == i && hasParams(uRo[i]) && fitsWithRequirements(uRo[i], uRe[i], params, request)) {
                    ++score
                }
            }
        }

        foundRoute.past = (score === maxLen) ? true : false;
        foundRoute.request = request;

        return foundRoute
    }

    /**
     * Fits with requiremements
     * http://en.wikipedia.org/wiki/Regular_expression
     *
     * @param {string} urlVar
     * @param {string} urlVal
     * @param {object} params
     *
     * @return {boolean} true|false - True if fits
     *
     * @private
     * */
    var fitsWithRequirements = function(urlVar, urlVal, params, request) {

        var matched = -1
            , _param = urlVar.match(/\:\w+/g)
            , regex = null
            , tested = false;

        if (!_param.length) return false;

        //  if custom path, path rewrite
        if (request.routing.param.path) {
            regex = new RegExp(urlVar, 'g')
            if (regex.test(request.routing.param.path)) {
                request.routing.param.path = request.routing.param.path.replace(regex, urlVal);
            }
        }

        //  if custom file, file rewrite
        if (request.routing.param.file) {
            regex = new RegExp(urlVar, 'g')
            if (regex.test(request.routing.param.file)) {
                request.routing.param.file = request.routing.param.file.replace(regex, urlVal);
            }
        }

        if (_param.length == 1) {// fast one
            matched = (_param.indexOf(urlVar) > -1) ? _param.indexOf(urlVar) : false;

            if (matched === false) return matched;
            // filter on method
            if (params.method !== request.method) return false;

            var key = _param[matched].substr(1);
            regex = params.requirements[key];

            if (/^\//.test(regex)) {
                var re = regex.match(/\/(.*)\//).pop()
                    , flags = regex.replace('/' + re + '/', '');

                tested = new RegExp(re, flags).test(urlVal)

            } else {
                tested = new RegExp(params.requirements[key]).test(urlVal)
            }

            if (
                typeof (params.param[key]) != 'undefined' &&
                typeof (params.requirements) != 'undefined' &&
                typeof (params.requirements[key]) != 'undefined' &&
                tested
            ) {
                request.params[key] = urlVal;
                return true
            }

        } else { // slow one

            // In order to support rules defined like :
            //      { params.url }  => `/section/:name/page:number`
            //      { request.url } => `/section/plante/page4`
            //
            //      with keys = [ ":name", ":number" ]

            var keys = _param
                , tplUrl = params.url
                , url = request.url
                , values = {}
                , strVal = ''
                , started = false
                , i = 0;

            for (var c = 0, posLen = url.length; c < posLen; ++c) {
                if (url.charAt(c) == tplUrl.charAt(i) && !started) {
                    ++i
                    continue
                } else if (strVal == '') { // start

                    started = true;
                    strVal += url.charAt(c);
                } else if (c > (tplUrl.indexOf(keys[0]) + keys[0].length)) {

                    regex = params.requirements[keys[0]];
                    urlVal = strVal.substr(0, strVal.length);

                    if (/^\//.test(regex)) {
                        var re = regex.match(/\/(.*)\//).pop()
                            , flags = regex.replace('/' + re + '/', '');

                        tested = new RegExp(re, flags).test(urlVal)

                    } else {
                        tested = new RegExp(params.requirements[key]).test(urlVal)
                    }

                    if (tested) {
                        values[keys[0].substr(1)] = urlVal
                    } else {
                        return false
                    }

                    strVal = '';
                    started = false;
                    i = (tplUrl.indexOf(keys[0]) + keys[0].length);
                    c -= 1;

                    keys.splice(0, 1)
                } else {
                    strVal += url.charAt(c);
                    ++i
                }

                if (c == posLen - 1) {

                    regex = params.requirements[keys[0]];
                    urlVal = strVal.substr(0, strVal.length);

                    if (/^\//.test(regex)) {
                        var re = regex.match(/\/(.*)\//).pop()
                            , flags = regex.replace('/' + re + '/', '');

                        tested = new RegExp(re, flags).test(urlVal)

                    } else {
                        tested = new RegExp(params.requirements[key]).test(urlVal)
                    }

                    if (tested) {
                        values[keys[0].substr(1)] = urlVal
                    } else {
                        return false
                    }

                }

            }

            if (values.count() == keys.length) {
                for (var key in values) {
                    request.params[key] = values[key];
                }
                return true
            }

        }

        return false
    }

    /**
     * @function getRoute
     *
     * @param {string} rule e.g.: [ <protocol>:// ]<name>[ @<bundle> ][ /<environment> ]
     * @param {object} params
     *
     * @return {object} route
     * */
    self.getRoute = function(rule, params) {

        var config      = getContext('gina').config
            , env       = GINA_ENV // by default, using same protocol
            , protocol  = null
            , bundle    = config.bundle // by default
        ;

        if ( /\@/.test(rule) ) {

            var arr = ( rule.replace(/(.*)\:\/\//, '') ).split(/\@/);

            bundle  = arr[1];

            // getting env
            if ( /\/(.*)$/.test(rule) ) {
                env = ( rule.replace(/(.*)\:\/\//, '') ).split(/\/(.*)$/)[1];
                bundle = bundle.replace(/\/(.*)$/, '')
            }


            // getting protocol
            protocol = ( /\:\/\//.test(rule) ) ? rule.split(/\:\/\//)[0] : config.bundlesConfiguration.conf[bundle][env].protocol;

            rule = arr[0] +'@'+ bundle;
        }

        var routing = config.getRouting(bundle, env);

        if ( typeof(routing[rule]) == 'undefined' ) {
            throw new Error('[ RoutingHelper::getRouting(rule, params) ] : `' +rule + '` not found !')
        }

        var route = JSON.parse(JSON.stringify(routing[rule]));
        var variable = null
        for (var p in route.param) {
            if ( /^:/.test(route.param[p]) ) {
                variable = route.param[p].substr(1);
                if ( typeof(params) != 'undefined' && typeof(params[variable]) != 'undefined' ) {
                    route.url = route.url.replace( new RegExp('(/:'+variable+'|/:'+variable+'$)', 'g'), '/'+ params[variable] );

                    if ( typeof(route.param.path) != 'undefined' && /:/.test(route.param.path) ) {
                        route.param.path = route.param.path.replace( new RegExp('(:'+variable+'/|:'+variable+'$)', 'g'), params[variable]);
                    }
                }
            }
        }

        if ( Array.isArray(route.url) ) {
            route.url = route.url[0]
        }

        route.toUrl = function (ignoreWebRoot) {

            var conf        = config.bundlesConfiguration.conf[bundle][env]
                , wroot     = conf.server.webroot
                , path      = this.url
            ;

            if (wroot.substr(wroot.length-1,1) == '/') {
                wroot = wroot.substr(wroot.length-1,1).replace('/', '')
            }

            this.url = ( typeof(ignoreWebRoot) != 'undefined' && ignoreWebRoot == true ) ? path.replace(wroot, '') : path;

            return conf.hostname + path
        };

        return route
    };

    

    /**
     * Get route by url
     * N.B.: this will only work with rules declared with `GET` method property
     *
     * @function getRouteByUrl
     *
     * @param {string} url e.g.: /bundle/some/url/path or http
     * @param {string} [bundle] targeted bundle
     * @param {string} [method] request method (GET|PUT|PUT|DELETE) - GET is set by default
     *
     * @return {object} route
     * */
    self.getRouteByUrl = function (url, bundle, method) {

        if (arguments.length == 2 && typeof(arguments[1]) != 'undefined' && ['get', 'post', 'put', 'delete'].indexOf(arguments[1].toLowerCase()) > -1 ) {
            var method = arguments[1], bundle = undefined;
        }

        var matched         = false
            , hostname      = null
            , config        = null
            , env           = null
            , webroot       = null
            , prefix        = null
            , pathname      = null
            , params        = null            
            , routing       = null
            , isRoute       = null
            , foundRoute    = null
            , route         = null
            , routeObj      = null
            , isXMLRequest  = null
        ;

        if (isGFFCtx) {
            config          = window.gina.config;
            bundle          = (typeof (bundle) != 'undefined') ? bundle : config.bundle;
            env             = config.env;
            routing         = config.getRouting(bundle);
            isXMLRequest    = false; // TODO - retrieve the right value

            hostname        = config.hostname;
            webroot         = config.webroot;
            prefix          = hostname + webroot;

        } else {

            var gnaCtx      = getContext('gina');
            
            config          = gnaCtx.config;
            bundle          = (typeof (bundle) != 'undefined') ? bundle : config.bundle;
            env             = config.env;
            routing         = config.getRouting(bundle, env);
            isXMLRequest    = getContext().router.isProcessingXMLRequest;

            hostname        = config.envConf[bundle][env].hostname;
            webroot         = config.envConf[bundle][env].server.webroot;
            prefix          = hostname + webroot;
        }

        pathname    = url.replace( new RegExp('^'+ hostname), '');
        method = (typeof (method) != 'undefined') ? method.toLowerCase() : 'get';

        //  getting params
        params = {};
        if (isGFFCtx) { 

        }

        var request = {
            routing: {
                path: unescape(pathname)
            },
            method: method,
            params: {},
            url: url
        };

        var paramsList = null;
        var re = new RegExp('^'+ method +'$', 'i');

        out:
            for (var name in routing) {
                if (typeof (routing[name]['param']) == 'undefined')
                    break;

                // bundle filter
                if (routing[name].bundle != bundle) continue;

                // method filter
                if (typeof (routing[name].method) != 'undefined' && !re.test(routing[name].method)) continue;
                
                //Preparing params to relay to the core/router.
                params = {
                    method: (routing[name].method) ? routing[name].method.toLowerCase() : request.method,
                    requirements: routing[name].requirements,
                    namespace: routing[name].namespace || undefined,
                    url: unescape(pathname), /// avoid %20
                    rule: routing[name].originalRule || name,
                    param: routing[name].param,
                    middleware: routing[name].middleware,
                    bundle: routing[name].bundle,
                    isXMLRequest: isXMLRequest
                };

                // normal case
                //Parsing for the right url.
                try {
                    isRoute = self.compareUrls(params, routing[name].url, request);

                    if (isRoute.past) {

                        route = JSON.parse(JSON.stringify(routing[name]));
                        route.name = name;

                        matched = true;
                        isRoute = {};

                        break;
                    }

                } catch (err) {
                    throw new Error('Route [ ' + name + ' ] needs your attention.\n' + err.stack);
                }
            } //EO for break out

        if (!matched) {
            if (isGFFCtx) {
                console.warn('[ RoutingHelper::getRouteByUrl(rule[, bundle, method]) ] : route not found for url: `' + url + '` !');
                return undefined
            }

            throw new Error('[ RoutingHelper::getRouteByUrl(rule[, bundle, method]) ] : route not found for url: `' + url + '` !')

        } else {
            return route
        }
    }

    return self
}

if ((typeof (module) !== 'undefined') && module.exports) {
    // Publish as node.js module
    module.exports = Routing()
} else if (typeof (define) === 'function' && define.amd) {
    // Publish as AMD module
    define(function() { return Routing() })
}