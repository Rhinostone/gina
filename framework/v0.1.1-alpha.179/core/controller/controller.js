"use strict";
/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2023 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

//Imports.
var fs              = require('fs');
const {promises: {readFile}} = require("fs");
var util            = require('util');
var promisify       = util.promisify;
var EventEmitter    = require('events').EventEmitter;
var zlib            = require('zlib');

//var dns           = require('dns');
// var tls = require('tls');
// var crypto = require('crypto');

var lib             = require('./../../lib') || require.cache[require.resolve('./../../lib')];
var merge           = lib.merge;
var inherits        = lib.inherits;
var console         = lib.logger;
var Collection      = lib.Collection;
var routingLib      = lib.routing;
var swig            = require('swig');
// Swig 2
// var swig            = require('./../deps/swig-client/swig-2.0.0.min.js');
var SwigFilters     = lib.SwigFilters;
var statusCodes     = requireJSON( _( getPath('gina').core + '/status.codes') );


/**
 * @class SuperController
 *
 *
 * @package     Gina
 * @namespace
 * @author      Rhinostone <contact@gina.io>
 *
 * @api         Public
 */
function SuperController(options) {

    //public
    this.name = 'SuperController';
    this.engine = {};


    var self = this;
    //private
    var local = {
        req     : null,
        res     : null,
        next    : null,
        options : options || null,
        query   : {},
        _data   : {},
        view    : {}
    };

    /**
     * SuperController Constructor
     * @constructor
     * */
    var init = function() {

        if ( typeof(SuperController.initialized) != 'undefined' ) {
            return getInstance()
        } else {

            SuperController.instance = self;


            if (local.options) {
                SuperController.instance._options = local.options;
            }

            SuperController.initialized = true;

        }
    }

    var getInstance = function() {
        local.options = SuperController.instance._options = options;
        // 2022-03-07 Fix for none-developpement environnements (without cache)
        self._options = local.options;

        return SuperController.instance;
    }

    var hasViews = function() {
        return ( typeof(local.options.template) != 'undefined' ) ? true : false;
    }

    /**
     * isHttp2
     * Returns `true` if server configured for HTTP/2
     *
     * @returns {boolean} isHttp2
     */
    var isHttp2 = function() {
        var options =  local.options;
        var protocolVersion = ~~options.conf.server.protocol.match(/\/(.*)$/)[1].replace(/\.\d+/, '');
        var httpLib =  options.conf.server.protocol.match(/^(.*)\//)[1] + ( (protocolVersion >= 2) ? protocolVersion : '' );


        return /http2/.test(httpLib)
    }

    var headersSent = function(res) {
        var _res = ( typeof(res) != 'undefined' ) ? res : local.res;

        if ( typeof(_res.headersSent) != 'undefined' ) {
            return _res.headersSent
        }

        if (
            typeof(_res.stream) != 'undefined'
            && typeof(_res.stream.headersSent) != 'undefined'
            && _res.stream.headersSent != 'null'
        ) {
            return true
        }

        return false;
    }
    /**
     * isSecured
     * Returns `true` if server configured to handle a HTTPS exchanges
     *
     * @returns {boolean} isSecured
     */
    var isSecured = function() {
        return /https/.test(local.options.conf.server.scheme)
    }

    this.getRequestObject = function() {
        return local.req;
    }

    this.getResponseObject = function() {
        return local.res;
    }

    this.getNextCallback = function() {
        return local.next;
    }

    /**
     * Check if env is running cacheless
     * */
    this.isCacheless = function() {
        return (/^true$/i.test(process.env.NODE_ENV_IS_DEV)) ? true : false;
    }
    /**
     * Check if the project scope is set for local
     * */
    this.isLocalScope = function() {
        return (/^true$/i.test(process.env.NODE_SCOPE_IS_LOCAL)) ? true : false;
    }

    this.setOptions = function(req, res, next, options) {
        local.options = SuperController.instance._options = options;
        local.options.renderingStack = (local.options.renderingStack) ? local.options.renderingStack : [];
        local.options.isRenderingCustomError = (local.options.isRenderingCustomError) ? local.options.isRenderingCustomError : false;


        // N.B.: Avoid setting `page` properties as much as possible from the routing.json
        // It will be easier for the framework if set from the controller.
        //
        // Here is a sample if you choose to set  `page.view.title` from the rule
        // ------rouging rule sample -----
        // {
        //    "default": {
        //        "url": ["", "/"],
        //            "param": {
        //            "control": "home",
        //            "title": "My Title"
        //        }
        // }
        //
        // ------controller action sample -----
        // Here is a sample if you decide to set `page.view.title` from your controller
        //
        // this.home = function(req, res, next) {
        //      var data = { page: { view: { title: "My Title"}}};
        //      self.render(data)
        // }

        if ( typeof(options.conf.content.routing[options.rule].param) !=  'undefined' ) {
            var str = 'page.'
                , p = options.conf.content.routing[options.rule].param
            ;

            for (var key in p) {
                if ( p.hasOwnProperty(key) && !/^(control)$/.test(key) ) {
                    str += key + '.';
                    var obj = p[key], value = '';
                    for (var prop in obj) {
                        if (obj.hasOwnProperty(prop)) {
                            value += obj[prop]
                        } else {

                            if ( /^:/.test(value) ) {
                                str = 'page.view.params.'+ key + '.';
                                set(str.substr(0, str.length-1), req.params[value.substr(1)]);
                            } else if (/^(file|title)$/.test(key)) {
                                str = 'page.view.'+ key + '.';
                                set(str.substr(0, str.length-1), value);
                            } else {
                                set(str.substr(0, str.length-1), value)
                            }

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
        if ( typeof(local.options.template) != 'undefined' && typeof(local.options.control) != 'undefined' ) {


            var  action             = local.options.control
                , rule              = local.options.rule
                , ext               = 'html' // by default
                , isWithoutLayout   = false // by default
                , namespace         = local.options.namespace || '';


            if ( typeof(local.options.template) != 'undefined' && local.options.template ) {
                if (
                    typeof(local.options.template.ext) != 'undefined'
                    && local.options.template.ext
                    && local.options.template.ext != ''
                ) {
                    ext = local.options.template.ext
                }

                if ( !/\./.test(ext) ) {
                    ext = '.' + ext;
                    local.options.template.ext = ext
                }

                if (
                    typeof(local.options.template.layout) == 'undefined'
                    || /^false$/.test(local.options.template.layout)
                    || local.options.template.layout == ''
                ) {
                    isWithoutLayout = true;
                }
            }


            if ( hasViews() ) {

                if ( typeof(local.options.file) == 'undefined') {
                    local.options.file = 'index'
                }

                if ( typeof(local.options.isWithoutLayout) == 'undefined' || !isWithoutLayout ) {
                    local.options.isWithoutLayout = false;
                }

                rule        = local.options.rule;
                namespace   = local.options.namespace || 'default';


                set('page.view.file', local.options.file);
                set('page.view.title', rule.replace(new RegExp('@' + options.conf.bundle), ''));
                set('page.view.namespace', namespace);
            }


            var ctx = getContext('gina');
            // new declaration && overrides
            var version = {
                "number"        : ctx.version,
                "platform"      : process.platform,
                "arch"          : process.arch,
                "nodejs"        : process.versions.node,
                "middleware"    : ctx.middleware
            };

            set('page.environment.allocated memory', (require('v8').getHeapStatistics().heap_size_limit / (1024 * 1024 * 1024)).toFixed(2) +' GB');

            set('page.environment.gina', version.number);
            set('page.environment.gina pid', GINA_PID);
            set('page.environment.nodejs', version.nodejs +' '+ version.platform +' '+ version.arch);
            set('page.environment.engine', options.conf.server.engine);//version.middleware
            set('page.environment.env', process.env.NODE_ENV);
            set('page.environment.envIsDev', self.isCacheless());
            set('page.environment.date.now', new Date().format("isoDateTime"));


            var routing = local.options.conf.routing = ctx.config.envConf.routing; // all routes
            set('page.environment.routing', encodeRFC5987ValueChars(JSON.stringify(routing))); // export for GFF
            //reverseRouting
            var reverseRouting = local.options.conf.reverseRouting = ctx.config.envConf.reverseRouting; // all routes
            set('page.environment.reverseRouting', encodeRFC5987ValueChars(JSON.stringify(reverseRouting))); // export for GFF

            var forms = local.options.conf.forms = options.conf.content.forms // all forms
            set('page.environment.forms', encodeRFC5987ValueChars(JSON.stringify(forms))); // export for GFF
            set('page.forms', options.conf.content.forms);

            set('page.environment.hostname', ctx.config.envConf[options.conf.bundle][process.env.NODE_ENV].hostname);
            set('page.environment.rootDomain', ctx.config.envConf[options.conf.bundle][process.env.NODE_ENV].rootDomain);
            set('page.environment.webroot', options.conf.server.webroot);
            set('page.environment.bundle', options.conf.bundle);
            set('page.environment.project', options.conf.projectName);
            set('page.environment.protocol', options.conf.server.protocol);
            set('page.environment.scheme', options.conf.server.scheme);
            set('page.environment.port', options.conf.server.port);
            set('page.environment.debugPort', options.conf.server.debugPort);
            set('page.environment.pid', process.pid);


            set('page.view.ext', ext);
            set('page.view.control', action);
            set('page.view.controller', local.options.controller.replace(options.conf.bundlesPath, ''), true);
            if (typeof (local.options.controlRequired) != 'undefined' ) {
                set('page.view.controlRequired', local.options.controlRequired);
            }
            set('page.view.method', local.options.method);
            set('page.view.namespace', namespace); // by default
            set('page.view.url', req.url);
            if ( local.options.template ) {
                set('page.view.layout', local.options.template.layout.replace(new RegExp(local.options.template.templates+'/'), ''));
                set('page.view.html.properties.mode.javascriptsDeferEnabled', local.options.template.javascriptsDeferEnabled);
                set('page.view.html.properties.mode.routeNameAsFilenameEnabled', local.options.template.routeNameAsFilenameEnabled);
            }


            var parameters = JSON.clone(req.getParams());
            parameters = merge(parameters, options.conf.content.routing[rule].param);
            // excluding default page properties
            delete parameters[0];
            delete parameters.file;
            delete parameters.control;
            delete parameters.title;

            if (parameters.count() > 0)
                set('page.view.params', parameters); // view parameters passed through URI or route params

            set('page.view.route', rule);


            var acceptLanguage = GINA_CULTURE; // by default : language-COUNTRY
            if ( typeof(req.headers['accept-language']) != 'undefined' ) {
                acceptLanguage = req.headers['accept-language']
            } else if ( typeof(local.options.conf.server.response.header['accept-language']) != 'undefined' ) {
                acceptLanguage = local.options.conf.server.response.header['accept-language']
            }

            // set user locale: region & culture
            var userCulture     = acceptLanguage.split(',')[0];
            var userCultureCode = userCulture.split(/\-/);
            var userLangCode    = userCultureCode[0];
            var userCountryCode = userCultureCode[1];

            var locales         = new Collection( getContext('gina').locales );
            var userLocales     = null;

            try {
                userLocales = locales.findOne({ lang: userLangCode }).content;
            } catch (err) {
                //var defaultRegion = (local.options.conf.content.settings.region) ? local.options.conf.content.settings.region.shortCode
                console.warn('language code `'+ userLangCode +'` not handled by current locales setup: replacing by default: `'+ local.options.conf.content.settings.region.shortCode +'`');
                userLocales = locales.findOne({ lang: local.options.conf.content.settings.region.shortCode }).content // by default
            }

            // user locales list
            local.options.conf.locales = userLocales;

            // user locale
            options.conf.locale = new Collection(userLocales).findOne({ short: userCountryCode }) || {};

            //set('page.date.now', new Date().format("isoDateTime"));
            if ( typeof(options.conf.locale) == 'undefined' || !options.conf.locale ) {
                options.conf.locale = {}
            }
            options.conf.locale.date = {
                now: new Date().format("isoDateTime")
            }
            set('page.view.locale', options.conf.locale);
            set('page.view.lang', userCulture);
        }

        if ( !getContext('isProxyHost') ) {
            var isProxyHost = ( typeof(req.headers.host) != 'undefined' && local.options.conf.server.scheme +'://'+ req.headers.host != local.options.conf.hostname || typeof(req.headers[':authority']) != 'undefined' && local.options.conf.server.scheme +'://'+ req.headers[':authority'] != local.options.conf.hostname  ) ? true : false;
            setContext('isProxyHost', isProxyHost);
        }

        //TODO - detect when to use swig
        var dir = null;
        if (local.options.template || self.templates) {
            dir = local.options.template.templates || self.templates;

            var swigOptions = {
                autoescape  : ( typeof(local.options.autoescape) != 'undefined') ? local.options.autoescape : false,
                // `memory` is no working yet ... advanced rendering setup required
                // cache       : (local.options.cacheless) ? false : 'memory'
                cache       : false
            };
            if (dir) {
                swigOptions.loader = swig.loaders.fs(dir);
            }
            if ( typeof(local._swigOptions) == 'undefined' ) {
                local._swigOptions = JSON.clone(swigOptions);
            }
            swig.setDefaults(swigOptions);
            // used for self.engine.compile(tpl, swigOptions)(data)
            swig.getOptions = function() {
                return local._swigOptions;
            }
            // preserve the same timezone as the system
            var defaultTZOffset = new Date().getTimezoneOffset();
            swig.setDefaultTZOffset(defaultTZOffset);

            self.engine = swig;
        }
    }

    this.renderWithoutLayout = function (data, displayToolbar) {

        // preventing multiple call of self.renderWithoutLayout() when controller is rendering from another required controller
        if (local.options.renderingStack.length > 1) {
            return false;
        }

        local.options.isWithoutLayout = true;

        self.render(data, displayToolbar);
    }

    /**
     * Render HTML templates : Swig is the default template engine
     *
     *  Extend default filters
     *  - length
     *
     * Avilable filters:
     *  - getWebroot()
     *  - getUrl()
     *
     *  N.B.: Filters can be extended through your `<project>/src/<bundle>/controllers/setup.js`
     *
     *
     * @param {object} userData
     * @param {boolean} [displayToolbar]
     * @param {object} [errOptions]
     * @returns {void}
     * */
    this.render = async function(userData, displayToolbar, errOptions) {
        var err = null;
        var isRenderingCustomError = (
                                    typeof(userData.isRenderingCustomError) != 'undefined'
                                    && /^true$/i.test(userData.isRenderingCustomError)
                                ) ? true : false;
        if (isRenderingCustomError)
            delete userData.isRenderingCustomError;

        var localOptions = (errOptions) ? errOptions : local.options;
        localOptions.renderingStack.push( self.name );
        // preventing multiple call of self.render() when controller is rendering from another required controller
        if ( localOptions.renderingStack.length > 1 && !isRenderingCustomError ) {
            return false
        }


        var data                = null
            , layout            = null
            , template          = null
            , file              = null
            , path              = null
            , plugin            = null
            , isWithoutLayout   = (localOptions.isWithoutLayout) ? true : false
        ;

        localOptions.debugMode = ( typeof(displayToolbar) == 'undefined' ) ? undefined : ( (/true/i.test(displayToolbar)) ? true : false ); // only active for dev env

        // specific override
        if (
            self.isCacheless()
            && typeof(local.req[ local.req.method.toLowerCase() ]) != 'undefined'
            && typeof(local.req[ local.req.method.toLowerCase() ].debug) != 'undefined'
        ) {
            if ( !/^(true|false)$/i.test(local.req[ local.req.method.toLowerCase() ].debug) ) {
                console.warn('Detected wrong value for `debug`: '+ local.req[ local.req.method.toLowerCase() ].debug);
                console.warn('Switching `debug` to `true` as `cacheless` mode is enabled');
                local.req[ local.req.method.toLowerCase() ].debug = true;
            }
            localOptions.debugMode = ( /^true$/i.test(local.req[ local.req.method.toLowerCase() ].debug) ) ? true : false;
        } else if (
            self.isCacheless()
            && hasViews()
            && !isWithoutLayout
            && localOptions.debugMode == undefined
        ) {
            localOptions.debugMode = true;
        } else if ( localOptions.debugMode == undefined  ) {
            localOptions.debugMode = self.isCacheless()
        }

        try {
            data = getData();

            if (!userData) {
                userData = { page: { view: {}}}
            } else if ( userData && !userData['page']) {

                if ( typeof(data['page']['data']) == 'undefined' )
                    data['page']['data'] = userData;
                else
                    data['page']['data'] = (isRenderingCustomError) ? userData : merge( userData, data['page']['data'] );
            } else {
                data = (isRenderingCustomError) ? userData : merge(userData, data)
            }

            template = localOptions.rule.replace('\@'+ localOptions.bundle, '');
            var localTemplateConf = localOptions.template;
            if ( isWithoutLayout ) {
                localTemplateConf = JSON.clone(localOptions.template);
                localTemplateConf.javascripts = new Collection(localTemplateConf.javascripts).find({ isCommon: false}, { isCommon: true, name: 'gina' });
                localTemplateConf.stylesheets = new Collection(localTemplateConf.stylesheets).find({ isCommon: false}, { isCommon: true, name: 'gina' });
            }
            setResources(localTemplateConf);
            // Allowing file & ext override
            if (
                typeof(local.req.routing.param.file) != 'undefined'
                && data.page.view.file !== local.req.routing.param.file
            ) {
                data.page.view.file = localOptions.file = local.req.routing.param.file
            }
            if (
                typeof(local.req.routing.param.ext) != 'undefined'
                && data.page.view.ext !== local.req.routing.param.ext
            ) {
                data.page.view.ext = localOptions.template.ext = local.req.routing.param.ext
            }

            file = (isRenderingCustomError) ? localOptions.file : data.page.view.file;

            // pre-compiling variables
            data = merge(data, getData()); // needed !!

            if  (typeof(data.page.data) == 'undefined' ) {
                data.page.data = {}
            }


            if (
                !local.options.isRenderingCustomError
                && typeof(data.page.data.status) != 'undefined'
                && !/^2/.test(data.page.data.status)
                && typeof(data.page.data.error) != 'undefined'
            ) {
                var statusCode = localOptions.conf.server.coreConfiguration.statusCodes;
                var errorObject = {
                    status: data.page.data.status,
                    //errors: msg.error || msg.errors || msg,
                    error: statusCodes[data.page.data.status] || msg.error || msg,
                    message: data.page.data.message || data.page.data.error,
                    stack: data.page.data.stack
                };
                if ( typeof(data.page.data.session) != 'undefined' ) {
                    errorObject.session = data.page.data.session;
                }
                self.throwError(errorObject);
                return;
            }

            // making path thru [namespace &] file
            if ( typeof(localOptions.namespace) != 'undefined' && localOptions.namespace ) {
                // excepted for custom paths
                if ( !/^(\.|\/|\\)/.test(file) ) {
                    var _ext = data.page.view.ext;
                    console.warn('file `'+ file +'` used in routing `'+ localOptions.rule +'` does not respect gina naming convention ! You should rename the file `'+ file + _ext +'` to `'+ ''+ file.replace(localOptions.namespace+'-', '') + _ext +'`');
                    console.warn('The reason you are getting this message is because your filename begeins with `<namespace>-`\n If you don\‘t want to rename, use template path like ./../'+ localOptions.namespace +'/'+file);
                    file = ''+ file.replace(localOptions.namespace+'-', '');
                }


                // means that rule name === namespace -> pointing to root namespace dir
                if (!file || file === localOptions.namespace) {
                    file = 'index'
                }
                path = (isRenderingCustomError) ? _(file) : _(localOptions.template.html +'/'+ localOptions.namespace + '/' + file)
            } else {
                if ( localOptions.path && !/(\?|\#)/.test(localOptions.path) ) {
                    path = _(localOptions.path);
                    var re = new RegExp( data.page.view.ext+'$');
                    if ( data.page.view.ext && re.test(data.page.view.file) ) {
                        data.page.view.path = path.replace('/'+ data.page.view.file, '');

                        path            = path.replace(re, '');
                        data.page.view.file  = data.page.view.file.replace(re, '');

                    } else {
                        data.page.view.path = path.replace('/'+ data.page.view.file, '');
                    }

                } else {
                     path = (!isRenderingCustomError && !/^(\.|\/|\\)/.test(file))
                            ? _(localOptions.template.html +'/'+ file)
                            : file
                }
            }

            if (data.page.view.ext && !new RegExp(data.page.view.ext+ '$').test(file) /** && hasViews() && fs.existsSync(_(path + data.page.view.ext, true))*/ ) {
                path += data.page.view.ext
            }

            data.page.view.path = path;

            var dic = {}, msg = '';
            for (var d in data.page) {
                dic['page.'+d] = data.page[d]
            }



            // please, do not start with a slashe when including...
            // ex.:
            //      /html/inc/_partial.html (BAD)
            //      html/inc/_partial.html (GOOD)
            //      ./html/namespace/page.html (GOOD)

            if ( !fs.existsSync(path) ) {
                msg = 'could not open "'+ path +'"' +
                            '\n1) The requested file does not exists in your templates/html (check your template directory). Can you find: '+path +
                            '\n2) Check the following rule in your `'+localOptions.conf.bundlePath+'/config/routing.json` and look around `param` to make sure that nothing is wrong with your file declaration: '+
                            '\n' + options.rule +':'+ JSON.stringify(options.conf.content.routing[options.rule], null, 4) +
                            '\n3) At this point, if you still have problems trying to run this portion of code, you can contact us telling us how to reproduce the bug.'
                            //'\n\r[ stack trace ] '
                            ;
                err = new ApiError(msg, 500);
                console.error(err.stack);
                self.throwError(err);
                return;
            }

            var isProxyHost = (
                typeof(local.req.headers.host) != 'undefined'
                    && localOptions.conf.server.scheme +'://'+ local.req.headers.host != localOptions.conf.hostname
                || typeof(local.req.headers[':authority']) != 'undefined'
                    && localOptions.conf.server.scheme +'://'+ local.req.headers[':authority'] != localOptions.conf.hostname
            ) ? true : false;
            // setup swig default filters
            var filters = SwigFilters({
                options     : JSON.clone(localOptions),
                isProxyHost : isProxyHost,
                throwError  : self.throwError,
                req         : local.req,
                res         : local.res
            });

            try {

                // Extends default `length` filter
                swig.setFilter('length', filters.length);



                // Allows you to get a bundle web root
                swig.setFilter('getWebroot', filters.getWebroot);

                swig.setFilter('getUrl', filters.getUrl);

            } catch (err) {
                // [ martin ]
                // i sent an email to [ paul@paularmstrongdesigns.com ] on 2014/08 to see if there is:
                // a way of retrieving swig compilation stack traces
                //var stack = __stack.splice(1).toString().split(',').join('\n');
                // -> no response...
                self.throwError(local.res, 500, new Error('template compilation exception encoutered: [ '+path+' ]\n'+(err.stack||err.message)));
                return;
            }



            var layoutPath              = null
                , assets                = null
                , mapping               = null
                , XHRData               = null
                , XHRView               = null
                , isDeferModeEnabled    = null
                , viewInfos             = null
                , filename              = null
                , isWithSwigLayout      = null
                , isUsingGinaLayout     = (!isWithoutLayout && typeof(localOptions.template.layout) != 'undefined' && fs.existsSync(local.options.template.layout)) ? true : false
            ;

            if ( isWithoutLayout || isUsingGinaLayout ) {
                layoutPath = (isWithoutLayout) ? localOptions.template.noLayout : localOptions.template.layout;
                // user layout override
                if ( isUsingGinaLayout && !isWithoutLayout ) {
                    layoutPath = localOptions.template.layout;
                }
                if (isWithoutLayout) {
                    data.page.view.layout = layoutPath;
                }
            } else { // without layout case

                // by default
                layoutPath = localOptions.template.layout;
                if ( !/^\//.test(layoutPath)) {
                    layoutPath = localOptions.template.templates +'/'+ layoutPath;
                }
                // default layout
                if (
                    !isWithoutLayout  && !fs.existsSync(layoutPath) && layoutPath == localOptions.template.templates +'/index.html'
                ) {
                    console.warn('Layout '+ local.options.template.layout +' not found, replacing with `nolayout`: '+ localOptions.template.noLayout);
                    layoutPath = localOptions.template.noLayout
                    isWithoutLayout = true;
                    data.page.view.layout = layoutPath;
                }
                // user defiend layout
                else if ( !isWithoutLayout && !fs.existsSync(layoutPath) ) {
                    isWithSwigLayout = true;
                    layoutPath = localOptions.template.noLayout;
                    data.page.view.layout = layoutPath;
                }
                // layout defiendd but not found
                else if (!fs.existsSync(layoutPath) ) {
                    err = new ApiError(options.bundle +' SuperController exception while trying to load your layout `'+ layoutPath +'`.\nIt seems like you have defined a layout, but gina could not locate the file.\nFor more informations, check your `config/templates.json` declaration around `'+ local.options.rule.replace(/\@(.*)/g, '') +'`', 500);
                    self.throwError(err);
                    return;
                }

            }


            var isLoadingPartial = false;
            try {
                assets  = {assets:"${assets}"};

                /**
                 * retrieve template & layout
                 * */
                var tpl = null;
                // tpl = fs.readFileSync(path).toString();
                // layout = fs.readFileSync(layoutPath).toString();

                await Promise.all([
                        readFile(layoutPath),
                        readFile(path)
                    ])
                    .then(([_layout, _tpl]) => {
                        layout  = _layout.toString();
                        tpl     = _tpl.toString();
                    })
                    .catch(error => {
                        console.error(error.message);
                        return;
                    });


                // mappin conf
                mapping = { filename: path };
                if (isRenderingCustomError) {
                    // TODO - Test if there is a block call `gina-error` in the layout & replace block name from tpl

                    if ( !/\{\%(\s+extends|extends)/.test(tpl) ) {
                        tpl = "\n{% extends '"+ layoutPath +"' %}\n" + tpl;
                    }
                    if (!/\{\% block content/.test(tpl)) {
                        // TODO - test if lyout has <body>
                        tpl = '{% block content %}<p>If you view this message you didn’t define a content block in your template.</p>{% endblock %}' + tpl;
                    }

                    tpl = tpl.replace(/\{\{ page\.content \}\}/g, '');
                }

                if ( isWithoutLayout || isWithSwigLayout) {
                    layout = tpl;
                } else if (isUsingGinaLayout) {
                    mapping = { filename: path };
                    if ( /(\{\{|\{\{\s+)page\.content/.test(layout) ) {

                        if ( /\{\%(\s+extends|extends)/.test(tpl) ) {
                            err = new Error('You cannot use at the same time `page.content` in your layout `'+ layoutPath +'` while calling `extends` from your page or content `'+ path +'`. You have to choose one or the other');
                            self.throwError(local.res, 500, err);
                            return
                        }
                        layout = layout.replace('{{ page.content }}', tpl);
                    } else {
                        layout = layout.replace(/\<\/body\>/i, '\t'+tpl+'\n</body>');
                    }

                } else {
                    tpl = tpl.replace('{{ page.view.layout }}', data.page.view.layout);
                    if (/\<\/body\>/i.test(layout)) {
                        layout = layout.replace(/\<\/body\>/i, '\t'+tpl+'\n</body>');
                    }
                        else {
                        layout += tpl;
                    }
                }

                // precompilation needed in case of `extends` or in order to display the toolbar
                if ( hasViews() && self.isCacheless() || /\{\%(\s+extends|extends)/.test(layout) ) {
                    layout = swig.compile(layout, mapping)(data);
                }
                //dic['page.content'] = layout;

            } catch(err) {
                err.stack = 'Exception, bad syntax or undefined data found: start investigating in '+ mapping.filename +'\n' + err.stack;
                self.throwError(local.res, 500, err);
                return
            }

            isLoadingPartial = (
                !/\<html/i.test(layout)
                || !/\<head/i.test(layout)
                || !/\<body/i.test(layout)
            ) ? true : false;

            // if (isLoadingPartial) {
            //     console.warn('----------------> loading partial `'+ path);
            // }

            isDeferModeEnabled = localOptions.template.javascriptsDeferEnabled || localOptions.conf.content.templates._common.javascriptsDeferEnabled || false;

            // iframe case - without HTML TAG
            if (!self.isXMLRequest() && !/\<html/.test(layout) ) {
                layout = '<html>\n\t<head></head>\n\t<body class="gina-iframe-body">\n\t\t'+ layout +'\n\t</body>\n</html>';
            }

            // adding stylesheets
            if (!isWithoutLayout && data.page.view.stylesheets && !/\{\{\s+(page\.view\.stylesheets)\s+\}\}/.test(layout) ) {
                layout = layout.replace(/\<\/head\>/i, '\n\t{{ page.view.stylesheets }}\n</head>')
            }

            if (hasViews() && isWithoutLayout) {
                // $.getScript(...)
                //var isProxyHost = ( typeof(local.req.headers.host) != 'undefined' && localOptions.conf.server.scheme +'://'+ local.req.headers.host != localOptions.conf.hostname || typeof(local.req.headers[':authority']) != 'undefined' && localOptions.conf.server.scheme +'://'+ local.req.headers[':authority'] != localOptions.conf.hostname  ) ? true : false;
                //var hostname = (isProxyHost) ? localOptions.conf.hostname.replace(/\:\d+$/, '') : localOptions.conf.hostname;



                var scripts = data.page.view.scripts;
                scripts = scripts.replace(/\s+\<script/g, '\n<script');

                if (!isProxyHost) {
                    var webroot = data.page.environment.webroot;
                    scripts = scripts.replace(/src\=\"\/(.*)\"/g, 'src="'+ webroot +'$1"');
                    //stylesheets = stylesheets.replace(/href\=\"\/(.*)\"/g, 'href="'+ webroot +'$1"')
                }

                // iframe case - without HTML TAG
                if (self.isXMLRequest() || !/\<html/.test(layout) ) {
                    layout += scripts;
                    //layout += stylesheets;
                }

            }

            // adding plugins
            // means that we don't want GFF context or we already have it loaded
            viewInfos = JSON.clone(data.page.view);
            if ( !isWithoutLayout )
                    viewInfos.assets = assets;

            if (
                hasViews() && self.isCacheless() && !isWithoutLayout
                && localOptions.debugMode
                ||
                hasViews() && self.isCacheless() && !isWithoutLayout
                && typeof(localOptions.debugMode) == 'undefined'
                ||
                hasViews() && localOptions.debugMode
            ) {

                layout = ''
                    // + '{%- set ginaDataInspector                    = JSON.clone(page) -%}'
                    + '{%- set ginaDataInspector                    = JSON.clone(page) -%}'
                    // + '{%- set ginaDataInspector                    = { view: {}, environment: { routing: {}}} -%}'
                    + '{%- set ginaDataInspector.view.assets        = {} -%}'
                    + '{%- set ginaDataInspector.view.scripts       = "ignored-by-toolbar" -%}'
                    + '{%- set ginaDataInspector.view.stylesheets   = "ignored-by-toolbar" -%}'
                    + layout
                ;

                plugin = '\t'
                    + '{# Gina Toolbar #}'
                    + '{%- set userDataInspector                    = JSON.clone(page) -%}'
                    // + '{%- set userDataInspector                    = { view: {}, environment: { routing: {}}} -%}'
                    + '{%- set userDataInspector.view.scripts       = "ignored-by-toolbar"  -%}'
                    + '{%- set userDataInspector.view.stylesheets   = "ignored-by-toolbar"  -%}'
                    + '{%- set userDataInspector.view.assets        = '+ JSON.stringify(assets) +' -%}'
                    + '{%- include "'+ getPath('gina').core +'/asset/plugin/dist/vendor/gina/html/toolbar.html" with { gina: ginaDataInspector, user: userDataInspector } -%}'// jshint ignore:line
                    + '{# END Gina Toolbar #}'
                ;


                if (isWithoutLayout && localOptions.debugMode || localOptions.debugMode ) {

                    if (self.isXMLRequest()) {
                        XHRData = '\t<input type="hidden" id="gina-without-layout-xhr-data" value="'+ encodeRFC5987ValueChars(JSON.stringify(data.page.data)) +'">\n\r';
                        XHRView = '\n<input type="hidden" id="gina-without-layout-xhr-view" value="'+ encodeRFC5987ValueChars(JSON.stringify(viewInfos)) +'">';
                        if ( /<\/body>/i.test(layout) ) {
                            layout = layout.replace(/<\/body>/i, XHRData + XHRView + '\n\t</body>');
                        } else {
                            // Popin case
                            // Fix added on 2023-01-25
                            layout += XHRData + XHRView + '\n\t'
                        }
                    }


                }

                if (self.isCacheless() || localOptions.debugMode ) {
                    layout = layout.replace(/<\/body>/i, plugin + '\n\t</body>');
                }

                // adding javascripts
                layout.replace('{{ page.view.scripts }}', '');
                // placed in the HEAD excepted when rendering a partial or when `isDeferModeEnabled` == true
                if (isLoadingPartial) {
                    layout += '\t{{ page.view.scripts }}';
                } else {
                    if ( isDeferModeEnabled  ) {
                        layout = layout.replace(/\<\/head\>/i, '\t{{ page.view.scripts }}\n\t</head>');
                    } else { // placed in the BODY
                        layout = layout.replace(/\<\/body\>/i, '\t{{ page.view.scripts }}\n</body>');
                    }
                }

                // ginaLoader cannot be deferred
                if ( !localOptions.template.javascriptsExcluded || localOptions.template.javascriptsExcluded != '**' ) {
                    layout = layout.replace(/\<\/head\>/i, '\t'+ localOptions.template.ginaLoader +'\n</head>');
                }

            } else if ( hasViews() && self.isCacheless() && self.isXMLRequest() ) {

                if (isWithoutLayout) {
                    delete data.page.view.scripts;
                    delete data.page.view.stylesheets;
                }
                // means that we don't want GFF context or we already have it loaded
                // viewInfos = JSON.clone(data.page.view);
                // if ( !isWithoutLayout )
                //     viewInfos.assets = assets;


                XHRData = '\n<input type="hidden" id="gina-without-layout-xhr-data" value="'+ encodeRFC5987ValueChars(JSON.stringify(data.page.data)) +'">';
                XHRView = '\n<input type="hidden" id="gina-without-layout-xhr-view" value="'+ encodeRFC5987ValueChars(JSON.stringify(viewInfos)) +'">';
                if ( /<\/body>/i.test(layout) ) {
                    layout = layout.replace(/<\/body>/i, XHRData + XHRView + '\n\t</body>');
                } else {
                    // Popin case
                    // Fix added on 2023-01-25
                    layout += XHRData + XHRView + '\n\t'
                }

                // layout += XHRData + XHRView;

            } else { // other envs like prod ...

                // adding javascripts
                // cleanup first
                layout.replace('{{ page.view.scripts }}', '');
                // placed in the HEAD excepted when rendering a partial or when `isDeferModeEnabled` == true
                // if (isLoadingPartial) {
                //     layout += '\t{{ page.view.scripts }}';
                // } else {
                //     if ( isDeferModeEnabled  ) {
                //         layout = layout.replace(/\<\/head\>/i, '\t{{ page.view.scripts }}\n\t</head>');
                //     } else { // placed in the BODY
                //         layout = layout.replace(/\<\/body\>/i, '\t{{ page.view.scripts }}\n</body>');
                //     }
                // }

                // // ginaLoader cannot be deferred
                // if ( !localOptions.template.javascriptsExcluded || localOptions.template.javascriptsExcluded != '**' ) {
                //     layout = layout.replace(/\<\/head\>/i, '\t'+ localOptions.template.ginaLoader +'\n</head>');
                // }

                // adding javascripts
                layout.replace('{{ page.view.scripts }}', '');
                if (isLoadingPartial) {
                    layout += '\t{{ page.view.scripts }}\n';
                    if ( !localOptions.template.javascriptsExcluded || localOptions.template.javascriptsExcluded != '**' ) {
                        layout += '\t'+ localOptions.template.ginaLoader +'\n';
                    }
                } else {
                    if ( isDeferModeEnabled && /\<\/head\>/i.test(layout) ) { // placed in the HEAD
                        layout = layout.replace(/\<\/head\>/i, '\t{{ page.view.scripts }}\n\t</head>');

                    } else { // placed in the BODY
                        layout = layout.replace(/\<\/body\>/i, '\t{{ page.view.scripts }}\n</body>');
                    }
                    // ginaLoader cannot be deferred
                    if ( !localOptions.template.javascriptsExcluded || localOptions.template.javascriptsExcluded != '**' ) {
                        layout = layout.replace(/\<\/head\>/i, '\t'+ localOptions.template.ginaLoader +'\n</head>');
                    }
                }
            }


            layout = whisper(dic, layout, /\{{ ([a-zA-Z.]+) \}}/g );
            dic['page.content'] = layout;
            /**
            // special case for template without layout in debug mode - dev only
            if ( hasViews() && localOptions.debugMode && self.isCacheless() && !/\{\# Gina Toolbar \#\}/.test(layout) ) {
                try {

                    layout = layout.replace(/<\/body>/i, plugin + '\n\t</body>');
                    layout = whisper(dic, layout, /\{{ ([a-zA-Z.]+) \}}/g );
                    //swig.invalidateCache();
                    layout = swig.compile(layout, mapping)(data);


                } catch (err) {
                    filename = localOptions.template.html;
                    filename += ( typeof(data.page.view.namespace) != 'undefined' && data.page.view.namespace != '' && new RegExp('^' + data.page.view.namespace +'-').test(data.page.view.file) ) ? '/' + data.page.view.namespace + data.page.view.file.split(data.page.view.namespace +'-').join('/') + ( (data.page.view.ext != '') ? data.page.view.ext: '' ) : '/' + data.page.view.file+ ( (data.page.view.ext != '') ? data.page.view.ext: '' );
                    self.throwError(local.res, 500, new Error('Compilation error encountered while trying to process template `'+ filename + '`\n'+(err.stack||err.message)));
                    return;
                }
            }
            else if (hasViews() && localOptions.debugMode && self.isCacheless()) {
                try {
                    //layout = whisper(dic, layout, /\{{ ([a-zA-Z.]+) \}}/g );
                    layout = swig.compile(layout, mapping)(data);
                } catch (err) {
                    filename = localOptions.template.html;
                    filename += ( typeof(data.page.view.namespace) != 'undefined' && data.page.view.namespace != '' && new RegExp('^' + data.page.view.namespace +'-').test(data.page.view.file) ) ? '/' + data.page.view.namespace + data.page.view.file.split(data.page.view.namespace +'-').join('/') + ( (data.page.view.ext != '') ? data.page.view.ext: '' ) : '/' + data.page.view.file+ ( (data.page.view.ext != '') ? data.page.view.ext: '' );
                    self.throwError(local.res, 500, new Error('Compilation error encountered while trying to process template `'+ filename + '`\n'+(err.stack||err.message)));
                    return;
                }
            }
            */


            // if ( !local.res.headersSent ) {
            if ( !headersSent() ) {
                local.res.statusCode = ( typeof(localOptions.conf.server.coreConfiguration.statusCodes[data.page.data.status])  != 'undefined' ) ? data.page.data.status : 200; // by default
                //catching errors
                if (
                    typeof(data.page.data.errno) != 'undefined' && /^2/.test(data.page.data.status) && typeof(localOptions.conf.server.coreConfiguration.statusCodes[data.page.data.status]) != 'undefined'
                    || typeof(data.page.data.status) != 'undefined' && !/^2/.test(data.page.data.status) && typeof(localOptions.conf.server.coreConfiguration.statusCodes[data.page.data.status]) != 'undefined'
                ) {

                    try {
                        local.res.statusMessage = localOptions.conf.server.coreConfiguration.statusCodes[data.page.data.status];
                    } catch (err){
                        local.res.statusCode    = 500;
                        local.res.statusMessage = err.stack||err.message||localOptions.conf.server.coreConfiguration.statusCodes[local.res.statusCode];
                    }
                }

                local.res.setHeader('content-type', localOptions.conf.server.coreConfiguration.mime['html'] + '; charset='+ localOptions.conf.encoding );

                try {

                    // escape special chars
                    var blacklistRe = new RegExp('[\<\>]', 'g');
                    // DO NOT REPLACE IT BY JSON.clone() !!!!

                    data.page.data = JSON.parse(JSON.stringify(data.page.data).replace(blacklistRe, '\$&'));

                } catch (err) {
                    filename = localOptions.template.html;
                    filename += ( typeof(data.page.view.namespace) != 'undefined' && data.page.view.namespace != '' && new RegExp('^' + data.page.view.namespace +'-').test(data.page.view.file) ) ? '/' + data.page.view.namespace + data.page.view.file.split(data.page.view.namespace +'-').join('/') + ( (data.page.view.ext != '') ? data.page.view.ext: '' ) : '/' + data.page.view.file+ ( (data.page.view.ext != '') ? data.page.view.ext: '' );
                    self.throwError(local.res, 500, new Error('Controller::render(...) compilation error encountered while trying to process template `'+ filename + '`\n' + (err.stack||err.message||err) ));
                    return;
                }


                // Only available for http/2.0 for now
                if ( !self.isXMLRequest() && /http\/2/.test(localOptions.conf.server.protocol) ) {
                    try {
                        // TODO - button in toolbar to empty url assets cache
                        if ( /**  self.isCacheless() ||*/ typeof(localOptions.template.assets) == 'undefined' || typeof(localOptions.template.assets[local.req.url]) == 'undefined' ) {
                            // assets string -> object
                            //assets = self.serverInstance.getAssets(localOptions.conf, layout.toString(), swig, data);
                            assets = self.serverInstance.getAssets(localOptions.conf, layout, swig, data);
                            localOptions.template.assets = JSON.parse(assets);
                        }

                        //  only for toolbar - TODO hasToolbar()
                        if (
                            self.isCacheless() && hasViews() && !isWithoutLayout
                            || hasViews() && localOptions.debugMode
                            || self.isCacheless() && hasViews() && self.isXMLRequest()
                        ) {
                            layout = layout.replace('{"assets":"${assets}"}', assets );
                        }

                    } catch (err) {
                        self.throwError(local.res, 500, new Error('Controller::render(...) calling getAssets(...) \n' + (err.stack||err.message||err) ));
                        return;
                    }
                }

                // Last compilation before rendering
                layout = swig.compile(layout, mapping)(data);

                if ( !headersSent() ) {
                    if ( local.options.isRenderingCustomError ) {
                        local.options.isRenderingCustomError = false;
                    }

                    local.res.end(layout);
                }

                console.info(local.req.method +' ['+local.res.statusCode +'] '+ local.req.url);

            } else if (typeof(local.next) != 'undefined') {
                // local.next();
                return local.next();
            } else {
                if ( typeof(local.req.params.errorObject) != 'undefined' ) {
                    self.throwError(local.req.params.errorObject);
                    return;
                }
                local.res.end('Unexpected controller error while trying to render.');
                return;
            }
        } catch (err) {
            self.throwError(local.res, 500, err);
            return;
        }
    }


    this.isXMLRequest = function() {
        return local.options.isXMLRequest;
    }

    this.isWithCredentials = function() {
        return ( /true/.test(local.options.withCredentials) ) ? true : false;
    }

    /**
     * Render JSON
     *
     * @param {object|string} jsonObj
     * @param {object} [req]
     * @param {object} [res]
     *
     * @callback {function} [next]
     *
     * */
    this.renderJSON = function(jsonObj) {

        // preventing multiple call of self.renderJSON() when controller is rendering from another required controller
        if (local.options.renderingStack.length > 1) {
            return false
        }
        if ( self.isProcessingError ) {
           return;
        }

        var request     = local.req;
        var response    = local.res;
        var next        = local.next || null;
        // var stream      = null;
        // if ( /http\/2/.test(local.options.conf.server.protocol) ) {
        //     stream = response.stream;
        // }

        if (!jsonObj) {
            jsonObj = {}
        }

        try {
            // just in case
            if ( typeof(jsonObj) == 'string') {
                jsonObj = JSON.parse(jsonObj)
            }

            // if( typeof(local.options) != "undefined" && typeof(local.options.charset) != "undefined" ){
            //     response.setHeader("charset", local.options.charset);
            // }


            //catching errors
            if (
                typeof(jsonObj.errno) != 'undefined' && response.statusCode == 200
                || typeof(jsonObj.status) != 'undefined' && jsonObj.status != 200 && typeof(local.options.conf.server.coreConfiguration.statusCodes[jsonObj.status]) != 'undefined'
            ) {

                try {
                    response.statusCode    = jsonObj.status;
                    response.statusMessage = local.options.conf.server.coreConfiguration.statusCodes[jsonObj.status];
                } catch (err){
                    response.statusCode    = 500;
                    response.statusMessage = err.stack;
                }
            }


            // Internet Explorer override
            if ( /msie/i.test(request.headers['user-agent']) ) {
                response.setHeader('content-type', 'text/plain' + '; charset='+ local.options.conf.encoding)
            } else {
                response.setHeader('content-type', local.options.conf.server.coreConfiguration.mime['json'] + '; charset='+ local.options.conf.encoding)
            }

            if ( !headersSent(response) ) {
                console.info(request.method +' ['+ response.statusCode +'] '+ request.url);

                if ( local.options.isXMLRequest && self.isWithCredentials() )  {

                    var data = JSON.stringify(jsonObj);
                    var len = 0;
                    // content length must be the right size !
                    if ( typeof(data) === 'string') {
                        len = Buffer.byteLength(data, 'utf8')
                    } else {
                        len = data.length
                    }

                    if (!headersSent(response))
                        response.setHeader("content-length", len);


                    // if (stream && !stream.destroyed) {
                    //     //stream.respond(header);
                    //     stream.end(data);
                    // } else {
                        response.write(data);

                        // required to close connection
                        setTimeout(function () {
                            response.end();
                            try {
                                response.headersSent = true;
                            } catch(err) {
                                // Ignoring warning
                                //console.warn(err);
                            }

                            if ( next ) {
                                next()
                            }
                        }, 200);



                        return // force completion
                    // }


                } else { // normal case
                    response.end(JSON.stringify(jsonObj));
                    if (!headersSent(response)) {
                        try {
                            response.headersSent = true;
                        } catch(err) {
                            // Ignoring warning
                            //console.warn(err);
                        }
                    }
                    if ( next ) {
                        return next()
                    }

                    return;
                }
            }
        } catch (err) {
            self.throwError(response, 500, err);
            return;
        }

    }


    this.renderTEXT = function(content) {

        // preventing multiple call of self.renderTEXT() when controller is rendering from another required controller
        if (local.options.renderingStack.length > 1) {
            return false
        }

        if ( typeof(content) != "string" ) {
            content = content.toString();
        }

        // if (typeof(options) != "undefined" && typeof(options.charset) !="undefined") {
        //     local.res.setHeader("charset", options.charset);
        // }
        if ( !local.res.getHeaders()['content-type'] ) {
            local.res.setHeader('content-type', 'text/plain' + '; charset='+ local.options.conf.encoding);
        }

        if ( !headersSent() ) {
            console.info(local.req.method +' ['+local.res.statusCode +'] '+ local.req.url);
            local.res.end(content);
            try {
                local.res.headersSent = true
            } catch(err) {
                // Ignoring warning
                //console.warn(err);
            }
        }
    }

    var parseDataObject = function(o, obj, override) {

        for (var i in o) {
            if ( o[i] !== null && typeof(o[i]) == 'object' || override && o[i] !== null && typeof(o[i]) == 'object' ) {
                parseDataObject(o[i], obj);
            } else if (o[i] == '_content_'){
                o[i] = obj
            }
        }

        return o
    }

    /**
     * Set data
     *
     * @param {string} nave -  variable name to set
     * @param {string|object} value - value to set
     * @param {boolean} [override]
     *
     * @returns {void}
     * */
    var set = function(name, value, override) {

        var override = ( typeof(override) != 'undefined' ) ? override : false;

        if ( typeof(name) == 'string' && /\./.test(name) ) {
            var keys        = name.split(/\./g)
                , newObj    = {}
                , str       = '{'
                , _count    = 0;

            for (var k = 0, len = keys.length; k<len; ++k) {
                str +=  "\""+ keys.splice(0,1)[0] + "\":{";

                ++_count;
                if (k == len-1) {
                    str = str.substr(0, str.length-1);
                    str += "\"_content_\"";
                    for (var c = 0; c<_count; ++c) {
                        str += "}"
                    }
                }
            }

            newObj = parseDataObject(JSON.parse(str), value, override);
            local.userData = merge(local.userData, newObj);

        } else if ( typeof(local.userData[name]) == 'undefined' ) {
            local.userData[name] = value.replace(/\\/g, '')
        }
    }

    /**
     * Get data
     *
     * @param {String} variable Data name to set
     * @returns {Object | String} data Data object or String
     * */
    var get = function(variable) {
        return local.userData[variable]
    }

    /**
     * Set resources
     *
     * @param {object} template - template configuration
     * */
    var setResources = function(viewConf) {
        if (!viewConf) {
            self.throwError(500, new Error('No views configuration found. Did you try to add views before using Controller::render(...) ? Try to run: gina view:add '+ options.conf.bundle +' @'+ options.conf.projectName));
            return;
        }

        var authority = ( typeof(local.req.headers['x-forwarded-proto']) != 'undefined' ) ? local.req.headers['x-forwarded-proto'] : local.options.conf.server.scheme;
        authority += '://'+ local.req.headers.host;
        var useWebroot = false;
        if ( !/^\/$/.test(local.options.conf.server.webroot) && local.options.conf.server.webroot.length > 0 && local.options.conf.hostname.replace(/\:\d+$/, '') == authority ) {
            useWebroot = true
        }

        var reURL = new RegExp('^'+ local.options.conf.server.webroot);

        var cssStr = '', jsStr = '';

        //Get css
        if( viewConf.stylesheets ) {
            cssStr  = getNodeRes('css', viewConf.stylesheets, useWebroot, reURL)
        }
        //Get js
        if( viewConf.javascripts ) {
            jsStr   = getNodeRes('js', viewConf.javascripts, useWebroot, reURL)
        }

        set('page.view.stylesheets', cssStr);
        set('page.view.scripts', jsStr);
    }

    /**
     * Get node resources
     *
     * @param {string} type
     * @param {string} resStr
     * @param {array} resArr
     * @param {object} resObj
     *
     * @returns {object} content
     *
     * @private
     * */
    var getNodeRes = function(type, resArr, useWebroot, reURL) {

        var r       = 0
            , rLen  = resArr.length
            , obj   = null
            , str   = ''
        ;
        switch(type){
            case 'css':
                for (; r < rLen; ++r) {
                    obj = resArr[r];
                    if (useWebroot && !reURL.test(obj.url) ) {
                        obj.url = local.options.conf.server.webroot + obj.url.substr(1);
                    }
                    // TODO - add support for cdn
                    if (!/\:\/\//.test(obj.url) ) {
                        obj.url = local.options.conf.hostname + obj.url;
                    }

                    if (obj.media)
                        str += '\n\t\t<link href="'+ obj.url +'" media="'+ obj.media +'" rel="'+ obj.rel +'" type="'+ obj.type +'">';
                    else
                        str += '\n\t\t<link href="'+ obj.url +'" rel="'+ obj.rel +'" type="'+ obj.type +'">';
                }

                return str;
            break;

            case 'js':
                var deferMode = (local.options.template.javascriptsDeferEnabled) ? ' defer' : '';

                for (; r < rLen; ++r) {
                    obj = resArr[r];
                    if (useWebroot && !reURL.test(obj.url) ) {
                        obj.url = local.options.conf.server.webroot + obj.url.substr(1);
                    }
                    // TODO - add support for cdn
                    if (!/\:\/\//.test(obj.url) ) {
                        obj.url = local.options.conf.hostname + obj.url;
                    }
                    str += '\n\t\t<script'+ deferMode +' type="'+ obj.type +'" src="'+ obj.url +'"></script>'
                }

                return str;
            break;
        }
    }

    /**
     * TODO -  SuperController.setMeta()
     * */
    // this.setMeta = function(metaName, metacontent) {
    //
    // }

    var getData = function() {
        return refToObj( local.userData )
    }


    var isValidURL = function(url){
        var re = /(http|ftp|https|sftp):\/\/[\w-]+(\.[\w-]+)+([\w.,@?^=%&amp;:\/~+#-]*[\w@?^=%&amp;\/~+#-])?/;
        return (re.test(url)) ? true : false
    }

    /**
     * Set method - Override current method
     * E.g.: in case of redirect, to force PUT to GET
     *
     * @param {string} requestMethod - GET, POST, PUT, DELETE
     */
    var localRequestMethod = null, localRequestMethodParams = null;
    this.setRequestMethod = function(requestMethod, conf) {
        // http/2 case
        if ( /http\/2/i.test(conf.server.protocolShort) ) {
            local.req.headers[':method'] = local.req.method.toUpperCase()
        }

        localRequestMethod = local.req.method = local.req.routing.method = requestMethod.toUpperCase();

        local.res.setHeader('access-control-allow-methods', localRequestMethod);

        return localRequestMethod;
    }

    this.getRequestMethod = function() {
        return localRequestMethod;
    }

    this.setRequestMethodParams = function(params) {
        localRequestMethodParams = local.req[local.req.method.toLowerCase()] = localRequestMethodParams = params
    }

    this.getRequestMethodParams = function() {
        return (localRequestMethodParams) ? localRequestMethodParams : local.req[local.req.method.toLowerCase()]
    }

    /**
     * isStaticRoute
     * Trying to determine if url is a `statics` ressource
     *
     * @param {string} url
     * @param {string} method
     *
     * @returns {boolean} isStaticRoute
     */
    var isStaticRoute = function(url, method, bundle, env, conf) {

        if ( !/get/i.test(method) ) {
            return false
        }

        // priority to statics - this portion of code has been duplicated to Server.js

        var staticsArr = conf[bundle][env].publicResources;
        var staticProps = {
            firstLevel          : '/' + url.split(/\//g)[1] + '/',
            // to be considered as a stativ content, url must content at least 2 caracters after last `.`: .js, .html are ok
            isStaticFilename    : /(\.([A-Za-z0-9]+){2}|\/)$/.test(url)
        };

        // handle resources from public with webroot in url
        if ( staticProps.isStaticFilename && conf[bundle][env].server.webroot != '/' && staticProps.firstLevel == conf[bundle][env].server.webroot ) {
            var matchedFirstInUrl = url.replace(conf[bundle][env].server.webroot, '').match(/[A-Za-z0-9_-]+\/?/);
            if ( matchedFirstInUrl && matchedFirstInUrl.length > 0 ) {
                staticProps.firstLevel = conf[bundle][env].server.webroot + matchedFirstInUrl[0]
            }
        }

        if (
            staticProps.isStaticFilename && staticsArr.indexOf(url) > -1
            || staticProps.isStaticFilename && staticsArr.indexOf( url.replace(url.substr(url.lastIndexOf('/')+1), '') ) > -1
            || staticProps.isStaticFilename && staticsArr.indexOf(staticProps.firstLevel) > -1
        ) {
            return true
        }

        return false;
    }

    /**
     * redirect
     *
     * TODO - improve redirect based on `lib.routing`
     * e.g.: self.redirect('project-get', { companyId: companyId, clientId: clientId, id: projectId }, true)
     *
     * How to avoid redirect inside popin context
     * N.B.: When you are in a popin context, add an `id` to your template tag so it can be ignored by the default PopinHandler
     *    E.g.: id="delete-link" -> <a href="#" id="delete-link">delete</a>
     *
     * You have to ways of using this method
     *
     * 1) Through routing.json
     * ---------------------
     * Allows you to redirect to an internal [ route ], an internal [ path ], or an external [ url ]
     *
     * For this to work you have to set in your routing.json a new route using  "param":
     * { "control": "redirect", "route": "one-valid-route" }
     * OR
     * { "control": "redirect", "url": "http://www.somedomain.com/page.html" }
     *
     * OR
     * { "control": "redirect", "path": "/", "ignoreWebRoot": true }
     *
     * OR
     * { "control": "redirect", "url": "http://home@public/production", "ignoreWebRoot": true }
     *
     * if you are free to use the redirection [ code ] of your choice, we've set it to 301 by default
     *
     *
     * 2) By calling this.redirect(rule, [ignoreWebRoot]):
     * ------------------------------------------------
     * where `this` is :
     *  - a Controller instance
     *
     * Where `rule` is either a string defining
     *  - the rule/route name
     *      => home (will use same bundle, same protocol scheme & same environment)
     *      => home@public (will use same protocol scheme & same environment)
     *      => http://home@public/dev (port style for more precision)
     *
     *  - an URI
     *      => /home
     *
     *  - a URL
     *      => http://www.google.com/
     *
     *
     * And Where `ignoreWebRoot` is an optional parameter used to ignore web root settings (Standalone mode or user set web root)
     * `ignoreWebRoot` behaves the like set to `false` by default
     *
     * N.B.: Gina will tell browsers not to cache redirections if you are using `dev` environement
     *
     * Trobleshouting:
     * ---------------
     *
     * Redirecting to a popin from the controller while posting from a form
     *      If this does not work, like doing a real redirect, this
     *      only means that the ID you are using for the form might be
     *      a duplicate one from the the main document !!!
     *
     * @param {object|string} req|rule|url - Request Object or Rule/Route name
     * @param {object|boolean} res|ignoreWebRoot - Response Object or Ignore WebRoot & start from domain root: /
     * @param {object} [params] TODO
     *
     * @callback [ next ]
     * */
    this.redirect = function(req, res, next) {
        var conf    = self.getConfig();
        var bundle  = conf.bundle;
        var env     = conf.env;
        var wroot   = conf.server.webroot;
        var ctx     = getContext('gina');
        var routing = ctx.config.getRouting();//conf.content.routing;
        var route   = '', rte = '';
        var ignoreWebRoot = null, isRelative = false;
        var originalUrl = null;
        var method = null;
        var originalMethod = null;

        if ( typeof(req) === 'string' ) {

            // if ( typeof(res) == 'undefined') {
            //     // nothing to do
            //     ignoreWebRoot = false
            // } else
            if (typeof(res) === 'string' || typeof(res) === 'number' || typeof(res) === 'boolean') {
                if ( /true|1/.test(res) ) {
                    ignoreWebRoot = true
                } else if ( /false|0/.test(res) ) {
                    ignoreWebRoot = false
                } else {
                    res = local.res;
                    var stack = __stack.splice(1).toString().split(',').join('\n');
                    self.throwError(res, 500, new Error('RedirectError: @param `ignoreWebRoot` must be a boolean\n' + stack));
                    return;
                }
            } else {
                // detect by default
                if (!ignoreWebRoot) {
                    var re = new RegExp('^'+wroot)
                    if ( re.test(req) ) {
                        ignoreWebRoot = true;
                    } else {
                        ignoreWebRoot = false;
                    }
                }

            }

            if ( req.substr(0,1) === '/') { // is relative (not checking if the URI is defined in the routing.json)
                // if (wroot.substr(wroot.length-1,1) == '/') {
                //     wroot = wroot.substr(wroot.length-1,1).replace('/', '')
                // }

                if ( /^\//.test(req) && !ignoreWebRoot )
                    req = req.substr(1);

                rte             = ( ignoreWebRoot != null && ignoreWebRoot  ) ? req : wroot + req;
                // cleaning url in case of ?param=value
                originalUrl     = rte;
                rte             = rte.replace(/\?(.*)/, '');

                req             = local.req;
                originalMethod = ( typeof(req.originalMethod) != 'undefined') ? req.originalMethod :  req.method;
                console.debug('[ BUNDLE ][ '+ local.options.conf.bundle +' ][ Controller ] trying to get route: ', rte, bundle, req.method);
                if ( !ignoreWebRoot || !isStaticRoute(rte, req.method, bundle, env, ctx.config.envConf) && !ignoreWebRoot ) {
                    req.routing     = lib.routing.getRouteByUrl(rte, bundle, req.method, req);
                    // try alternative method
                    if (!req.routing) {
                        req.routing     = lib.routing.getRouteByUrl(rte, bundle, 'GET', req, true); // true == override
                        // if still (!req.routing) { should throw a 404 }
                        if (req.routing) {
                            method = req.method = 'GET'
                        }
                    }

                    //route = route = req.routing.name;
                } else {
                    req.routing = {
                        param : {
                            url: rte
                        }
                    }
                }

                res             = local.res;
                next            = local.next;
                isRelative      = true;

                req.routing.param.path = rte
            } else if ( isValidURL(req) ) { // might be an URL
                rte             = req;
                originalUrl     = rte;
                rte             = rte.replace(/\?(.*)/, '');

                req     = local.req;
                res     = local.res;
                next    = local.next;

                req.routing.param.url = rte
            } else { // is by default a route name

                if ( /\@/.test(req) ) {
                    var rteArr = req.split(/\//);
                    if ( typeof(rteArr[1]) != 'undefined' )
                        env = rteArr[1];

                    rte = route = rteArr[0];
                    rteArr = rteArr[0].split(/\@/);

                    bundle = rteArr[1];

                } else {
                    rte = route = ( new RegExp('^/'+conf.bundle+'-$').test(req) ) ? req : wroot.match(/[^/]/g).join('') +'-'+ req;
                }


                req     = local.req;
                res     = local.res;
                next    = local.next;

                req.routing.param.route = routing[rte]
            }

        } else {
            route = req.routing.param.route;
        }

        if ( !originalMethod ) {
            originalMethod = ( typeof(req.originalMethod) != 'undefined') ? req.originalMethod :  req.method;
        }

        var path        = originalUrl || req.routing.param.path || '';
        var url         = req.routing.param.url;
        var code        = req.routing.param.code || 301;

        var keepParams  = req.routing.param['keep-params'] || false;

        var condition   = true; //set by default for url @ path redirect

        if (route) { // will go with route first
            condition = ( typeof(routing[route]) != 'undefined') ? true : false;
        }

        if ( !self.forward404Unless(condition, req, res) ) { // forward to 404 if bad route

            var isProxyHost = ( typeof(local.req.headers.host) != 'undefined' && local.options.conf.server.scheme +'://'+ local.req.headers.host != local.options.conf.hostname || typeof(local.req.headers[':authority']) != 'undefined' && local.options.conf.server.scheme +'://'+ local.req.headers[':authority'] != local.options.conf.hostname  ) ? true : false;
            var hostname = (isProxyHost) ? ctx.config.envConf[bundle][env].hostname.replace(/\:\d+$/, '') : ctx.config.envConf[bundle][env].hostname;

            // if ( !/\:\d+$/.test(req.headers.host) )
            //     hostname = hostname.replace(/\:\d+$/, '');

            if (route) { // will go with route first

                if ( /\,/.test(routing[route].url) ) {
                    var paths = routing[route].url.split(/\,/g);
                    path = (ignoreWebRoot) ? paths[0].replace(wroot, '') : paths[0];
                } else {
                    path = (ignoreWebRoot) ? routing[route].url.replace(wroot, '') : routing[route].url;
                }

                if (bundle != conf.bundle) {
                    path = hostname + path;
                }
            } else if (url && !path) {
                path = ( (/\:\/\//).test(url) ) ? url : req.scheme + '://' + url;

                if (/\@/.test(path)) {
                    path = lib.routing.getRoute(path).toUrl(ignoreWebRoot);
                }

            //} else if(path && typeof(isRelative) !=  'undefined') {
            // nothing to do, just ignoring
            //} else {
            } else if ( !path && typeof(isRelative) ==  'undefined' ) {

                path = hostname + path
                //path = local.req.headers.host + path
            }



            if (!headersSent()) {

                // backing up oldParams
                var oldParams = local.req[originalMethod.toLowerCase()];
                var requestParams = req[req.method.toLowerCase()] || {};
                if ( typeof(requestParams) != 'undefined' && typeof(requestParams.error) != 'undefined' ) {
                    var redirectError = requestParams.error;
                    self.throwError(requestParams.error);
                    return;
                }

                if (
                    !/GET/i.test(req.method)
                    ||
                    originalMethod && !/GET/i.test(originalMethod)
                ) { // trying to redirect using the wrong method ?

                    console.warn(new Error('Your are trying to redirect using the wrong method: `'+ req.method+'`.\nThis can often occur while redirecting from a controller to another controller or from a bundle to another.\nA redirection is not permitted in this scenario.\nD\'ont panic :)\nSwitching request method to `GET` method instead.\n').message);
                    method = local.req.method = self.setRequestMethod('GET', conf);
                    code = 303;
                }

                var inheritedDataIsNeeded = ( req.method.toLowerCase() == originalMethod.toLowerCase() ) ? false: true;

                // merging new & olds params
                requestParams = merge(requestParams, oldParams);
                // remove session to prevent reaching the 2000 chars limit
                // if you need the session, you need to find another way to retrieve while in the next route
                if ( typeof(requestParams.session) != 'undefined' ) {
                    delete requestParams.session;
                }
                if ( typeof(requestParams) != 'undefined' && requestParams.count() > 0 ) {
                    //if ( typeof(requestParams.error) != 'undefined' )

                    var inheritedData = null;
                    if ( /\?/.test(path) ) {
                        inheritedData = '&inheritedData='+ encodeRFC5987ValueChars(JSON.stringify(requestParams));
                    } else {
                        inheritedData = '?inheritedData='+ encodeRFC5987ValueChars(JSON.stringify(requestParams));
                    }

                    if ( inheritedData.length > 2000 ) {
                        var error = new ApiError('Controller::redirect(...) exceptions: `inheritedData` reached 2000 chars limit', 424);
                        self.throwError(error);
                        return;
                    }

                    // if redirecting from a xhrRequest
                    if ( self.isXMLRequest() ) {
                        // `requestParams` should be stored in the session to avoid passing datas in clear
                        var redirectObj = { location: path, isXhrRedirect: true };
                        if (requestParams.count() > 0)  {
                            var userSession = req.session.user || req.session;
                            if ( userSession && local.haltedRequestUrlResumed ) {
                                // will be reused for server.js on `case : 'GET'`
                                userSession.inheritedData = requestParams;
                            } else { // will be passed in clear
                                redirectObj.location += inheritedData;
                            }
                        }

                        self.renderJSON(redirectObj);
                        return;
                    }

                    if (inheritedDataIsNeeded) {
                        path += inheritedData;
                    }
                }

                var ext = 'html';
                res.setHeader('content-type', local.options.conf.server.coreConfiguration.mime[ext]);

                var resHeaderACAM = res.getHeader('access-control-allow-methods');
                if (
                    // typeof(local.res._headers) != 'undefined'
                    // && typeof(local.res._headers['access-control-allow-methods']) != 'undefined'
                    // && local.res._headers['access-control-allow-methods'] != req.method
                    typeof(resHeaderACAM) != 'undefined'
                    && resHeaderACAM != req.method
                    ||
                    !new RegExp(req.method, 'i').test( res.getHeader('access-control-allow-methods') )
                ) {
                    res.setHeader('access-control-allow-methods', req.method.toUpperCase() );
                }
                //path += '?query='+ JSON.stringify(self.getRequestMethodParams());
                local.req[req.method.toLowerCase()] = self.getRequestMethodParams() || {};

                var headInfos = {
                    'location': path
                };

                if (self.isCacheless()) {
                    res.writeHead(code, merge(headInfos, {
                        'cache-control': 'no-cache, no-store, must-revalidate', // preventing browsers from using cache
                        'pragma': 'no-cache',
                        'expires': '0'
                    }))
                } else {
                    res.writeHead(code, headInfos)
                }
                // in case of query from another bundle waiting for a response
                var redirectObject = JSON.stringify({ status: code, headers: headInfos });

                try {
                    res.end(redirectObject);
                    local.res.headersSent = true;// done for the render() method
                } catch(err){
                    // ignoring the warning
                    // console.warn(err.stack);
                }

                console.info(local.req.method.toUpperCase() +' ['+code+'] '+ path);

                if ( typeof(next) != 'undefined' )
                    next();
                else
                    return;
            }

        }
    }

    /**
     * Move files to assets dir
     *
     * @param {object} res
     * @param {collection} files
     *
     * @callback cb
     * @param {object} [err]
     * */
    var movefiles = function (i, res, files, cb) {
        if (!files.length || files.length == 0) {
            cb(false)
        } else {
            if ( fs.existsSync(files[i].target) ) new _(files[i].target).rmSync();

            var sourceStream = fs.createReadStream(files[i].source);
            var destinationStream = fs.createWriteStream(files[i].target);

            sourceStream
                .pipe(destinationStream)
                .on('error', function () {
                    var err = 'Error on SuperController::copyFile(...): Not found ' + files[i].source + ' or ' + files[i].target;
                    cb(err)
                })
                .on('close', function () {

                    try {
                        fs.unlinkSync(files[i].source);
                        files.splice(i, 1);
                    } catch (err) {
                        cb(err)
                    }

                    movefiles(i, res, files, cb)
                })
        }
    }

    this.getBundleStatus = function(req, res, next) {
        self.renderJSON({
            status: 200,
            isAlive: true,
            message: 'I am alive !'
        });
    }

    this.checkBundleStatus = async function(bundle, cb) {
        var opt     = self.getConfig('app').proxy[bundle];
        var route   = lib.routing.getRoute('bundle-status@'+bundle);
        opt.method  = 'GET';
        opt.path    = route.url;
        var response = { isAlive: false }, error = false;
        await util.promisify(self.query)(opt, {})
            .then( function onQueryResponse(_status) {
                response = _status
            });

        if (cb) {
            cb(error, response);
        } else {
            return response;
        }
    }

    /**
     * downloadFromURL
     * Download from an URL
     *  - attachment/inline
     *  OR
     *  - locally: `Controller.store(target, cb)` must be called to store on `onComplete` event
     *
     *      - Will trigger on frontend : Failed to load resource: Frame load interrupted
     *        because there is no `res.end()`: whitch is normal, we want to stay on the referrer page
     *
     *      - To avoid this, add to your download link the attribute `data-gina-link`
     *        This will convert the regular HTTP Request to an XML Request
     *
     * @param {string} url - eg.: https://upload.wikimedia.org/wikipedia/fr/2/2f/Firefox_Old_Logo.png
     * @param {object} [options]
     *
     *
     * */
    this.downloadFromURL = function(url, options) {

        var defaultOptions = {
            // file name i  you want to rename the file
            file: null,
            fileSize: null,
            // only if you want to store locally the downloaded file
            toLocalDir: false, // this option will disable attachment download
            // content-disposition (https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Disposition)
            contentDisposition: 'attachment',
            // content-type (https://developer.mozilla.org/en-US/docs/Web/Security/Securing_your_site/Configuring_server_MIME_types)
            contentType: 'application/octet-stream',

            agent: false,
            // set to false to ignore certificate verification
            rejectUnauthorized: true,
            //responseType: 'blob',
            port: 80,
            method: 'GET',
            keepAlive: true,
            headers: {}
        };

        var opt = ( typeof(options) != 'undefined' ) ? merge(options, defaultOptions) : defaultOptions;

        var requestOptions = {};
        for (var o in opt) {
            if ( !/(toLocalDir|contentDisposition|contentType|file)/.test(o) )
                requestOptions[o] = opt[o];
        }

        // defining protocol & scheme
        var protocol    = null;
        var scheme      = null;

        if ( /\:\/\//.test(url) ) {
            scheme = url.match(/^\w+\:/)[0];
            scheme = scheme.substr(0, scheme.length-1);

            if ( !/^http/.test(scheme) ) {
                self.throwError(local.res, 500, new Error('[ '+ scheme +' ] Scheme not supported. Ref.: `http` or `https` only'));
                return;
            }



        } else { // by default
            scheme = 'http';
        }

        requestOptions.scheme = scheme +':';

        //defining port
        var port = url.match(/\:\d+\//) || null;
        if ( port != null ) {
            port = port[0].substr(1, port[0].length-2);
            requestOptions.port = ~~port;
        }

        // defining hostname & path
        var parts = url.replace(new RegExp( scheme + '\:\/\/'), '').split(/\//g);
        requestOptions.host = parts[0].replace(/\:\d+/, '');
        requestOptions.path = '/' + parts.splice(1).join('/');


        // extension and mime
        var filename    = url.split(/\//g).pop();
        if (!filename) {
            self.throwError(local.res, 500, new Error('Filename not found in url: `'+ url +'`'));
            return;
        }


        if ( !/\.\w+$/.test(filename) ) {
            self.throwError(local.res, 500, new Error('[ '+ filename +' ] extension not found.'));
            return;
        }


        // filename renaming
        if (opt.file)
            filename = opt.file;

        if ( opt.contentDisposition == 'attachment') {
            opt.contentDisposition += '; filename=' + filename;
        }

        var ext             = filename.match(/\.\w+$/)[0].substr(1)
            , contentType   = null
            , tmp           = _(GINA_TMPDIR +'/'+ filename, true)
        ;

        if ( typeof(local.options.conf.server.coreConfiguration.mime[ext]) != 'undefined' ) {

            contentType = (opt.contentType != defaultOptions.contentType) ? opt.contentType : local.options.conf.server.coreConfiguration.mime[ext];

        } else { // extension not supported
            self.throwError(local.res, 500, new Error('[ '+ ext +' ] Extension not supported. Ref.: gina/core mime.types'));
            return;
        }

        // defining responseType
        requestOptions.headers['content-type'] = contentType;
        requestOptions.headers['content-disposition'] = opt.contentDisposition;

        var browser = require(''+ scheme);
        //console.debug('requestOptions: \n', JSON.stringify(requestOptions, null, 4));

        browser
            .get(requestOptions, function(response) {

                local.res.setHeader('content-type', contentType + '; charset='+ local.options.conf.encoding);
                local.res.setHeader('content-disposition', opt.contentDisposition);
                if (opt.fileSize) {
                    local.res.setHeader('content-length', opt.fileSize);
                }
                //local.res.setHeader('content-length', opt.fileSize);
                // local.res.setHeader('cache-control', 'must-revalidate');
                // local.res.setHeader('pragma', 'must-revalidate');


                response.pipe(local.res);
            })
            .on('error', function onDownloadError(err) {
                self.throwError(local.res, 500, err);
            });



        // Will trigger on frontend : Failed to load resource: Frame load interrupted
        // because there is no `res.end()`: whitch is normal, we want to stay on the referrer page

        // To avoid this, add to your download link the attribute `data-gina-link`
        // This will convert the regular HTTP Request to an XML Request
    }


    /**
     * Download to targeted filename.ext - Will create target if new
     * Use `cb` callback or `onComplete` event
     *
     *      - Will trigger on frontend : Failed to load resource: Frame load interrupted
     *        because there is no `res.end()`: whitch is normal, we want to stay on the referrer page
     *
     *      - To avoid this, add to your download link the attribute `data-gina-link`
     *        This will convert the regular HTTP Request to an XML Request
     *
     * @param {string} filename
     * @param {object} options
     **/
    this.downloadFromLocal = function(filename) {

        var file            = filename.split(/\//g).pop();
        var ext             = file.split(/\./g).pop()
            , contentType   = null
        ;

        if ( typeof(local.options.conf.server.coreConfiguration.mime[ext]) != 'undefined' ) {

            contentType = local.options.conf.server.coreConfiguration.mime[ext];
            local.res.setHeader('content-type', contentType);
            local.res.setHeader('content-disposition', 'attachment; filename=' + file);

            var filestream = fs.createReadStream(filename);
            filestream.pipe(local.res);

        } else { // extension not supported
            self.throwError(local.res, 500, new Error('[ '+ ext +' ] Extension not supported. Ref.: gina/core mime.types'));
            return;
        }
    }


    /**
     * Store file(s) to a targeted directory - Will create target if new
     * You only need to provide the destination path
     * Use `cb` callback or `onComplete` event
     *
     * @param {string} target is the upload dir destination
     * @param {array} [files]
     *
     * @callback [cb]
     *  @param {object} error
     *  @param {array} files
     *
     * @event
     *  @param {object} error
     *  @param {array} files
     *
     * */
    this.store = async function(target, files, cb) {


        var start = function(target, files, cb) {

            if (arguments.length == 2 && typeof(arguments[1]) == 'function' ) {
                var cb = arguments[1];
            }

            if ( typeof(files) == 'undefined' || typeof(files) == 'function' ) {
                files = local.req.files
            }

            var uploadedFiles = [];

            if ( typeof(files) == 'undefined' || files.count() == 0 ) {
                if (cb) {
                    cb(new Error('No file to upload'))
                } else {
                    self.emit('uploaded', new Error('No file to upload'))
                }
            } else {
                // saving files
                var uploadDir   = new _(target)
                    , list      = []
                    , i         = 0
                    , folder    = uploadDir.mkdirSync();

                if (folder instanceof Error) {
                    if (cb) {
                        cb(folder)
                    } else {
                        self.emit('uploaded', folder)
                    }
                } else {
                    // files list
                    var fileName = null;
                    for (var len = files.length; i < len; ++i ){

                        fileName = files[i].filename || files[i].originalFilename

                        list[i] = {
                            source: files[i].path,
                            target: _(uploadDir.toString() + '/' + fileName)
                        };

                        uploadedFiles[i] = {
                            file        : fileName,
                            filename    : list[i].target,
                            size        : files[i].size,
                            type        : files[i].type,
                            encoding    : files[i].encoding
                        };

                    }

                    movefiles(0, local.res, list, function (err) {
                        if (err) {
                            if (cb) {
                                cb(new Error('No file to upload'))
                            } else {
                                self.emit('uploaded', new Error('No file to upload'))
                            }
                        } else {
                            if (cb) {
                                cb(false, uploadedFiles)
                            } else {
                                self.emit('uploaded', false, uploadedFiles)
                            }
                        }
                    })
                }
            }
        }

        if ( typeof(cb) == 'undefined' ) {

            return {
                onComplete : function(cb){
                    self.on('uploaded', cb);
                    start(target, files)
                }
            }
        } else {
            start(target, files, cb)
        }
    }


    /**
     * Query
     *
     * Allows you to act as a proxy between your frontend and a 1/3 API
     * */
    function sha256(s) {
        return crypto.createHash('sha256').update(s).digest('base64');
    }
    local.query.data = {};
    local.query.options = {
        host    : undefined, // Must be an IP
        hostname  : undefined, // cname of the host e.g.: `www.google.com` or `localhost`
        path    : undefined, // e.g.: /test.html
        port    : 80, // #80 by default but can be 3000 or <bundle>@<project>/<environment>
        method  : 'GET', // POST | GET | PUT | DELETE
        keepAlive: true,
        auth: undefined, // use `"username:password"` for basic authentification

        // set to false to ignore certificate verification when requesting on https (443)
        // same as process.env.NODE_TLS_REJECT_UNAUTHORIZED = "1";
        rejectUnauthorized: true,

        headers: {
            'content-type': 'application/json',
            'content-length': local.query.data.length
        },
        agent   : false/**,
        checkServerIdentity: function(host, cert) {
            // Make sure the certificate is issued to the host we are connected to
            const err = tls.checkServerIdentity(host, cert);
            if (err) {
                return err;
            }

            // Pin the public key, similar to HPKP pin-sha25 pinning
            const pubkey256 = 'pL1+qb9HTMRZJmuC/bB/ZI9d302BYrrqiVuRyW+DGrU=';
            if (sha256(cert.pubkey) !== pubkey256) {
                const msg = 'Certificate verification error: ' +
                    `The public key of '${cert.subject.CN}' ` +
                    'does not match our pinned fingerprint';
                return new Error(msg);
            }

            // Pin the exact certificate, rather then the pub key
            const cert256 = '25:FE:39:32:D9:63:8C:8A:FC:A1:9A:29:87:' +
                'D8:3E:4C:1D:98:DB:71:E4:1A:48:03:98:EA:22:6A:BD:8B:93:16';
            if (cert.fingerprint256 !== cert256) {
                const msg = 'Certificate verification error: ' +
                    `The certificate of '${cert.subject.CN}' ` +
                    'does not match our pinned fingerprint';
                return new Error(msg);
            }

            // This loop is informational only.
            // Print the certificate and public key fingerprints of all certs in the
            // chain. Its common to pin the public key of the issuer on the public
            // internet, while pinning the public key of the service in sensitive
            // environments.
            do {
                console.debug('Subject Common Name:', cert.subject.CN);
                console.debug('  Certificate SHA256 fingerprint:', cert.fingerprint256);

                hash = crypto.createHash('sha256');
                console.debug('  Public key ping-sha256:', sha256(cert.pubkey));

                lastprint256 = cert.fingerprint256;
                cert = cert.issuerCertificate;
            } while (cert.fingerprint256 !== lastprint256);

        }*/

    };

    this.query = function() { // options, data, callback
        var err = null;
        var options = arguments[0];
        var data = arguments[1] || {};
        var callback = null;
        if ( typeof(arguments[arguments.length-1]) == 'function' ) {
            callback = arguments[arguments.length-1];
        }  else {
            data = arguments[arguments.length-1]
        }
        // preventing multiple call of self.query() when controller is rendering from another required controller
        if (
            typeof(local.options) != 'undefined'
            && typeof(local.options.renderingStack) != 'undefined'
            && local.options.renderingStack.length > 1
        ) {
            return false
        }
        self.isProcessingError = false; // by default

        var queryData           = {}
            , defaultOptions    = local.query.options
            , path              = options.path
            , browser           = null
        ;

        // options must be used as a copy in case of multiple calls of self.query(options, ...)
        options = merge(JSON.clone(options), defaultOptions);

        for (var o in options) {//cleaning
            if ( typeof(options[o]) == 'undefined' || options[o] == undefined) {
                delete options[o]
            }
        }

        if (self.isCacheless() || self.isLocalScope() ) {
            options.rejectUnauthorized = false;
        }

        if ( !options.host && !options.hostname ) {
            err = new Error('SuperController::query() needs at least a `host IP` or a `hostname`');
            if (callback) {
                return callback(err)
            }
            self.emit('query#complete', err)
        }


        if ( typeof(data) != 'undefined' &&  data.count() > 0) {

            queryData = '?';
            // TODO - if 'application/json' && method == (put|post)
            if ( ['put', 'post'].indexOf(options.method.toLowerCase()) >-1 && /(text\/plain|application\/json|application\/x\-www\-form)/i.test(options.headers['content-type']) ) {
                // replacing
                queryData = encodeRFC5987ValueChars(JSON.stringify(data))
                //queryData = JSON.stringify(data)

            } else {
                //Sample request.
                //options.path = '/updater/start?release={"version":"0.0.5-dev","url":"http://10.1.0.1:8080/project/bundle/repository/archive?ref=0.0.5-dev","date":1383669077141}&pid=46493';
                // do not alter the orignal data
                var tmpData = JSON.clone(data);
                for (let d in tmpData) {
                    if ( typeof(tmpData[d]) == 'object') {
                        tmpData[d] = JSON.stringify(tmpData[d]);
                    }
                    queryData += d + '=' + encodeRFC5987ValueChars(tmpData[d]) + '&';
                }

                queryData = queryData.substring(0, queryData.length-1);
                queryData = queryData.replace(/\s/g, '%20');

                options.path += queryData;
            }

        } else {
            queryData = ''
        }


        // Internet Explorer override
        if ( local.req != null && /msie/i.test(local.req.headers['user-agent']) ) {
            options.headers['content-type'] = 'text/plain';
        } else {
            options.headers['content-type'] = local.options.conf.server.coreConfiguration.mime['json'];
        }

        // if ( typeof(local.req.headers.cookie) == 'undefined' && typeof(local.res._headers['set-cookie']) != 'undefined' ) { // useful for CORS : forward cookies from the original request
        //     //options.headers.cookie = local.req.headers.cookie;
        //     var originalResponseCookies = local.res._headers['set-cookie'];
        //     options.headers.cookie = [];
        //     for (var c = 0, cLen = originalResponseCookies.length; c < cLen; ++c) {
        //         options.headers.cookie.push(originalResponseCookies[c])
        //     }
        // }

        //you need this, even when empty.
        options.headers['content-length'] = queryData.length;

        // adding gina headers
        if ( local.req != null && typeof(local.req.ginaHeaders) != 'undefined' ) {
            // gina form headers
            for (let h in local.req.ginaHeaders.form) {
                let k = h.substr(0,1).toUpperCase() + h.substr(1);
                options.headers['X-Gina-Form-' +  k ] = local.req.ginaHeaders.form[h];
            }
        }

        var ctx         = getContext()
            , protocol  = null
            , scheme    = null
        ;
        // cleanup options.path
        if (/\:\/\//.test(options.path)) {

            var hArr    = options.path.split(/^(https|http)\:\/\//);
            var domain  = hArr[1] +'://';
            var host    = hArr[2].split(/\//)[0];
            var port    = parseInt(host.split(/\:/)[1] || 80);

            options.port = port;
            options.host = domain + host.replace(':'+port, '');
            options.path = options.path
                                .replace(options.host, '')
                                .replace(':'+port, '');
        }

        // retrieve protocol & scheme: if empty, take the bundles protocol
        protocol    = options.protocol || ctx.gina.config.envConf[ctx.bundle][ctx.env].server.protocol;// bundle servers's protocol by default
        protocol    = protocol.match(/[.a-z 0-9]+/ig)[0];
        scheme      = options.scheme || ctx.gina.config.envConf[ctx.bundle][ctx.env].server.scheme;// bundle servers's scheme by default
        scheme      = scheme.match(/[a-z 0-9]+/ig)[0];
        // retrieve credentials
        if ( typeof(options.ca) == 'undefined' || ! options.ca ) {
            options.ca  = ctx.gina.config.envConf[ctx.bundle][ctx.env].server.credentials.ca;
        }

        //retrieving dynamic host, hostname & port
        if ( /\@/.test(options.hostname) ) {

            var bundle = ( options.hostname.replace(/(.*)\:\/\//, '') ).split(/\@/)[0];

            // No shorcut possible because conf.hostname might differ from user inputs
            options.host        = ctx.gina.config.envConf[bundle][ctx.env].host.replace(/(.*)\:\/\//, '').replace(/\:\d+/, '');
            options.hostname    = ctx.gina.config.envConf[bundle][ctx.env].hostname;
            options.port        = ctx.gina.config.envConf[bundle][ctx.env].server.port;

            options.protocol    = ctx.gina.config.envConf[bundle][ctx.env].server.protocol;
            options.scheme      = ctx.gina.config.envConf[bundle][ctx.env].server.scheme;

            // retrieve credentials
            if ( typeof(options.ca) == 'undefined' || ! options.ca ) {
                options.ca = ctx.gina.config.envConf[bundle][ctx.env].server.credentials.ca;
            }

            // might be != from the bundle requesting
            //options.protocol    = ctx.gina.config.envConf[bundle][ctx.env].content.settings.server.protocol || ctx.gina.config.envConf[bundle][ctx.env].server.protocol;
            //options.scheme    = ctx.gina.config.envConf[bundle][ctx.env].content.settings.server.scheme || ctx.gina.config.envConf[bundle][ctx.env].server.scheme;
        }

        if ( typeof(options.protocol) == 'undefined' ) {
            options.protocol = protocol
        }
        if ( typeof(options.scheme) == 'undefined' ) {
            options.scheme = scheme
        }




        // reformating scheme
        if( !/\:$/.test(options.scheme) )
            options.scheme += ':';

        try {
            options.queryData = queryData;
            var protocolVersion = ~~options.protocol.match(/\/(.*)$/)[1].replace(/\.\d+/, '');
            var httpLib =  options.protocol.match(/^(.*)\//)[1] + ( (protocolVersion >= 2) ? protocolVersion : '' );
            if ( !/http2/.test(httpLib) && /https/.test(options.scheme) ) {
                httpLib += 's';
            }

            browser = require(''+ httpLib);

            if ( /http2/.test(httpLib) ) {
                return handleHTTP2ClientRequest(browser, options, callback);
            } else {
                return handleHTTP1ClientRequest(browser, options, callback);
            }


        } catch(err) {
            if (callback) {
                return callback(err)
            }
            self.emit('query#complete', err)
        }

    }

    var handleHTTP1ClientRequest = function(browser, options, callback) {

        var altOpt = JSON.clone(options);

        altOpt.protocol = options.scheme;
        altOpt.hostname = options.host;
        altOpt.port     = options.port;
        if ( typeof(altOpt.encKey) != 'undefined' ) {
            try {
                altOpt.encKey = fs.readFileSync(options.encKey);
            } catch(err) {
                self.emit('query#complete', err);
            }

        } else {
            console.warn('[ CONTROLLER ][ HTTP/1.0#query ] options.encKey not found !');
        }

        if ( typeof(altOpt.encCert) != 'undefined' ) {
            try {
                altOpt.encCert = fs.readFileSync(options.encCert);
            } catch(err) {
                self.emit('query#complete', err);
            }

        } else {
            console.warn('[ CONTROLLER ][ HTTP/1.0#query ] options.encCert not found !');
        }

        altOpt.agent = new browser.Agent(altOpt);

        var req = browser.request(altOpt, function(res) {

            res.setEncoding('utf8');

            // upgrade response headers to handler
            if ( typeof(res.headers['access-control-allow-credentials']) != 'undefined' )
                local.options.withCredentials = res.headers['access-control-allow-credentials'];


            var data = '', err = false;

            res.on('data', function onData (chunk) {
                data += chunk;
            });

            res.on('end', function onEnd(err) {


                // exceptions filter
                if ( typeof(data) == 'string' && /^Unknown ALPN Protocol/.test(data) ) {
                    err = {
                        status: 500,
                        error: new Error(data)
                    };

                    if ( typeof(callback) != 'undefined' ) {
                        callback(err)
                    } else {
                        self.emit('query#complete', err)
                    }

                    return
                }

                //Only when needed.
                if ( typeof(callback) != 'undefined' ) {
                    if ( typeof(data) == 'string' && /^(\{|%7B|\[{)|\[\]/.test(data) ) {
                        try {
                            data = JSON.parse(data)
                        } catch (err) {
                            data = {
                                status    : 500,
                                error     : err
                            };
                            console.error(err);
                        }
                    }

                    try {
                        if ( data.status && !/^2/.test(data.status) && typeof(local.options.conf.server.coreConfiguration.statusCodes[data.status]) != 'undefined' ) {
                            self.throwError(data);
                            return;
                        } else {
                            callback( false, data );
                            return;
                        }
                    } catch (e) {
                        var infos = local.options, controllerName = infos.controller.substr(infos.controller.lastIndexOf('/'));
                        var msg = 'Controller Query Exception while catching back.\nBundle: '+ infos.bundle +'\nController File: /controllers'+ controllerName +'\nControl: this.'+ infos.control +'(...)\n\r' + e.stack;
                        var exception = new Error(msg);
                        exception.status = 500;
                        self.throwError(exception);
                        return;
                    }

                } else {
                    if ( typeof(data) == 'string' && /^(\{|%7B|\[{)|\[\]/.test(data) ) {
                        try {
                            data = JSON.parse(data)
                        } catch (err) {
                            data = {
                                status    : 500,
                                error     : data
                            }
                            self.emit('query#complete', data)
                        }
                    }

                    if ( data.status && !/^2/.test(data.status) && typeof(local.options.conf.server.coreConfiguration.statusCodes[data.status]) != 'undefined' ) {
                        self.emit('query#complete', data)
                    } else {
                        self.emit('query#complete', false, data)
                    }
                }
            })
        });


        //starting from from >0.10.15
        req.on('error', function onError(err) {


            if (
                typeof(err.code) != 'undefined' && /ECONNREFUSED|ECONNRESET/.test(err.code)
                || typeof(err.cause) != 'undefined' && typeof(err.cause.code) != 'undefined' &&  /ECONNREFUSED|ECONNRESET/.test(err.cause.code)
            ) {

                var port = getContext('gina').ports[options.protocol][options.scheme.replace(/\:/, '')][ options.port ];//err.port || err.cause.port
                if ( typeof(port) != 'undefined' ) {
                    err.accessPoint = port;
                    err.message = '`Controller::query()` could not connect to [ ' + err.accessPoint + ' ] using port '+options.port+'.\n';
                }
            }


            console.error(err.stack||err.message);
            // you can get here if :
            //  - you are trying to query using: `enctype="multipart/form-data"`
            //  -
            if ( typeof(callback) != 'undefined' ) {

                callback(err)

            } else {
                var error = {
                    status    : 500,
                    error     : err.stack || err.message
                };

                self.emit('query#complete', error)
            }
        });


        if (req) { // don't touch this please
            if (req.write) req.write(options.queryData);
            if (req.end) req.end();
        }

        return {
            onComplete  : function(cb) {
                self.once('query#complete', function(err, data){

                    if ( typeof(data) == 'string' && /^(\{|%7B|\[{)|\[\]/.test(data) ) {
                        try {
                            data = JSON.parse(data)
                        } catch (err) {
                            data = {
                                status    : 500,
                                error     : data
                            }
                        }
                    }

                    try {
                        if ( data.status && !/^2/.test(data.status) && typeof(local.options.conf.server.coreConfiguration.statusCodes[data.status]) != 'undefined') {
                            cb(data)
                        } else {
                            cb(err, data)
                        }
                    } catch (e) {
                        var infos = local.options, controllerName = infos.controller.substr(infos.controller.lastIndexOf('/'));
                        var msg = 'Controller Query Exception while catching back.\nBundle: '+ infos.bundle +'\nController File: /controllers'+ controllerName +'\nControl: this.'+ infos.control +'(...)\n\r' + e.stack;
                        var exception = new Error(msg);
                        exception.status = 500;
                        self.throwError(exception);
                        return;
                    }
                })
            }

        }
    }

    var handleHTTP2ClientRequest = function(browser, options, callback) {

        //cleanup
        options[':authority'] = options.hostname;

        delete options.host;

        if ( typeof(options[':path']) == 'undefined' ) {
            options[':path'] = options.path;
            delete options.path;
        }
        if ( typeof(options[':method']) == 'undefined' ) {
            options[':method'] = options.method.toUpperCase();
            delete options.method;
        }

        // only if binary !!
        // if ( typeof(options['content-length']) == 'undefined' ) {
        //     options['content-length'] = options.headers['content-length'] ;
        //     delete options.headers['content-length'];
        // }
        // if ( typeof(options['content-type']) == 'undefined' ) {
        //     options['content-type'] = options.headers['content-type'] ;
        //     delete options.headers['content-type'];
        // }

        if ( typeof(options[':scheme']) == 'undefined' ) {
            options[':scheme'] = options.scheme ;
        }

        if ( typeof(options.ca) != 'undefined' ) {
            try {
                options.ca = fs.readFileSync(options.ca);
            } catch(err) {
                if ( typeof(callback) != 'undefined' ) {
                    callback(err)
                } else {
                    self.emit('query#complete', err);
                }

                return;
            }

        } else {
            console.warn('[ CONTROLLER ][ HTTP/2.0#query ] options.ca not found !');
        }


        var body = Buffer.from(options.queryData);
        options.headers['content-length'] = body.length;
        delete options.queryData;



        const client = browser.connect(options.hostname, options);


        const {
            HTTP2_HEADER_PROTOCOL,
            HTTP2_HEADER_SCHEME,
            HTTP2_HEADER_AUTHORITY,
            HTTP2_HEADER_PATH,
            HTTP2_HEADER_METHOD,
            HTTP2_HEADER_STATUS
          } = browser.constants;


        if ( typeof(local.req.headers['x-requested-with']) != 'undefined' ) {
            options.headers['x-requested-with'] = local.req.headers['x-requested-with']
        }

        if ( typeof(local.req.headers['access-control-allow-credentials']) != 'undefined' ) {
            options.headers['access-control-allow-credentials'] = local.req.headers['access-control-allow-credentials']
        }

        if ( typeof(local.req.headers['content-type']) != 'undefined' && local.req.headers['content-type'] != options.headers['content-type'] ) {
            options.headers['content-type'] = local.req.headers['content-type']
        }

        var headers = merge({
            [HTTP2_HEADER_METHOD]: options[':method'],
            [HTTP2_HEADER_PATH]: options[':path']
        }, options.headers);

        // merging with user options
        for (var o in options) {
            if (!/^\:/.test(o) && !/headers/.test(o) && typeof(headers[o]) == 'undefined' ) {
                headers[o] = options[o]
            }
        }

        /**
         * sessionOptions
         * endStream <boolean> true if the Http2Stream writable side should be closed initially, such as when sending a GET request that should not expect a payload body.
         * exclusive <boolean> When true and parent identifies a parent Stream, the created stream is made the sole direct dependency of the parent, with all other existing dependents made a dependent of the newly created stream. Default: false.
         * parent <number> Specifies the numeric identifier of a stream the newly created stream is dependent on.
         * weight <number> Specifies the relative dependency of a stream in relation to other streams with the same parent. The value is a number between 1 and 256 (inclusive).
         * waitForTrailers <boolean> When true, the Http2Stream will emit the 'wantTrailers' event after the final DATA frame has been sent.
         */
        var sessionOptions = {}, endStream = true;
        if ( body.length > 0 || options.headers['x-requested-with'] ) {
            endStream = false;
            sessionOptions.endStream = endStream;
        }


        client.on('error', (error) => {

            console.error( '`'+ options[':path']+ '` : '+ error.stack||error.message);
            if (
                typeof(error.cause) != 'undefined' && typeof(error.cause.code) != 'undefined' && /ECONNREFUSED|ECONNRESET/.test(error.cause.code)
                || /ECONNREFUSED|ECONNRESET/.test(error.code)
            ) {

                var port = getContext('gina').ports[options.protocol][options.scheme.replace(/\:/, '')][ options.port ];
                if ( typeof(port) != 'undefined' ) {
                    error.accessPoint = port;
                    error.message = 'Could not connect to [ ' + error.accessPoint + ' ].\nThe `'+port.split(/\@/)[0]+'` bundle is offline or unreachable.\n';
                }
            }
            self.throwError(error);
            return;
        });

        client.on('connect', () => {

            var req = client.request( headers, sessionOptions );


            // req.on('response', function onQueryResponse(headers, flags) {
            //     for (const name in headers) {
            //         console.debug(`${name}: ${headers[name]}`);
            //     }
            // });

            req.setEncoding('utf8');
            var data = '';
            req.on('data', function onQueryDataChunk(chunk) {
                data += chunk;
            });

            req.on('error', function onQueryError(error) {

                if (
                    typeof(error.cause) != 'undefined' && typeof(error.cause.code) != 'undefined' && /ECONNREFUSED|ECONNRESET/.test(error.cause.code)
                    || /ECONNREFUSED|ECONNRESET/.test(error.code)
                ) {

                    var port = getContext('gina').ports[options.protocol][options.scheme.replace(/\:/, '')][ options.port ];
                    if ( typeof(port) != 'undefined' ) {
                        error.accessPoint = port;
                        error.message = 'Could not connect to [ ' + error.accessPoint + ' ].\n' + error.message;
                    }
                }


                console.error(error.stack||error.message);
                // you can get here if :
                //  - you are trying to query using: `enctype="multipart/form-data"`
                //  - server responded with an error
                if ( typeof(callback) != 'undefined' ) {
                    callback(error);
                } else {
                    error = {
                        status    : 500,
                        error     : error.stack ||error.message
                    };

                    self.emit('query#complete', error)
                }

                return;
            });

            req.on('end', function onEnd() {

                // exceptions filter
                if ( typeof(data) == 'string' && /^Unknown ALPN Protocol/.test(data) ) {
                    var err = {
                        status: 500,
                        error: new Error(data)
                    };

                    if ( typeof(callback) != 'undefined' ) {
                        callback(err)
                    } else {
                        self.emit('query#complete', err)
                    }

                    return
                }

                //Only when needed.
                if ( typeof(callback) != 'undefined' ) {
                    if ( typeof(data) == 'string' && /^(\{|%7B|\[{)|\[\]/.test(data) ) {
                        try {
                            data = JSON.parse(data);
                            // just in case
                            if ( typeof(data.status) == 'undefined' ) {
                                var currentRule = local.options.rule || local.req.routing.rule;
                                console.warn( '['+ currentRule +'] ' + 'Response status code is `undefined`: switching to `200`');
                                data.status = 200;
                            }
                        } catch (err) {
                            data = {
                                status    : 500,
                                error     : err
                            }
                            console.error(err);
                        }
                    } else if ( !data && this.aborted && this.destroyed) {
                        data = {
                            status    : 500,
                            error     : new Error('request aborted')
                        }
                    }
                    //console.debug(options[':method']+ ' ['+ (data.status || 200) +'] '+ options[':path']);
                    try {
                        // intercepting fallback redirect
                        if ( data.status && /^3/.test(data.status) && typeof(data.headers) != 'undefined' ) {
                            local.res.writeHead(data.status, data.headers);
                            return local.res.end();
                        }

                        if ( data.status && !/^2/.test(data.status) && typeof(local.options.conf.server.coreConfiguration.statusCodes[data.status]) != 'undefined' ) {
                              if ( /^5/.test(data.status)  ) {
                                  return callback(data)
                              } else {
                                  self.throwError(data);
                                  return;
                              }
                        } else {
                            // required when control is used in an halted state
                            // Ref.: resumeRequest()
                            if ( self && self.isHaltedRequest() && typeof(local.onHaltedRequestResumed) != 'undefined' ) {
                                local.onHaltedRequestResumed(false);
                            }
                            return callback( false, data )
                        }

                    } catch (e) {
                        var infos = local.options, controllerName = infos.controller.substr(infos.controller.lastIndexOf('/'));
                        var msg = 'Controller Query Exception while catching back.\nBundle: '+ infos.bundle +'\nController File: /controllers'+ controllerName +'\nControl: this.'+ infos.control +'(...)\n\r' + e.stack;
                        var exception = new Error(msg);
                        exception.status = 500;
                        self.throwError(exception);
                        return;
                    }

                } else {
                    if ( typeof(data) == 'string' && /^(\{|%7B|\[{)|\[\]/.test(data) ) {
                        try {
                            data = JSON.parse(data)
                        } catch (e) {
                            data = {
                                status    : 500,
                                error     : data
                            }
                            self.emit('query#complete', data)
                        }
                    }

                    // intercepting fallback redirect
                    if ( data.status && /^3/.test(data.status) && typeof(data.headers) != 'undefined' ) {
                        self.removeAllListeners(['query#complete']);
                        local.res.writeHead(data.status, data.headers);
                        return local.res.end();
                    }

                    if ( data.status && !/^2/.test(data.status) && typeof(local.options.conf.server.coreConfiguration.statusCodes[data.status]) != 'undefined' ) {
                        self.emit('query#complete', data)
                    } else {
                        // required when control is used in an halted state
                        // Ref.: resumeRequest()
                        if ( self.isHaltedRequest() && typeof(local.onHaltedRequestResumed) != 'undefined' ) {
                            local.onHaltedRequestResumed(false);
                        }
                        self.emit('query#complete', false, data)
                    }
                }

                client.close();
            });

            if (!endStream) {
                req.end(body);
            }
        });


        return {
            onComplete  : function(cb) {

                self.once('query#complete', function(err, data){

                    if ( typeof(data) == 'string' && /^(\{|%7B|\[{)|\[\]/.test(data) ) {
                        try {
                            data = JSON.parse(data)
                        } catch (err) {
                            data = {
                                status    : 500,
                                error     : data
                            }
                        }
                    }

                    try {
                        if ( data.status && !/^2/.test(data.status) && typeof(local.options.conf.server.coreConfiguration.statusCodes[data.status]) != 'undefined') {
                            cb(data)
                        } else {
                            // required when control is used in an halted state
                            // Ref.: resumeRequest()
                            if ( self.isHaltedRequest() && typeof(local.onHaltedRequestResumed) != 'undefined' ) {
                                local.onHaltedRequestResumed(err);
                            }

                            cb(err, data)
                        }
                    } catch (e) {
                        var infos = local.options, controllerName = infos.controller.substr(infos.controller.lastIndexOf('/'));
                        var msg = 'Controller Query Exception while catching back.\nBundle: '+ infos.bundle +'\nController File: /controllers'+ controllerName +'\nControl: this.'+ infos.control +'(...)\n\r' + e.stack;
                        var exception = new Error(msg);
                        exception.status = 500;
                        self.throwError(exception);
                        return;
                    }
                })
            }
        }
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
     * @returns {string | boolean} err
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
            // Clone
            var params = JSON.clone(req.params);
            switch( req.method.toLowerCase() ) {
                case 'get':
                    params = merge(params, req.get, true);
                    break;

                case 'post':
                    params = merge(params, req.post, true);
                    break;

                case 'put':
                    params = merge(params, req.put, true);
                    break;

                case 'delete':
                    params = merge(params, req.delete, true);
                    break;
            }

            return params
        }

        req.getParam = function(name) {

            var param   = null;
            switch( req.method.toLowerCase() ) {
                case 'get':
                    param = req.get[name];
                    break;

                case 'post':
                    param = req.post[name];
                    break;

                case 'put':
                    param= req.put[name];
                    break;

                case 'delete':
                    param = req.delete[name];
                    break;
            }

            return param
        }
    }

    /**
     * Forward request
     * Allowing x-bundle forward
     * Attention: this is a work in progres, do not use it yet
     *
     * @param {object} req
     * @param {object} res
     * @param {callback} next
     * @returns
     */
    this.forward = function(req, res, next) {
        var route   = req.routing;
        if ( typeof(route.param.url) == 'undefined' || /^(null|\s*)$/.test(route.param.url) ) {
            self.throwError( new Error('`route.param.url` must be defiend in your route: `'+ route.rule +'`') );
            return;
        }

        var param = {};
        for (let p in route.param) {
            if ( /^(url|urlIndex|control|file|title|bundle|project|hostname|port|path|method)$/.test(p) ) {
                continue;
            }
            param[p] = route.param[p]
        }
        var routeObj = null;
        if ( typeof(route.param.urlIndex) != 'undefined' ) {
            routeObj = lib.routing.getRoute(route.param.url, param, route.param.urlIndex);
        } else {
            routeObj = lib.routing.getRoute(route.param.url, param);
        }
        var ca = self.getConfig('settings').server.credentials.ca;
        var hostname = null, port = null, path = null;
        // by default
        var project = local.options.conf.projectName;
        if ( typeof(route.param.project) != 'undefined' && /^(null|\s*)$/.test(route.param.project) ) {
            project = route.param.project;
        } // TODO - add support for project pointer : getContext('gina').projects[project]
        if (/\@(.*)$/.test(route.param.url)) {
            var targetedBundle = route.param.url.substr(route.param.url.lastIndexOf('@')+1);
            hostname    = targetedBundle +'@'+ project;
            port        = hostname;
            var webroot = getContext('gina').config.envConf[targetedBundle][local.options.conf.env].server.webroot;
            path        = (/\/$/.test(webroot)) ? webroot.substr(0, webroot.length-1) : webroot;
        } else {
            hostname    = route.param.hostname;
            port        = route.param.port;
            path        = route.param.port;
        }

        var method = null;
        if ( typeof(route.param.method) != 'undefined' ) {
            method = route.param.method.toLowerCase();
        } else {
            method = req.method.toLowerCase();
        }

        var opt = {
            ca: ca,
            hostname: hostname,
            port: port,
            path: path,
            method: method
        }
        if (self.isCacheless() || self.isLocalScope() ) {
            opt.rejectUnauthorized = false;
        }

        var obj = req[ req.method.toLowerCase() ];
        // if ( req.files != 'undefined' ) {
        //     obj.files = req.files;
        // }
        self.query(opt, obj, function onForward(err, result){
            if (err) {
                self.throwError(err);
                return;
            }

            // TODO - filter : redirect & location

            // if ( self.isXMLRequest() || !hasViews() || !local.options.isUsingTemplate && !hasViews() || hasViews() && !local.options.isUsingTemplate ) {
                self.renderJSON(result)
            // } else {
            //     self.render(result)
            // }
        });
    }


    /**
     * Get config
     *
     * @param {string} [name] - Conf name without extension.
     * @returns {object} config
     *
     * */
    this.getConfig = function(name) {
        if ( typeof(name) != 'undefined' ) {
            try {
                // needs to be read only
                //config = JSON.clone(local.options.conf.content[name]);
                //config = Object.freeze(local.options.conf.content[name]);
                //Object.seal(local.options.conf.content[name]);
                //Object.freeze(local.options.conf.content[name]);
                return JSON.clone(local.options.conf.content[name]);
            } catch (err) {
                return undefined;
            }
        } else {
            // config = JSON.stringify(local.options.conf);
            // return JSON.parse(config)
            return JSON.clone(local.options.conf);
        }
    }

    /**
     * Get locales
     * Will take only supported lang
     *
     * @param {string} [shortCountryCode] - e.g. EN
     *
     * @returns {object} locales
     * */
    this.getLocales = function (shortCountryCode) {

        var userLocales = local.options.conf.locales;

        if ( typeof(shortCountryCode) != 'undefined' ) {
            shortCountryCode = shortCountryCode.toLowerCase();
            var locales         = new Collection( getContext('gina').locales );

            try {
                userLocales = locales.findOne({ lang: shortCountryCode }).content
            } catch (err) {
                console.warn('language code `'+ shortCountryCode +'` not handled to setup locales: replacing by `'+ local.options.conf.content.settings.region.shortCode +'`');
                userLocales = locales.findOne({ lang: local.options.conf.content.settings.region.shortCode }).content // by default
            }
        }


        /**
         * Get countries list
         *
         * @param {string} [code] - e.g.: officialStateName, isoShort, isoLong, continent, capital, currency.name
         *
         * @returns {object} countries - countries code & value list
         * */
        var getCountries = function (code) {
            var list = [], cde = 'countryName';

            if ( typeof(code) != 'undefined' && typeof(userLocales[0][code]) == 'string' ) {
                cde = code
            } else if ( typeof(code) != 'undefined' ) {
                console.warn('`'+ code +'` not supported : sticking with `short` code')
            }


            for ( let i = 0, len = userLocales.length; i< len; ++i ) {
                list[ i ] = {
                    isoShort: userLocales[i].isoShort,
                    isoLong: userLocales[i].isoLong,
                    countryName: userLocales[i].countryName,
                    officialStateName: userLocales[i].officialStateName
                };
            }

            return list
        }

        return {
            'getCountries': getCountries
            // TODO - getCurrencies()
        }
    }

    /**
     * Get forms rules
     *
     *
     * @returns {object} rules
     *
     * */
    this.getFormsRules = function () {
        var bundle  = local.options.conf.bundle; // by default
        var form    = null;
        var rule    = null;
        var isGettingRulesFromAnotherBundle = false;
        var rules   = {};
        if ( typeof(local.req.ginaHeaders) != 'undefined' && typeof(local.req.ginaHeaders.form) != 'undefined' ) {
            form = local.req.ginaHeaders.form;
            if ( typeof(form.rule) != 'undefined' ) {
                var ruleInfos = form.rule.split(/\@/);
                rule = ruleInfos[0];
                // rules might be located in another bundle
                if (ruleInfos[1] && ruleInfos[1] != '' && ruleInfos[1] != bundle) {
                    bundle = ruleInfos[1];
                    isGettingRulesFromAnotherBundle = true;
                }
            }
        }

        if ( form && typeof(form.id) != 'undefined' ) {
            try {
                if (isGettingRulesFromAnotherBundle) {
                    rules = JSON.clone(getConfig()[bundle][local.options.conf.env].content.forms.rules[form.id]) || null;
                } else {
                    rules = JSON.clone(local.options.conf.content.forms).rules[form.id] || null;
                }

                if (!rules) {
                    rules = {};
                    console.warn('[CONTROLLER]['+ local.options.conf.bundle +'][Backend validation] did not find matching rules for form.id `'+ form.id +'` for  `'+ bundle+' bundle`. Do not Panic if you did not defined any.')
                }
            } catch (ruleErr) {
                self.throwError(ruleErr);
                return;
            }
        }

        return rules;
    }

    this.push = function(payload) {

        var req = local.req, res = local.res;
        var method  = req.method.toLowerCase();
        // if no session defined, will push to all active clients
        var sessionId = ( typeof(req[method].sessionID) != 'undefined' ) ? req[method].sessionID : null;

        // resume current session

        if (!payload) {
            payload     = null;
            if ( typeof(req[method]) != 'undefined' && typeof(req[method].payload) != 'undefined' ) {
                if ( typeof(payload) == 'string' ) {
                    payload = decodeURIComponent(req[method].payload)
                } else {
                    payload =  JSON.stringify(req[method].payload)
                }
            }
        } else if ( typeof(payload) == 'object' ) {
            payload = JSON.stringify(payload)
        }

        try {
            var clients = null;
            if (sessionId) {
                clients = self.serverInstance.eio.getClientsBySessionId(sessionId);
                if (clients)
                    clients.send(payload);
            }

            // send to all clients if no specific sessionId defined
            if (!sessionId) {
                clients = self.serverInstance.eio.clients;
                for (var id in clients) {
                    clients[id].send(payload)
                }
            }

            res.end();
        } catch(err) {
            self.throwError(err);
            return;
        }
    }

    var getSession = function() {
        var session = null;
        if ( typeof(local.req.session) != 'undefined') {
            session = local.req.session;
        }
        // passport override
        if (!session && typeof(local.req.session) != 'undefined' && typeof(local.req.session.user) != 'undefined') {
            session = local.req.session.user;
        }

        return session;
    }

    this.isHaltedRequest = function(session) {
        // trying to retrieve session since it is optional
        if ( typeof(session) == 'undefined' ) {
            session = getSession();
            // if ( typeof(local.req.session) != 'undefined' && typeof(local.req.session.haltedRequest) != 'undefined' ) {
            //     session = local.req.session;
            // }
            // // passport
            // if (!session && typeof(local.req.session) != 'undefined' && typeof(local.req.session.user) != 'undefined' && typeof(local.req.session.user.haltedRequest) != 'undefined' ) {
            //     session = local.req.session.user;
            // }
            if (
                !session
                ||
                typeof(session) != 'undefined'
                && typeof(session.haltedRequest) == 'undefined'
            ) {
                return false;
            }
        }

        return (typeof(session.haltedRequest) != 'undefined' ) ? true : false;
    }


    local.haltedRequestUrlResumed = false;

    this.pauseRequest = function(data, requestStorage) {


        // saving halted request
        var req             = local.req
            , res           = local.res
            , next          = local.next
            , haltedRequest = {
                url     : req.url,
                routing : req.routing,
                method  : req.method.toLowerCase(),
                data    : JSON.clone(data)
            }
        ;

        if (
            typeof(requestStorage) == 'undefined'
            && typeof(req.session) != 'undefined'
        ) {
            requestStorage = req.session;
        }

        if (
            typeof(requestStorage) == 'undefined'
        ) {
            var error = new ApiError('`requestStorage` is required', 424);
            self.throwError(error);
            return;
        }

        var requestParams = {}, i = 0;
        for (var p in req.params) {
            if (i > 0) {
                requestParams[p] = req.params[p];
            }
            ++i;
        }
        if (requestParams.count() > 0) {
            haltedRequest.params = requestParams;
        }

        requestStorage.haltedRequest = haltedRequest;

        return requestStorage;
    }


    /**
     * resumeRequest
     * Used to resume an halted request
     * Requirements :
     *  - a middleware attached `haltedRequest` to userSession
     * OR
     * - a persistant object where `haltedRequest` is attached
     *
     * @param {object} req
     * @param {object} res
     * @param {callback|null} next
     * @param {object} [requestStorage] - Will try to use sessionStorage if not passed
     */
    this.resumeRequest = function(requestStorage) {

        if (local.haltedRequestUrlResumed)
            return;

        var haltedRequest   = null
            , req           = local.req
            , res           = local.res
            , next          = local.next
        ;

        if (
            typeof(requestStorage) == 'undefined'
            && typeof(req.session) != 'undefined'
        ) {
            requestStorage = req.session;
        }

        if (
            typeof(requestStorage) == 'undefined'
            ||
            typeof(requestStorage) != 'undefined'
            && typeof(requestStorage.haltedRequest) == 'undefined'
        ) {
            var error = new ApiError('`requestStorage.haltedRequest` is required', 424);
            self.throwError(error);
            return;
        }
        haltedRequest       = requestStorage.haltedRequest;
        var data            = haltedRequest.data || {};
        // request methods cleanup
        // checkout /framework/{verrsion}/core/template/conf/(settings.json).server.supportedRequestMethods
        var serverSupportedMethods = local.options.conf.server.supportedRequestMethods;
        for (let method in serverSupportedMethods) {
            if (req.method.toLowerCase() == method) {
                data = merge(data, req[method])
            }

            delete req[method];
        }


        var dataAsParams    = {};
        if (data.count() > 0) {
            dataAsParams = JSON.clone(haltedRequest.data);
        }
        var url             = lib.routing.getRoute(haltedRequest.routing.rule, haltedRequest.params||dataAsParams).url;
        var requiredController = self; // by default;
        if ( req.routing.namespace != haltedRequest.routing.namespace ) {
            try {
                requiredController = self.requireController(haltedRequest.routing.namespace, self._options );
            } catch (err) {
                self.throwError(err);
            }
        }
        req.routing     = haltedRequest.routing;
        req.method      = haltedRequest.method;
        req[haltedRequest.method] = data;

        local.haltedRequestUrlResumed = true;
        if ( /GET/i.test(req.method) ) {
            if ( typeof(requestStorage.haltedRequest) != 'undefined' ) {
                delete requestStorage.haltedRequest;
            }
            delete requestStorage.haltedRequest;
            delete requestStorage.inheritedData;
            requestStorage.haltedRequestUrlResumed = url;

            if (
                typeof(req.routing.param.isPopinContext) != 'undefined'
                && /^true$/i.test(req.routing.param.isPopinContext)
                && self.isXMLRequest()
            ) {
                return self.renderJSON({
                    isXhrRedirect: true,
                    popin: {
                        url: url
                    }
                })
            }
            else if (self.isXMLRequest() ) {
                return self.renderJSON({
                    isXhrRedirect: true,
                    location: url
                })
            }

            requiredController.redirect(url, true);

        } else {
            local.onHaltedRequestResumed = function(err) {
                if (!err) {
                    delete requestStorage.haltedRequest;
                    delete requestStorage.inheritedData;
                }
            }
            if ( typeof(next) == 'function' ) {
                console.warn('About to override `next` param');
            }

            try {
                requiredController[req.routing.param.control](req, res, next);
                // consuming it
                local.onHaltedRequestResumed(false);
            } catch(err) {
                console.error('[ BUNDLE ][ '+ local.options.conf.bundle +' ][ Controller ] Could not resume haltedRequest\n' + err.stack );
                self.throwError(err);
            }


        }
    }


    this.renderCustomError = function (req, res, next) {

        // preventing multiple call of self.renderWithoutLayout() when controller is rendering from another required controller
        if (local.options.renderingStack.length > 1) {
            return false;
        }
        local.options.isRenderingCustomError = true;

        //local.options.isWithoutLayout = true;

        var data = null;
        if ( typeof(req.routing.param.error) != 'undefined' ) {
            data = JSON.clone(req.routing.param.error) || {};
            delete req.routing.param.error
        }

        var session = getSession();
        if (session) {
            data.session = JSON.clone(session)
        }
        var displayToolbar = req.routing.param.displayToolbar || false;
        if (req.routing.param.displayToolbar) {
            delete req.routing.param.displayToolbar
        }
        var isLocalOptionResetNeeded = req.routing.param.isLocalOptionResetNeeded || false;
        var errOptions = null;
        if (isLocalOptionResetNeeded) {
            delete req.routing.param.isLocalOptionResetNeeded;
            var bundleConf = JSON.clone(local.options.conf);
            var bundle = req.routing.bundle;
            var param = req.routing.param;
            var localOptions = {
                // view namespace first
                //namespace       : null,
                control         : param.control,
                //controller      : controllerFile,
                //controller: '<span class="gina-bundle-name">' + bundle +'</span>/controllers/controller.js',
                file: param.file,
                //layout: param.file,
                //bundle          : bundle,//module
                bundlePath      : bundleConf.bundlesPath + '/' + bundle,
                renderingStack  : bundleConf.renderingStack,
                //rootPath        : self.executionPath,
                // We don't want to keep original conf untouched
                //conf            : JSON.clone(conf),
                //instance: self.serverInstance,
                //template: (routeHasViews) ? bundleConf.content.templates[templateName] : undefined,
                //isUsingTemplate: local.isUsingTemplate,
                //cacheless: cacheless,
                path: null //, // user custom path : namespace should be ignored | left blank
                //assets: {}
            };
            errOptions = merge(localOptions, local.options);


        }
        delete local.options.namespace;
        self.render(data, displayToolbar, errOptions);
    }

    var getResponseProtocol = function (response) {
        // var options =  local.options;
        // var protocolVersion = ~~options.conf.server.protocol.match(/\/(.*)$/)[1].replace(/\.\d+/, '');

        var protocol    = 'http/'+ local.req.httpVersion; // inheriting request protocol version by default
        var bundleConf  = options.conf;
        // switching protocol to h2 when possible
        if ( /http\/2/.test(bundleConf.server.protocol) && response.stream ) {
            protocol    = bundleConf.server.protocol;
        }

        return protocol;
    }


    /**
     * Throw error
     *
     * @param {object} [ res ]
     * @param {number} code
     * @param {string} msg
     *
     * @returns {void}
     * */
    this.throwError = function(res, code, msg) {

        var protocol        = getResponseProtocol(res);
        var stream          = ( /http\/2/.test(protocol) && res.stream ) ? res.stream : null;
        var header          = ( /http\/2/.test(protocol) && res.stream ) ? {} : null;

        self.isProcessingError = true;
        var errorObject = null; // to be returned

        // preventing multiple call of self.throwError() when controller is rendering from another required controller
        if (local.options.renderingStack.length > 1) {
            return false
        }
        var bundleConf = local.options.conf;
        var bundle = bundleConf.bundle;
        // handle error fallback
        // err.fallback must be a valide route object or a url string
        var fallback = null;
        var standardErrorMessage = null;
        if (
            arguments[0] instanceof Error
            || arguments.length == 1 && typeof(res) == 'object'
            || arguments[arguments.length-1] instanceof Error
            || typeof(arguments[arguments.length-1]) == 'string' && !(arguments[0] instanceof Error)
        ) {

            code    = ( res && typeof(res.status) != 'undefined' ) ?  res.status : 500;

            if ( typeof(statusCodes[code]) != 'undefined' ) {
                standardErrorMessage = statusCodes[code];
            } else {
                console.warn('[ ApiValidator ] statusCode `'+ code +'` not matching any definition in `'+_( getPath('gina').core + '/status.codes')+'`\nPlease contact the Gina dev team to add one if required');
            }

            errorObject = {
                status  : code,
                error   : res.error || res.message || standardErrorMessage
            };

            if ( res instanceof Error || typeof(res.stack) != 'undefined' ) {
                //errorObject.status   = code;
                //errorObject.error    = standardErrorMessage || res.error || res.message;
                errorObject.stack   = res.stack;
                if (res.message && typeof(res.message) == 'string') {
                    errorObject.message = res.message;
                } else if (res.message) {
                    console.warn('[ Controller ] Ignoring message because of the format.\n'+res.message)
                }

            } else if ( typeof(arguments[arguments.length-1]) == 'string' ) {
                // formated error
                errorObject.message = arguments[arguments.length-1]
            } else if (
                arguments[arguments.length-1] instanceof Error
                || typeof(res) == 'object' && typeof(res.stack) != 'undefined'
            ) {
                errorObject = merge(arguments[arguments.length-1], errorObject)
            }

            if ( typeof(res.fallback) != 'undefined' ) {
                fallback = res.fallback
            }

            res = local.res;

        } else if (arguments.length < 3) {
            msg           = code || null;
            code          = res || 500;
            res           = local.res;
        }

        var responseHeaders = null;
        if ( typeof(res.getHeaders) == 'undefined' && typeof(res.stream) != 'undefined' ) {
            responseHeaders = res.stream.sentHeader;
        } else {
            responseHeaders = res.getHeaders() || local.res.getHeaders();
        }
        // var responseHeaders = res.getHeaders() || local.res.getHeaders();
        var req             = local.req;
        var next            = local.next;
        if (!headersSent()) {
            // DELETE request methods don't normaly use a view,
            // but if we are calling it from a view, we should render the error back to the view
            if ( self.isXMLRequest() || !hasViews() && !/delete/i.test(req.method) || !local.options.isUsingTemplate && !hasViews() || hasViews() && !local.options.isUsingTemplate ) {
                // fallback interception
                if ( fallback ) {
                    if ( typeof(fallback) == 'string' ){ // string url: user provided
                        return self.redirect( fallback, true )
                    } else {
                        // else, using url from route object
                        // Reminder
                        // Here, we use route.toUrl() intead of
                        // route.url to support x-bundle com
                        return self.redirect( fallback.toUrl() );
                    }
                }

                // allowing this.throwError(err)
                if ( typeof(code) == 'object' && !msg && typeof(code.status) != 'undefined' && typeof(code.error) != 'undefined' ) {
                    msg     = code.error || code.message;
                    code    = code.status || 500;
                }
                if ( typeof(statusCodes[code]) != 'undefined' ) {
                    standardErrorMessage = statusCodes[code];
                } else {
                    console.warn('[ ApiValidator ] statusCode `'+ code +'` not matching any definition in `'+_( getPath('gina').core + '/status.codes')+'`\nPlease contact the Gina dev team to add one if required');
                }

                // if ( !local.res.getHeaders()['content-type'] /**!req.headers['content-type'] */  ) {
                //     // Internet Explorer override
                //     if ( typeof(req.headers['user-agent']) != 'undefined' && /msie/i.test(req.headers['user-agent']) ) {
                //         res.writeHead(code, "content-type", "text/plain")
                //     } else {
                //         res.writeHead(code, { 'content-type': bundleConf.server.coreConfiguration.mime['json']} );
                //     }
                // }

                // TODO - test with internet explorer then remove this if working
                if ( typeof(req.headers['user-agent']) != 'undefined' ) {
                    if ( /msie/i.test(req.headers['user-agent']) ) {
                        res.writeHead(code, "content-type", "text/plain");
                    } else {
                        var contentType = ( responseHeaders && responseHeaders['content-type'])
                                         ? responseHeaders['content-type']
                                         : bundleConf.server.coreConfiguration.mime['json']+ '; charset='+ bundleConf.encoding
                        ;
                        res.writeHead(code, { 'content-type': contentType } );
                    }
                } else if ( typeof(responseHeaders['content-type']) != 'undefined' ) {
                    res.writeHead(code, { 'content-type': responseHeaders['content-type']} )
                } else {
                    res.writeHead(code, "content-type", bundleConf.server.coreConfiguration.mime['json']+ '; charset='+ bundleConf.encoding);
                }



                if (!errorObject) {
                    errorObject = {
                        status: code,
                        //errors: msg.error || msg.errors || msg,
                        error: standardErrorMessage || msg.error || msg,
                        message: msg.message || msg,
                        stack: msg.stack
                    }
                }

                var errOutput = null, output = errorObject.toString();
                if ( output == '[object Object]' ) {
                    errOutput = JSON.stringify(errorObject);
                } else {
                    errOutput = JSON.stringify(
                        {
                            status  : errorObject.status,
                            error   : output,
                            stack   : errorObject.stack || null
                        }
                    );
                }

                console.error('[ BUNDLE ][ '+ bundleConf.bundle +' ][ Controller ] '+ req.method +' ['+res.statusCode +'] '+ req.url +'\n'+ errorObject);
                return res.end(errOutput);
            } else {


                console.error(req.method +' ['+ errorObject.status +'] '+ req.url + '\n'+ (errorObject.stack||errorObject.message));


                 // intercept none HTML mime types
                 var url                     = decodeURI(local.req.url) /// avoid %20
                    , ext                   = null
                    , isHtmlContent         = false
                    , hasCustomErrorFile    = false
                    , eCode                 = code.toString().substr(0,1) + 'xx'
                ;
                var extArr = url.substr(url.lastIndexOf('.')).match(/(\.[A-Za-z0-9]+)/);
                if (extArr) {
                    ext = extArr[0].substr(1);
                }
                if ( !ext || /^(html|htm)$/i.test(ext) ) {
                    isHtmlContent = true;
                    if (!ext) {
                        ext = 'html'
                    }
                }

                if (
                    isHtmlContent
                    && typeof(bundleConf.content.templates._common.errorFiles) != 'undefined'
                    && typeof(bundleConf.content.templates._common.errorFiles[code]) != 'undefined'
                    ||
                    isHtmlContent
                    && typeof(bundleConf.content.templates._common.errorFiles) != 'undefined'
                    && typeof(bundleConf.content.templates._common.errorFiles[eCode]) != 'undefined'
                ) {
                    hasCustomErrorFile = true;
                    var eFilename               = null
                        , eData                 = null
                    ;
                    eData = {
                        isRenderingCustomError  : true,
                        bundle                  : bundle,
                        status                  : code || null,
                        //message                 : errorObject.message || msg || null,
                        pathname                : url
                    };

                    if ( errorObject ) {
                        eData = merge(errorObject, eData);
                    }

                    if ( typeof(msg) == 'object' ) {
                        if ( typeof(msg.stack) != 'undefined' ) {
                            eData.stack = msg.stack
                        }
                        if ( !eData.message && typeof(msg.message) != 'undefined' ) {
                            eData.message = msg.message
                        }
                    }
                    if (
                        code
                        // See: framework/${version}/core/status.code
                        && typeof(bundleConf.server.coreConfiguration.statusCodes[code]) != 'undefined'
                    ) {
                        eData.title = bundleConf.server.coreConfiguration.statusCodes[code];
                    }
                    // TODO - Remove this if not used
                    // if ( typeof(local.req.routing) != 'undefined' ) {
                    //     eData.routing = local.req.routing;
                    // }

                    if (typeof(bundleConf.content.templates._common.errorFiles[code]) != 'undefined') {
                        eFilename = bundleConf.content.templates._common.errorFiles[code];
                    } else {
                        eFilename = bundleConf.content.templates._common.errorFiles[eCode];
                    }

                    if (!local.options.isRenderingCustomError) {
                        var eRule = 'custom-error-page@'+ bundle;
                        var routeObj = bundleConf.content.routing[eRule];
                        routeObj.rule = eRule;
                        //routeObj.url = decodeURI(local.req.url);/// avoid %20
                        routeObj.param.title = ( typeof(eData.title) != 'undefined' ) ? eData.title : 'Error ' + eData.status;
                        routeObj.param.file = eFilename;
                        routeObj.param.error = eData;
                        routeObj.param.displayToolbar = self.isCacheless();
                        routeObj.param.isLocalOptionResetNeeded = true;


                        local.req.routing = routeObj;
                        local.req.params.errorObject = errorObject;
                        self.renderCustomError(local.req, res, local.next);
                        return;
                    }

                }

                // if (!errorObject) {
                //     errorObject = {
                //         status: code,
                //         //errors: msg.error || msg.errors || msg,
                //         error: standardErrorMessage || msg.error || msg,
                //         message: msg.message || msg,
                //         stack: msg.stack
                //     }
                // }
                var msgString = '<h1 class="status">Error '+ code +'.</h1>';

                console.error('[ BUNDLE ][ '+ local.options.conf.bundle +' ][ Controller ] `this.'+ req.routing.param.control +'(...)` ['+res.statusCode +'] '+ req.url);
                if ( typeof(msg) == 'object' ) {

                    if (msg.title) {
                        msgString += '<pre class="'+ eCode +' title">'+ msg.title +'</pre>';
                    }

                    if (msg.error) {
                        msgString += '<pre class="'+ eCode +' message">'+ msg.error +'</pre>';
                    }

                    if (msg.message) {
                        msgString += '<pre class="'+ eCode +' message">'+ msg.message +'</pre>';
                    }

                    if (msg.stack) {

                        if (msg.error) {
                            msg.stack = msg.stack.replace(msg.error, '')
                        }

                        if (msg.message) {
                            msg.stack = msg.stack.replace(msg.message, '')
                        }

                        msg.stack = msg.stack.replace('Error:', '').replace(' ', '');
                        msgString += '<pre class="'+ eCode +' stack">'+ msg.stack +'</pre>';
                    }

                } else {
                    // Generic error
                    var title = null, message = null, stack = null;;
                    if ( typeof(errorObject) != 'undefined' && errorObject && typeof(errorObject.error) != 'undefined' ) {
                        title = errorObject.error
                    }
                    if (typeof(errorObject) != 'undefined' && errorObject  && typeof(errorObject.message) != 'undefined' ) {
                        message = errorObject.message
                    }
                    if (typeof(errorObject) != 'undefined' && errorObject  && typeof(errorObject.stack) != 'undefined' ) {
                        stack = errorObject.stack
                    }

                    if (title) {
                        msgString += '<pre class="'+ eCode +' title">'+ title +'</pre>';
                    }
                    if (message) {
                        msgString += '<pre class="'+ eCode +' message">'+ message +'</pre>';
                    }
                    if (stack) {
                        msgString += '<pre class="'+ eCode +' stack">'+ stack +'</pre>';
                    }
                }
                res.writeHead(code, { 'content-type': bundleConf.server.coreConfiguration.mime[ext]+'; charset='+ bundleConf.encoding } );
                // if ( isHtmlContent && hasCustomErrorFile ) {
                //     res.end(msgString);
                // } else {
                //if ( isHtmlContent && !hasCustomErrorFile ) {
                    res.end(msgString);
                //}

                return;
            }
        } else {
            if (typeof(next) != 'undefined')
                return next();
        }

        if ( /http\/2/.test(protocol) ) {
            return stream.end();
        }

        return res.end();
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
            //data = merge(data, obj, true);
            data = merge(obj, data);
            obj = {};
            curObj = {}
        }
        return data
    }

    init()
};

SuperController = inherits(SuperController, EventEmitter);
module.exports = SuperController