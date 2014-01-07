/*
 * This file is part of the geena package.
 * Copyright (c) 2014 Rhinostone <geena@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * @class Router
 *
 *
 * @package     Geena
 * @namespace
 * @author      Rhinostone <geena@rhinostone.com>
 * @api         Public
 */
var Router;

//Imports.
var url     = require("url"),
    fs      = require("fs"),
    util    = require('util'),
    utils   = require('./utils');

Router = function(env){

    this.name = 'Router';
    var _this = this;
    var Config  = require('./config')();
    var _conf = Config.getInstance();

    /**
     * Router Constructor
     * @constructor
     * */
    var init = function(){
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
    var hasParams = function(pathname){
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
                else if (hasParams(uRo[i]) && fitsWithRequirements(request, uRo[i], uRe[i], params))
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
    var fitsWithRequirements = function(request, urlVar, urlVal, params){

        urlVar = urlVar.replace(/:/,"");
        var v = null;

        //console.info("ROUTE !!! ", urlVar, params.requirements);
        if( typeof(params.requirements) != "undefined" && typeof(params.requirements[urlVar]) != "undefined" ){
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
    var loadHandler = function(path, action){
        var handler = path +'/'+ action + '.js',//CONFIGURATION : settings.script_ext
            cacheless = Config.isCacheless();

        //console.info('!!about to add handler ', handler);
        try {
            if (cacheless) delete require.cache[handler];

            return {obj : fs.readFileSync(handler), file : action + '.js', name : action + 'Handler'};
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
        var pathname        = url.parse(request.url).pathname,
            AppController   = {},
            app             = {},
            bundle          = params.param.app,
            action          = params.param.action,
            Controller      = require("./controller");


        console.log("routing..", bundle, env,  Config.Env.getConf( bundle, env ));
        //Middleware Filters when declared.
        var resHeaders = Config.Env.getConf( bundle, env ).server.response.header;
        //TODO - to test
        if ( resHeaders.count() > 0 ) {
            for (var h in resHeaders)
                response.header(h, resHeaders[h]);
        }

        logger.debug('geena', 'ROUTER:DEBUG:1', 'ACTION ON  ROUTING IS : ' + action, __stack);
        //console.log("ACTION ON  ROUTING IS : " + action);

        //Getting Models & extending it with super Models.
        var controllerFile  = _conf[bundle][env].bundlesPath +'/'+ bundle + '/controllers/controllers.js',
            handlersPath    = _conf[bundle][env].bundlesPath  +'/'+ bundle + '/handlers';
        var controller;


        try {
            console.log("controller file is ", controllerFile);
            var controllerRequest  = require(controllerFile);
        } catch (err) {
            logger.error('geena', 'ROUTER:ERR:1', 'Could not complete ['+ action +' : function(req, res)...] : ' + err , __stack);
        }

        var options = {
            action          : action,
            bundle          : bundle,//module
            bundlePath      : _conf[bundle][env].bundlesPath +'/'+ bundle,
            rootPath        : _this.executionPath,
            conf            : _conf[bundle][env],
            ext             : (_conf[bundle][env].template) ? _conf[bundle][env].template.ext : Config.Env.getDefault().ext,
            handler         : loadHandler(handlersPath, action),
            instance        : _this.instance,
            //to remove later
            templateEngine  : (typeof(_conf.templateEngine) != "undefined") ? _conf.templateEngine : null,
            view            : (typeof(_conf[bundle][env].view) != "undefined") ? _conf[bundle][env].view : null,
            webPath         : _this.executionPath
        };

        var actionController = controllerRequest, parentController = new Controller(request, response, next, options);
        utils.extend( true, actionController, parentController);
        logger.debug('geena', 'ROUTER:DEBUG:1', 'About to contact Controller', __stack);
//        var a = actionController[action];
//        a(request, response, next);
//        //actionController.handleResponse(response);
//        //console.log("a ", a);
//          if (/.render/.test( a.toString() ))
//        if (a.toString().match(/.render/) ) {
//            actionController.handleResponse(response, false);
//        } else {
//            actionController.handleResponse(response, true);
//        }

        actionController.handleResponse(response);//inverted.
        actionController[action](request, response, next);

        action = null;


    };//EO route()

    init();

};

module.exports = Router;