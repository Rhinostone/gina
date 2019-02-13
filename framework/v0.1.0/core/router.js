/*
 * This file is part of the gina package.
 * Copyright (c) 2016 Rhinostone <gina@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */


//Imports.
var fs                = require('fs')
    
    , lib               = require('./../lib')
    , console           = lib.logger
    , inherits          = lib.inherits
    , merge             = lib.merge
    
    , SuperController   = require('./controller')
    , Config            = require('./config')
    
    //get config instance
    //, config            = new Config()
;

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
            //conf    : config.getInstance(),
            //bundle  : null
        }
    ;

    /**
     * Router Constructor
     * @constructor
     * */
    var init = function() {
        
        if ( typeof(Router.initialized) != "undefined" ) {
            return self.getInstance()
        } else {
            Router.initialized = true
        }
    }
    
    var isSetupRequired = function(control) {
        
        if (local.isXMLRequest) return false;
        
        return ([
            'redirect',
            'query',
            'store',
            'downloadFromLocal',
            'downloadFromURL'
        ].indexOf(control) < 0 ) ? true : false;
    }
    
    this.getInstance = function() {
        return self
    }

    /**
     * Core dependencies refresh for cacheless env
     *  - {core}/controller/controller.js
     */
    var refreshCoreDependencies= function() {
        
        var corePath    = getPath('gina').core;
        
        // Super controller
        delete require.cache[require.resolve(_(corePath +'/controller/controller.js', true))];
        delete require.cache[require.resolve(_(corePath +'/controller/index.js', true))];
        require.cache[_(corePath +'/controller/controller.js', true)] = require( _(corePath +'/controller/controller.js', true) );
        require.cache[_(corePath +'/controller/index.js', true)] = require( _(corePath +'/controller/index.js', true) );
        
        SuperController = require.cache[_(corePath +'/controller/index.js', true)];
    }
    
    this.setServerInstance = function(serverInstance) {
        serverInstance._http2streamEventInitalized = false;
        self.serverInstance = serverInstance;
    }
    
    this.getServerInstance = function () {
        return self.serverInstance;
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
        
        var cacheless           = (process.env.IS_CACHELESS == 'false') ? false : true
            , bundle            = local.bundle = params.bundle
            , config            = new Config().getInstance()
            , serverInstance    = self.getServerInstance()
            , env               = config.env
            , conf              = config[bundle][env]
        ;
        
        local.cacheless     = cacheless;
        local.request       = request;
        local.next          = next;
        local.conf          = conf;
        local.isStandalone  = conf.isStandalone;     
        
        if (cacheless) {
            refreshCoreDependencies()
        }
                       

        var action          = request.control = params.param.control;
        // more can be added ... but it will always start by `on`Something.
        var reservedActions = [
            'onReady',
            'setup'
        ];        
        
        
        if (reservedActions.indexOf(action) > -1) serverInstance.throwError(response, 500, '[ this.'+action+' ] is reserved for the framework');
        
        // Routing object
        var routerObj = {
            response                    : response,
            next                        : next,
            hasViews                    : ( typeof(conf.content.templates) != 'undefined' ) ? true : false,
            isUsingTemplate             : conf.template,
            isProcessingXMLRequest      : params.isXMLRequest,
            isProcessingWithcredentials : params.isWithCredentials
        };

        setContext('router', routerObj);
        
        var middleware      = params.middleware || [];
        var actionFile      = params.param.file; // matches rule name
        var namespace       = params.namespace;
        var routeHasViews   = ( typeof(conf.content.templates) != 'undefined' ) ? true : false;
        var isUsingTemplate = conf.template;
        var hasSetup        = false;        
        
        
        local.isXMLRequest      = params.isXMLRequest;
        local.isWithCredentials = params.isWithCredentials;
        local.routeHasViews     = routeHasViews;
        local.isUsingTemplate   = isUsingTemplate;
        
        

                
        
        //Middleware Filters when declared.
        var resHeaders = conf.server.response.header;
        //TODO - to test
        if ( resHeaders.count() > 0 ) {
            // authority by default if no Access Control Allow Origin set
            var authority = (typeof(request.headers.referer) != 'undefined') ? local.conf.server.scheme +'://'+ request.headers.referer.match(/:\/\/(.[^\/]+)(.*)/)[1] : (request.headers[':authority'] || request.headers.host || null);
            var re = new RegExp(authority);
            var origin = ( typeof(conf.server.response.header['Access-Control-Allow-Origin']) != 'undefined' && conf.server.response.header['Access-Control-Allow-Origin'] != '' ) ? conf.server.response.header['Access-Control-Allow-Origin'] : authority;
            for (var h in resHeaders) {                
                if (!response.headersSent) {
                    // handles multiple origins
                if ( /Access\-Control\-Allow\-Origin/.test(h) ) { // re.test(resHeaders[h]                    
                        if ( /\,/.test(origin) ) {
                            origin = origin.split(/\,/g);
                        }
                        response.setHeader(h, origin)
                    } else {
                        response.setHeader(h, resHeaders[h])
                    }
                }                    
            }
        }

        //Getting superCleasses & extending it with super Models.
        var controllerFile         = {}
            , setupFile            = {}
            , Controller           = {}
        ;

        // TODO -  ?? merge all controllers into a single file while building for other env than `dev`

        setupFile     = conf.bundlesPath +'/'+ bundle + '/controllers/setup.js';
        var filename = '';
        if (namespace) {
            filename = conf.bundlesPath +'/'+ bundle + '/controllers/controller.'+ namespace +'.js';
            if ( !fs.existsSync(filename) ) {                
                console.warn('namespace `'+ namespace +'` found, but no `'+filename+'` to load: just ignore this message if this is ok with you');
                filename = conf.bundlesPath +'/'+ bundle + '/controllers/controller.js';
            }
        } else {
            filename = conf.bundlesPath +'/'+ bundle + '/controllers/controller.js';
        }
        controllerFile = filename;

        
        // default param setting
        var templateName = params.rule.replace('\@'+ bundle, '') || '_common';
        
        // inheriting from _common
        if (conf.content.templates[templateName])
            conf.content.templates[templateName].ginaLoader = conf.content.templates._common.ginaLoader;
        
        var options = {
            // view namespace first
            namespace       : params.param.namespace || namespace,
            control: params.param.control,
            controller: controllerFile,
            //controller: '<span class="gina-bundle-name">' + bundle +'</span>/controllers/controller.js',
            file: actionFile,
            //bundle          : bundle,//module
            bundlePath: conf.bundlesPath + '/' + bundle,
            rootPath: self.executionPath,
            conf: JSON.parse(JSON.stringify(conf)),
            //instance: self.serverInstance,
            template: (routeHasViews) ? conf.content.templates[templateName] : undefined,
            isUsingTemplate: local.isUsingTemplate,
            cacheless: cacheless,
            //rule            : params.rule,
            path: params.param.path || null, // user custom path : namespace should be ignored | left blank
            assets: {}
            //isXMLRequest    : params.isXMLRequest,
            //withCredentials : false
        };

        
        options = merge(options, params);
        options.conf.content.routing[options.rule].param = params.param;
        delete options.middleware;
        delete options.param;
        delete options.requirements;


        try {

            if ( fs.existsSync(_(setupFile, true)) )
                hasSetup = true;

            if (cacheless) {

                delete require.cache[require.resolve(_(controllerFile, true))];

                if ( hasSetup )
                    delete require.cache[require.resolve(_(setupFile, true))];
            }

            Controller = require(_(controllerFile, true));

        } catch (err) {
            // means that you have a syntax errors in you controller file
            // TODO - increase `stack-trace` from 10 (default value) to 500 or more to get the exact error --stack-trace-limit=1000
            // TODO - also check `stack-size` why not set it to at the same time => --stack-size=1024
            serverInstance.throwError(response, 500, new Error('syntax error(s) found in `'+ controllerFile +'` \nTrace: ') + (err.stack || err.message) );
        }
        
        
        // about to contact Controller ...
        try {
            
            Controller      = inherits(Controller, SuperController);
            
            var controller  = new Controller(options);                        
            controller.name = options.control;            
            controller.serverInstance = serverInstance;
            controller.setOptions(request, response, next, options);
            
            // if ( /http\/2/.test(conf.server.protocol) && !local.isXMLRequest) { 
                
            //     serverInstance._referrer        = local.request.url;
            //     serverInstance._options         = options;
            //     serverInstance._isXMLRequest    = local.isXMLRequest;
                                
            //     if ( !serverInstance._http2streamEventInitalized ) {
            //         serverInstance._http2streamEventInitalized = true;
            //         serverInstance.on('stream', function onHttp2Strem(stream, headers) {        
            //             if (!this._isXMLRequest)                
            //                 controller.onHttp2Stream(this._referrer, stream, headers);
            //         });
            //     }               
            // }
            
            

            if (hasSetup && isSetupRequired(params.param.control) ) { // adding setup
                
                // if ( !isSetupRequired(params.param.control) ) {
                //     controller.setup = function() { this._setupDone = true;  return };                                      
                // } else {
                    controller.setup = function(request, response, next) {
                        if (!this._setupDone) {
                            this._setupDone = true;
                            return function (request, response, next) { // getting rid of the controller context
                                var Setup = require(_(setupFile, true));
    
                                // TODO - loop on a defiend SuperController property like SuperController._allowedForExport
                                // inheriting SuperController functions & objects
    
                                // exporting config & common methods
                                Setup.engine                = controller.engine;
                                Setup.getConfig             = controller.getConfig;
                                Setup.getLocales            = controller.getLocales;
                                Setup.getFormsRules         = controller.getFormsRules;
                                Setup.throwError            = serverInstance.throwError;
                                Setup.redirect              = controller.redirect;
                                Setup.render                = controller.render;
                                Setup.renderJSON            = controller.renderJSON;
                                Setup.renderWithoutLayout   = controller.renderWithoutLayout
                                Setup.isXMLRequest          = controller.isXMLRequest;
                                Setup.isWithCredentials     = controller.isWithCredentials,
                                Setup.isCacheless           = controller.isCacheless;
    
                                Setup.apply(Setup, arguments);
    
                                return Setup;
                            }(request, response, next)
                        }
                    }    
                //} 
            } else {
                controller.setup = function() { return };
            }


            /**
             * requireController
             * Allowing another controller (public methods) to be required inside the current controller
             *
             * @param {string} namespace - Controller namespace
             * @param {object} [options] - Controller options
             *
             * @return {object} controllerInstance
             * */

            controller.requireController = function (namespace, options) {

                var cacheless   = (process.env.IS_CACHELESS == 'false') ? false : true;
                var corePath    = getPath('gina').core;
                var config      = getContext('gina').Config.instance;
                var bundle      = config.bundle;
                var env         = config.env;
                var bundleConf  = config.Env.getConf(bundle, env);

                var controllerFile  = ( typeof(namespace) != 'undefined' && namespace != '' && namespace != 'null' && namespace != null ) ? 'controller.'+ namespace : namespace;
                var filename        = _(bundleConf.bundlesPath + '/' + bundle + '/controllers/' + controllerFile + '.js', true);

                if (typeof (options.controlRequired) == 'undefined')
                    options.controlRequired = [];

                var ctrlInfo = {};
                ctrlInfo[controllerFile] = filename;
                options.controlRequired.push(ctrlInfo);

                try {

                    if (cacheless) {
                        // Super controller
                        delete require.cache[require.resolve(_(corePath +'/controller/index.js', true))];
                        require.cache[_(corePath +'/controller/index.js', true)] = require( _(corePath +'/controller/index.js', true) );

                        delete require.cache[require.resolve(filename)];
                    }

                    var SuperController     = require.cache[_(corePath +'/controller/index.js', true)];
                                        
                    
                    var RequiredController  = require(filename);

                    RequiredController      = inherits(RequiredController, SuperController);
                    
                    var controller = null;
                    if ( typeof(options) != 'undefined' ) {

                        controller = new RequiredController( options );
                        controller.name = namespace;
                        
                        controller.setOptions(request, response, next, options);

                    } else {
                        controller = new RequiredController();
                    }
                    
                    controller.serverInstance = serverInstance;                    
                    // if ( /http\/2/.test(conf.server.protocol) ) { 
                
                    //     serverInstance._referrer = local.request.url;
                    //     serverInstance._options = options;
                                        
                    //     if ( !serverInstance._http2streamEventInitalized ) {
                    //         serverInstance._http2streamEventInitalized = true;
                    //         serverInstance.on('stream', function onHttp2Strem(stream, headers) {        
                                                
                    //             controller.onHttp2Stream(this._referrer, stream, headers);
                    //         });
                    //     }               
                    // }
                    
                    return controller

                } catch (err) {
                    serverInstance.throwError(response, 500, err );
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

                        try {
                            controller[action](request, response, next)
                        } catch (err) {
                            var superController = new SuperController(options);
                            superController.setOptions(request, response, next, options);
                            if (typeof (controller) != 'undefined' && typeof (controller[action]) == 'undefined') {
                                serverInstance.throwError(response, 500, (new Error('control not found: `' + action + '`. Please, check your routing.json ('+ options.rule +') or the related control in your `' + controllerFile + '`.')).stack);
                            } else {
                                serverInstance.throwError(response, 500, err.stack);
                            }
                        }

                    })
            } else {
                // handle superController events
                // e.g.: inside your controller, you can defined: `this.onReady = function(){...}` which will always be called before the main action
                for (var e=0; e<reservedActions.length; ++e) {
                    if ( typeof(controller[reservedActions[e]]) == 'function' ) {
                        controller[reservedActions[e]](request, response, next)
                    }
                }
                try {
                    controller[action](request, response, next)
                } catch (err) {
                    if ( typeof(controller) != 'undefined' && typeof (controller[action]) == 'undefined') {
                        serverInstance.throwError(response, 500, (new Error('control not found: `' + action + '`. Please, check your routing.json or the related control in your `' + controllerFile + '`.')).stack);
                    } else {
                        serverInstance.throwError(response, 500, err.stack);
                    }
                }                
            }

        } catch (err) {
            if ( typeof(controller) != 'undefined' && typeof (controller[action]) == 'undefined') {
                serverInstance.throwError(response, 500, (new Error('control not found: `' + action + '`. Please, check your routing.json or the related control in your `' + controllerFile + '`.')).stack);
            } else {
                serverInstance.throwError(response, 500, err.stack);
            }

            // var superController = new SuperController(options);
            // superController.setOptions(request, response, next, options);
            // if ( typeof(controller) != 'undefined' && typeof(controller[action]) == 'undefined') {
            //     serverInstance.throwError(response, 500, (new Error('control not found: `'+ action+'`. Please, check your routing.json or the related control in your `'+controllerFile+'`.')).stack);
            // } else {
            //     serverInstance.throwError(response, 500, err.stack);
            // }
        }

        action = null
    };//EO route()

    var processMiddlewares = function(middlewares, controller, action, req, res, next, cb){

        var filename        = _(local.conf.bundlePath)
            , middleware    = null
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
                if ( /*!/^middlewares\.express\./.test(filename) &&*/ !fs.existsSync( filename ) ) {
                    // no middleware found with this alias
                    serverInstance.throwError(res, 501, new Error('middleware not found '+ middleware).stack);
                }
                
                if (local.cacheless) delete require.cache[require.resolve(_(filename, true))];

                var MiddlewareClass = function(req, res, next) {

                    return function () { // getting rid of the middleware context

                        //var Middleware = ( !/^middlewares\.express\./.test(filename) ) ? require(_(filename, true)) : require(_(expressMiddlewareBootstrap, true));
                        var Middleware = require(_(filename, true));
                        // TODO - loop on a defiend SuperController property like SuperController._allowedForExport


                        // exporting config & common methods
                        //Middleware.engine             = controller.engine;
                        Middleware.prototype.getConfig              = controller.getConfig;
                        Middleware.prototype.getLocales             = controller.getLocales;
                        Middleware.prototype.getFormsRules          = controller.getFormsRules;
                        Middleware.prototype.throwError             = controller.throwError;
                        Middleware.prototype.redirect               = controller.redirect;
                        Middleware.prototype.render                 = controller.render;
                        Middleware.prototype.renderJSON             = controller.renderJSON;
                        Middleware.prototype.renderWithoutLayout    = controller.renderWithoutLayout
                        Middleware.prototype.isXMLRequest           = controller.isXMLRequest;
                        Middleware.prototype.isWithCredentials      = controller.isWithCredentials;
                        Middleware.prototype.isCacheless            = controller.isCacheless;

                        return Middleware;
                    }(req, res, next)
                }(req, res, next);

                middleware = new MiddlewareClass();


                if ( !middleware[constructor] ) {
                    serverInstance.throwError(res, 501, new Error('contructor [ '+constructor+' ] not found @'+ middlewares[m]).stack);
                }

                if ( typeof(middleware[constructor]) != 'undefined') {

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

    // var throwError = function(res, code, msg) {
    //     if (arguments.length < 3) {
    //         var msg     = code || null
    //             , code  = res || 500
    //             , res   = local.res;
    //     }

    //     if (!res.headersSent) {
    //         res.headersSent = true;

    //         if (local.isXMLRequest || !hasViews() || !local.isUsingTemplate) {
    //             // Internet Explorer override
    //             if ( /msie/i.test(local.request.headers['user-agent']) ) {
    //                 res.writeHead(code, "Content-Type", "text/plain")
    //             } else {
    //                 res.writeHead(code, { 'Content-Type': 'application/json'} )
    //             }

                
    //             var err = null;

    //             if ( typeof(msg) == 'object' ) {
    //                 err = {
    //                     status: code,
    //                     message: msg
    //                 }
    //             } else {
    //                 err = {
    //                     status: code,
    //                     message : msg.message,
    //                     stack: msg.stack || msg || null
    //                 }
    //             }


    //             if ( !err.stack ) {
    //                 delete err.stack
    //             }
                
                

    //             res.end(JSON.stringify(err))
    //         } else {
    //             res.writeHead(code, { 'Content-Type': 'text/html'} );
    //             //console.error('[ ROUTER ] '+ res.req.method +' [ '+code+' ] '+ res.req.url);
    //             res.end('<h1>Error '+ code +'.</h1><pre>'+ msg + '</pre>', local.next);
    //         }
            
    //         console.error('[ ROUTER ] ' + local.request.method + ' [ ' + code + ' ] ' + local.request.url + '\n'+ (msg.stack || msg.message || msg) /**routing.getRouteByUrl(res.req.url).toUrl()*/ );
    //     } else {
    //         if (typeof(local.next) != 'undefined')
    //             return local.next();
    //         else
    //             return;
    //     }
    // };

    init()
};

module.exports = Router