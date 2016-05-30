/*
 * This file is part of the gina package.
 * Copyright (c) 2016 Rhinostone <gina@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */


//Imports.

var url                 = require('url')
    , fs                = require('fs')
    , utils             = require('./utils')
    , console           = utils.logger
    , inherits          = utils.inherits
    , merge             = utils.merge
    , SuperController   = require('./controller')
    , Config            = require('./config')
    //get config instance
    , config            = new Config();

/**
 * @class Router
 *
 *
 * @package     Gina
 * @namespace
 * @author      Rhinostone <gina@rhinostone.com>
 * @api         Public
 */
function Router(env) {

    this.name = 'Router';
    var self = this
        , local = {
            conf    : config.getInstance(),
            bundle  : null
        };

    /**
     * Router Constructor
     * @constructor
     * */
    var init = function(){
        if ( typeof(Router.initialized) != "undefined" ) {
            return self.getInstance()
        } else {
            Router.initialized = true
        }
    }

    this.setMiddlewareInstance = function(instance) {
        self.middlewareInstance = instance
    }

    this.getInstance = function() {
        return self
    }


    /**
     * Compare urls
     *
     * @param {object} request
     * @param {object} params - Route params
     * @param {string} urlRouting
     *
     * @return {object|false} routes
     * */
    this.compareUrls = function(request, params, urlRouting) {

        if ( Array.isArray(urlRouting) ) {
            var i       = 0
                , res   = {
                    past    : false,
                    request : request
                };

            while (i < urlRouting.length && !res.past) {
                res = parseRouting(request, params, urlRouting[i]);
                ++i
            }

            return res
        } else {
            return parseRouting(request, params, urlRouting)
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
        return ( /:/.test(pathname) ) ? true : false
    }

    /**
     * Parse routing for mathcing url
     *
     * @param {object} request
     * @param {object} params
     * @param {str} route
     *
     * @return
     *
     * */
    var parseRouting = function(request, params, route) {
        var uRe         = params.url.split(/\//)
            , uRo       = route.split(/\//)
            , maxLen    = uRo.length
            , score     = 0
            , r         = {}
            , i         = 0;

        //attaching routing description for this request
        request.routing = params; // can be retried in controller with: req.routing

        if (uRe.length === uRo.length) {
            for (; i<maxLen; ++i) {
                if (uRe[i] === uRo[i]) {
                    ++score
                } else if (score == i && hasParams(uRo[i]) && fitsWithRequirements(request, uRo[i], uRe[i], params)) {
                    ++score
                }
            }
        }

        r.past = (score === maxLen) ? true : false;
        r.request = request;

        return r
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
    var fitsWithRequirements = function(request, urlVar, urlVal, params) {

        var matched     = -1
            , _param    = urlVar.match(/\:\w+/g)
            , regex     = null
            , tested    = false;

        if (!_param.length) return false;

        if (_param.length == 1) {// fast one
            matched =  ( _param.indexOf(urlVar) > -1 ) ? _param.indexOf(urlVar) : false;

            if (matched === false) return matched;

            var key = _param[matched].substr(1);
            regex   = params.requirements[key];

            if ( /^\//.test(regex) ) {
                var re      = regex.match(/\/(.*)\//).pop()
                    , flags = regex.replace('/'+ re +'/', '');

                tested = new RegExp(re, flags).test( urlVal )

            } else {
                tested = new RegExp(params.requirements[key]).test( urlVal )
            }

            if (
                typeof(params.param[key]) != 'undefined' &&
                typeof(params.requirements) != 'undefined' &&
                typeof(params.requirements[key]) != 'undefined' &&
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

            var keys        = _param
                , tplUrl    = params.url
                , url       = request.url
                , values    = {}
                , strVal    = ''
                , started   = false
                , i         = 0;

            for (var c = 0, posLen = url.length; c < posLen; ++c) {
                if (url.charAt(c) == tplUrl.charAt(i) && !started) {
                    ++i
                    continue
                } else if (strVal == '') { // start

                    started = true;
                    strVal += url.charAt(c);
                } else if ( c > (tplUrl.indexOf(keys[0]) + keys[0].length) ) {

                    regex   = params.requirements[keys[0]];
                    urlVal  = strVal.substr(0, strVal.length);

                    if ( /^\//.test(regex) ) {
                        var re      = regex.match(/\/(.*)\//).pop()
                            , flags = regex.replace('/'+ re +'/', '');

                        tested = new RegExp(re, flags).test( urlVal )

                    } else {
                        tested = new RegExp(params.requirements[key]).test( urlVal )
                    }

                    if (tested) {
                        values[ keys[0].substr(1) ] = urlVal
                    } else {
                        return false
                    }

                    strVal =  '';
                    started = false;
                    i = (tplUrl.indexOf(keys[0]) + keys[0].length);
                    c -= 1;

                    keys.splice(0,1)
                } else {
                    strVal += url.charAt(c);
                    ++i
                }

                if (c == posLen - 1 ) {

                    regex   = params.requirements[keys[0]];
                    urlVal  = strVal.substr(0, strVal.length);

                    if ( /^\//.test(regex) ) {
                        var re      = regex.match(/\/(.*)\//).pop()
                            , flags = regex.replace('/'+ re +'/', '');

                        tested = new RegExp(re, flags).test( urlVal )

                    } else {
                        tested = new RegExp(params.requirements[key]).test( urlVal )
                    }

                    if (tested) {
                        values[ keys[0].substr(1) ] = urlVal
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

    var refreshCore = function() {
        var core = new RegExp( getPath('gina.core') );
        var excluded = [
            _(getPath('gina.core') + '/gna.js', true)
        ];

        for (var c in require.cache) {
            if ( (core).test(c) && excluded.indexOf(c) < 0 ) {
                require.cache[c].exports = require( _(c, true) )
            }
        }

        //update utils
        delete require.cache[_(getPath('gina.core') +'/utils/index.js', true)];
        require.cache[_(getPath('gina.core') +'/utils/index.js', true)] = require( _(getPath('gina.core') +'/utils/index.js', true) );
        require.cache[_(getPath('gina.core') + '/gna.js', true)].exports.utils = require.cache[_(getPath('gina.core') +'/utils/index.js', true)];

        // Super controller
        delete require.cache[_(getPath('gina.core') +'/controller/index.js', true)];
        require.cache[_(getPath('gina.core') +'/controller/index.js', true)] = require( _(getPath('gina.core') +'/controller/index.js', true) );
        SuperController = require.cache[_(getPath('gina.core') +'/controller/index.js', true)];

    }

    /**
     * Route on the fly
     *
     * @param {object} request
     * @param {object} response
     * @param {object} params - Route params
     *
     * @callback next
     * */
    this.route = function(request, response, next, params) {

        //Routing.
        var pathname        = url.parse(request.url).pathname;
        var bundle          = local.bundle = params.bundle;
        var conf            = config.Env.getConf( bundle, env );
        var bundles         = conf.bundles;
        local.request       = request;
        local.conf          = conf;
        local.isStandalone  = config.Host.isStandalone();

        // for libs/context etc..
        var routerObj = {
            response        : response,
            next            : next,
            hasViews        : ( typeof(conf.content.views) != 'undefined' ) ? true : false,
            isUsingTemplate : conf.template
        };

        setContext('router', routerObj);

        var action          = request.action = params.param.action;
        // more can be added ... but it will always start by `on`Something.
        var reservedActions = [
            "onReady",
            "setup"
        ];
        if (reservedActions.indexOf(action) > -1) throwError(response, 500, '[ '+action+' ] is reserved for the framework');
        var middleware      = params.middleware || [];
        var actionFile      = params.param.file; // matches rule name
        var namespace       = params.namespace;
        var routeHasViews   = ( typeof(conf.content.views) != 'undefined' ) ? true : false;
        var isUsingTemplate = conf.template;
        var hasSetup        = false;
        var hasNamespace    = false;

        local.routeHasViews     = routeHasViews;
        local.isUsingTemplate   = isUsingTemplate;
        local.next              = next;
        local.isXMLRequest      = params.isXMLRequest;

        var cacheless = (process.env.IS_CACHELESS == 'false') ? false : true;
        local.cacheless = cacheless;

        if (cacheless) refreshCore();

        //Middleware Filters when declared.
        var resHeaders = conf.server.response.header;
        //TODO - to test
        if ( resHeaders.count() > 0 ) {
            for (var h in resHeaders) {
                if (!response.headersSent)
                    response.setHeader(h, resHeaders[h])
            }
        }

        console.debug('ACTION ON  ROUTING IS : ' + action);

        //Getting superCleasses & extending it with super Models.
        var controllerFile         = {}
            , setupFile            = {}
            , Controller           = {};

        // TODO -  ?? merge all controllers into a single file while building for other env than `dev`

        setupFile     = conf.bundlesPath +'/'+ bundle + '/controllers/setup.js';
        var filename = '';
        if (namespace) {
            filename = conf.bundlesPath +'/'+ bundle + '/controllers/controller.'+ namespace +'.js';
            if ( !fs.existsSync(filename) ) {
                filename = conf.bundlesPath +'/'+ bundle + '/controllers/controller.js';
                console.warn('namespace found, but no `'+filename+'` to load: just ignore this message if this is ok with you')
            }
        } else {
            filename = conf.bundlesPath +'/'+ bundle + '/controllers/controller.js';
        }
        controllerFile = filename


        // default param setting
        var options = {
            file            : actionFile,
            namespace       : namespace,
            bundle          : bundle,//module
            bundlePath      : conf.bundlesPath +'/'+ bundle,
            rootPath        : self.executionPath,
            conf            : conf,
            instance        : self.middlewareInstance,
            views           : ( routeHasViews ) ? conf.content.views : undefined,
            isUsingTemplate : local.isUsingTemplate,
            cacheless       : cacheless,
            rule            : params.rule,
            isXMLRequest    : params.isXMLRequest
        };

        for (var p in params.param) {
            options[p] = params.param[p]
        }

        try {

            if ( fs.existsSync(_(setupFile, true)) )
                hasSetup = true;

            if (cacheless) {

                delete require.cache[_(controllerFile, true)];

                if ( hasSetup )
                    delete require.cache[_(setupFile, true)];
            }

            Controller = require(_(controllerFile, true));

        } catch (err) {
            // means that you have a syntax errors in you controller file
            // TODO - increase `stack-trace` from 10 (default value) to 500 or more to get the exact error --stack-trace-limit=1000
            // TODO - also check `stack-size` why not set it to at the same time => --stack-size=1024
            throwError(response, 500, new Error('syntax error(s) found in `'+ controllerFile +'` ').stack);
        }

        // about to contact Controller ...
        try {

            Controller      = inherits(Controller, SuperController);

            var controller  = new Controller(options);

            controller.setOptions(request, response, next, options);

            if (hasSetup) { // adding setup
                controller.setup = function(request, response, next) {
                    if (!this._setupDone) {
                        this._setupDone = true;
                        return function (request, response, next) { // getting rid of the controller context
                            var Setup = require(_(setupFile, true));

                            // TODO - loop on a defiend SuperController property like SuperController._allowedForExport
                            // inheriting SuperController functions & objects

                            // exporting config & common methods
                            Setup.engine        = controller.engine;
                            Setup.getConfig     = controller.getConfig;
                            Setup.throwError    = controller.throwError;
                            Setup.redirect      = controller.redirect;
                            Setup.render        = controller.render;
                            Setup.renderJSON    = controller.renderJSON;
                            Setup.isXMLRequest  = controller.isXMLRequest;
                            Setup.isCacheless   = controller.isCacheless;

                            Setup.apply(Setup, arguments);

                            return Setup;
                        }(request, response, next)
                    }
                }
            }

            if (middleware.length > 0) {
                processMiddlewares(middleware, controller, action, request, response, next,
                    function onDone(action, request, response, next){
                        // handle superController events
                        for (var e=0; e<reservedActions.length; ++e) {
                            if ( typeof(controller[reservedActions[e]]) == 'function' ) {
                                controller[reservedActions[e]](request, response, next)
                            }
                        }
                        controller[action](request, response, next)
                    })
            } else {
                // handle superController events
                // e.g.: inside your controller, you can defined: `this.onReady = function(){...}` which will always be called before the main action
                for (var e=0; e<reservedActions.length; ++e) {
                    if ( typeof(controller[reservedActions[e]]) == 'function' ) {
                        controller[reservedActions[e]](request, response, next)
                    }
                }
                controller[action](request, response, next)
            }

        } catch (err) {
            var superController = new SuperController(options);
            superController.setOptions(request, response, next, options);
            if ( typeof(controller) != 'undefined' && typeof(controller[action]) == 'undefined') {
                superController.throwError(response, 500, (new Error('action not found: `'+ action+'`. Please, check your routing.json or the related control in your `'+controllerFile+'`.')).stack);
            } else {
                superController.throwError(response, 500, err.stack);
            }
        }

        action = null
    };//EO route()

    var processMiddlewares = function(middlewares, controller, action, req, res, next, cb){

        var filename        = _(local.conf.bundlePath)
            , middleware    = {}
            , constructor   = null
            , re            = new RegExp('^'+filename);

        if ( middlewares.length > 0 ) {
            for (var m=0; m<middlewares.length; ++m) {
                constructor = middlewares[m].split(/\./g);
                constructor = constructor
                    .splice(constructor.length-1,1)
                    .toString();
                middleware = middlewares[m].split(/\./g);
                middleware.splice(middleware.length-1);
                middleware = middleware.join('/');
                filename = _(filename +'/'+ middleware + '/index.js');
                if ( !fs.existsSync( filename ) ) {
                    // no middleware found with this alias
                    throwError(res, 501, new Error('middleware not found '+ middleware).stack);
                }

                if (local.cacheless) delete require.cache[_(filename, true)];

                middleware = require(_(filename, true));
                if ( !middleware[constructor] ) {
                    throwError(res, 501, new Error('contructor [ '+constructor+' ] not found @'+ middlewares[m]).stack);
                }

                if ( typeof(middleware[constructor]) != 'undefined') {

                    // TODO - loop on a defiend SuperController property like SuperController._allowedForExport
                    // exporting config & common methods
                    middleware.getConfig    = controller.getConfig;
                    middleware.throwError   = controller.throwError;
                    middleware.redirect     = controller.redirect;
                    middleware.render       = controller.render;
                    middleware.renderJSON   = controller.renderJSON;
                    middleware.isXMLRequest = controller.isXMLRequest;

                    middleware[constructor](req, res, next,
                        function onMiddlewareProcessed(req, res, next){
                            middlewares.splice(m, 1);
                            if (middlewares.length > 0) {
                                processMiddlewares(middlewares, controller, action,  req, res, next, cb)
                            } else {
                                cb(action, req, res, next)
                            }
                        }
                    );

                    break
                }
            }

        } else {
            cb(action, req, res, next)
        }
    };

    var hasViews = function() {
        return local.routeHasViews;
    };

    var throwError = function(res, code, msg) {
        if (arguments.length < 3) {
            var msg     = code || null
                , code  = res || 500
                , res   = local.res;
        }

        if (!res.headersSent) {
            if (local.isXMLRequest || !hasViews() || !local.isUsingTemplate) {
                // Internet Explorer override
                if ( /msie/i.test(local.request.headers['user-agent']) ) {
                    res.writeHead(code, "Content-Type", "text/plain")
                } else {
                    res.writeHead(code, { 'Content-Type': 'application/json'} )
                }

                res.end(JSON.stringify({
                    status: code,
                    error: msg
                }))
            } else {
                res.writeHead(code, { 'Content-Type': 'text/html'} );
                res.end('<h1>Error '+ code +'.</h1><pre>'+ msg + '</pre>', local.next);
            }
        } else {
            local.next()
        }
    };

    init()
};

module.exports = Router