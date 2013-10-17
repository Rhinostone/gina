/*
 * This file is part of the geena package.
 * Copyright (c) 2013 Rhinostone <geena@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * @class Router
 *
 *
 * @package     Geena
 * @namespace   Geena.Router
 * @author      Rhinostone <geena@rhinostone.com>
 * @api         Public
 */
var Router;

//Imports.
var Url     = require("url"),
    Fs      = require("fs"),
    Util    = require('util'),
    Utils   = require('./utils.js');
    Config  = require('./config');
    //Server  = require('./server');

/**
 * Router Constructor
 * @constructor
 * */
Router = function(env){

    this.name = 'Router';
    var _this = this;
    var Config  = require('./config');
    var _conf = Config.getInstance();

    var _init = function(){
        if ( typeof(Router.initialized) != "undefined" ) {
            console.log("....instance already exists...");
            return _this.getInstance();
        } else {
            Router.initialized = true;
            console.log("....creating new one...");
        }
    };

    /**
     * Check if rule has params
     *
     * @param {string} pathname
     * @return {boolean} found
     *
     * @private
     * */
    var _hasParams = function(pathname){
        var patt = /:/;
        return (patt.test(pathname)) ? true : false;
    };

    this.getInstance = function(){
        return _this;
    };

    /**
     * Compare urls
     *
     * @param {object} request
     * @param {object} params - Route params
     * @param {string} urlRouting
     *
     * @return {object|false} routes
     * */
    this.compareUrls = function(request, params, urlRouting){

        var uRe = params.url.split(/\//),
            uRo = urlRouting.split(/\//),
            score = 0,
            r = {};

        if (uRe.length === uRo.length) {
            var maxLen = uRo.length;
            //console.info("-----------------FOUND MATCHING SCORE", uRe.length, uRo.length);
            //console.info(uRe, uRo);
            for (var i=0; i<maxLen; ++i) {

                if (uRe[i] === uRo[i])
                    ++score;
                else if (_hasParams(uRo[i]) && _fitsWithRequirements(request, uRo[i], uRe[i], params))
                    ++score;
            }
        }
        r.past = (score === maxLen) ? true : false;
        r.request = request;
        return r;
    };

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
    var _fitsWithRequirements = function(request, urlVar, urlVal, params){

        urlVar = urlVar.replace(/:/,"");
        var v = null;

        //console.info("ROUTE !!! ", urlVar, params.requirements);
        if( typeof(params.requirements) != "undefined" && typeof(params.requirements[urlVar] != "undefined")){
            v = urlVal.match(params.requirements[urlVar]);
            //console.info('does it match ?', v);
            //works with regex like "([0-9]*)"
            //console.log("PARAMMMMM !!! ", urlVar, params.requireclearments[urlVar], params.requirements);
            if(v != null && v[0] !== ""){
                request.params[urlVar] = v[0];
            }

        }
        return (v != null && v[0] == urlVal && v[0] !="") ? true : false;
    };

    /**
     * Load handlers
     * TODO - Load all application handler from server at once
     * TODO - Means that if we have 2 bundles for the same app, we should load handlers for both of them
     *
     * @param {string} path
     * @param {string} action - Controller action
     *
     * @return {object|undefined} handlerObject
     *
     * @private
     * */
    _loadHandler = function(path, action){
        var handler = path +'/'+ action + '.js',//CONFIGURATION : settings.script_ext
            cacheless = Config.isCacheless();

        //console.info('!!about to add handler ', handler);
        try {
            if (cacheless) delete require.cache[handler];

            return {obj : Fs.readFileSync(handler), file : action + '.js', name : action + 'Handler'};
        } catch (err) {
            return null;
        }

    };

    /**
     * Route on the fly
     *
     * @param {object} request
     * @param {object} response
     * @param {object} params - Route params
     *
     * @callback next
     * */
    this.route = function(request, response, next, params){

        //Routing.
        var pathname        = Url.parse(request.url).pathname,
            AppController   = {},
            app             = {},
            bundle          = params.param.app,
            action          = params.param.action,
            Controller      = require("./controller");


        console.log("routing..");
        //Middleware Filters when declared.
        var resHeders = Config.Env.getConf( bundle, env ).server.response.header;
        //TODO - to test
        if ( resHeders.count() > 0 ) {
            for (var h in resHeders)
                response.header(h, resHeders[h]);
        }

        Log.debug('geena', 'ROUTER:DEBUG:1', 'ACTION ON  ROUTING IS : ' + action, __stack);
        //console.log("ACTION ON  ROUTING IS : " + action);

        //Getting Models & extending it with super Models.
        var controllerFile  = _conf[bundle][env].bundlesPath +'/'+ bundle + '/controllers/controllers.js',
            handlersPath    = _conf[bundle][env].bundlesPath  +'/'+ bundle + '/handlers';

        //console.log("FILE ", controllerFile);

        try {
            var controllerRequest  = require(controllerFile)
             _this.actionRequest = new controllerRequest();

        } catch (err) {
            Log.error('geena', 'ROUTER:ERR:1', 'Could not trigger actionRequest', __stack);
        }

        Log.debug('geena', 'ROUTER:DEBUG:1', 'About to contact Controller', __stack);
        //Getting Controller & extending it with super Controller.
        try {
            console.log("Action is ", action);
            _this.actionHandler = _loadHandler(handlersPath, action);
            //Two places in this file to change these kind of values.
            var options = {
                action          : action,
                bundle          : bundle,//module
                bundlePath  : _conf[bundle][env].bundlesPath +'/'+ bundle,
                rootPath    : _this.executionPath,
                conf            : _conf[bundle][env],
                ext             : (_conf[bundle][env].template) ? _conf[bundle][env].template.ext : Config.Env.getDefault().ext,
                handler         : _this.actionHandler,
                instance        : _this.instance,
                //to remove later
                templateEngine  : (typeof(_conf.templateEngine) != "undefined") ? _conf.templateEngine : null,
                view            : (typeof(_conf[bundle][env].view) != "undefined") ? _conf[bundle][env].view : null,
                webPath         : _this.executionPath
            };
            //console.log("found conf \n", options.conf);
            //AppController = Utils.extend(false, _this.actionRequest, new Controller(options));
            //var controller = new Controller(request, response, next, options);
            //Should be a get instance..
            Utils.extend( true, _this.actionRequest, new Controller(request, response, next, options) );
            //console.log("--->> 1 ", action, _this.actionRequest);

            //TypeError: Property 'xxxxxx' of object #<Object> is not a function
            //Either the controllers.js is empty, either you haven't created the method xxxxxx
            //console.log("handling response 0 ", action, AppController[action]);
            try {
                _this.actionRequest[action](request, response, next);
            } catch (err) {
                Log.error('geena', 'ROUTER:ERR:3', 'failed to execute function: '+ action +'(request, response, next)\n'+ err, __stack);
            }

            _this.actionRequest.handleResponse();
            action = null;

        } catch (err) {

            Log.error(
                'geena',
                'ROUTER:ERR:2',
                'Action '+ action +' failled to execute \n'+err,
                __stack
            );

            Utils.extend( true, _this.actionRequest, new Controller(request, response, next) );
            //_this.actionResponse = AppController[action](request, response, next);
            _this.actionRequest[action](request, response, next);

            _this.actionHandler = _loadHandler(handlersPath, action);
            var routeObj = _this.routing;
            app = {
                instance    : _this.instance,
                bundle      : bundle,//module
                bundlePath  : _conf[bundle][env].bundlesPath +'/'+ bundle,
                rootPath    : _this.executionPath,
                action      : action,
                handler     : _this.actionHandler,
                view        : (typeof(_conf[bundle][env].view) != "undefined") ? _conf[bundle][env].view : null,
                route       : routeObj,
                ext         : (_conf[bundle][env].template) ? '.' +_conf[bundle][env].template.ext : Config.Env.getDefault().ext
            };
            Controller.app = app;

            //handle response.
            _this.actionRequest.handleResponse();
            action = null;
            app = null;
        }

    };//EO route()

    _init();

};

module.exports = Router;