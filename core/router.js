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
    Utils   = require('./utils.js'),
    Server  = require('./server');

/**
 * Router Constructor
 * @constructor
 * */
Router = function(){
    this.name = 'Router';


    var _consctruct = function(){

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

        var uRe = params.Url.split(/\//),
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
            cacheless = (this.parent.conf[this.parent.bundle].env == "dev") ? true : false;

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
            Config          = require("./config"),
            Controller      = new require("./controller")(),
            Server          = Server,
            _this           = this;



        //Middleware Filters when declared.
        var resHeders = Config.Env.getConf( bundle, Config.Env.get() ).server.response.header;
        //TODO - to test
        if ( resHeders.count() > 0 ) {
            for (var h in resHeders)
                response.header(h, resHeders[h]);
        }

        Log.debug('geena', 'ROUTER:DEBUG:1', 'ACTION ON  ROUTING IS : ' + action, __stack);
        //console.log("ACTION ON  ROUTING IS : " + action);

        //Getting Models & extending it with super Models.
        var controllerFile  = Server.conf[bundle].bundlesPath +'/'+ bundle + '/controllers/controllers.js',
            handlersPath    = Server.conf[bundle].bundlesPath  +'/'+ bundle + '/handlers';

        try {
            Server.actionRequest = require(controllerFile);
        } catch (err) {
            Log.error('geena', 'ROUTER:ERR:1', 'Could not trigger actionRequest', __stack);
        }

        Log.debug('geena', 'ROUTER:DEBUG:1', 'About to contact Controller', __stack);
        //Getting Controller & extending it with super Controller.
        try {
            //console.info('hum 3');
            Server.actionHandler = _loadHandler(handlersPath, action);
            //console.info('hum 4');

            //Two places in this file to change these kind of values.
            Controller.app = {
                action          : action,
                bundle          : bundle,//module
                appPath         : Server.conf[bundle].bundlesPath +'/'+ bundle,
                conf            : Server.conf[bundle],
                ext             : (Server.conf[bundle].template) ? Server.conf[bundle].template.ext : Config.Env.getDefault().ext,
                handler         : Server.actionHandler,
                instance        : Server.instance,
                //to remove later
                templateEngine  : (typeof(Server.conf.templateEngine) != "undefined") ? Server.conf.templateEngine : null,
                view            : (typeof(Server.conf[bundle].view) != "undefined") ? Server.conf[bundle].view : null,
                webPath         : Server.executionPath
            };

            AppController = Utils.extend(false, Server.actionRequest, Controller);



            //TypeError: Property 'xxxxxx' of object #<Object> is not a function
            //Either the controllers.js is empty, either you haven't created the method xxxxxx
            Server.actionResponse = AppController[action](request, response, next);
            AppController.handleResponse(request, response, next);
            Server.actionResponse = null;
            action = null;

        } catch (err) {

            Log.error(
                'geena',
                'ROUTER:ERR:1',
                err,
                __stack
            );
            AppController = Utils.extend(false, Server.actionRequest, Controller);
            Server.actionResponse = AppController[action](request, response, next);

            Server.actionHandler = _loadHandler(handlersPath, action);
            var routeObj = Server.routing;
            app = {
                instance    : Server.instance,
                bundle      : bundle,//module
                appPath     : Server.conf[bundle].bundlesPath +'/'+ bundle,
                webPath     : Server.executionPath,
                action      : action,
                handler     : Server.actionHandler,
                view        : (typeof(Server.conf[bundle].view) != "undefined") ? Server.conf[bundle].view : null,
                route       : routeObj,
                ext         : (Server.conf[bundle].template) ? '.' +Server.conf[bundle].template.ext : Config.Env.getDefault().ext
            };
            Controller.app = app;

            //handle response.
            AppController.handleResponse(request, response, next);

            Server.actionResponse = null;
            action = null;
            app = null;
        }

    }//EO route()

    _init();
};

module.exports = Router;