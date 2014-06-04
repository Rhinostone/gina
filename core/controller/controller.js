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
var fs      = require('fs');
var utils   = require('./../utils');
var merge   = utils.merge;
var swig    = require('swig');

Controller = function(request, response, next) {

    //public
    this.name       = "Controller";
    this._data      = {};

    //private
    var self = this;
    var _options;
    var _request, _response, _next;

    /**
     * Controller Constructor
     * @constructor
     * */
    var init = function(request, response, next) {
        _request = request, _response = response, _next = next;
        if ( typeof(Controller.initialized) != 'undefined' ) {
            return getInstance()
        } else {
            Controller.initialized = true;
            Controller.instance = self
        }
    }

    var getInstance = function() {
        _options = Controller.instance._options;
        self._data = Controller.instance._data;
        return Controller.instance
    }

    var hasViews = function() {
        return ( typeof(_options.views) != 'undefined' ) ? true : false;
    }

    this.isCacheless = function() {
        return _options.cacheless
    }

    this.throwError = function(res, code, msg) {

        if ( !hasViews() ) {
            res.writeHead(code, { 'Content-Type': 'application/json'} );
            res.end(JSON.stringify({
                status: code,
                error: 'Error '+ code +'. '+ msg
            }))
        } else {
            res.writeHead(code, { 'Content-Type': 'text/html'} );
            res.end('Error '+ code +'. '+ msg)
        }
    }

    this.setOptions = function(options) {
        _options = Controller.instance._options = options;
        getParams(_request);
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
            self.set('page.ext', ext);
            self.set('page.content', content);
            self.set('page.action', action);
            self.set('page.title', action);
        }

        if ( hasViews() ) {
            self.set('file', _options.file);
            self.set('page.title', _options.file);

            //TODO - detect when to use swig
            var dir = self.views || _options.views.default.views;
            var swigOptions = {
                loader: swig.loaders.fs(dir),
                cache: (_options.cacheless) ? false : 'memory'
            };
            swig.setDefaults(swigOptions);
            self.engine = swig;
        }
    }

    this.setViewsLocation = function(dir) {
        _options.views.default.views = dir;
        _options.views.default.html = _(dir + '/html');
        swig.setDefaults({
            loader: swig.loaders.fs(dir)
        })
    }

    this.hasOptions = function() {
        return ( typeof(_options) != 'undefined') ? true : false
    }

    /**
     * Render HTML templates : Swig is the default template engine
     *
     * @param {object} _data
     * @return {void}
     * */
    this.render = function(_data) {
        _data = merge(true, _data, self.getData() );
        self.setRessources(_options.views, _data.page.action);
        var data = merge(true, _data, self.getData() );
        var path = _(_options.views.default.html + '/' + data.page.content);

        var dic = {};
        for (var d in data.page) {
            dic['page.'+d] = data.page[d]
        }
        // please, do not put any slashes when including...
        // ex.:
        //      html/inc/_partial.html (GOOD)
        //      /html/inc/_partial.html (BAD)
        fs.readFile(path, function (err, content) {
            if (err) {
                this.throwError(_response, 500, err.stack);
                return
            }

            try {
                content = swig.compile(content.toString())(data)
            } catch (err) {
                self.throwError(_response, 500, '[ '+path+' ]\n' + err.stack);
                return
            }

            dic['page.content'] = content;

            fs.readFile(_options.views.default.layout, function(err, layout) {
                if (err) {
                    this.throwError(_response, 500, err.stack);
                    return;
                }
                layout = layout.toString();
                layout = whisper(dic, layout, /\{{ ([a-zA-Z.]+) \}}/g );

                _response.writeHead(200, { 'Content-Type': 'text/html' });
                _response.end(layout);
            })
        })
    }

    /**
     * Set Layout path
     *
     * @param {string} filename
     * */
    this.setLayout = function(filename) {//means path
        _options.views.default.layout = filename
    }
