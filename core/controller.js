/*
 * This file is part of the geena package.
 * Copyright (c) 2014 Rhinostone <geena@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * @class Controller
 *
 *
 * @package     Geena
 * @namespace
 * @author      Rhinostone <geena@rhinostone.com>
 *
 * @api         Public
 */
var Controller;

//Imports.
var fs      = require("fs"),
    //Node
    util    = require('util'),
    //Geena
    utils   = require("./utils"),
    extend  = utils.extend;

Controller = function(request, response, next) {

    //public
    this.name       = "Controller";
    this.data       = {};

    //private
    var _this = this;
    var _options;
    var _request, _response, _next;

    /**
     * Controller Constructor
     * @constructor
     * */
    var init = function(request, response, next) {
        _request = request, _response = response, _next = next;
        getParams(request);
        if ( typeof(Controller.initialized) != 'undefined' ) {
            return getInstance()
        } else {
            Controller.initialized = true;
            Controller.instance = _this
        }
    }

    var getInstance = function() {
        _options = Controller.instance._options;
        if ( typeof(_this.protected['setOptions']) != 'undefined' ) {
            delete _this.protected['setOptions'] // used once on init
        }
        return Controller.instance
    }

    this.setOptions = function(options) {
        _options = Controller.instance._options = options;

        if ( typeof(_options.views) != 'undefined' && typeof(_options.action) != 'undefined' ) {
            var action = _options.action;
            var ext = 'html';
            if ( typeof(_options.views.default) != 'undefined' ) {
                ext = _options.views.default.ext || ext;
            }
            if( !/\./.test(ext) ) {
                ext = '.' + ext
            }
            var content = action + ext;
            _this.set('page.ext', ext);
            _this.set('page.content', content);
        }
    }

    this.hasOptions = function() {
        return ( typeof(_options) != 'undefined') ? true : false
    }

    /**
     * TODO - remove this
    * Handle Responses
    *
    * @param {object} response
    *
    * @return {void}
    **/
    this.handleResponse = function(response) {
        var options = getOptions()
        _response = response;
        logger.info(
            'geena',
            'CONTROLLER:FACTORY:INFO:1',
            'bundle Path  is: '+ _this.app.bundlePath,
            __stack
        );

        logger.info(
            'geena',
            'CONTROLLER:FACTORY:INFO:2',
            'Action  is: '+ _this.app.action,
            __stack
        );

        _this.rendered      = false;
        var action          = _this.app.action,
            appName         = _this.app.appName,
            content         = '',
            data            = {},
            instance        = _this.app.instance,
            templateEngine  = _this.app.views.default.engine || 'swig',
            ext             = _this.app.views.default.ext || 'html',
            templateDir     = _this.app.views.default.dir || _this.app.bundlePath + '/views',
            viewConf        = _this.app.views;


        //Only if templates are handled. Will handle swigg by default.
        if (templateEngine != null && viewConf != "undefined" && viewConf != null) {

            //Usefull or Useless not ?.
            instance.set('views', templateDir);
            if (viewConf)
                setRessources(viewConf, action);//css & js.

            if( !/\./.test(ext) ) {
                ext = '.' + ext
            }
            content = action + ext;
            //console.info('ACTION IS ', content);
            _this.set('page.content', content);
            _this.set('page.ext', ext);



            if (_this.rendered != true && _this.autoRender ) {
                data = _this.getData();
                _this.render(data, request, response, next);
                data = null
            }
        } else {

            //console.log("get header ", _this.rendered, autoRendered);
            if (_this.rendered != true) {
                //Webservices handling.
                data = _this.getData();
                _this.renderJSON(data);
                data = null
            }
        }
    };

    /**
     * Render HTML templates Swigg by default
     *
     * @param {object} data
     * @return {void}
     * */

    this.render = function(data, request, response, next) {

    }
//    this.render = function(data, request, response, next) {
//
//        _this.app.isXmlHttpRequest = ( typeof(request) != "undefined" && request.xhr && _this.app.isXmlHttpRequest || _this.app.isXmlHttpRequest ) ? true : false;
//
//        if( typeof(_this.app.isXmlHttpRequest) == "undefined" || !_this.app.isXmlHttpRequest ) {
//            data.page.handler = (_this.app.handler != null) ? '<script type="text/javascript" src="/'+ _this.app.appName + '/handlers/' + _this.app.handler.file +'"></script>' : '';
//            //console.log('HANDLER SRC _____',data.page.handler);
//
//            if (data.page.content) {
//                _response.render('layout' + data.page.ext, data)
//            }
//        } else {
//            if ( !response.get('Content-Type') ) {
//                response.setHeader("Content-Type", "application/json")
//            }
//        }
//        _this.rendered = true;
//        response.end()
//    }

    /**
     * Render JSON
     *
     * @param {object|string} jsonObj
     * @return {void}
     * */
    this.renderJSON = function(jsonObj) {

        try {

            if(typeof(options) != "undefined" && typeof(options.charset) != "undefined"){
                _response.setHeader("charset", options.charset);
            }
            if ( !_response.get('Content-Type') ) {
                _response.setHeader("Content-Type", "application/json");
            }
            _this.rendered = true;
            _response.end(JSON.stringify(jsonObj))
        } catch (err) {
            console.log(err.stack)
        }

    }

    this.renderTEXT = function(content) {
        if ( typeof(content) != "string" ) {
            var content = content.toString();
        }

        if(typeof(options) != "undefined" && typeof(options.charset) !="undefined") {
            _response.setHeader("charset", options.charset);
        }
        if ( !_response.get('Content-Type') ) {
            _response.setHeader("Content-Type", "text/plain");
        }
        _this.rendered = true;
        _response.end(content);
    }

    /**
     * Set data
     *
     * @param {string} variable Data name to set
     * @param {string} value Data value to set
     * @return {void}
     * */
    this.set = function(variable, value) {
        _this.data[variable] = value
    }

    /**
     * Get data
     *
     * @param {String} variable Data name to set
     * @return {Object | String} data Data object or String
     * */
    this.get = function(variable) {
        return _this.data[variable]
    }

    var setRessources = function(viewConf, localRessources) {
        var res = '',
            tmpRes = {},
            css = {
                media   : "screen",
                rel     : "stylesheet",
                type    : "text/css",
                content : []
            },
            cssStr = '',
            js  = {
                type    : "text/javascript",
                content : []
            },
            jsStr = '';

        //intercept errors in case of malformed config
        //console.log('type of view conf ', typeof(viewConf));
        if( typeof(viewConf) != "object" ){
            cssStr = viewConf;
            jsStr = viewConf
        }

        //console.info('setting ressources for .... ', localRessources, viewConf);
        //Getting global/default css
        //Default will be completed OR overriden by locals - if options are set to "override_css" : "true" or "override" : "true"
        if( viewConf["default"] ){
            //console.info('found default ', ["default"]);
            //Get css
            if( viewConf["default"]["stylesheets"] ){
                tmpRes = _getNodeRes('css', cssStr, viewConf["default"]["stylesheets"], css);
                cssStr = tmpRes.cssStr;
                css = tmpRes.css;
                tmpRes = null
            }
            //Get js
            if( viewConf["default"]["javascripts"] ){
                tmpRes = _getNodeRes('js', jsStr, viewConf["default"]["javascripts"], js);
                jsStr = tmpRes.jsStr;
                js = tmpRes.js;
                tmpRes = null
            }
        }

        //Check if local css exists
        if( viewConf[localRessources] ){
            //Css override test
            if(viewConf[localRessources]["override_css"] && viewConf[localRessources]["override_css"] == true || viewConf[localRessources]["override"] && viewConf[localRessources]["override"] == true){
                cssStr = "";
                css.content = []
            }
            //Get css
            if( viewConf[localRessources]["stylesheets"] ){
                //console.info('case ', viewConf[localRessources]["stylesheets"], localRessources);
                tmpRes = _getNodeRes('css', cssStr, viewConf[localRessources]["stylesheets"], css);
                cssStr = tmpRes.cssStr;
                css = tmpRes.css;
                tmpRes = null
            }
            //js override test
            if( viewConf[localRessources]["override_js"] && viewConf[localRessources]["override_js"] == true || viewConf[localRessources]["override"] && viewConf[localRessources]["override"] == true ){
                jsStr = "";
                js.content = []
            }
            //Get js
            if( viewConf[localRessources]["javascripts"] ){
                tmpRes = _getNodeRes('js', jsStr, viewConf[localRessources]["javascripts"], js);
                jsStr = tmpRes.jsStr;
                js = tmpRes.js;
                tmpRes = null
            }
        }
        _this.set('page.stylesheets', cssStr);
        _this.set('page.scripts', jsStr)
        //console.info('setting ressources !! ', cssStr, jsStr);
    }

    /**
     * Get node resources
     *
     * @param {string} type
     * @param {string} resStr
     * @param {array} resArr
     * @param {object} resObj
     *
     * @return {object} content
     *
     * @private
     * */
    var _getNodeRes = function(type, resStr, resArr, resObj) {
        //console.log('assigning ..... ', resStr);
        switch(type){
            case 'css':
                var css = resObj;
                for (var res in resArr) {
                    //means that you will find options.
                    if (typeof(resArr[res]) == "object") {
                        //console.info('found object ', resArr[res]);
                        css.media = (resArr[res].options.media) ? resArr[res].options.media : css.media;
                        css.rel = (resArr[res].options.rel) ? resArr[res].options.rel : css.rel;
                        css.type = (resArr[res].options.type) ? resArr[res].options.type : css.type;
                        if (!css.content[resArr[res]._]) {
                            css.content[resArr[res]._] = '<link href="'+ resArr[res]._ +'" media="'+ css.media +'" rel="'+ css.rel +'" type="'+ css.type +'">';
                            resStr += '\n\t' + css.content[resArr[res]._]
                        }

                    } else {
                        css.content[resArr[res]] = '<link href="'+ resArr[res] +'" media="screen" rel="'+ css.rel +'" type="'+ css.type +'">';
                        resStr += '\n\t' + css.content[resArr[res]]
                    }


                }
                return { css : css, cssStr : resStr }
            break;

            case 'js':
                var js = resObj;
                for (var res in resArr) {
                    //means that you will find options
                    if ( typeof(resArr[res]) == "object" ) {
                        js.type = (resArr[res].options.type) ? resArr[res].options.type : js.type;
                        if (!js.content[resArr[res]._]) {
                            js.content[resArr[res]._] = '<script type="'+ js.type +'" src="'+ resArr[res]._ +'"></script>';
                            resStr += '\n\t' + js.content[resArr[res]._];
                        }

                    } else {
                        js.content[resArr[res]] = '<script type="'+ js.type +'" src="'+ resArr[res] +'"></script>';
                        resStr += '\n\t' + js.content[resArr[res]]
                    }


                }
                return { js : js, jsStr : resStr }
            break;
        }
    }

    /**
     * TODO -  Controller.setMeta()
     * */
    this.setMeta = function(metaName, metacontent) {

    }

    this.getData = function() {
        return utils.refToObj(_this.data)
    }

    /**
     * TODO -  Controller.redirect()
     * */
    this.redirect = function(route) {

    }

    /**
     * TODO -  Controller.forward404Unless()
     * */
    this.forward404Unless = function(condition) {

    }

    /**
     * Get Params
     * */
    var getParams = function(req) {

        req.get = req.query;
        req.post = req.body;

        req.getParams = function() {
            //copy.
            var params = JSON.parse(JSON.stringify(req.params));
            params = extend(params, req.get);
            params = extend(params, req.post);
            return params
        };

        delete req['query'];
        delete req['body'];
    }

    /**
     * Get config
     *
     * @param {string} [name] - Conf name without extension.
     * @return {object} result
     *
     * TODO - Protect result
     * */
    this.getConfig = function(name) {
        var tmp = "";
        if ( typeof(name) != 'undefined' ) {
            try {
                //Protect it.
                tmp = JSON.stringify(_options.conf.content[name]);
                return JSON.parse(tmp)
            } catch (err) {
                return undefined
            }
        } else {
            tmp = JSON.stringify(_options.conf);
            return JSON.parse(tmp)
        }
    }

    this.renderDocumentation = function(req, res) {

    }

    //protected
    this.protected =  {
        setOptions : _this.setOptions, //used only once on new instance
        hasOptions : _this.hasOptions,
        render : _this.render,
        renderJSON : _this.renderJSON,
        renderTEXT : _this.renderTEXT,
        set : _this.set,
        setMeta : _this.setMeta,
        getConfig : _this.getConfig,
        redirect : _this.redirect,
        getData : _this.getData
        //getParams : _this.getParams
    };

    init(request, response, next);
};

module.exports = Controller