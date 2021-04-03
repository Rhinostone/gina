"use strict";
/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2021 Rhinostone <gina@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

//Imports.
var fs              = require('fs');
var util            = require('util');
var EventEmitter    = require('events').EventEmitter;
var zlib            = require('zlib');

//var dns           = require('dns');
// var tls = require('tls');
// var crypto = require('crypto');

var lib             = require('./../../lib') || require.cache[require.resolve('./../../lib')];
var merge           = lib.merge;
var inherits        = lib.inherits;
var console         = lib.logger;
var Collection      = lib.Collection;
var swig            = require('swig');
var SwigFilters     = lib.SwigFilters;
var statusCodes     = requireJSON( _( getPath('gina').core + '/status.codes') );


/**
 * @class SuperController
 *
 *
 * @package     Gina
 * @namespace
 * @author      Rhinostone <gina@rhinostone.com>
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

    // var ports = {
    //     'http': 80,
    //     'https': 443
    // };


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
        return SuperController.instance;
    }

    var hasViews = function() {
        return ( typeof(local.options.template) != 'undefined' ) ? true : false;
    }
    
    /**
     * isHttp2
     * Returns `true` if server configured for HTTP/2
     * 
     * @return {boolean} isHttp2
     */
    var isHttp2 = function() {
        var options =  local.options;  
        var protocolVersion = ~~options.conf.server.protocol.match(/\/(.*)$/)[1].replace(/\.\d+/, '');
        var httpLib =  options.conf.server.protocol.match(/^(.*)\//)[1] + ( (protocolVersion >= 2) ? protocolVersion : '' );
                            
        
        return /http2/.test(httpLib)
    }
    /**
     * isSecured
     * Returns `true` if server configured to handle a HTTPS exchanges
     * 
     * @return {boolean} isSecured
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
        return local.options.cacheless
    }

    this.setOptions = function(req, res, next, options) {
        local.options = SuperController.instance._options = options;
        local.options.renderingStack = (local.options.renderingStack) ? local.options.renderingStack : [];

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


            var  action     = local.options.control
                , rule      = local.options.rule
                , ext       = 'html'
                , namespace = local.options.namespace || '';


            if ( typeof(local.options.template) != 'undefined' ) {
                ext = local.options.template.ext || ext;
            }
            if ( !/\./.test(ext) ) {
                ext = '.' + ext;
                local.options.template.ext = ext
            }
            
            if ( hasViews() ) {

                if ( typeof(local.options.file) == 'undefined') {
                    local.options.file = 'index'
                }
    
                if ( typeof(local.options.isWithoutLayout) == 'undefined' ) {
                    local.options.isWithoutLayout = false;
                }
    
                var rule        = local.options.rule
                    , namespace = local.options.namespace || 'default';
    
    
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

            set('page.environment.gina', version.number);
            set('page.environment.gina pid', GINA_PID);
            set('page.environment.nodejs', version.nodejs +' '+ version.platform +' '+ version.arch);
            set('page.environment.engine', options.conf.server.engine);//version.middleware
            set('page.environment.env', GINA_ENV);
            set('page.environment.envIsDev', GINA_ENV_IS_DEV);
            
            
            var routing = local.options.conf.routing = ctx.config.envConf.routing; // all routes
            set('page.environment.routing', escape(JSON.stringify(routing))); // export for GFF
            //reverseRouting
            var reverseRouting = local.options.conf.reverseRouting = ctx.config.envConf.reverseRouting; // all routes
            set('page.environment.reverseRouting', escape(JSON.stringify(reverseRouting))); // export for GFF
            
            var forms = local.options.conf.forms = options.conf.content.forms // all forms
            set('page.environment.forms', escape(JSON.stringify(forms))); // export for GFF
            set('page.forms', options.conf.content.forms);
            
            set('page.environment.hostname', ctx.config.envConf[options.conf.bundle][GINA_ENV].hostname);
            set('page.environment.webroot', options.conf.server.webroot);
            set('page.environment.bundle', options.conf.bundle);
            set('page.environment.project', options.conf.projectName);
            set('page.environment.protocol', options.conf.server.protocol);
            set('page.environment.scheme', options.conf.server.scheme);
            set('page.environment.port', options.conf.server.port);
            set('page.environment.debugPort', options.conf.server.debugPort);
            set('page.environment.pid', process.pid);

            set('page.view.layout', local.options.template.layout);
            set('page.view.ext', ext);
            set('page.view.control', action);
            set('page.view.controller', local.options.controller.replace(options.conf.bundlesPath, ''), true);
            if (typeof (local.options.controlRequired) != 'undefined' ) {
                set('page.view.controlRequired', local.options.controlRequired);
            }            
            set('page.view.method', local.options.method);
            set('page.view.namespace', namespace); // by default
            set('page.view.url', req.url);
            set('page.view.html.properties.mode.javascriptsDeferEnabled', local.options.template.javascriptsDeferEnabled);
            set('page.view.html.properties.mode.routeNameAsFilenameEnabled', local.options.template.routeNameAsFilenameEnabled);
            
            var parameters = JSON.parse(JSON.stringify(req.getParams()));
            parameters = merge(parameters, options.conf.content.routing[rule].param);
            // excluding default page properties
            delete parameters[0];            
            delete parameters.file;
            delete parameters.control;
            delete parameters.title;

            if (parameters.count() > 0)
                set('page.view.params', parameters); // view parameters passed through URI or route params

            set('page.view.route', rule);

            
            var acceptLanguage = 'en-US'; // by default : language-COUNTRY
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
                console.warn('language code `'+ userLangCode +'` not handled to setup locales: replacing by default: `'+ local.options.conf.content.settings.region.shortCode +'`');
                userLocales = locales.findOne({ lang: local.options.conf.content.settings.region.shortCode }).content // by default
            }

            // user locales list
            local.options.conf.locales = userLocales;

            // user locale
            options.conf.locale = new Collection(userLocales).findOne({ short: userCountryCode }) || {};

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
            dir = self.templates || local.options.template.templates;
        }
        
        var swigOptions = {
            autoescape: ( typeof(local.options.autoescape) != 'undefined') ? local.options.autoescape : false,
            //loader: swig.loaders.fs(dir),
            cache: (local.options.cacheless) ? false : 'memory'
        };
        if (dir) {
            swigOptions.loader = swig.loaders.fs(dir)
        }
        swig.setDefaults(swigOptions);
        self.engine = swig;
    }
    
    this.renderWithoutLayout = function (data, displayToolbar) {

        // preventing multiple call of self.renderWithoutLayout() when controller is rendering from another required controller
        if (local.options.renderingStack.length > 1) {
            return false
        }

        local.options.isWithoutLayout = true;
        
        self.render(data, displayToolbar)
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
     * @return {void}
     * */
    this.render = function(userData, displayToolbar) {

        local.options.renderingStack.push( self.name );
        // preventing multiple call of self.render() when controller is rendering from another required controller
        if ( local.options.renderingStack.length > 1 ) {
            return false
        }
        
        local.options.debugMode = ( typeof(displayToolbar) == 'undefined' ) ? undefined : ( (/true/i.test(displayToolbar)) ? true : false ); // only active for dev env
        
        // specific override
        if (GINA_ENV_IS_DEV && typeof(local.req[ local.req.method.toLowerCase() ].debug) != 'undefined' ) {
            local.options.debugMode = ( /true/i.test(local.req[ local.req.method.toLowerCase() ].debug) ) ? true : false;
        }
        
        var data            = null
        , template          = null
        , file              = null
        , path              = null
        , plugin            = null
        , isWithoutLayout   = (local.options.isWithoutLayout) ? true : false
        , layoutRoot        = null
    ;
        try {
            data = getData();
            
            if (!userData) {
                userData = { page: { view: {}}}
            } else if ( userData && !userData['page']) {

                if ( typeof(data['page']['data']) == 'undefined' )
                    data['page']['data'] = userData;
                else
                    data['page']['data'] = merge( userData, data['page']['data'] );
            } else {
                data = merge(userData, data)
            }

            template = local.options.rule.replace('\@'+ local.options.bundle, '');
            var localTemplateConf = local.options.template;
            if ( isWithoutLayout ) {
                localTemplateConf = JSON.parse(JSON.stringify(local.options.template));
                localTemplateConf.javascripts = new Collection(localTemplateConf.javascripts).find({ isCommon: false}, { isCommon: true, name: 'gina' });
                localTemplateConf.stylesheets = new Collection(localTemplateConf.stylesheets).find({ isCommon: false}, { isCommon: true, name: 'gina' }); 
            }
            setResources(localTemplateConf);
            
            
            file = data.page.view.file;

            // pre-compiling variables
            data = merge(data, getData()); // needed !!

            if  (typeof(data.page.data) == 'undefined' ) {
                data.page.data = {}
            }

            if ( typeof(data.page.data.status) != 'undefined' && !/^2/.test(data.page.data.status) && typeof(data.page.data.error) != 'undefined' ) {
                self.throwError(data.page.data.status, data.page.data.error)
            }

            // making path thru [namespace &] file
            if ( typeof(local.options.namespace) != 'undefined' ) {
                // excepted for custom paths
                if ( !/^(\.|\/|\\)/.test(file) )
                    file = ''+ file.replace(local.options.namespace+'-', '');
                
                // means that rule name === namespace -> pointing to root namespace dir
                if (!file || file === local.options.namespace) {
                    file = 'index'
                }
                path = _(local.options.template.html +'/'+ local.options.namespace + '/' + file)
            } else {
                if ( local.options.path && !/(\?|\#)/.test(local.options.path) ) {
                    path = _(local.options.path);
                    var re = new RegExp( data.page.view.ext+'$');
                    if ( data.page.view.ext && re.test(data.page.view.file) ) {
                        data.page.view.path = path.replace('/'+ data.page.view.file, '');

                        path            = path.replace(re, '');
                        data.page.view.file  = data.page.view.file.replace(re, '');

                    } else {
                        data.page.view.path = path.replace('/'+ data.page.view.file, '');
                    }

                } else {
                    path = _(local.options.template.html +'/'+ file)
                }
            }

            if (data.page.view.ext /** && hasViews() && fs.existsSync(_(path + data.page.view.ext, true))*/ ) {
                path += data.page.view.ext
            }

            data.page.view.path = path;

            var dic = {}, msg = '';
            for (var d in data.page) {
                dic['page.'+d] = data.page[d]
            }

            

            // please, do not put any slashes when including...
            // ex.:
            //      /html/inc/_partial.html (BAD)
            //      html/inc/_partial.html (GOOD)
            //      ./html/namespace/page.html (GOOD)
            fs.readFile(path, function (err, content) {
                var isProxyHost = ( 
                    typeof(local.req.headers.host) != 'undefined' 
                        && local.options.conf.server.scheme +'://'+ local.req.headers.host != local.options.conf.hostname 
                    || typeof(local.req.headers[':authority']) != 'undefined' 
                        && local.options.conf.server.scheme +'://'+ local.req.headers[':authority'] != local.options.conf.hostname  
                ) ? true : false;
                // setup swig default filters                
                var filters = SwigFilters({
                    options     : local.options,
                    isProxyHost : isProxyHost,
                    throwError  : self.throwError,
                    req         : local.req,
                    res         : local.res 
                });
                
                if (err) {
                    msg = 'could not open "'+ path +'"' +
                            '\n1) The requested file does not exists in your views/html (check your template directory). Can you find: '+path +
                            '\n2) Check the following rule in your `'+local.options.conf.bundlePath+'/config/routing.json` and look around `param` to make sure that nothing is wrong with your declaration: '+
                            '\n' + options.rule +':'+ JSON.stringify(options.conf.content.routing[options.rule], null, 4) +
                            '\n3) At this point, if you still have problems trying to run this portion of code, you can contact us telling us how to reproduce the bug.' +
                            '\n\r[ stack trace ] '+ err.stack;

                    console.error(err);
                    self.throwError(local.res, 500, new Error(msg));
                }

                try {
                    
                    // Extends default `length` filter
                    swig.setFilter('length', filters.length);

                    

                    // Allows you to get a bundle web root
                    swig.setFilter('getWebroot', filters.getWebroot);
                    
                    swig.setFilter('getUrl', filters.getUrl);

                } catch (err) {
                    // [ martin ]
                    // i sent an email to [ paul@paularmstrongdesigns.com ] on 2014/08 to see if there is
                    // a way of retrieving swig compilation stack traces
                    //var stack = __stack.splice(1).toString().split(',').join('\n');
                    self.throwError(local.res, 500, new Error('template compilation exception encoutered: [ '+path+' ]\n'+(err.stack||err.message)));
                }

                dic['page.content'] = content;
                
                var layoutPath              = null
                    , assets                = null
                    , mapping               = null
                    , XHRData               = null
                    , XHRView               = null
                    , isDeferModeEnabled    = null
                    , viewInfos             = null
                    , filename              = null
                ;
                
                if ( isWithoutLayout || !isWithoutLayout && typeof(local.options.template.layout) != 'undefined' && fs.existsSync(local.options.template.layout) ) {
                    layoutPath = (isWithoutLayout) ? local.options.template.noLayout : local.options.template.layout;
                    if (isWithoutLayout)
                        data.page.view.layout = layoutPath;
                } else {
                    layoutRoot = ( typeof(local.options.namespace) != 'undefined' && local.options.namespace != '') ? local.options.template.templates + '/'+ local.options.namespace  : local.options.template.templates;
                    layoutPath = layoutRoot +'/'+ local.options.file + local.options.template.ext;    
                }
                
                fs.readFile(layoutPath, function onLoadingLayout(err, layout) {

                    if (err) {
                        self.throwError(local.res, 500, err);
                    } else {
                        
                        try {
                            assets  = {assets:"${assets}"};                        
                            //mapping = { filename: local.options.template.layout };         
                            mapping = { filename: layoutPath }; 
                            layout  = layout.toString();
                            // precompie in case of extends
                            if ( /\{\%(\s+extends|extends)/.test(layout) ) {
                                //swig.invalidateCache();
                                layout = swig.compile(layout, mapping)(data);
                            }
                        } catch(err) {
                            err.stack = 'Exception,  bad syntax or undefined data found: start investigating in '+ mapping.filename +'\n' + err.stack;
                            self.throwError(local.res, 500, err);
                            return
                        }
                            
                            
                        
                        isDeferModeEnabled = local.options.template.javascriptsDeferEnabled;  
                        
                        // iframe case - without HTML TAG
                        if (!self.isXMLRequest() && !/\<html/.test(layout) ) {
                            layout = '<html>\n\t<head></head>\n\t<body class="gina-iframe-body">\n\t\t'+ layout +'\n\t</body>\n</html>';
                        }                     
                        
                        // adding stylesheets
                        if (!isWithoutLayout && data.page.view.stylesheets && !/\{\{\s+(page\.view\.stylesheets)\s+\}\}/.test(layout) ) {
                            layout = layout.replace(/\<\/head\>/i, '\n{{ page.view.stylesheets }}\n</head>')
                        }
                                        
                        if (hasViews() && isWithoutLayout) {
                            // $.getScript(...)
                            //var isProxyHost = ( typeof(local.req.headers.host) != 'undefined' && local.options.conf.server.scheme +'://'+ local.req.headers.host != local.options.conf.hostname || typeof(local.req.headers[':authority']) != 'undefined' && local.options.conf.server.scheme +'://'+ local.req.headers[':authority'] != local.options.conf.hostname  ) ? true : false;
                            //var hostname = (isProxyHost) ? local.options.conf.hostname.replace(/\:\d+$/, '') : local.options.conf.hostname;
                            
                            
                            
                            var scripts = data.page.view.scripts;
                            scripts = scripts.replace(/\s+\<script/g, '\n<script');
                                        
                            // var stylesheets = data.page.view.stylesheets;
                            // stylesheets = stylesheets
                            //             .replace(/\s+\<link/g, '\n<link');
                                                    
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
                        if (hasViews() && GINA_ENV_IS_DEV && !isWithoutLayout && local.options.debugMode || hasViews() && GINA_ENV_IS_DEV && !isWithoutLayout && typeof(local.options.debugMode) == 'undefined' || hasViews() && local.options.debugMode ) {                            

                            layout = ''
                                + '{%- set ginaDataInspector                    = JSON.parse(JSON.stringify(page)) -%}'
                                + '{%- set ginaDataInspector.view.assets        = {} -%}'
                                + '{%- set ginaDataInspector.view.scripts       = "ignored-by-toolbar" -%}'
                                + '{%- set ginaDataInspector.view.stylesheets   = "ignored-by-toolbar" -%}'
                                + layout
                            ;
                                
                            plugin = '\t'
                                + '{# Gina Toolbar #}'
                                + '{%- set userDataInspector                    = JSON.parse(JSON.stringify(page)) -%}'
                                + '{%- set userDataInspector.view.scripts        = "ignored-by-toolbar"  -%}'
                                + '{%- set userDataInspector.view.stylesheets   = "ignored-by-toolbar"  -%}'
                                + '{%- set userDataInspector.view.assets        = '+ JSON.stringify(assets) +' -%}'
                                + '{%- include "'+ getPath('gina').core +'/asset/js/plugin/src/gina/toolbar/toolbar.html" with { gina: ginaDataInspector, user: userDataInspector } -%}'
                                + '{# END Gina Toolbar #}'                                                           
                            ;
                                                        

                            if (isWithoutLayout && local.options.debugMode || local.options.debugMode ) {

                                XHRData = '\t<input type="hidden" id="gina-without-layout-xhr-data" value="'+ encodeURIComponent(JSON.stringify(data.page.data)) +'">\n\r';
                                
                                layout = layout.replace(/<\/body>/i, XHRData + '\n\t</body>');
                            }
                            
                            if (GINA_ENV_IS_DEV || local.options.debugMode ) {
                                layout = layout.replace(/<\/body>/i, plugin + '\n\t</body>');
                            }
                            
                            // adding javascripts
                            layout.replace('{{ page.view.scripts }}', '');
                            if ( isDeferModeEnabled ) { // placed in the HEAD                                
                                layout = layout.replace(/\<\/head\>/i, '\t'+ local.options.template.ginaLoader +'\n</head>');                                
                                layout = layout.replace(/\<\/head\>/i, '\t{{ page.view.scripts }}\n\t</head>');
                                
                            } else { // placed in the BODY
                                layout = layout.replace(/\<\/body\>/i, '\t'+ local.options.template.ginaLoader +'\n</body>');                                
                                layout = layout.replace(/\<\/body\>/i, '\t{{ page.view.scripts }}\n</body>');
                            }
                            

                        } else if ( hasViews() && GINA_ENV_IS_DEV && self.isXMLRequest() ) {
                            
                            if (isWithoutLayout) {                                
                                delete data.page.view.scripts;
                                delete data.page.view.stylesheets;                                
                            }
                            // means that we don't want GFF context or we already have it loaded
                            viewInfos = JSON.parse(JSON.stringify(data.page.view));
                            if ( !isWithoutLayout )
                                viewInfos.assets = assets;

                            XHRData = '\n<input type="hidden" id="gina-without-layout-xhr-data" value="'+ encodeURIComponent(JSON.stringify(data.page.data)) +'">';
                            XHRView = '\n<input type="hidden" id="gina-without-layout-xhr-view" value="'+ encodeURIComponent(JSON.stringify(viewInfos)) +'">';


                            layout += XHRData + XHRView;

                        } else { // production env

                            plugin = '\t'
                                + '\n\t<script type="text/javascript">'
                                + ' \n\t<!--'
                                + '\n\t' + local.options.template.pluginLoader.toString()
                                + '\t//-->'
                                + '\n</script>'

                                //+ '\n\t<script type="text/javascript" src="{{ \'/js/vendor/gina/gina.min.js\' | getUrl() }}"></script>'
                            ;
                            
                            
                            // if ( !/page\.view\.scripts/.test(layout) ) {
                            //     layout = layout.replace(/<\/body>/i, plugin + '\t{{ page.view.scripts }}\n\t</body>');
                            // } else {
                            //     layout = layout.replace(/{{ page.view.scripts }}/i, plugin + '\t{{ page.view.scripts }}');
                            // }
                            
                            // adding javascripts
                            layout.replace('{{ page.view.scripts }}', '');
                            if ( isDeferModeEnabled ) { // placed in the HEAD                                
                                layout = layout.replace(/\<\/head\>/i, '\t'+ local.options.template.ginaLoader +'\n</head>');                                
                                layout = layout.replace(/\<\/head\>/i, '\t{{ page.view.scripts }}\n\t</head>');
                                
                            } else { // placed in the BODY
                                layout = layout.replace(/\<\/body\>/i, '\t'+ local.options.template.ginaLoader +'\n</body>');                                
                                layout = layout.replace(/\<\/body\>/i, '\t{{ page.view.scripts }}\n</body>');
                            }

                        }

                        layout = whisper(dic, layout, /\{{ ([a-zA-Z.]+) \}}/g );
                        
                        // special case for template without layout in debug mode - dev only
                        if ( hasViews() && local.options.debugMode && GINA_ENV_IS_DEV && !/\{\# Gina Toolbar \#\}/.test(layout) ) {
                            try { 
                                
                                layout = layout.replace(/<\/body>/i, plugin + '\n\t</body>');                                                                    
                                layout = whisper(dic, layout, /\{{ ([a-zA-Z.]+) \}}/g );
                                //swig.invalidateCache();
                                layout = swig.compile(layout, mapping)(data);
                                

                            } catch (err) {
                                filename = local.options.template.html;
                                filename += ( typeof(data.page.view.namespace) != 'undefined' && data.page.view.namespace != '' && new RegExp('^' + data.page.view.namespace +'-').test(data.page.view.file) ) ? '/' + data.page.view.namespace + data.page.view.file.split(data.page.view.namespace +'-').join('/') + ( (data.page.view.ext != '') ? data.page.view.ext: '' ) : '/' + data.page.view.file+ ( (data.page.view.ext != '') ? data.page.view.ext: '' );
                                self.throwError(local.res, 500, new Error('Compilation error encountered while trying to process template `'+ filename + '`\n'+(err.stack||err.message)))
                            }
                        }                        
                        

                        if ( !local.res.headersSent ) {
                            local.res.statusCode = ( typeof(local.options.conf.server.coreConfiguration.statusCodes[data.page.data.status])  != 'undefined' ) ? data.page.data.status : 200; // by default
                            //catching errors
                            if (
                                typeof(data.page.data.errno) != 'undefined' && /^2/.test(data.page.data.status) && typeof(local.options.conf.server.coreConfiguration.statusCodes[data.page.data.status]) != 'undefined'
                                || typeof(data.page.data.status) != 'undefined' && !/^2/.test(data.page.data.status) && typeof(local.options.conf.server.coreConfiguration.statusCodes[data.page.data.status]) != 'undefined'
                            ) {

                                try {
                                    local.res.statusMessage = local.options.conf.server.coreConfiguration.statusCodes[data.page.data.status];
                                } catch (err){
                                    local.res.statusCode    = 500;
                                    local.res.statusMessage = err.stack||err.message||local.options.conf.server.coreConfiguration.statusCodes[local.res.statusCode];
                                }
                            }

                            local.res.setHeader('content-type', local.options.conf.server.coreConfiguration.mime['html'] + '; charset='+ local.options.conf.encoding );
                            try {
                                // escape special chars
                                var blacklistRe = new RegExp('[\<\>]', 'g');
                                data.page.data = JSON.parse(JSON.stringify(data.page.data).replace(blacklistRe, '\$&'));
                                //swig.invalidateCache();
                                layout = swig.compile(layout, mapping)(data);
                            } catch (err) {
                                filename = local.options.template.html;
                                filename += ( typeof(data.page.view.namespace) != 'undefined' && data.page.view.namespace != '' && new RegExp('^' + data.page.view.namespace +'-').test(data.page.view.file) ) ? '/' + data.page.view.namespace + data.page.view.file.split(data.page.view.namespace +'-').join('/') + ( (data.page.view.ext != '') ? data.page.view.ext: '' ) : '/' + data.page.view.file+ ( (data.page.view.ext != '') ? data.page.view.ext: '' );
                                self.throwError(local.res, 500, new Error('Controller::render(...) compilation error encountered while trying to process template `'+ filename + '`\n' + (err.stack||err.message||err) ));
                            }
                            
                            // Only available for http/2.0 for now
                            if ( !self.isXMLRequest() && /http\/2/.test(local.options.conf.server.protocol) ) {
                                try {
                                    // TODO - button in toolbar to empty url assets cache    
                                    if ( /**  GINA_ENV_IS_DEV ||*/ typeof(local.options.template.assets) == 'undefined' || typeof(local.options.template.assets[local.req.url]) == 'undefined' ) {
                                        // assets string -> object
                                        assets = self.serverInstance.getAssets(local.options.conf, layout.toString(), swig, data);
                                        local.options.template.assets = JSON.parse(assets);
                                    }
                                    
                                    //  only for toolbar - TODO hasToolbar()
                                    if (
                                        GINA_ENV_IS_DEV && hasViews() && !isWithoutLayout
                                        || hasViews() && local.options.debugMode
                                        || GINA_ENV_IS_DEV && hasViews() && self.isXMLRequest() 
                                    ) {                                
                                        layout = layout.replace('{"assets":"${assets}"}', assets ); 
                                    }
                                    
                                } catch (err) {
                                    self.throwError(local.res, 500, new Error('Controller::render(...) calling getAssets(...) \n' + (err.stack||err.message||err) ));
                                }
                            }                             
                            
                            if ( !local.res.headersSent )
                                local.res.end(layout);
                                
                            console.info(local.req.method +' ['+local.res.statusCode +'] '+ local.req.url);
                                                        
                        } else if (typeof(local.next) != 'undefined') {                            
                            local.next();
                        } else {
                            return;
                        }
                    }
                })
            })
        } catch (err) {
            self.throwError(local.res, 500, err)
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
        var next        = local.next;
        // var stream      = null;
        // if ( /http\/2/.test(local.options.conf.server.protocol) ) {            
        //     stream = response.stream;  
        // }

        if (!jsonObj) {
            var jsonObj = {}
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

            if ( !response.headersSent ) {
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

                    response.setHeader("content-length", len);
                    
                    
                    // if (stream && !stream.destroyed) {
                    //     //stream.respond(header);
                    //     stream.end(data);
                    // } else {
                        response.write(data);
                        
                        // required to close connection
                        setTimeout(function () {
                            response.end();
                            response.headersSent = true;
                        }, 200);

                        return // force completion
                    // }
                        

                } else { // normal case
                    response.end(JSON.stringify(jsonObj));
                    response.headersSent = true
                }
            }
        } catch (err) {
            self.throwError(response, 500, err)
        }

    }


    this.renderTEXT = function(content) {

        // preventing multiple call of self.renderTEXT() when controller is rendering from another required controller
        if (local.options.renderingStack.length > 1) {
            return false
        }

        if ( typeof(content) != "string" ) {
            var content = content.toString();
        }

        // if (typeof(options) != "undefined" && typeof(options.charset) !="undefined") {
        //     local.res.setHeader("charset", options.charset);
        // }
        if ( !local.res.getHeaders()['content-type'] ) {
            local.res.setHeader('content-type', 'text/plain' + '; charset='+ local.options.conf.encoding);
        }

        if ( !local.res.headersSent ) {
            console.info(local.req.method +' ['+local.res.statusCode +'] '+ local.req.url);
            local.res.end(content);
            local.res.headersSent = true
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
     * @return {void}
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
     * @return {Object | String} data Data object or String
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
            self.throwError(500, new Error('No views configuration found. Did you try to add views before using Controller::render(...) ? Try to run: gina bundle:add-view '+ options.conf.bundle +' @'+ options.conf.projectName))
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
     * @return {object} content
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
        return (localRequestMethodParams) ? localRequestMethodParams : local.req[local.req.method.toLowerCase()]
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
     * TODO - improve redirect based on `utils.routing`
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
     * @param {object|string} req|rule - Request Object or Rule/Route name
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
            if (typeof(res) === 'string' || typeof(res) === 'number' || typeof(res) === 'boolean') {
                if ( /true|1/.test(res) ) {
                    ignoreWebRoot = true
                } else if ( /false|0/.test(res) ) {
                    ignoreWebRoot = false
                } else {
                    res = local.res;
                    var stack = __stack.splice(1).toString().split(',').join('\n');
                    self.throwError(res, 500, new Error('RedirectError: @param `ignoreWebRoot` must be a boolean\n' + stack));
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
                console.debug('trying to get route: ', rte, bundle, req.method);     
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
        
        var path        = originalUrl || req.routing.param.path || '';
        var url         = req.routing.param.url;
        var code        = req.routing.param.code || 301;

        var keepParams  = req.routing.param['keep-params'] || false;

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
                       
            

            if (!local.res.headersSent) {
                
                if ( 
                    !/GET/i.test(req.method) 
                    || 
                    originalMethod && !/GET/i.test(originalMethod) 
                ) { // trying to redirect using the wrong method ?                    
                    
                    console.warn(new Error('Your are trying to redirect using the wrong method: `'+ req.method+'`.\nThis can often occur while redirecting from a controller to another controller or from a bundle to another.\nA redirection is not permitted in this scenario.\nD\'ont panic :)\nSwitching request method to `GET` method instead.\n').message);
                    method = local.req.method = self.setRequestMethod('GET', conf);
                    code = 303;                                   
                }
                
                // backing up oldParams
                var oldParams = local.req[originalMethod.toLowerCase()];
                var requestParams = req[req.method.toLowerCase()] || {};
                
                // merging new & olds params
                requestParams = merge(requestParams, oldParams);                
                if ( typeof(requestParams) != 'undefined' && requestParams.count() > 0 ) {                    
                    var inheritedData = null;
                    if ( /\?/.test(path) ) {
                        inheritedData = '&inheritedData='+ encodeURIComponent(JSON.stringify(requestParams));  
                    } else {
                        inheritedData = '?inheritedData='+ encodeURIComponent(JSON.stringify(requestParams));  
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
                    
                    path += inheritedData;
                } 
                    
                var ext = 'html';
                res.setHeader('content-type', local.options.conf.server.coreConfiguration.mime[ext]);
                
                if ( 
                    typeof(local.res._headers) != 'undefined'
                    && typeof(local.res._headers['access-control-allow-methods']) != 'undefined' 
                    && local.res._headers['access-control-allow-methods'] != req.method 
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
                
                if (GINA_ENV_IS_DEV) {
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
                res.end(redirectObject);
                try {
                    local.res.headersSent = true;// done for the render() method
                } catch(err){
                    // ignoring the warning
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
            
            if ( !/^http/.test(scheme) )
                self.throwError(local.res, 500, new Error('[ '+ scheme +' ] Scheme not supported. Ref.: `http` or `https` only'));
                
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
        if (!filename)
            self.throwError(local.res, 500, new Error('Filename not found in url: `'+ url +'`'));
        
        if ( !/\.\w+$/.test(filename) )
                self.throwError(local.res, 500, new Error('[ '+ filename +' ] extension not found.'));
        
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
        }
        
        // defining responseType
        requestOptions.headers['content-type'] = contentType;
        requestOptions.headers['content-disposition'] = opt.contentDisposition;
                 
        var browser = require(''+ scheme);
        //console.debug('requestOptions: \n', JSON.stringify(requestOptions, null, 4));
        
        browser.get(requestOptions, function(response) {

            local.res.setHeader('content-type', contentType + '; charset='+ local.options.conf.encoding);
            local.res.setHeader('content-disposition', opt.contentDisposition);
            if (opt.fileSize) {
                local.res.setHeader('content-length', opt.fileSize);
            }
            //local.res.setHeader('content-length', opt.fileSize);
            // local.res.setHeader('cache-control', 'must-revalidate'); 
            // local.res.setHeader('pragma', 'must-revalidate'); 
            
            // response.on('end', function onResponsePipeEnd(){
            //     self.renderJSON({ url: url});
            //     //local.res.end( Buffer.from(data) );
            //     //local.res.headersSent = true;       
                
            //     // if ( typeof(local.next) != 'undefined')
            //     //     local.next();
            //     // else
            //     //     return;
            // });
            
            response.pipe(local.res);
        });
        
        return;

    }

    
    /**
     * Download to targeted filename.ext - Will create target if new
     * Use `cb` callback or `onComplete` event
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
                        
                        fileName = files[i].filename || files[i].originalFilename
                        
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
                console.log('Subject Common Name:', cert.subject.CN);
                console.log('  Certificate SHA256 fingerprint:', cert.fingerprint256);

                hash = crypto.createHash('sha256');
                console.log('  Public key ping-sha256:', sha256(cert.pubkey));

                lastprint256 = cert.fingerprint256;
                cert = cert.issuerCertificate;
            } while (cert.fingerprint256 !== lastprint256);

        }*/
        
    };

    this.query = function(options, data, callback) {

        // preventing multiple call of self.query() when controller is rendering from another required controller
        if (local.options.renderingStack.length > 1) {
            return false
        }
        self.isProcessingError = false; // by default
       
        var queryData           = {}
            , defaultOptions    = local.query.options
            , path              = options.path
            , browser           = null            
        ;

        // options must be used as a copy in case of multiple calls of self.query(options, ...)
        options = merge(JSON.parse(JSON.stringify(options)), defaultOptions);
        
        for (var o in options) {//cleaning
            if ( typeof(options[o]) == 'undefined' || options[o] == undefined) {
                delete options[o]
            }
        }

        if ( !options.host && !options.hostname ) {
            self.emit('query#complete', new Error('SuperController::query() needs at least a `host IP` or a `hostname`'))
        }

        

        if (arguments.length <3) {
            if ( typeof(data) == 'function') {
                var callback = data;
                var data = undefined;
            } else {
                callback = undefined;
            }
        }
        if ( typeof(data) != 'undefined' &&  data.count() > 0) {

            queryData = '?';
            // TODO - if 'application/json' && method == (put|post)
            if ( ['put', 'post'].indexOf(options.method.toLowerCase()) >-1 && /(text\/plain|application\/json|application\/x\-www\-form)/i.test(options.headers['content-type']) ) {
                // replacing
                queryData = encodeURIComponent(JSON.stringify(data))

            } else {
                //Sample request.
                //options.path = '/updater/start?release={"version":"0.0.5-dev","url":"http://10.1.0.1:8080/project/bundle/repository/archive?ref=0.0.5-dev","date":1383669077141}&pid=46493';

                for (var d in data) {
                    if ( typeof(data[d]) == 'object') {
                        data[d] = JSON.stringify(data[d]);
                    }
                    queryData += d + '=' + data[d] + '&';
                }

                queryData = queryData.substring(0, queryData.length-1);
                queryData = queryData.replace(/\s/g, '%20');
                options.path += queryData;
            }

        } else {
            queryData = ''
        }

        
        // Internet Explorer override
        if ( /msie/i.test(local.req.headers['user-agent']) ) {
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
        
        //retrieving dynamic host, hostname & port
        if ( /\@/.test(options.hostname) ) {
            
            var bundle = ( options.hostname.replace(/(.*)\:\/\//, '') ).split(/\@/)[0];
            
            // No shorcut possible because conf.hostname might differ from user inputs
            options.host        = ctx.gina.config.envConf[bundle][ctx.env].host.replace(/(.*)\:\/\//, '').replace(/\:\d+/, '');
            options.hostname    = ctx.gina.config.envConf[bundle][ctx.env].hostname;
            options.port        = ctx.gina.config.envConf[bundle][ctx.env].server.port;
            
            options.protocol    = ctx.gina.config.envConf[bundle][ctx.env].server.protocol;
            options.scheme      = ctx.gina.config.envConf[bundle][ctx.env].server.scheme;
            // might be != from the bundle requesting
            //options.protocol    = ctx.gina.config.envConf[bundle][ctx.env].content.settings.server.protocol || ctx.gina.config.envConf[bundle][ctx.env].server.protocol;
            //options.scheme    = ctx.gina.config.envConf[bundle][ctx.env].content.settings.server.scheme || ctx.gina.config.envConf[bundle][ctx.env].server.scheme;
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
            //throw err;
            //throw new Error('Scheme `'+ scheme +'` not supported')
            self.emit('query#complete', err)
        }
           
    }
    
    var handleHTTP1ClientRequest = function(browser, options, callback) {
        
        var altOpt = JSON.parse(JSON.stringify(options));
        
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


            var data = '';

            res.on('data', function onData (chunk) {
                data += chunk;
            });

            res.on('end', function onEnd(err) {
                
                
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
                            data = JSON.parse(data)
                        } catch (err) {
                            data = {
                                status    : 500,
                                error     : data
                            }
                        }
                    }

                    try {
                        if ( data.status && !/^2/.test(data.status) && typeof(local.options.conf.server.coreConfiguration.statusCodes[data.status]) != 'undefined' ) {
                            self.throwError(data)
                        } else {
                            callback( false, data )
                        }
                    } catch (e) {
                        var infos = local.options, controllerName = infos.controller.substr(infos.controller.lastIndexOf('/'));
                        var msg = 'Controller Query Exception while catching back.\nBundle: '+ infos.bundle +'\nController File: /controllers'+ controllerName +'\nControl: this.'+ infos.control +'(...)\n\r' + e.stack;
                        var exception = new Error(msg);
                        exception.status = 500;
                        self.throwError(exception)
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
                || typeof(err.cause) != 'undefined' && typeof(err.cause.code) != 'undefined' &&  /ECONNREFUSED|ECONNRESET/.test(err.cause.code) 
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
                    error     : err.stack || err.message
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
                        self.throwError(exception)
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
        //options.headers['content-length'] = options.queryData.length;
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
                    error.message = 'Could not connect to [ ' + error.accessPoint + ' ].\nThe `'+port.split(/\@/)[0]+'` bundle is offline.\n';
                }                    
            }
            self.throwError(error)
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
                                
                            }
                        } catch (err) {
                            data = {
                                status    : 500,
                                error     : data
                            }
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
                                  self.throwError(data)
                              }  
                        } else {
                            // required when control is used in an halted state
                            // Ref.: resumeHaltedRequest()
                            if ( self.isHaltedRequest() && typeof(local.onHaltedRequestResumed) != 'undefined' ) {
                                local.onHaltedRequestResumed(false);
                            }
                            return callback( false, data )                        
                        }
                        
                    } catch (e) {
                        var infos = local.options, controllerName = infos.controller.substr(infos.controller.lastIndexOf('/'));
                        var msg = 'Controller Query Exception while catching back.\nBundle: '+ infos.bundle +'\nController File: /controllers'+ controllerName +'\nControl: this.'+ infos.control +'(...)\n\r' + e.stack;
                        var exception = new Error(msg);
                        exception.status = 500;
                        self.throwError(exception)
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
                        // Ref.: resumeHaltedRequest()
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
                            // Ref.: resumeHaltedRequest()
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
                        self.throwError(exception)
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
            // copy
            var param = null, params = JSON.parse(JSON.stringify(req.params));
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
        if (GINA_ENV_IS_DEV) {
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
            
            // if ( self.isXMLRequest() || !hasViews() || !local.options.isUsingTemplate && !hasViews() || hasViews() && !local.options.isUsingTemplate ) {
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
     * @return {object} config
     *
     * TODO - Protect result
     * */
    this.getConfig = function(name) {
        var config = null;

        if ( typeof(name) != 'undefined' ) {
            try {
                // needs to be read only
                //config = JSON.parse(JSON.stringify(local.options.conf.content[name]));
                //config = Object.freeze(local.options.conf.content[name]);
                //Object.seal(local.options.conf.content[name]);
                //Object.freeze(local.options.conf.content[name]);
                return local.options.conf.content[name]
            } catch (err) {
                return undefined
            }
        } else {
            config = JSON.stringify(local.options.conf);
            return JSON.parse(config)
        }
    }

    /**
     * Get locales
     *
     * @param {string} [shortCountryCode] - e.g. EN
     *
     * @return {object} locales
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
         * @param {string} [code] - e.g.: short, long, fifa, m49
         *
         * @return {object} countries - countries code & value list
         * */
        var getCountries = function (code) {
            var list = {}, cde = 'short', name = null;

            if ( typeof(code) != 'undefined' && typeof(userLocales[0][code]) == 'string' ) {
                cde = code
            } else if ( typeof(code) != 'undefined' ) (
                console.warn('`'+ code +'` not supported : sticking with `short` code')
            )
            
            
            for ( var i = 0, len = userLocales.length; i< len; ++i ) {

                if (userLocales[i][cde]) {

                    name = userLocales[i].officialName.short || userLocales[i].full;

                    if ( name )
                        list[ userLocales[i][cde] ] = name;
                }
            }

            return list
        }

        return {
            'getCountries': getCountries
        }
    }

    /**
     * Get forms rules
     *
     * @param {string} [formId]
     *
     * @return {object} rules
     *
     * */
    this.getFormsRules = function (formId) {
        try {

            if ( typeof(formId) != 'undefined' ) {
                try {
                    formId = formId.replace(/\-/g, '.');
                    return JSON.parse(JSON.stringify(local.options.conf.content.forms)).rules[formId]
                } catch (ruleErr) {
                    self.throwError(ruleErr)
                }
            } else {
                try {
                    return JSON.parse(JSON.stringify(local.options.conf.content.forms)).rules
                } catch ( ruleErr ) {
                    self.throwError(ruleErr)
                }
                
            }

        } catch (err) {
            self.throwError(local.res, 500, err)
        }
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
            self.throwError(err)
        } 
    }
        
    this.isHaltedRequest = function(session) {
        // trying to retrieve session since it is optional
        if ( typeof(session) == 'undefined' ) {
            session = null;
            if ( typeof(local.req.session) && typeof(local.req.session.haltedRequest) != 'undefined' ) {
                session = local.req.session;
            }
            // passport
            if (!session && typeof(local.req.session.user) != 'undefined' && typeof(local.req.session.user.haltedRequest) != 'undefined' ) {
                session = local.req.session.user;
            }
            if (!session) {
                return false;
            }
        }
        
        return (typeof(session.haltedRequest) != 'undefined' ) ? true : false;
    }
    
    /**
     * resumeHaltedRequest
     * Used to resume an halted request
     * Requirements :
     *  - a middleware attaching `haltedRequest` to userSession
     * OR
     * - a persistant object where `haltedRequest` is attached
     * 
     * @param {object} req 
     * @param {object} res 
     * @param {callback|null} next
     * @param {object} userSession
     */
    local.haltedRequestUrlResumed = false;
    this.resumeHaltedRequest = function(req, res, next, userSession/**, requiredControllerOrNamespace*/) {
        
        if (local.haltedRequestUrlResumed)
            return;
        
        var haltedRequest = null;        
        if (
            typeof(userSession) == 'undefined' 
            ||
            typeof(userSession) != 'undefined' 
            && typeof(userSession.haltedRequest) == 'undefined' 
        ) {
            var error = new ApiError('`userSession.haltedRequest` is required', 424);
            self.throwError(error);
            return;
        }
        // request methods cleanup
        // checkout /framework/{verrsion}/core/template/conf/(settings.json).server.supportedRequestMethods
        var serverSupportedMethods = local.options.conf.server.supportedRequestMethods;
        for (let method in serverSupportedMethods) {
            delete req[method]; 
        }
               
        var haltedRequest   = userSession.haltedRequest;
        var data            = haltedRequest.data || {};
        var dataAsParams    = {};
        if (data.count() > 0){
            dataAsParams = JSON.parse(JSON.stringify(haltedRequest.data));
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
            if ( typeof(userSession.haltedRequest) != 'undefined' ) {
                delete userSession.haltedRequest;
            }
            delete userSession.haltedRequest;
            userSession.haltedRequestUrlResumed = url;
            requiredController.redirect(url, true);
        } else {
            local.onHaltedRequestResumed = function(err) {
                if (!err) {                    
                    delete userSession.haltedRequest;
                    delete userSession.inheritedData;
                }
            }
            requiredController[req.routing.param.control](req, res, local.onHaltedRequestResumed);
        }              
    }
    
    

    /**
     * Throw error
     *
     * @param {object} [ res ]
     * @param {number} code
     * @param {string} msg
     *
     * @return {void}
     * */
    this.throwError = function(res, code, msg) {
        self.isProcessingError = true;
        var errorObject = null; // to be returned
        // preventing multiple call of self.throwError() when controller is rendering from another required controller
        if (local.options.renderingStack.length > 1) {
            return false
        }
        // handle error fallback
        // err.fallback must be a valide route object or a url string
        var fallback = null;
        
        if ( arguments.length == 1 && typeof(res) == 'object' ) {
            code    = ( res && typeof(res.status) != 'undefined' ) ?  res.status : 500;
                //, errorObject   = res.stack || res.message || res.error || res.fallback
            var standardErrorMessage = null;
            if ( typeof(statusCodes[code]) != 'undefined' ) {
                standardErrorMessage = statusCodes[code];
            } else {
                console.warn('[ ApiValidator ] statusCode `'+ code +'` not matching any definition in `'+_( getPath('gina').core + '/status.codes')+'`\nPlease contact the Gina dev team to add one if required');
            }
            errorObject = {};

            if ( res instanceof Error) {
                errorObject.status   = code;
                errorObject.error   = standardErrorMessage || res.error || res.message;
                errorObject.stack   = res.stack;
                if (res.message && typeof(res.message) == 'string') {
                    errorObject.message = res.message;
                } else if (res.message) {
                    console.warn('[ Controller ] Ignoring message because of the format.\n'+res.message)
                }
                    
            } else {
                // formated error
                errorObject = JSON.parse(JSON.stringify(res))
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
        
                

        var req     = local.req;
        var next    = local.next;
        if (!res.headersSent) {
            // DELETE request methods don't normaly use a view,
            // but if we are calling it from a view, we should render the error back to the view
            if ( self.isXMLRequest() || !hasViews() && !/delete/i.test(req.method) || !local.options.isUsingTemplate && !hasViews() || hasViews() && !local.options.isUsingTemplate ) {
                // faaback interception
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

                // if ( !local.res.getHeaders()['content-type'] /**!req.headers['content-type'] */  ) {
                //     // Internet Explorer override
                //     if ( typeof(req.headers['user-agent']) != 'undefined' && /msie/i.test(req.headers['user-agent']) ) {
                //         res.writeHead(code, "content-type", "text/plain")
                //     } else {
                //         res.writeHead(code, { 'content-type': local.options.conf.server.coreConfiguration.mime['json']} );
                //     }
                // }
                
                // TODO - test with internet explorer then remove this if working
                if ( typeof(req.headers['user-agent']) != 'undefined' ) {
                    if ( /msie/i.test(req.headers['user-agent']) ) {
                        res.writeHead(code, "content-type", "text/plain")
                    } else {
                        res.writeHead(code, { 'content-type': req.headers['content-type']} )
                    }
                } else if ( typeof(req.headers['content-type']) != 'undefined' ) {
                    res.writeHead(code, { 'content-type': req.headers['content-type']} )
                } else {
                    res.writeHead(code, "content-type", local.options.conf.server.coreConfiguration.mime['json']+ '; charset='+ local.options.conf.encoding);
                }

                console.error('[ BUNDLE ][ '+ local.options.conf.bundle +' ][ Controller ] '+ req.method +' ['+res.statusCode +'] '+ req.url);
                
                if (!errorObject) {
                    errorObject = {
                        status: code,
                        //errors: msg.error || msg.errors || msg,
                        error: standardErrorMessage || msg.error || msg,
                        message: msg.message || msg,
                        stack: msg.stack
                    }
                }
                
                res.end(JSON.stringify(errorObject));
                return;
            } else {
                res.writeHead(code, { 'content-type': 'text/html'} );
                console.error(req.method +' ['+ res.statusCode +'] '+ req.url);

                //var msgString = msg.stack || msg.error || msg;
                var msgString = '<h1 class="status">Error '+ code +'.</h1>';
                var eCode = code.toString().substr(0,1);
                
                // if (!errorObject) {
                //     errorObject = {
                //         status: code,
                //         //errors: msg.error || msg.errors || msg,
                //         error: standardErrorMessage || msg.error || msg,
                //         message: msg.message || msg,
                //         stack: msg.stack
                //     }
                // }
                
                console.error('[ BUNDLE ][ '+ local.options.conf.bundle +' ][ Controller ] `this.'+ req.routing.param.control +'(...)` ['+res.statusCode +'] '+ req.url);
                if ( typeof(msg) == 'object' ) {

                    if (msg.title) {
                        msgString += '<pre class="'+ eCode +'xx title">'+ msg.title +'</pre>';
                    }

                    if (msg.error) {
                        msgString += '<pre class="'+ eCode +'xx message">'+ msg.error +'</pre>';
                    }

                    if (msg.message) {
                        msgString += '<pre class="'+ eCode +'xx message">'+ msg.message +'</pre>';
                    }

                    if (msg.stack) {

                        if (msg.error) {
                            msg.stack = msg.stack.replace(msg.error, '')
                        }

                        if (msg.message) {
                            msg.stack = msg.stack.replace(msg.message, '')
                        }

                        msg.stack = msg.stack.replace('Error:', '').replace(' ', '');
                        msgString += '<pre class="'+ eCode +'xx stack">'+ msg.stack +'</pre>';
                    }

                } else {
                    // Generic error
                    if (!msg && typeof(errorObject) != 'undefined' && typeof(errorObject.error) != 'undefined' ) {
                        msg = errorObject.error
                    }
                    msgString += '<pre class="'+ eCode +'xx message">'+ msg +'</pre>';
                    var stack = null;
                    if ( errorObject && typeof(errorObject) != 'undefined' && typeof(errorObject.stack) != 'undefined' ) {
                        stack = errorObject.stack
                        msgString += '<pre class="'+ eCode +'xx stack">'+ stack +'</pre>';
                    }                    
                }

                res.end(msgString);
                return;
            }
        } else {
            if (typeof(next) != 'undefined')
                return next();
        }
        res.end();
        return;
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