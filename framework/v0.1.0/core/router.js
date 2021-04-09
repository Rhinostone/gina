//"use strict";
/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2021 Rhinostone <gina@rhinostone.com>
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
            self.initialized = true;
            self.hasCompletedControlllerSetup = false; 
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
        
        /**
        * BO Passport JS HTTP2 fix : taken from passport/request.js
        */
       if ( typeof(request._passport) != 'undefined' && typeof(request.isAuthenticated) == 'undefined' ) {
            request.isAuthenticated = function() {
                var property = 'user';
                if (this._passport && this._passport.instance) {
                    property = this._passport.instance._userProperty || 'user';
                }
                var isAuthenticated = (this[property]) ? true : false;
                if (isAuthenticated) {
                    request.session.user = this[property]
                }
                return isAuthenticated;
            };
        }
        
        if ( typeof(request._passport) != 'undefined' && (typeof(request.logIn) == 'undefined' || typeof(request.login) == 'undefined') ) {
            request.login =
            request.logIn = function(user, options, done) {
                if (typeof options == 'function') {
                    done = options;
                    options = {};
                }
                options = options || {};
                
                var property = 'user';
                if (this._passport && this._passport.instance) {
                    property = this._passport.instance._userProperty || 'user';
                }
                var session = (options.session === undefined) ? true : options.session;
                
                this[property] = user;
                if (session) {
                    if (!this._passport) { throw new Error('passport.initialize() middleware not in use'); }
                    if (typeof done != 'function') { throw new Error('req#login requires a callback function'); }
                    
                    var self = this;
                    this._passport.instance._sm.logIn(this, user, function(err) {
                    if (err) { 
                        self[property] = null;
                        return done(err); 
                    }
                    done();
                    });
                } else {
                    done && done();
                }
            };
        }
        
        if ( typeof(request._passport) != 'undefined' && (typeof(request.logOut) == 'undefined' ||  typeof(request.logout) == 'undefined') ) {
            request.logout =
            request.logOut = function() {
                var property = 'user';
                if (this._passport && this._passport.instance) {
                    property = this._passport.instance._userProperty || 'user';
                }
                
                this[property] = null;
                if (this._passport) {
                    this._passport.instance._sm.logOut(this);
                }
            };
        }
        
        // for redirect with `hidden inheritedData`
        if ( /get/i.test(request.method) && typeof(request.session) != 'undefined' ) {
            var userSession = request.session.user || request.session;
            if ( typeof(userSession.inheritedData) != 'undefined' ) {
                if (!request.get) {
                    request.get = {};
                }
                request.get = merge(request.get, userSession.inheritedData);
                
                // if not persisted ... means that if you refresh the current page, `inheritedData` will be lost
                delete userSession.inheritedData;
            }
        }
        
        /**
        * EO Passport JS HTTP2 fix
        */
       
       var serverInstance   = self.getServerInstance();
       var config               = null
            , conf              = null
            , bundle            = null
            , env               = null
            , cacheless         = (process.env.IS_CACHELESS == 'false') ? false : true
       ;
        try {
            config      = new Config().getInstance();
            bundle      = local.bundle = params.bundle;
            env         = config.env;
            conf        = config[bundle][env];            
        } catch (configErr) {            
            serverInstance.throwError(response, 500, new Error('syntax error(s) found in `'+ controllerFile +'` \nTrace: ') + (configErr.stack || configErr.message) );
        }  
        
        local.cacheless     = cacheless;
        local.request       = request;
        local.next          = next;
        local.conf          = conf;
        local.isStandalone  = conf.isStandalone;     
        
        if (cacheless) {
            refreshCoreDependencies();
        }
                       

        var action          = request.control = params.param.control;
        // more can be added ... but it will always start by `on`Something.
        var reservedActions = [
            'onReady',
            'setup'
        ];        
        
        
        if (reservedActions.indexOf(action) > -1)
            serverInstance.throwError(response, 500, '[ this.'+action+' ] is reserved for the framework');
        
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
        
            
        //Getting superCleasses & extending it with super Models.
        var mainControllerFile          = conf.bundlesPath +'/'+ bundle + '/controllers/controller.js'
            , controllerFile            = null
            , setupFile                 = null
            , MainController            = {} // controller.js
            , Controller                = {} // controller.namespace.js
            , hasControllerNamespace    = (namespace) ? true : false
        ;

        // TODO -  ?? merge all controllers into a single file while building for other env than `dev`

        setupFile = conf.bundlesPath +'/'+ bundle + '/controllers/setup.js';
        var filename = '';
        if (hasControllerNamespace) {
            filename = conf.bundlesPath +'/'+ bundle + '/controllers/controller.'+ namespace +'.js';
            if ( !fs.existsSync(filename) ) {                
                hasControllerNamespace = false;
                console.warn('Namespace `'+ namespace +'` found, but no `'+filename+'` to load: just ignore this message if this is ok with you');                
                filename = conf.bundlesPath +'/'+ bundle + '/controllers/controller.js';
                console.info('Switching to default controller: '+ mainControllerFile);
            }
        } else {
            filename = mainControllerFile;
        }
        controllerFile = filename;

        
        // default param setting
        if ( !params.rule ) {
            params.rule = params.name;
        }
        var templateName = params.rule.replace('\@'+ bundle, '') || '_common';
        
        // inheriting from _common
        if (conf.content.templates[templateName])
            conf.content.templates[templateName].ginaLoader = conf.content.templates._common.ginaLoader;
        
        var options = {
            // view namespace first
            namespace       : params.param.namespace || namespace,
            control         : params.param.control,
            controller      : controllerFile,
            //controller: '<span class="gina-bundle-name">' + bundle +'</span>/controllers/controller.js',
            file: actionFile,
            //bundle          : bundle,//module
            bundlePath      : conf.bundlesPath + '/' + bundle,
            rootPath        : self.executionPath,
            // We don't want to keep original conf untouched
            conf            : JSON.clone(conf),
            //instance: self.serverInstance,
            template: (routeHasViews) ? conf.content.templates[templateName] : undefined,
            isUsingTemplate: local.isUsingTemplate,
            cacheless: cacheless,
            path: params.param.path || null, // user custom path : namespace should be ignored | left blank
            assets: {}
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
                if (hasControllerNamespace) {
                    delete require.cache[require.resolve(_(mainControllerFile, true))];
                }
                delete require.cache[require.resolve(_(controllerFile, true))];

                if ( hasSetup )
                    delete require.cache[require.resolve(_(setupFile, true))];
            }
            if (hasControllerNamespace) {
                MainController = require(_(mainControllerFile, true));
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
            if (hasControllerNamespace) {
                MainController = inherits(MainController, SuperController);
                Controller      = inherits(Controller, MainController, SuperController);
            } else {
                Controller      = inherits(Controller, SuperController);
            }
            
            
            var controller  = new Controller(options);                        
            controller.name = options.control;            
            controller.serverInstance = serverInstance;
            controller.setOptions(request, response, next, options);
            
            /**
             * requireController
             * Allowing another controller (public methods) to be required inside the current controller
             *
             * @param {string} namespace - Controller namespace
             * @param {object} [options] - Controller options
             *
             * @return {object} controllerInstance
             * */
            
            var requireController = function (namespace, options) {

                var cacheless   = (process.env.IS_CACHELESS == 'false') ? false : true;
                var corePath    = getPath('gina').core;
                var config      = getContext('gina').Config.instance;
                var bundle      = config.bundle;
                var env         = config.env;
                var bundleConf  = config.Env.getConf(bundle, env);

                var controllerFile  = ( typeof(namespace) != 'undefined' && namespace != '' && namespace != 'null' && namespace != null ) ? 'controller.'+ namespace : 'controller';
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
                    
                    controller.requireController = requireController;
                                        
                    return controller;
                } catch (err) {
                    serverInstance.throwError(response, 500, err );
                }
            };
            
            controller.requireController = requireController;

            if (hasSetup && isSetupRequired(params.param.control) || hasSetup && !self.hasCompletedControlllerSetup ) { // adding setup
                
                controller.setup = function(request, response, next) {
                    if (!this._setupDone) {
                        this._setupDone = true;
                        return function (request, response, next) { // getting rid of the controller context
                            var Setup = require(_(setupFile, true));

                            
                            // Inheriting SuperController functions & objects                            
                            // Exporting config & common methods
                            Setup.engine                = controller.engine;
                            // This is working, but too heavy
                            // TODO- Allow user to target selected methods to be exported
                            // TODO - loop on a defiend SuperController property like SuperController._allowedForExport
                            // for ( let f in controller) {
                            //     if ( typeof(controller[f]) != 'function' ) {
                            //         continue;
                            //     }
                            //     Setup[f] = controller[f];
                            // }
                            Setup.getConfig             = controller.getConfig;
                            Setup.checkBundleStatus     = controller.checkBundleStatus;
                            Setup.getLocales            = controller.getLocales;
                            Setup.getFormsRules         = controller.getFormsRules;
                            Setup.throwError            = serverInstance.throwError;
                            Setup.redirect              = controller.redirect;
                            Setup.render                = controller.render;
                            Setup.renderJSON            = controller.renderJSON;
                            Setup.renderWithoutLayout   = controller.renderWithoutLayout;
                            Setup.isXMLRequest          = controller.isXMLRequest;
                            Setup.isWithCredentials     = controller.isWithCredentials,
                            Setup.isCacheless           = controller.isCacheless;
                            Setup.requireController     = controller.requireController;
                            

                            Setup.apply(Setup, arguments);

                            return Setup;
                        }(request, response, next)
                    }
                }    
                
                if ( !self.hasCompletedControlllerSetup )
                    self.hasCompletedControlllerSetup = true;
            } else {
                controller.setup = function() { return };
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
                if ( !fs.existsSync( filename ) ) {
                    // no middleware found with this alias
                    serverInstance.throwError(res, 501, new Error('middleware not found '+ middleware).stack);
                }
                
                if (local.cacheless) delete require.cache[require.resolve(_(filename, true))];

                var MiddlewareClass = function(req, res, next) {

                    return function () { // getting rid of the middleware context

                        //var Middleware = ( !/^middlewares\.express\./.test(filename) ) ? require(_(filename, true)) : require(_(expressMiddlewareBootstrap, true));
                        var Middleware = require(_(filename, true));
                        // TODO - loop on a defiend SuperController property like SuperController._allowedForExport


                        // Exporting config & common methods
                        // This is working, but too heavy
                        // TODO- Allow user to target selected methods to be exported
                        // TODO - loop on a defiend SuperController property like SuperController._allowedForExport
                        // for ( let f in controller) {
                        //     if ( typeof(controller[f]) != 'function' ) {
                        //         continue;
                        //     }
                        //     Middleware.prototype[f] = controller[f];
                        // }
                        Middleware.prototype.getConfig              = controller.getConfig;
                        Middleware.prototype.checkBundleStatus      = controller.checkBundleStatus;
                        Middleware.prototype.getLocales             = controller.getLocales;
                        Middleware.prototype.getFormsRules          = controller.getFormsRules;
                        Middleware.prototype.throwError             = controller.throwError;
                        Middleware.prototype.redirect               = controller.redirect;
                        Middleware.prototype.render                 = controller.render;
                        Middleware.prototype.renderJSON             = controller.renderJSON;
                        Middleware.prototype.renderWithoutLayout    = controller.renderWithoutLayout;
                        Middleware.prototype.isXMLRequest           = controller.isXMLRequest;
                        Middleware.prototype.isWithCredentials      = controller.isWithCredentials;
                        Middleware.prototype.isCacheless            = controller.isCacheless;
                        Middleware.prototype.requireController      = controller.requireController;

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

    init()
};

module.exports = Router