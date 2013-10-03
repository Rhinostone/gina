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
var url             = require("url"),
    fs              = require("fs"),
    Utils           = require('./utils.js'),
    Util            = require('util'),
    Router          = {
    request : {},
    init : function(){},
    hasParams : function(pathname){
        var patt = /:/;
        return (patt.test(pathname)) ? true : false;
    },
    /**
     * Compare urls
     *
     * @param {object} request
     * @param {object} params - Route params
     * @param {string} urlRouting
     *
     * */
    compareUrls : function(request, params, urlRouting){

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
                else if (this.hasParams(uRo[i]) && this.fitsWithRequirements(request, uRo[i], uRe[i], params))
                    ++score;
            }
        }
        r.past = (score === maxLen) ? true : false;
        r.request = request;
        return r;
    },
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
     * */
    fitsWithRequirements : function(request, urlVar, urlVal, params){

        urlVar = urlVar.replace(/:/,"");
        var matched = false,
            v = null;
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
    },

    /**
     * Load handlers
     *
     * @param {string} path
     * @param {string} action - Controller action
     *
     * @return {object|undefined} handlerObject
     *
     * @private
     * */
    loadHandler : function(path, action){
        var handler = path +'/'+ action + '.js',//CONFIGURATION : settings.script_ext
            cacheless = (this.parent.conf[this.parent.appName].env == "dev") ? true : false;

        //console.info('!!about to add handler ', handler);
        try {
            if (cacheless) delete require.cache[handler];

            return {obj : fs.readFileSync(handler), file : action + '.js', name : action + 'Handler'};
        } catch (err) {
            return null;
        }

    },

    /**
     * Route on the fly
     *
     * @param {object} request
     * @param {object} response
     * @param {object} params - Route params
     *
     * @callback next
     * */
    route : function(request, response, params, next){
        //console.log("Request for " + pathname + " received : ", request.url, params);

        //Routing.
        var pathname        = url.parse(request.url).pathname,
            AppController   = {},
            app             = {},
            appName         = params.param.app,
            action          = params.param.action,
            Config          = require("./config"),
            Controller      = require("./controller"),
            Server          = this.parent,
            _this           = this;



        //Middleware Filters when declared.
        var resHeders = Config.Env.getConf(appName, Config.Env.get()).server.response.header;
        /** to be tested */
        if (resHeders.count() > 0) {
            for (h in resHeders)
                response.header(h, resHeders[h]);
        }

        //Getting Models & extending it with super Models.


        //console.log("ACTION ON  ROUTING IS : " + action);
        var controllerFile  = Server.conf[appName].bundlesPath +'/'+ appName + '/controllers/controllers.js',
            handlersPath    = Server.conf[appName].bundlesPath  +'/'+ appName + '/handlers';

        console.log("About to route a request for " + pathname,'\n', '....with execution path : ', Server.executionPath );
        console.info('routing ==> ', pathname, appName);

        Server.actionRequest = require(controllerFile);

        //TODO -  delete.
        //Controller.request = request;
        //Controller.response = response;

        //console.log("get conf env ", Config.Env.get() );
        console.log("ATTENTION !! trying to get controller ");
        //Getting Controller & extending it with super Controller.
        try {
            //console.info('hum 3');
            Server.actionHandler = _this.loadHandler(handlersPath, action);
            //console.info('hum 4');

            //Two places in this file to change these kind of values.
            Controller.app = {
                action          : action,
                appName         : appName,//module
                appPath         : Server.conf[appName].bundlesPath +'/'+ appName,
                conf            : Server.conf[appName],
                ext             : (Server.conf[appName].template) ? Server.conf[appName].template.ext : Config.Env.getDefault().ext,
                handler         : Server.actionHandler,
                instance        : Server.instance,
                //to remove later
                templateEngine  : (typeof(Server.conf.templateEngine) != "undefined") ? Server.conf.templateEngine : null,
                view            : (typeof(Server.conf[appName].view) != "undefined") ? Server.conf[appName].view : null,
                webPath         : Server.executionPath
            };

            //console.log('ok ..... ', Controller.app.action);

            AppController = Utils.extend(false, Server.actionRequest, Controller);


            /**
             * TypeError: Property 'xxxxxx' of object #<Object> is not a function
             * Either the controllers.js is empty, either you haven't created the method xxxxxx
             * */
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

            Server.actionHandler = _this.loadHandler(handlersPath, action);
            var routeObj = Server.routing;
            app = {
                instance    : Server.instance,
                appName     : appName,//module
                appPath     : Server.conf[appName].bundlesPath +'/'+ appName,
                webPath     : Server.executionPath,
                action      : action,
                handler     : Server.actionHandler,
                view        : (typeof(Server.conf[appName].view) != "undefined") ? Server.conf[appName].view : null,
                route       : routeObj,
                ext         : (Server.conf[appName].template) ? '.' +Server.conf[appName].template.ext : Config.Env.getDefault().ext
            };
            Controller.app = app;

            //handle response.
            AppController.handleResponse(request, response, next);

            Server.actionResponse = null;
            action = null;
            app = null;
        }


    }

};

module.exports = Router;