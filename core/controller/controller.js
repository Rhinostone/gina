/*
 * This file is part of the gina package.
 * Copyright (c) 2015 Rhinostone <gina@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

//Imports.
var fs              = require('fs');
var EventEmitter    = require('events').EventEmitter;
var utils           = require('./../utils') || require.cache[require.resolve('./../utils')];
var merge           = utils.merge;
var inherits        = utils.inherits;
var console         = utils.logger;
var swig            = require('swig');


/**
 * @class Controller
 *
 *
 * @package     Gina
 * @namespace
 * @author      Rhinostone <gina@rhinostone.com>
 *
 * @api         Public
 */
function Controller(options) {

    //public
    this.name       = "Controller";
    this._data      = {};

    //private
    var self = this;
    var local = {
        req : null,
        res : null,
        next : null,
        options: options || null
    };

    /**
     * Controller Constructor
     * @constructor
     * */
    var init = function() {

        if ( typeof(Controller.initialized) != 'undefined' ) {
            return getInstance()
        } else {
            Controller.initialized = true;
            Controller.instance = self;
            if (local.options) {
                Controller.instance._options = local.options
            }
        }
    }

    var getInstance = function() {
        local.options = Controller.instance._options = options;
        self._data = Controller.instance._data;
        return Controller.instance
    }

    var hasViews = function() {
        return ( typeof(local.options.views) != 'undefined' ) ? true : false;
    }

    this.isCacheless = function() {
        return local.options.cacheless
    }

    this.setOptions = function(req, res, next, options) {
        local.options = Controller.instance._options = options;

        // N.B.: Avoid setting `page` properties as much as possible from the routing.json
        // It will be easier for the framework if set from the controller.
        //
        // Here is a sample if you choose to set  `page.title` from the rule
        // ------rouging rule sample -----
        // {
        //    "default": {
        //        "url": ["", "/"],
        //            "param": {
        //            "action": "home",
        //                "title": "My Title"
        //        }
        // }
        //
        // ------controller action sample -----
        // Here is a sample if you decide to set `page.title` from your controller
        //
        // this.home = function(req, res, next) {
        //      var data = { page: { title: "My Title"}};
        //      self.render(data)
        // }
        if ( typeof(options.conf.content.routing[options.rule].param) !=  'undefined' ) {
            var str = 'page.', p = options.conf.content.routing[options.rule].param;
            for (var key in p) {
                if (p.hasOwnProperty(key)) {
                    str += key + '.';
                    var obj = p[key], value = '';
                    for (var prop in obj) {
                        if (obj.hasOwnProperty(prop)) {
                            value += obj[prop]
                        } else {
                            self.set(str.substr(0, str.length-1), value);
                            str = 'page.'
                        }
                    }
                }
            }
        }

        local.req = req;
        local.res = res;
        local.next = next;

        getParams(req);
        if ( typeof(local.options.views) != 'undefined' && typeof(local.options.action) != 'undefined' ) {
            var action = local.options.action;
            var ext = 'html';
            if ( typeof(local.options.views.default) != 'undefined' ) {
                ext = local.options.views.default.ext || ext;
            }
            if( !/\./.test(ext) ) {
                ext = '.' + ext;
                local.options.views.default.ext = ext
            }

            var content = action;
            self.set('page.ext', ext);
            self.set('page.content', content);
            self.set('page.action', action);
            self.set('page.title', action);

            if (typeof(req.headers['accept-language']) != 'undefined') {
                self.set('page.lang', req.headers['accept-language'].split(',')[0]);
            } else {
                self.set('page.lang', local.options.conf.server.response.header['accept-language'].split(',')[0]);
            }
        }

        if ( hasViews() ) {

            if ( typeof(local.options.file) == 'undefined') {
                local.options.file = 'index'
            }

            self.set('file', local.options.file);
            self.set('page.title', local.options.file);

            //TODO - detect when to use swig
            var dir = self.views || local.options.views.default.views;
            var swigOptions = {
                autoescape: ( typeof(local.options.autoescape) != 'undefined') ? local.options.autoescape: false,
                loader: swig.loaders.fs(dir),
                cache: (local.options.cacheless) ? false : 'memory'
            };
            swig.setDefaults(swigOptions);
            self.engine = swig;
        }
    }

    /**
     * Set views|templates location
     *
     * @param {string} dir
     * @param {string} [ layout ] - Is by default dir + '/layout.html'
     * */
    this.setViewsLocation = function(dir, layout) {
        local.options.views.default.views = dir;
        local.options.views.default.html = _(dir + '/html');
        if ( typeof(local.options.namespace) != 'undefined') {
            local.options.views.default.html = _(local.options.views.default.html+'/'+local.options.namespace)
        }
        local.options.views.default.layout = layout || _(local.options.views.default.html + '/layout.html');
        swig.setDefaults({
            loader: swig.loaders.fs(dir)
        })
    }

    this.hasOptions = function() {
        return ( typeof(local.options) != 'undefined') ? true : false
    }

    /**
     * Set Layout path
     *
     * @param {string} filename
     * */
    this.setLayout = function(rule, filename) {//means path
        local.options.views[rule].layout = filename
    }

    /**
     * Render HTML templates : Swig is the default template engine
     *
     *
     * Avilable filters:
     *  - getBundleWebroot()
     *
     * @param {object} _data
     * @return {void}
     * */
    this.render = function(_data) {

        try {
            var data = self.getData();
            if (!_data) {
                _data = { page: {}}
            } else if (!_data['page']) {
                data['page'] = {
                    data: _data
                }
            } else {
                data = merge(_data, data)
            }
            self.setRessources(local.options.views, data.file);
            var file = data.file;


            // pre-compiling variables
            data = merge(data, self.getData()); // needed !!
            if ( typeof(local.options.namespace) != 'undefined' ) {
                file = ''+ file.replace(local.options.namespace+'-', '');
                // means that rule name === namespace -> pointing to root namespace dir
                if (!file || file === local.options.namespace) {
                    file = 'index'
                }
                path = _(local.options.views[data.file].html +'/'+ local.options.namespace + '/' + file)
            } else {
                path = _(local.options.views[data.file].html +'/'+ file)
            }

            if (data.page.ext) {
                path += data.page.ext
            }

            var dic = {}, msg = '';
            for (var d in data.page) {
                dic['page.'+d] = data.page[d]
            }


            // please, do not put any slashes when including...
            // ex.:
            //      /html/inc/_partial.html (BAD)
            //      html/inc/_partial.html (GOOD)
            //      html/namespace/page.html (GOOD)
            fs.readFile(path, function (err, content) {
                if (err) {
                    msg = 'could not open "'+ path +'"' +
                            '\n1) The requested file does not exists in your views/html (views/template). Can you find: '+path +
                            '\n2) Check the following rule in your routing(.json) and look around `param` to make sure that nothing is wrong with your declaration: '+
                            '\n' + options.rule +':'+ JSON.stringify(options.conf.content.routing[options.rule], null, 4) +
                            '\n3) At this point, if you still have problems trying to run this portion of code, you can contact us telling us how to reproduce the bug.';

                    self.throwError(local.res, 500, new Error(msg));
                }

                try {
                    // Allows you to get a bundle web root
                    swig.setFilter('getBundleWebroot', function (input, obj) {
                        var prop = options.envObj.getConf(obj, options.conf.env),
                            url = prop.protocol + '://'+ prop.host +':'+ prop.port[prop.protocol];
                        if ( typeof(prop.server['webroot']) != 'undefined') {
                            url += prop.server['webroot']
                        }
                        return url
                    });

                    /**
                     * getUrl filter
                     *
                     * Usage:
                     *      <a href="{{ 'users-add' | getUrl({ id: user.id }) }}">Add User</a>
                     *      <a href="{{ 'users-edit' | getUrl({ id: user.id }) }}">Edit user</a>
                     *      <a href="{{ 'users-list' | getUrl(null, 'http://domain.com') }}">Display all users</a>
                     *
                     * @param {string} route
                     * @param {object} params - can't be left blank if base is required -> null if not defined
                     * @param {string} [base] - can be a CDN or the http://domain.com
                     *
                     * @return {string} relativeUrl|absoluteUrl - /sample/url.html or http://domain.com/sample/url.html
                     * */
                    var config        = local.options.conf
                        , wroot         = config.server.webroot
                        , isStandalone  = (config.bundles.length > 1) ? true : false
                        , isMaster      = (config.bundles[0] === config.bundle) ? true : false
                        , routing       = config.content.routing
                        , rule          = ''
                        , url           = NaN
                    ;
                    swig.setFilter('getUrl', function (route, params, base) {
                        if ( isStandalone && !isMaster ) {
                            rule = config.bundle +'-'+ route
                        } else {
                            rule = route
                        }

                        if ( typeof(routing[rule]) != 'undefined' ) { //found
                            url = routing[rule].url;
                            if ( typeof(routing[rule].requirements) != 'undefined' ) {
                                for (var p in routing[rule].requirements) {
                                    url = url.replace(new RegExp(':'+p, 'g'), params[p])
                                }
                            }
                        }

                        if ( typeof(base) != 'undefined' ) url = base + url;

                        return url
                    });

                    content = swig.compile( content.toString() )(data)
                } catch (err) {
                    // [ martin ]
                    // i sent an email to [ paul@paularmstrongdesigns.com ] on 2014/08 to see if there is
                    // a way of retrieving swig compilation stack traces
                    var stack = __stack.splice(1).toString().split(',').join('\n');
                    self.throwError(local.res, 500, 'template compilation exception encoutered: [ '+path+' ]\n'+stack);
                }

                dic['page.content'] = content;

                fs.readFile(local.options.views[data.file].layout, function(err, layout) {
                    if (err) {
                        self.throwError(local.res, 500, err.stack);
                    }
                    layout = layout.toString();
                    layout = whisper(dic, layout, /\{{ ([a-zA-Z.]+) \}}/g );

                    if ( !local.res.headersSent ) {
                        local.res.writeHead(200, { 'Content-Type': 'text/html' });
                        local.res.end(layout);
                        local.res.headersSent = true
                    }
                })
            })
        } catch (err) {
            self.throwError(local.res, 500, err.stack)
        }
    }


    /**
     * Render JSON
     *
     * @param {object|string} jsonObj
     * @return {void}
     * */
    this.renderJSON = function(jsonObj) {
        try {

            if(typeof(local.options) != "undefined" && typeof(local.options.charset) != "undefined"){
                local.res.setHeader("charset", local.options.charset);
            }
            if ( !local.res.get('Content-Type') ) {
                local.res.setHeader("Content-Type", "application/json");
            }
            if ( !local.res.headersSent ) {
                local.res.end(JSON.stringify(jsonObj));
                local.res.headersSent = true
            }
        } catch (err) {
            local.res.end(JSON.stringify({error: err.stack}));
            local.res.headersSent = true;
            console.log(err.stack)
        }

    }

    this.renderTEXT = function(content) {
        if ( typeof(content) != "string" ) {
            var content = content.toString();
        }

        if(typeof(options) != "undefined" && typeof(options.charset) !="undefined") {
            local.res.setHeader("charset", options.charset);
        }
        if ( !local.res.get('Content-Type') ) {
            local.res.setHeader("Content-Type", "text/plain");
        }

        if ( !local.res.headersSent ) {
            local.res.end(content);
            local.res.headersSent = true
        }
    }

    /**
     * Set data
     *
     * @param {string} variable Data name to set
     * @param {string} value Data value to set
     * @return {void}
     * */
    this.set = function(variable, value) {
        if ( typeof(self._data[variable]) == 'undefined' )
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

    /**
     * Set ressources
     *
     * @param {object} viewConf - template configuration
     * @param {string} localRessouces - rule name
     * */
    this.setRessources = function(viewConf, localRessource) {
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


        //cascading merging
        if (localRessource !== 'default') {
            if ( typeof(viewConf[localRessource]) != 'undefined') {
                for (var attr in viewConf.default) {
                    viewConf[localRessource][attr] = merge(viewConf[localRessource][attr], viewConf.default[attr])
                }
            } else {
                viewConf[localRessource] = viewConf.default
            }
        }

        //Get css
        if( viewConf[localRessource]["stylesheets"] ) {
            tmpRes = getNodeRes('css', cssStr, viewConf[localRessource]["stylesheets"], css);
            cssStr = tmpRes.cssStr;
            css = tmpRes.css;
            tmpRes = null
        }
        //Get js
        if( viewConf[localRessource]["javascripts"] ) {
            tmpRes = getNodeRes('js', jsStr, viewConf[localRessource]["javascripts"], js);
            jsStr = tmpRes.jsStr;
            js = tmpRes.js;
            tmpRes = null
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
        return refToObj(self._data)
    }

    var isValidURL = function(url){
        var re = /(http|ftp|https|sftp):\/\/[\w-]+(\.[\w-]+)+([\w.,@?^=%&amp;:\/~+#-]*[\w@?^=%&amp;\/~+#-])?/;
        return (re.test(url)) ? true : false
    }

    /**
     * redirect
     *
     * You have to ways of using this method
     *
     * 1) Through routing.json
     * ---------------------
     * Allows you to redirect to an internal [ route ], an internal [ path ], or an external [ url ]
     *
     * For this to work you have to set in your routing.json a new route using  "param":
     * { "action": "redirect", "route": "one-valid-route" }
     * OR
     * { "action": "redirect", "url": "http://www.somedomain.com/page.html" }
     *
     * if you are free to use the redirection [ code ] of your choice, we've set it to 301 by default
     *
     *
     * 2) By calling this.redirect(rule, [ignoreWebRoot]):
     * ------------------------------------------------
     * where `this` is :
     *  - a Controller instance
     *  - a Middleware instance
     *
     * Where `rule` is either a string defining
     *  - the rule/route name => home
     *  - an URI => /home
     *  - a URL => http://www.google.com/
     *
     * And Where `ignoreWebRoot` is an optional parameter used to ignore web root settings (Standalone mode or user set web root)
     * `ignoreWebRoot` behaves the like set to `false` by default
     *
     *
     *
     * @param {object|string} req|rule - Request Object or Rule/Route name
     * @param {object|boolean} res|ignoreWebRoot - Response Object or Ignore WebRoot & start from domain root: /
     *
     * @callback [ next ]
     * */
    this.redirect = function(req, res, next) {
        var conf = self.getConfig();
        var wroot = conf.server.webroot;
        var routing = conf.content.routing;
        var route = '', rte = '';

        if ( typeof(req) === 'string' ) {

            if ( typeof(res) == 'undefined') {
                // nothing to do
            } else if (typeof(res) === 'string' || typeof(res) === 'number' || typeof(res) === 'boolean') {
                var ignoreWebRoot = null;
                if ( /true|1/.test(res) ) {
                    ignoreWebRoot = true
                } else if ( /false|0/.test(res) ) {
                    ignoreWebRoot = false
                } else {
                    res = local.res;
                    var stack = __stack.splice(1).toString().split(',').join('\n');
                    self.throwError(res, 500, 'Internal Server Error\n@param `ignoreWebRoot` must be a boolean\n' + stack);
                }
            }

            if ( req.substr(0,1) === '/') { // is relative (not checking if the URI is defined in the routing.json)
                if (wroot.substr(wroot.length-1,1) == '/') {
                    wroot = wroot.substr(wroot.length-1,1).replace('/', '')
                }
                rte     = ( typeof(ignoreWebRoot) != 'undefined' && ignoreWebRoot) ? req : wroot + req;
                req     = local.req;
                res     = local.res;
                next    = local.next;
                var isRelative = true;
                req.routing.param.path = rte
            } else if ( isValidURL(req) ) { // might be an URL
                rte     = req;
                req     = local.req;
                res     = local.res;
                next    = local.next;
                req.routing.param.url = rte
            } else { // is by default a route name
                rte = route = ( new RegExp('^/'+conf.bundle+'-$').test(req) ) ? req : wroot.match(/[^/]/g).join('') +'-'+ req;
                req     = local.req;
                res     = local.res;
                next    = local.next;
                req.routing.param.route = routing[rte]
            }
        } else {
            route = req.routing.param.route;
        }

        var path = req.routing.param.path || '';
        var url = req.routing.param.url;
        var code = req.routing.param.code || 301;
        var keepParams = req.routing.param['keep-params'] || false;

        var condition = true; //set by default for url @ path redirect

        if (route) { // will go with route first
            condition = ( typeof(routing[route]) != 'undefined') ? true : false;
        }

        if ( !self.forward404Unless(condition, req, res) ) { // forward to 404 if bad route

            if (wroot.substr(wroot.length-1,1) == '/') {
                wroot = wroot.substr(wroot.length-1,1).replace('/', '')
            }

            if (route) { // will go with route first
                path = routing[route].url;
                if (path instanceof Array) {
                    path = path[0] //if it is an array, we just take the first one
                }
            } else if (url && !path) {
                path = ( (/\:\/\//).test(url) ) ? url : req.protocol + '://' + url;
            } else if(path && typeof(isRelative) !=  'undefined') {
                // nothing to do
            } else {
                path = conf.hostname + path
            }

            if (req.headersSent) return next();

            res.writeHead(code, { 'Location': path });
            res.end();
            local.res.headersSent = true;// done for the render() method
        }
        next()
    }


    /**
     * forward404Unless
     *
     * @param {boolean} condition
     * @param {object} req
     * @param {object} res
     *
     * @callback [ next ]
     * @param {string | boolean} err
     *
     * @return {string | boolean} err
     * */
    this.forward404Unless = function(condition, req, res, next) {
        var pathname = req.url;

        if (!condition) {
            self.throwError(res, 404, 'Page not found\n' + pathname);
            var err = new Error('Page not found\n' + pathname);
            if ( typeof(next) != 'undefined')
                next(err)
            else
                return err
        } else {
            if ( typeof(next) != 'undefined' )
                next(false)
            else
                return false
        }
    }

    /**
     * Get all Params
     * */
    var getParams = function(req) {

        req.getParams = function() {
            // copy
            var params = JSON.parse(JSON.stringify(req.params));
            params = merge(true, params, req.get);
            params = merge(true, params, req.post);
            return params
        }
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
        var tmp = null;

        if ( typeof(name) != 'undefined' ) {
            try {
                // needs to be read only
                tmp = JSON.stringify(local.options.conf.content[name]);
                return JSON.parse(tmp)
            } catch (err) {
                return undefined
            }
        } else {
            tmp = JSON.stringify(local.options.conf);
            return JSON.parse(tmp)
        }
    }

    this.throwError = function(res, code, msg) {
        if (arguments.length < 3) {
            var res = local.res;
            var code = res || 500;
            var msg = code || null;
        }

        if ( !res.headersSent ) {
            if ( !hasViews() ) {
                res.writeHead(code, { 'Content-Type': 'application/json'} );
                res.end(JSON.stringify({
                    status: code,
                    error: 'Error '+ code +'. '+ msg
                }))
            } else {
                res.writeHead(code, { 'Content-Type': 'text/html'} );
                res.end('<h1>Error '+ code +'.</h1><pre>'+ msg + '</pre>');
                local.res.headersSent = true;
            }
        } else {
            local.next()
        }
    }

    // converting references to objects
    var refToObj = function (arr){
        var tmp = null,
            curObj = {},
            obj = {},
            count = 0,
            data = {},
            last = null;
        for (var r in arr) {
            tmp = r.split(".");
            //Creating structure - Adding sub levels
            for (var o in tmp) {
                count++;
                if (last && typeof(obj[last]) == "undefined") {
                    curObj[last] = {};
                    if (count >= tmp.length) {
                        // assigning.
                        // !!! if null or undefined, it will be ignored while extending.
                        curObj[last][tmp[o]] = (arr[r]) ? arr[r] : "undefined";
                        last = null;
                        count = 0;
                        break
                    } else {
                        curObj[last][tmp[o]] = {}
                    }
                } else if (tmp.length === 1) { //Just one root var
                    curObj[tmp[o]] = (arr[r]) ? arr[r] : "undefined";
                    obj = curObj;
                    break
                }
                obj = curObj;
                last = tmp[o]
            }
            data = merge(true, data, obj);
            obj = {};
            curObj = {}
        }
        return data
    }

    init()
};

Controller = inherits(Controller, EventEmitter);
module.exports = Controller