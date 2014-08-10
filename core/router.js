/*
 * This file is part of the geena package.
 * Copyright (c) 2014 Rhinostone <geena@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */


//Imports.
var url     = require("url"),
    fs      = require("fs"),
    util    = require('util'),
    utils   = require('./utils'),
    console = utils.logger,
    inherits = utils.inherits;

/**
 * @class Router
 *
 *
 * @package     Geena
 * @namespace
 * @author      Rhinostone <geena@rhinostone.com>
 * @api         Public
 */
function Router(env) {

    this.name = 'Router';
    var self = this;
    var Config  = require('./config');
    var config = new Config();
    var local = {
        conf : config.getInstance()
    };

    /**
     * Router Constructor
     * @constructor
     * */
    var init = function(){
        if ( typeof(Router.initialized) != "undefined" ) {
            console.log("....Router instance already exists...");
            return self.getInstance()
        } else {
            Router.initialized = true;
            console.log("....creating new Router...")
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
        var patt = /:/;
        return ( patt.test(pathname) ) ? true : false
    }
    this.setMiddlewareInstance = function(instance) {
        self.middlewareInstance = instance
    }

    this.getInstance = function() {
        return self
    }

    var parseRouting = function(request, params, route) {
        var uRe = params.url.split(/\//),
            uRo = route.split(/\//),
            score = 0,
            r = {};

        //attaching routing description for this request
        request.routing = params; // can be retried in controller with: req.routing

        if (uRe.length === uRo.length) {
            var maxLen = uRo.length;
            //console.info("-----------------FOUND MATCHING SCORE", uRe.length, uRo.length);
            //console.info(uRe, uRo);
            for (var i=0; i<maxLen; ++i) {
                if (uRe[i] === uRo[i])
                    ++score
                else if (hasParams(uRo[i]) && fitsWithRequirements(request, uRo[i], uRe[i], params))
                    ++score
            }
        }
        r.past = (score === maxLen) ? true : false;
        r.request = request;
        return r
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

        if ( typeof(urlRouting) == 'object' ) {
            var i = 0;
            var res = {
                past : false,
                request : request
            };
            while (i < urlRouting.count() && !res.past) {
                res = parseRouting(request, params, urlRouting[i]);
                ++i
            }
            return res
        } else {
            return parseRouting(request, params, urlRouting)
        }
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

        urlVar = urlVar.replace(/:/,"");
        var v = null;

        //console.info("ROUTE !!! ", urlVar, params.requirements);
        if (
            typeof(params.requirements) != "undefined" &&
            typeof(params.requirements[urlVar]) != "undefined"
            ) {
            v = urlVal.match(params.requirements[urlVar]);
            //console.info('does it match ?', v);
            //works with regex like "([0-9]*)"
            //console.log("PARAMMMMM !!! ", urlVar, params.requireclearments[urlVar], params.requirements);
            if (v != null && v[0] !== "") {
                request.params[urlVar] = v[0]
            }
        }
        return (v != null && v[0] == urlVal && v[0] !="") ? true : false
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
        var bundle          = params.bundle;
        var action          = params.param.action;
        var actionFile          = params.param.file;
        var namespace       = params.param.namespace;
        var SuperController = require('./controller');
        var hasViews        = ( typeof(local.conf[bundle][env].content.views) != 'undefined' ) ? true : false;

        var cacheless = (process.env.IS_CACHELESS == 'false') ? false : true;
        console.debug("routing content : \n", bundle, env,  JSON.stringify( config.Env.getConf( bundle, env ), null, 4) );
        //Middleware Filters when declared.
        var resHeaders = config.Env.getConf( bundle, env ).server.response.header;
        //TODO - to test
        if ( resHeaders.count() > 0 ) {
            for (var h in resHeaders)
                response.header(h, resHeaders[h])
        }

        //logger.debug('geena', 'ROUTER:DEBUG:1', 'ACTION ON  ROUTING IS : ' + action, __stack);
        console.debug('ACTION ON  ROUTING IS : ' + action);

        //Getting superCleasses & extending it with super Models.
        var controllerFile = _(local.conf[bundle][env].bundlesPath +'/'+ bundle + '/controllers/controller.js');

        var options = {
            action          : action,
            file            : actionFile,
            bundle          : bundle,//module
            bundlePath      : local.conf[bundle][env].bundlesPath +'/'+ bundle,
            rootPath        : self.executionPath,
            conf            : local.conf[bundle][env],
            instance        : self.middlewareInstance,
            views           : ( hasViews ) ? local.conf[bundle][env].content.views : undefined,
            cacheless       : cacheless
        };

        try {
            // TODO - namespace handling
            //if ( typeof(namespace) != 'undefined' ) {

            if (cacheless) delete require.cache[_(controllerFile, true)];
            var Controller  = require(controllerFile)
        } catch (err) {
            var superController = new SuperController(request, response, next);
            superController.setOptions(options);
            console.log(err.stack);
            superController.throwError(response, 500, err.stack);
            process.exit(1)
        }


        // about to contact Controller'
        if ( typeof(namespace) != 'undefined' && namespace == 'framework' ) { //framework controller filter
            Controller = SuperController.prototype[namespace];
        }

        Controller = inherits(Controller, SuperController);
        try {
            var controller = new Controller(request, response, next);
            controller.setOptions(options);
            controller[action](request, response, next)
        } catch (err) {
            var superController = new SuperController(request, response, next);
            superController.setOptions(options);
            superController.throwError(response, 500, err.stack);
        }
        eval('');
        action = null
    };//EO route()

    init()
};

module.exports = Router