//    this.render = function(data, request, response, next) {
//
//        self.app.isXmlHttpRequest = ( typeof(request) != "undefined" && request.xhr && self.app.isXmlHttpRequest || self.app.isXmlHttpRequest ) ? true : false;
//
//        if( typeof(self.app.isXmlHttpRequest) == "undefined" || !self.app.isXmlHttpRequest ) {
//            data.page.handler = (self.app.handler != null) ? '<script type="text/javascript" src="/'+ self.app.appName + '/handlers/' + self.app.handler.file +'"></script>' : '';
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
//        self.rendered = true;
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
            self.rendered = true;
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
        self.rendered = true;
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
        self._data[variable] = value
    }

    /**
     * Get data
     *
     * @param {String} variable Data name to set
     * @return {Object | String} data Data object or String
     * */
    this.get = function(variable) {
        return self._data[variable]
    }

    this.setRessources = function(viewConf, localRessources) {
        var res = '',
            tmpRes = {},
            css = {
                media   : "screen",
                rel     : "stylesheet",
                type    : "text/css",
                content : []
            },
            cssStr = ' ',
            js  = {
                type    : "text/javascript",
                content : []
            },
            jsStr = ' ';

        //intercept errors in case of malformed config
        if ( typeof(viewConf) != "object" ) {
            cssStr = viewConf;
            jsStr = viewConf
        }

        //Getting global/default css
        //Default will be completed OR overriden by locals - if options are set to "override_css" : "true" or "override" : "true"
        if( viewConf["default"] ) {
            //console.info('found default ', ["default"]);
            //Get css
            if( viewConf["default"]["stylesheets"] ) {
                tmpRes = getNodeRes('css', cssStr, viewConf["default"]["stylesheets"], css);
                cssStr = tmpRes.cssStr;
                css = tmpRes.css;
                tmpRes = null
            }
            //Get js
            if( viewConf["default"]["javascripts"] ) {
                tmpRes = getNodeRes('js', jsStr, viewConf["default"]["javascripts"], js);
                jsStr = tmpRes.jsStr;
                js = tmpRes.js;
                tmpRes = null
            }
        }

        //Check if local css exists
        if( viewConf[localRessources] ) {
            //Css override test
            if(viewConf[localRessources]["override_css"] && viewConf[localRessources]["override_css"] == true || viewConf[localRessources]["override"] && viewConf[localRessources]["override"] == true){
                cssStr = "";
                css.content = []
            }
            //Get css
            if( viewConf[localRessources]["stylesheets"] ) {
                //console.info('case ', viewConf[localRessources]["stylesheets"], localRessources);
                tmpRes = getNodeRes('css', cssStr, viewConf[localRessources]["stylesheets"], css);
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
            if( viewConf[localRessources]["javascripts"] ) {
                tmpRes = getNodeRes('js', jsStr, viewConf[localRessources]["javascripts"], js);
                jsStr = tmpRes.jsStr;
                js = tmpRes.js;
                tmpRes = null
            }
        }

        self.set('page.stylesheets', cssStr);
        self.set('page.scripts', jsStr)
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
    var getNodeRes = function(type, resStr, resArr, resObj) {
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
        return utils.refToObj(self._data)
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
        req.get = (req.query) ? req.query : {};
        req.post = (req.body) ? req.body : {};

        req.getParams = function() {
            //copy.
            var params = JSON.parse(JSON.stringify(req.params));
            params = merge(true, params, req.get);
            params = merge(true, params, req.post);
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


/**    //protected
    this.protected =  {
        setOptions : self.setOptions,
        hasOptions : self.hasOptions,
        render : self.render,
        renderJSON : self.renderJSON,
        renderTEXT : self.renderTEXT,
        set : self.set,
        setMeta : self.setMeta,
        getConfig : self.getConfig,
        redirect : self.redirect,
        getData : self.getData,
        setRessources : setRessources,
        setLayout : self.setLayout
    };*/

    init(request, response, next);
};

module.exports = Controller