//"use strict";
//Imports.
var fs              = require('fs');
var os              = require('os');
var path            = require('path');
var EventEmitter    = require('events').EventEmitter;
var Busboy          = require('./deps/busboy');
const Stream        = require('stream');
var zlib            = require('zlib'); // gzip / deflate
var util            = require('util');
var Config          = require('./config');
var Router          = require('./router');
var lib             = require('./../lib');
var routingUtils    = lib.routing;         
var inherits        = lib.inherits;
var merge           = lib.merge;
var Proc            = lib.Proc;
var console         = lib.logger;

function Server(options) {

    // switching logger flow
    //console.switchFlow('server');

    var e       = new EventEmitter();
    var self    = this;
    var local   = {
        router : null,
        hasViews: {}
    };
    var Engine = null;

    this.conf = {
        core: {}
    };

    this.routing = {};
    //this.activeChild = 0;

    /**
     * Set Configuration
     * @param {object} options Configuration
     *
     *
     * @callback callback responseCallback
     * @param {boolean} complete
     * @public
     */
    var init = function(options) {
        
        self.projectName    = options.projectName;
        //Starting app.
        self.appName        = options.bundle;
        self.env            = options.env;        
        self.version        = options.version;
        local.router        = new Router(self.env);

        //True => multiple bundles sharing the same server (port).
        self.isStandalone   = options.isStandalone;
        self.executionPath  = options.executionPath;
        self.bundles        = options.bundles;

        if (!self.isStandalone) {
            //Only load the related conf / env.
            self.conf[self.appName] = {};
            self.conf[self.appName][self.env] = options.conf[self.appName][self.env];
            self.conf[self.appName][self.env].bundlesPath = options.conf[self.appName][self.env].bundlesPath;
            self.conf[self.appName][self.env].modelsPath =  options.conf[self.appName][self.env].modelsPath;            
        } else {

            //console.log("Running mode not handled yet..", self.appName, " VS ", self.bundles);
            //Load all conf for the related apps & env.
            var apps = self.bundles;
            for (var i=0; i<apps.length; ++i) {
                self.conf[apps[i]] = {};
                self.conf[apps[i]][self.env] = options.conf[apps[i]][self.env];
                self.conf[apps[i]][self.env].bundlesPath = options.conf[apps[i]][self.env].bundlesPath;
                self.conf[apps[i]][self.env].modelsPath = options.conf[apps[i]][self.env].modelsPath;                
            }
        }
        

        try {
            
            // updating server protocol
            var serverOpt = {};
            var ioServerOpt = null;
            if ( typeof(options.conf[self.appName][self.env].content.settings.ioServer) != 'undefined' ) {
                ioServerOpt = JSON.clone(options.conf[self.appName][self.env].content.settings.ioServer); 
            }
                    
               
            if ( 
                typeof(options.conf[self.appName][self.env].content.settings.server) != 'undefined' 
                && options.conf[self.appName][self.env].content.settings.server != ''
                && options.conf[self.appName][self.env].content.settings.server != null
            ) {
                serverOpt = options.conf[self.appName][self.env].content.settings.server;
            }
            
            serverOpt = merge({
                        bundle  : self.appName,
                        env     : self.env
                    }, 
                    serverOpt, 
                    {
                        engine: options.conf[self.appName][self.env].server.engine,
                        protocol: options.conf[self.appName][self.env].server.protocol,
                        scheme: options.conf[self.appName][self.env].server.scheme
                    }
            );
            
            self.engine = serverOpt.engine;
            console.debug('[ BUNDLE ][ server ][ init ] Initializing [ '+ self.appName +' ] server with `'+ serverOpt.engine +'`engine');
            
            // controlling one last time protocol & ports            
            var ctx         = getContext('gina'),
            projectConf     = ctx.project,
            //protocols       = projectConf.protocols,
            // TODO - check if the user prefered protocol is register in projectConf
            portsReverse    = ctx.portsReverse;
                        
            // locking port & protocol so it can't be changed by the user's settings
            self.conf[self.appName][self.env].server.protocol = serverOpt.protocol;
            self.conf[self.appName][self.env].server.scheme = serverOpt.scheme;
            self.conf[self.appName][self.env].server.engine = serverOpt.engine;
            
            serverOpt.port      = self.conf[self.appName][self.env].server.port = portsReverse[ self.appName +'@'+ self.projectName ][self.env][serverOpt.protocol][serverOpt.scheme];
            self.conf[self.appName][self.env].server.debugPort = getContext().debugPort;
            
            // engin.io options
            if ( ioServerOpt ) {
                serverOpt.ioServer = ioServerOpt
            }

            Engine = require('./server.' + ((typeof (serverOpt.engine) != 'undefined' && serverOpt.engine != '') ? serverOpt.engine : 'express'));
            var engine = new Engine(serverOpt);
            
            self.emit('configured', false, engine.instance, engine.middleware, self.conf[self.appName][self.env]);

        } catch (err) {
            
            console.emerg('[ BUNDLE ] [ '+ self.appName +' ] ServerEngine ' + err.stack)
            process.exit(1)
        }
    }
    
    this.isCacheless = function() {
        return (GINA_ENV_IS_DEV) ? true : false
    }

    this.onConfigured = function(callback) {
        self.once('configured', function(err, instance, middleware, conf) {
            callback(err, instance, middleware, conf)
        });

        init(options);
    }

    this.start = function(instance) {
        if (instance) {            
            self.instance       = instance;            
            //Router configuration.
            var router = local.router;
            
            instance.throwError         = throwError;
            instance.getAssets          = getAssets;
            instance.completeHeaders    = completeHeaders;
            
            router.setServerInstance(instance);
        }
        
        onRequest()
    }



    /**
     * onRoutesLoaded
     *
     *
     * */
    var onRoutesLoaded = function(callback) {

        var config                  = new Config()
            , conf                  = config.getInstance(self.appName)
            , serverCoreConf        = self.conf.core
            , routing               = {}
            , reverseRouting        = {}
            , cacheless             = config.isCacheless()
            , env                   = self.env
            , apps                  = conf.allBundles//conf.bundles
            , filename              = ''
            , appName               = ''
            , tmp                   = {}
            , standaloneTmp         = {}
            , main                  = ''
            , tmpContent            = ''
            , i                     = 0
            , file                  = null // template file
            , wroot                 = null
            , hasWebRoot            = false
            , webrootAutoredirect   = null
            , localWroot            = null
            , originalRules         = []
            , oRuleCount            = 0;

        //Standalone or shared instance mode. It doesn't matter.
        for (; i<apps.length; ++i) {
            config.setServerCoreConf(apps[i], self.env, serverCoreConf);

            var appPath = _(conf.envConf[apps[i]][self.env].bundlesPath+ '/' + apps[i]);
            appName     =  apps[i];

            //Specific case.
            if (!self.isStandalone && i == 0) appName = apps[i];

            try {
                main        = _(appPath + '/config/' + conf.envConf[apps[i]][self.env].configFiles.routing);
                filename    = main;//by default
                filename    = conf.envConf[apps[i]][self.env].configFiles.routing.replace(/.json/, '.' +env + '.json');
                filename    = _(appPath + '/config/' + filename);
                //Can't do a thing without.
                if ( !fs.existsSync(filename) ) {
                    filename = main
                }

                if (cacheless) {
                    delete require.cache[require.resolve(_(filename, true))]
                }

                if (filename != main) {
                    routing = tmpContent = merge(require(main), require(filename), true);

                } else {
                    try {
                        tmpContent = require(filename);
                    } catch (err) {
                        // do not block here because the bundle is not build for the same env
                        console.warn(err.stack);
                        continue
                    }
                }

                try {

                    wroot               = conf.envConf[apps[i]][self.env].server.webroot;
                    webrootAutoredirect = conf.envConf[apps[i]][self.env].server.webrootAutoredirect;
                    // renaming rule for standalone setup
                    if ( self.isStandalone && apps[i] != self.appName && wroot == '/') {
                        wroot = '/'+ apps[i];
                        conf.envConf[apps[i]][self.env].server.webroot = wroot
                    }

                    if (wroot.length >1) {
                        hasWebRoot = true
                    } else {
                        hasWebRoot = false
                    }

                    tmp = tmpContent;
                    //Adding important properties; also done in core/config.
                    for (var rule in tmp){
                        tmp[rule.toLowerCase() +'@'+ appName] = tmp[rule];
                        delete tmp[rule];
                        file = ruleShort = rule.toLowerCase();
                        rule = rule.toLowerCase() +'@'+ appName;


                        tmp[rule].bundle        = (tmp[rule].bundle) ? tmp[rule].bundle : apps[i]; // for reverse search
                        tmp[rule].param.file    = ( typeof(tmp) != 'string' && typeof(tmp[rule].param.file) != 'undefined' ) ? tmp[rule].param.file : file; // get template file
                        // by default, method is inherited from the request
                        if (
                            hasWebRoot && typeof(tmp[rule].param.path) != 'undefined' && typeof(tmp[rule].param.ignoreWebRoot) == 'undefined'
                            || hasWebRoot && typeof(tmp[rule].param.path) != 'undefined' && !tmp[rule].param.ignoreWebRoot
                        ) {
                            tmp[rule].param.path = wroot + tmp[rule].param.path
                        }

                        if (typeof(tmp[rule].url) != 'object') {
                            if (tmp[rule].url.length > 1 && tmp[rule].url.substr(0,1) != '/') {
                                tmp[rule].url = '/'+tmp[rule].url
                            }/** else if (tmp[rule].url.length > 1 && conf.envConf[apps[i]][self.env].server.webroot.substr(conf.envConf[apps[i]][self.env].server.webroot.length-1,1) == '/') {
                                tmp[rule].url = tmp[rule].url.substr(1)
                            }*/ else {
                                if (wroot.substr(wroot.length-1,1) == '/') {
                                    wroot = wroot.substr(wroot.length-1,1).replace('/', '')
                                }
                            }


                            if (tmp[rule].bundle != apps[i]) { // allowing to override bundle name in routing.json
                                // originalRule is used to facilitate cross bundles (hypertext)linking
                                originalRules[oRuleCount] = ( self.isStandalone && tmp[rule] && apps[i] != self.appName) ? apps[i] + '-' + rule : rule;
                                ++oRuleCount;

                                localWroot = conf.envConf[tmp[rule].bundle][self.env].server.webroot;
                                // standalone setup
                                if ( self.isStandalone && tmp[rule].bundle != self.appName && localWroot == '/') {
                                    localWroot = '/'+ routing[rule].bundle;
                                    conf.envConf[tmp[rule].bundle][self.env].server.webroot = localWroot
                                }
                                if (localWroot.substr(localWroot.length-1,1) == '/') {
                                    localWroot = localWroot.substr(localWroot.length-1,1).replace('/', '')
                                }
                                if ( typeof(tmp[rule].param.ignoreWebRoot) == 'undefined' || !tmp[rule].param.ignoreWebRoot )
                                    tmp[rule].url = localWroot + tmp[rule].url
                            } else {
                                if ( typeof(tmp[rule].param.ignoreWebRoot) == 'undefined' || !tmp[rule].param.ignoreWebRoot )
                                    tmp[rule].url = wroot + tmp[rule].url
                                else if (!tmp[rule].url.length)
                                    tmp[rule].url += '/'
                            }

                        } else {

                            for (var u=0; u<tmp[rule].url.length; ++u) {
                                if (tmp[rule].url[u].length > 1 && tmp[rule].url[u].substr(0,1) != '/') {
                                    tmp[rule].url[u] = '/'+tmp[rule].url[u]
                                } else {
                                    if (wroot.substr(wroot.length-1,1) == '/') {
                                        wroot = wroot.substr(wroot.length-1,1).replace('/', '')
                                    }
                                }
                                if ( typeof(tmp[rule].param.ignoreWebRoot) == 'undefined' || !tmp[rule].param.ignoreWebRoot )
                                    tmp[rule].url[u] = wroot + tmp[rule].url[u]
                                else if (!tmp[rule].url.length)
                                    tmp[rule].url += '/'
                            }
                        }

                        if( hasViews(apps[i]) ) {
                            // This is only an issue when it comes to the frontend dev
                            // views.routeNameAsFilenameEnabled is set to true by default
                            // IF [ false ] the action is used as filename
                            if ( !conf.envConf[apps[i]][self.env].content.templates['_common'].routeNameAsFilenameEnabled && tmp[rule].param.bundle != 'framework') {
                                var tmpRouting = [];
                                for (var r = 0, len = tmp[rule].param.file.length; r < len; ++r) {
                                    if (/[A-Z]/.test(tmp[rule].param.file.charAt(r))) {
                                        tmpRouting[0] = tmp[rule].param.file.substring(0, r);
                                        tmpRouting[1] = '-' + (tmp[rule].param.file.charAt(r)).toLocaleLowerCase();
                                        tmpRouting[2] = tmp[rule].param.file.substring(r + 1);
                                        tmp[rule].param.file = tmpRouting[0] + tmpRouting[1] + tmpRouting[2];
                                        ++r
                                    }
                                }
                            }
                        }

                        if ( self.isStandalone && tmp[rule]) {
                            standaloneTmp[rule] = JSON.clone(tmp[rule]);
                        }
                    }// EO for


                } catch (err) {
                    self.routing = routing = null;
                    console.error(err.stack||err.message);
                    callback(err)
                }

            } catch (err) {
                console.warn(err, err.stack||err.message);
                callback(err)
            }


            routing = merge(routing, ((self.isStandalone && apps[i] != self.appName ) ? standaloneTmp : tmp), true);
            // originalRule is used to facilitate cross bundles (hypertext)linking
            for (var r = 0, len = originalRules.length; r < len; r++) { // for each rule ( originalRules[r] )
                routing[originalRules[r]].originalRule = (routing[originalRules[r]].bundle === self.appName ) ?  config.getOriginalRule(originalRules[r], routing) : config.getOriginalRule(routing[originalRules[r]].bundle +'-'+ originalRules[r], routing)
            }

            // reverse routing
            for (var rule in routing) {
                if ( typeof(routing[rule].url) != 'object' ) {
                    reverseRouting[routing[rule].url] = rule
                } else {
                    for (var u = 0, len = routing[rule].url.length; u < len; ++u) {
                        reverseRouting[routing[rule].url[u]] = rule
                    }
                }
            }

            config.setRouting(apps[i], self.env, routing);
            config.setReverseRouting(apps[i], self.env, reverseRouting);

            if (apps[i] == self.appName) {
                self.routing        = routing;
                self.reverseRouting = reverseRouting
            }

        }//EO for.
        

        callback(false)
    }

    var hasViews = function(bundle) {
        var _hasViews = false, conf = new Config().getInstance(bundle);
        if (typeof(local.hasViews[bundle]) != 'undefined') {
            _hasViews = local.hasViews[bundle];
        } else {
            _hasViews = ( typeof(conf.envConf[bundle][self.env].content['templates']) != 'undefined' ) ? true : false;
            local.hasViews[bundle] = _hasViews;
        }

        return _hasViews
    }

    var parseCollection = function (collection, obj) {

        for(var i = 0, len = collection.length; i<len; ++i) {
            obj[i] = parseObject(collection[i], obj);
        }

        return obj
    }

    var parseObject = function (tmp, obj) {
        var el      = []
            , key   = null
        ;

        for (var o in tmp) {
            
            el[0]   = o;
            el[1]   = tmp[o];

            if ( /^(.*)\[(.*)\]/.test(el[0]) ) { // some[field] ?
                key = el[0].replace(/\]/g, '').split(/\[/g);
                obj = parseLocalObj(obj, key, 0, el[1])
            } else {
                obj[ el[0] ] = el[1]
            }
        }

        return obj
    }

    var parseBody = function(body) {

        if ( /^(\{|\[|\%7B|\%5B)/.test(body) ) {
            try {
                var obj = {}, tmp = null;

                if ( /^(\%7B|\%5B)/.test(body) ) {
                    tmp = JSON.parse(decodeURIComponent(body))
                } else {
                    tmp = JSON.parse(body)
                }

                if ( Array.isArray(tmp) ) {
                    obj = parseCollection(tmp, obj)
                } else {
                    obj = parseObject(tmp, obj)
                }

                return obj
            } catch (err) {
                console.error('[365] could not parse body:\n' + body)
            }

        } else {
            var obj = {}, arr = body.split(/&/g);
            if ( /(\"false\"|\"true\"|\"on\")/.test(body) )
                body = body.replace(/\"false\"/g, false).replace(/\"true\"/g, true).replace(/\"on\"/g, true);


            var el      = {}
                , value = null
                , key   = null;

            for (var i = 0, len = arr.length; i < len; ++i) {
                if (!arr[i]) continue;

                arr[i] = decodeURIComponent(arr[i]);

                if ( /^\{/.test(arr[i]) || /\=\{/.test(arr[i]) || /\=\[/.test(arr[i]) ) {
                    //if ( /^\{/.test(arr[i]) ) { // is a json string
                    try {
                        if (/^\{/.test(arr[i])) {
                            obj = JSON.parse(arr[i]);
                            break;
                        } else {
                            el = arr[i].match(/\=(.*)/);
                            el[0] =  arr[i].split(/\=/)[0];
                            obj[ el[0] ] = JSON.parse( el[1] );
                        }


                    } catch (err) {
                        console.error('[parseBody#1] could not parse body:\n' + arr[i])
                    }
                } else {
                    el = arr[i].split(/=/);
                    if ( /\{\}\"\:/.test(el[1]) ) { //might be a json
                        try {
                            el[1] = JSON.parse(el[1])
                        } catch (err) {
                            console.error('[parseBody#2] could not parse body:\n' + el[1])
                        }
                    }

                    if ( typeof(el[1]) == 'string' && !/\[object /.test(el[1])) {
                        key     = null;
                        el[0]   = decodeURIComponent(el[0]);
                        el[1]   = decodeURIComponent(el[1]);

                        if ( /^(.*)\[(.*)\]/.test(el[0]) ) { // some[field] ?
                            key = el[0].replace(/\]/g, '').split(/\[/g);
                            obj = parseLocalObj(obj, key, 0, el[1])
                        } else {
                            obj[ el[0] ] = el[1]
                        }
                    }
                }
            }

            return obj
        }


    }

    var parseLocalObj = function(obj, key, k, value) {

        if ( typeof(obj[ key[k] ]) == 'undefined' ) {
            obj[ key[k] ] = {};
        }

        for (var prop in obj) {

            if (k == key.length-1) {

                if (prop == key[k]) {
                    obj[prop] = ( typeof(value) != 'undefined' ) ? value : '';
                }

            } else if ( key.indexOf(prop) > -1 ) {
                ++k;
                if ( !obj[prop][ key[k] ] )
                    obj[prop][ key[k] ] = {};


                parseLocalObj(obj[prop], key, k, value)

            }
        }

        return obj;
    }
    
    var getAssetFilenameFromUrl = function(bundleConf, url) {        
        
        var staticsArr  = bundleConf.publicResources;
        url = decodeURIComponent( url );
        var staticProps = {
            firstLevel  : '/'+ url.split(/\//g)[1] + '/',
            isFile      :  /^\/[A-Za-z0-9_-]+\.(.*)$/.test(url)
        };
        var notFound = '404.html'
        
        var filename        = null
            , path          = null
            , altConf       = ( typeof(staticProps.firstLevel) != 'undefined' && typeof(self.conf.reverseRouting) != 'undefined' ) ? self.conf.reverseRouting[staticProps.firstLevel] : false
            , backedupPath  = null
        ;
        if ( 
            staticProps.isFile && staticsArr.indexOf(url) > -1 
            || staticsArr.indexOf(staticProps.firstLevel) > -1
            || typeof(altConf) != 'undefined' && altConf
        ) {            
            
            // by default
            path = url.replace(url.substr(url.lastIndexOf('/')+1), '');
            if ( typeof(altConf) != 'undefined' && altConf ) {
                bundleConf = self.conf[altConf.split(/\@/)[1]][bundleConf.env];
                backedupPath = path;
                path = path.replace(staticProps.firstLevel, '/');
            }
            
            
            // catch `statics.json` defined paths || bundleConf.staticResources.indexOf(url.replace(url.substr(url.lastIndexOf('/')+1), '')) > -1
            if (  bundleConf.staticResources.indexOf(path) > -1 || bundleConf.staticResources.indexOf(staticProps.firstLevel) > -1 ) {
                if ( typeof(altConf) != 'undefined' && altConf && backedupPath ) {
                    filename = (bundleConf.staticResources.indexOf(path) > -1) ? bundleConf.content.statics[path] + url.replace(backedupPath, '/') : bundleConf.content.statics[staticProps.firstLevel] + url.replace(staticProps.firstLevel, '/');
                } else {
                    filename = (bundleConf.staticResources.indexOf(path) > -1) ? bundleConf.content.statics[path] + url.replace(path, '/') : bundleConf.content.statics[staticProps.firstLevel] + url.replace(staticProps.firstLevel, '/');
                }
            } else {
                filename = ( bundleConf.staticResources.indexOf(url) > -1 ) ? bundleConf.content.statics[url] : bundleConf.publicPath + url;
            }
            
        
            if ( !fs.existsSync(filename) )
                return notFound;
                
            return filename
            
        } else {
            return notFound
        }
    }
    
    var readFromUrl = function(url, encoding) {
        return new (require('httpclient').HttpClient)({
            method: 'GET',
              url: url
            }).finish().body.read().decodeToString();
    }
    
    /**
     * Get Assets
     * 
     * @param {object} bundleConf
     * @param {string} layoutStr
     * @param {object} [swig] - when called from controller
     * @param {object} [data] - when called from controller
     */
    var getAssets = function (bundleConf, layoutStr, swig, data) {
        
        // layout search for <link|script|img>
        var layoutAssets        = layoutStr.match(/<link .*?<\/link>|<link .*?(rel\=\"(stylesheet|icon|manifest|(.*)\-icon))(.*)|<script.*?<\/script>|<img .*?(.*)/g) || [];
        
        var assets      = {}
            , cssFiles  = []
            , aCount    = 0
            , i         = 0
            , len       = 0
            , domain    = null
            , key       = null // [ code ] url
            , ext       = null
            , url       = null
            , filename  = null
        ;
        
        // user's defineds assets
        var layoutClasses     = [];
                       
        // layout assets
        i   = 0;
        len = layoutAssets.length;         
        var type            = null
            , isAvailable   = null
            , tag           = null
            , properties    = null
            , p             = 0
            , pArr          = []            
        ;
        for (; i < len; ++i) {
            
            if ( 
                !/(\<img|\<link|\<script)/g.test(layoutAssets[i])
                || /\<img/.test(layoutAssets[i]) &&  /srcset/.test(layoutAssets[i]) // not able to handle this case for now
            ) {
                continue;
            }                
            
            if ( /\<img/.test(layoutAssets[i]) ) {
                type    = 'image';
                tag     = 'img'; 
            }
            
            if ( /\<script/.test(layoutAssets[i]) ) {
                type    = 'javascript';
                tag     = 'script'; 
            }
            
            if ( /\<link/.test(layoutAssets[i]) ) {
                if ( /rel\=\"stylesheet/.test(layoutAssets[i]) ) {
                    type    = 'stylesheet';
                } else if ( /rel\=\"(icon|(.*)\-icon)/.test(layoutAssets[i]) ) {
                    type    = 'image';
                } else {
                    type = 'file';
                }
                
                tag     = 'link'; 
            }
            
            domain  = null;
            try {
                url     = layoutAssets[i].match(/(src|href)\=(\".*?\"|\'.*?\')/)[0];
            } catch (err) {
                console.warn('Problem with this asset ('+ i +'/'+ len +'): '+ layoutAssets[i].substr(0, 80) +'...');
                continue;
            }
            
            
            if ( /data\:/.test(url) ) { // ignoring "data:..."
                continue
            }
            url = url.replace(/((src|href)\=\"|(src|href)\=\'|\"|\')/g, '');
            if (swig && /^\{\{/.test(url) )
                url = swig.compile(url)(data);
            
            if (!/(\:\/\/|^\/\/)/.test(url) ) {
                filename = getAssetFilenameFromUrl(bundleConf, url);
            } else {
                domain      = url.match(/^.*:\/\/[a-z0-9._-]+\/?/);
                //url         = ( new RegExp('/'+ bundleConf.host +'/' ).test(domain) ) ? url.replace(domain, '/') : url;
                
                if ( ! new RegExp('/'+ bundleConf.host +'/' ).test(domain) ) {
                    continue;
                }
                
                url         = url.replace(domain, '/');
                filename    = url
            }
            //key =  (( /404/.test(filename) ) ? '[404]' : '[200]') +' '+ url;
            key         = url;
            isAvailable =  ( /404/.test(filename) ) ? false : true;
            if ( isAvailable ) {
                try {
                    ext         = url.substr(url.lastIndexOf('.')).match(/(\.[A-Za-z0-9]+)/)[0];
                } catch(err) {
                    
                    console.warn('No extension found for `'+ filename +'`\n'+ err.stack );
                    ext = null
                }
            }
            
            
            assets[key] = {
                type        : type,
                url         : url,
                ext         : ext,
                mime        : (!ext) ? 'NA' : (bundleConf.server.coreConfiguration.mime[ext.substr(1)] || 'NA'),
                filename    : ( /404/.test(filename) ) ? 'not found' : filename,
                isAvailable : isAvailable
            };
            
            if (domain)
                assets[key].domain = domain;
            
            if ( type == 'stylesheet' && !/not found/.test(assets[key].filename) ) {
                cssFiles.push(assets[key].filename)
            }
            
            properties = layoutAssets[i].replace( new RegExp('(\<'+ tag +'\\s+|\>|\/\>|\<\/'+ tag +'\>)', 'g'), '').replace(/[A-Za-z]+\s+/, '$&="true" ').split(/\"\s+/g);
            p = 0;
            
            for (; p < properties.length; ++p ) {
                
                pArr = properties[p].split(/\=/g);
                if ( /(src|href)/.test(pArr[0]) )
                    continue;
                    
                assets[key][pArr[0]] = (pArr[1]) ? pArr[1].replace(/\"/g, '') : pArr[1];            
            }            
            //++aCount            
        }
        
        // getting layout css classes in order to retrieve active css assets from <asset>.css
        var classesArr = layoutStr.match(/class=\"([A-Za-z0-9_-\s+]+)\"?/g);
        
        if ( classesArr ) {
            var cCount      = 0
                , cArr      = null
                , cArrI     = null
                , cArrLen   = null
            ;
            i = 0;
            len = classesArr.length;
            for (; i < len; ++i) {
                classesArr[i] = classesArr[i].replace(/(\"|class\=)/g, '').trim();
                
                if ( /\s+/g.test(classesArr[i]) ) {
                    cArrI   = 0;                
                    cArr    = classesArr[i].replace(/\s+/g, ',').split(/\,/g);
                    //cArr    = classesArr[i].split(/\s+/g);
                    cArrLen = cArr.length;
                    
                    for (; cArrI < cArrLen; ++cArrI) {
                        
                        if ( layoutClasses.indexOf( cArr[cArrI] ) < 0) {
                            layoutClasses[cCount] = cArr[cArrI];
                            
                            ++cCount
                        }
                    }
                    continue;
                }
                
                if ( layoutClasses.indexOf( classesArr[i] ) < 0) {
                    layoutClasses[cCount] = classesArr[i];
                    ++cCount
                }            
            }
            assets._classes = { 
                total: layoutClasses.length,
                list: layoutClasses.join(', ')
            };
            
            // parsing css files
            i = 0, len = cssFiles.length;
            var cssContent = null
                , hasUrls   = null
                , definition = null
                , defName   = null
                , d = null
                , dLen = null
                , cssMatched = null
            ;
            var cssArr = null, classNames = null, assetsInClassFound = {};
            for (; i < len; ++i) {
                //if ( /^(http|https)\:/.test(cssFiles[i]) ) {
                //    cssContent = readFromUrl(cssFiles[i], bundleConf.encoding);
                //} else {
                    cssContent = fs.readFileSync(cssFiles[i], bundleConf.encoding).toString();
                //}
                
                hasUrls = ( /(url\(|url\s+\()/.test(cssContent) ) ? true : false;
                if (!hasUrls) continue;
                
                cssArr = cssContent.split(/}/g);
                for (let c = 0; c < cssArr.length; ++c) {
                    
                    if ( /(\@media|\@font-face)/.test(cssArr[c]) ) { // one day maybe !
                        continue
                    }
                    
                    if ( /(url\(|url\s+\()/.test(cssArr[c]) && !/data\:|\@font-face/.test(cssArr[c]) ) {
                        
                        url = cssArr[c].match(/((background\:url|url)+\()([A-Za-z0-9->~_.,:"'%/\s+]+).*?\)+/g)[0].replace(/((background\:url|url)+\(|\))/g, '').trim();                    
                        if ( typeof(assetsInClassFound[url]) != 'undefined') continue; // already defined
                        
                        //cssMatched = cssArr[c].match(/((\.[A-Za-z0-9-_.,;:"'%\s+]+)(\s+\{|{))/);
                        cssMatched = cssArr[c].match(/((\.[A-Za-z0-9->~_.,;:"'%\s+]+)(\s+\{|{))/);
                        if ( !cssMatched ) { // might be a symbol problem : not supported by the regex
                            console.warn('[ HTTP2 ][ ASSETS ][ cssMatchedException ] `'+ cssFiles[i] +'`: unable to match definition for url : '+ url +'\n'+ cssArr[c]);
                            continue;
                        }
                        definition = cssMatched[0].replace(/\{/g, '');
                        
                        classNames = definition.replace(/\./g, '').split(/\s+/);
                                        
                        
                        for( let clss = 0; clss < classNames.length; ++clss) {
                            // this asset is in use
                            if ( layoutClasses.indexOf(classNames[clss] < 0 && typeof(assetsInClassFound[url]) == 'undefined') ) {
                                //console.debug(' found -> (' +  url +')');
                                assetsInClassFound[url] = true;
                                // assetsInClassFound[url] = {
                                //     cssFile: cssFiles[i],
                                //     definition: definition,
                                //     url: url
                                // }     
                                if (!/(\:\/\/|^\/\/)/.test(url) ) {
                                    filename = getAssetFilenameFromUrl(bundleConf, url);
                                } else {
                                    domain      = url.match(/^.*:\/\/[a-z0-9._-]+\/?/);
                                    url         = url.replace(domain, '/');
                                    filename    = url
                                }
                                
                                //key =  (( /404/.test(filename) ) ? '[404]' : '[200]') +' '+ url;
                                key         = url;
                                isAvailable =  ( /404/.test(filename) ) ? false : true;
                                ext         = url.substr(url.lastIndexOf('.')).match(/(\.[A-Za-z0-9]+)/)[0];
                                assets[key] = {
                                    referrer    : cssFiles[i],
                                    definition  : definition,
                                    type        : type,
                                    url         : url,
                                    ext         : ext,
                                    mime        : bundleConf.server.coreConfiguration.mime[ext.substr(1)] || 'NA',
                                    filename    : ( /404/.test(filename) ) ? 'not found' : filename
                                };  
                                
                                if (domain)
                                    assets[key].domain = domain;
                                
                                break;                    
                            }
                        }
                    }
                    //font-family: source-sans-pro, sans-serif;
                    
                    
                }
                
                // match all definitions .xxx {}
                //definitions = cssContent.match(/((\.[A-Za-z0-9-_.\s+]+)+(\s+\{|{))([A-Za-z0-9-@'"/._:;()\s+]+)\}/g);
                //definitions = cssContent.match(/((\.[A-Za-z0-9-_.\s+]+)+(\s+\{|{))?/g);
                // d = 0, dLen = definitions.length;
                // for (; d < dLen; ++d) {
                //     if ( definitions[d] )
                // }
                
                // fonts, images, background - attention required to relative paths !!
                //var inSourceAssets = cssContent.match(/((background\:url|url)+\()([A-Za-z0-9-_."']+).*?\)+/g);
            }
            
            assets._cssassets = assetsInClassFound.count();
        } // EO if (classesArr) {
        
            
        
        // TODO - report
        /**
         * assets._report = {
         *      total   : ${int: aCount}, // assets count
         *      warning : [
         *          {
         *              message: "too many requests",
         *              hint: "you should lower this"
         *          },
         *          {...}
         *      ],
         *      error: [
         *          {
         *              message: "${int: eCount} asset(s) not found",
         *              hint: "check your assets location"
         *          },
         *          {
         *              
         *          }
         *      ]
         * }
         */
        
        if (swig) {
            var assetsStr = JSON.stringify(assets);        
            assets = swig.compile( assetsStr.substring(1, assetsStr.length-1) )(data);
            return '{'+ assets +'}'
        } else {
            return assets
        }
    }
    
    // var getHeaderFromPseudoHeader = function(header) {
        
    //     var htt2Headers = {
    //         ':status'   : 'status',
    //         ':method'   : 'method',
    //         ':authority': 'host',
    //         ':scheme'   : 'scheme', // not sure
    //         ':path'     : 'path', // not sure
    //         ':protocol' : 'protocol' // not sure
    //     };
        
    //     if ( typeof(htt2Headers[header]) != 'undefined' ) {
    //         return htt2Headers[header]
    //     }
        
    //     return header
    // }
    
    var completeHeaders = function(responseHeaders, request, response) {
        
        var resHeaders      = null
            , referer       = null
            , authority     = null
            , method        = null
            , scheme        = null
            , re            = null
            , allowedOrigin = null
            , sameOrigin    = false
            , conf          = self.conf[self.appName][self.env]
        ;
        
        if ( typeof(responseHeaders) == 'undefined' || !responseHeaders) {
            responseHeaders = {};
        }
        
        // Copy to avoid override
        resHeaders  = JSON.clone(conf.server.response.header);
        if ( typeof(request.routing) == 'undefined' ) {
            request.routing = {
                'url': request.url,
                'method': request.method
            }
        }
        // Should not override main server.response.header.methods
        resHeaders['access-control-allow-methods'] = request.routing.method.replace(/(\,\s+|\,)/g, ', ').toUpperCase();                                            
        
                                                    
        if ( typeof(request.headers.origin) != 'undefined' ) {
            authority = request.headers.origin;
        } else if (request.headers.referer) {
            referer = request.headers.referer.match(/[^http://|^https://|][a-z0-9-_.:]+\//)[0];
            referer = request.headers.referer.match(/^(http|https)\:\/\/?/)[0] + referer.substring(0, referer.length-1);
        }
        
        // access-control-allow-origin settings
        if ( resHeaders.count() > 0 ) {
            // authority by default if no Access Control Allow Origin set
            //authority = ( typeof(referer) != 'undefined') ? conf.server.scheme +'://'+ request.headers.referer.match(/:\/\/(.[^\/]+)(.*)/)[1] : (request.headers[':scheme'] +'://'+request.headers[':authority'] || conf.server.scheme +'://'+request.headers.host || null);
            if (!authority) {
                if (!referer) {
                    if ( /http\/2/.test(conf.server.protocol) ) {
                        authority   = request.headers[':authority'] || request.headers.host;
                        scheme      = request.headers[':scheme'] || request.headers['x-forwarded-proto'] || conf.server.scheme;                                                    
                    } else {
                        authority   = request.headers.host;
                        scheme      = ( new RegExp(authority).test(referer) ) ? referer.match(/^http(.*)\:\/\//)[0].replace(/\:\/\//, '') : conf.server.scheme;
                    }
                    authority = scheme +'://'+ authority;
                } else {
                    authority   = referer;
                    sameOrigin  = authority;
                }  
            }  
            
            if (!sameOrigin && conf.hostname == authority || !sameOrigin && conf.hostname.replace(/\:\d+$/, '') == authority.replace(/\:\d+$/, '') ) {
                sameOrigin = authority
            }
            
            re = new RegExp(authority);
            allowedOrigin = ( typeof(conf.server.response.header['access-control-allow-origin']) != 'undefined' && conf.server.response.header['access-control-allow-origin'] != '' ) ? conf.server.response.header['access-control-allow-origin'] : authority;
            var found = null, origin = null, origins = null; // to handles multiple origins
            var originHostReplacement = function(name) {
                name = name.split(/\@/);
                var bundle      = name[0]
                    , project   = name[1]
                    , arr       = null
                    , domain    = null
                ;
                var env     = conf.env; // current env by default
                if ( /\//.test(name[1]) ) {
                    arr     = name[1].split(/\//);
                    project = arr[0];
                    env     = (arr[1]) ? arr[1] : env;
                }        
                
                domain      = ( !/^http/.test(self.conf[bundle][env].hostname) || /^\/\//.test(self.conf[bundle][env].hostname) ) ? scheme +'://'+ self.conf[bundle][env].hostname.replace(/^\/\//, '') : self.conf[bundle][env].hostname;
                sameOrigin  = (domain == self.conf[bundle][env].hostname) ? self.conf[bundle][env].hostname : false; 
                
                return domain
            }
                        
            var headerValue = null;
            for (var h in resHeaders) {                
                if (!response.headersSent) {                    
                    // handles multiple origins
                    if ( /access\-control\-allow\-origin/i.test(h) ) { // re.test(resHeaders[h]    
                        if (sameOrigin) {
                            origin = sameOrigin
                        } else {
                            if ( /\,/.test(allowedOrigin) ) {
                                origins = allowedOrigin.replace(/\s+/g, '').replace(/([a-z0-9_-]+\@[a-z0-9_-]+|[a-z0-9_-]+\@[a-z0-9_-]+\/[a-z0-9_-]+\@[a-z0-9_-]+)/ig, originHostReplacement).split(/\,/g);                                                                
                                
                                found = ( origins.indexOf(authority) > -1 ) ? origins[origins.indexOf(authority)] : false;
                                if ( found != false ) {
                                    origin = found
                                }
                            } else {
                                origin = allowedOrigin
                            }
                        }
                        
                        if (origin || sameOrigin) {
                            if (!origin && sameOrigin)
                                origin = sameOrigin;
                            
                            
                            response.setHeader(h, origin);                                                                                          
                        }                                 
                        sameOrigin = false;                               
                    } else { 
                        headerValue = resHeaders[h]; 
                        try {
                            response.setHeader(h, headerValue)                   
                        } catch (headerError) {
                            console.error(headerError)
                        }              
                                               
                    }
                }                    
            }
        } 
        
        // update response
        try {
            if ( responseHeaders && responseHeaders.count() > 0 ) {
                return merge(responseHeaders, response.getHeaders());
            }        
            return response.getHeaders();   
        } catch(err) {
            return responseHeaders
        }
    }
    
    this.onHttp2Stream = function(stream, headers, response) {
                
        if (!stream.pushAllowed) { 
            //header = merge({ ':status': 200 }, response.getHeaders());
            stream.respond({ ':status': 200 });
            stream.end();
            return; 
        }
        
        if (stream.headersSent) return;
        
        if ( !this._options.template ) {            
            throwError({stream: stream}, 500, 'Internal server error\n' + headers[':path'] + '\nNo template found');
        }
        
        var header = null, isWebroot = false, pathname = null;
        if ( 
            headers[':path'] == '/'
            || headers[':path'] == this._options.conf.server.webroot      
        ) {
            
            if (
                this._options.conf.server.webroot != headers[':path']
                && this._options.conf.server.webrootAutoredirect 
                || headers[':path'] == this._options.conf.server.webroot
                    && this._options.conf.server.webrootAutoredirect 
            ) {
                                
                header = {
                    ':status': 301
                };
                
                if (cacheless) {
                    header['cache-control'] = 'no-cache, no-store, must-revalidate';
                    header['pragma'] = 'no-cache';
                    header['expires'] = '0';  
                }
                header['location'] = this._options.conf.server.webroot;
                
                stream.respond(header);
                stream.end();
                return;  
            } else {
                isWebroot = true;
            }                    
        }
        
        if ( 
            typeof(this._options.template.assets) != 'undefined'
            && typeof(this._options.template.assets[ headers[':path'] ]) != 'undefined' 
            && this._options.template.assets[ headers[':path'] ].isAvailable             
            || isWebroot   
        ) {
            // by default
            header = { 
                ':status': 200
            };
            var url = (isWebroot) ? this._referrer : headers[':path'];
            var assets = this._options.template.assets;
            var responseHeaders = ( typeof(this._responseHeaders) != 'undefined') ? this._responseHeaders : null;
            var conf = this._options.conf;
            var asset = {
                    url         : url,
                    filename    : assets[ url ].filename,
                    file        : null,
                    isAvailable : assets[ url ].isAvailable,
                    mime        : assets[ url ].mime,
                    encoding    : conf.encoding,
                    isHandler   : false
                }
                , cacheless = conf.cacheless
            ;
            
            console.debug('h2 pushing: '+ headers[':path'] + ' -> '+ asset.filename);
            
            // adding handler `gina.ready(...)` wrapper
            if ( new RegExp('^'+ conf.handlersPath).test(asset.filename) ) {
                
                if ( !fs.existsSync(asset.filename) ) {
                    throwError({stream: stream}, 404, 'Page not found: \n' + headers[':path']);   
                    // header[':status'] = 404;
                    // //console.info(headers[':method'] +' ['+ header[':status'] +'] '+ headers[':path'] + '\n' + (err.stack|err.message|err));
                    // stream.respond(header);
                    // stream.end()
                }
                    
                asset.isHandler = true;
                asset.file      = fs.readFileSync(asset.filename, asset.encoding).toString();                
                asset.file      = '(gina.ready(function onGinaReady($){\n'+ asset.file + '\n},window["originalContext"]));';
                
                stream.respond(header);
                stream.end(asset.file);
                
                return;                
            }
            
            stream.pushStream({ ':path': headers[':path'] }, function onPushStream(err, pushStream, headers){
                
                
                if ( err ) {
                    header[':status'] = 500;
                    if (err.code === 'ENOENT' || !asset.isAvailable ) {
                        header[':status'] = 404;
                    } 
                    //console.info(headers[':method'] +' ['+ header[':status'] +'] '+ headers[':path'] + '\n' + (err.stack|err.message|err));
                    var msg = ( header[':status'] == 404 ) ? 'Page not found: \n' + asset.url :  'Internal server error\n' + (err.stack|err.message|err)
                    throwError({stream: pushStream}, header[':status'], msg);   
                    // stream.respond(header);
                    // stream.end();
                    // return;
                }
                
                
                header['content-type'] = ( !/charset/.test(asset.mime ) ) ? asset.mime + '; charset='+ asset.encoding : asset.mime;
                
                if (cacheless) {
                    // source maps integration for javascript & css
                    if ( /(.js|.css)$/.test(asset.filename) && fs.existsSync(asset.filename +'.map') ) {
                        //pathname = asset.filename +'.map';
                        pathname = headers[':path'] +'.map';    
                        // serve without cache
                        header['X-SourceMap'] = pathname;
                        header['cache-control'] = 'no-cache, no-store, must-revalidate';
                        header['pragma'] = 'no-cache';
                        header['expires'] = '0';
                    }    
                }                       
                
                if (responseHeaders) {
                    header = merge(header, responseHeaders);
                }
                header = completeHeaders(header, local.request, response);
                pushStream.respondWithFile( 
                    asset.filename
                    , header
                    //, { onError }
                );            
                                           
            });
        } else {
            var status = 404;
            if ( /\/$/.test(headers[':path']) && this._options.template.assets[ headers[':path'] +'index.html' ].isAvailable   ) { // preview of directory is forbidden
                status = 403;
                headers[':status'] = status;
            }
            return throwError({stream: stream}, status, 'Page not found: \n' + headers[':path']);      
        }       
    }
    
    
    
    var getResponseProtocol = function (response) {
        
        var protocol    = 'http/'+ local.request.httpVersion; // inheriting request protocol version by default
        var bundleConf  = self.conf[self.appName][self.env];
        // switching protocol to h2 when possible
        if ( /http\/2/.test(bundleConf.server.protocol) && response.stream ) {            
            protocol    = bundleConf.server.protocol;                       
        }
        
        return protocol;
    }
    
    /**
     * Default http/1.x statics handler - For http/2.x check the SuperController
     * @param {object} staticProps - Expected : .isStaticFilename & .firstLevel
     * @param {object} request 
     * @param {object} response 
     * @param {callback} next 
     */
    var handleStatics = function(staticProps, request, response, next) {        
        
        
        var conf            = self.conf
            , bundleConf    = conf[self.appName][self.env]
            , webroot       = bundleConf.server.webroot
            , re            = new RegExp('^'+ webroot)
            , publicPathRe  = new RegExp('^'+ bundleConf.publicPath)
            , pathname      = ( webroot.length > 1 && re.test(request.url) ) ? request.url.replace(re, '/') : request.url
            , contentType   = null
            , stream        = null
            , header        = null
            , protocol      = getResponseProtocol(response)
        ;
        
        
        // h2 protocol response option
        if ( /http\/2/.test(protocol) ) {
            
            stream = response.stream;            
            
            if ( typeof(self._options) == 'undefined') {
                self._options       = {
                    template: {
                        assets: {}                                           
                    },
                    conf: bundleConf
                }
            }
            
            self._options.conf = bundleConf
        }
                
        var cacheless       = bundleConf.cacheless;  
        // by default
        var filename        = bundleConf.publicPath + pathname;
        var isFilenameDir   = null
            , dirname       = null
            , isBinary      = null
            , hanlersPath   = null
        ;
        
        // catch `statics.json` defined paths
        var staticIndex     = bundleConf.staticResources.indexOf(pathname);
        if ( staticProps.isStaticFilename && staticIndex > -1 ) {
            filename =  bundleConf.content.statics[ bundleConf.staticResources[staticIndex] ]
        } else {
            var s = 0, sLen = bundleConf.staticResources.length;
            for ( ; s < sLen; ++s ) {
                //if ( new RegExp('^'+ bundleConf.staticResources[s]).test(pathname) ) {                 
                if ( eval('/^' + bundleConf.staticResources[s].replace(/\//g,'\\/') +'/').test(pathname) ) {
                    filename = bundleConf.content.statics[ bundleConf.staticResources[s] ] +'/'+ pathname.replace(bundleConf.staticResources[s], '');
                    break;
                }
            } 
        }
                
        filename = decodeURIComponent(filename);
        fs.exists(filename, function onStaticExists(exist) {
            
            if (!exist) {
                throwError(response, 404, 'Page not found: \n' + pathname, next);
            } else {
                
                isFilenameDir = fs.statSync(filename).isDirectory();
                if ( isFilenameDir ) {
                    dirname = request.url;
                    filename += 'index.html';
                    request.url += 'index.html';
                    
                    if ( !fs.existsSync(filename) ) {
                        throwError(response, 403, 'Forbidden: \n' + pathname, next);      
                    } else {
                        var ext = 'html';
                        if ( /http\/2/.test(protocol) ) {
                            header = {
                                ':status': 301,
                                'location': request.url,
                                'content-type': bundleConf.server.coreConfiguration.mime[ext]+'; charset='+ bundleConf.encoding
                            };
                            
                            if (cacheless) {
                                header['cache-control'] = 'no-cache, no-store, must-revalidate';
                                header['pragma'] = 'no-cache';
                                header['expires'] = '0';  
                            }
                            request = checkPreflightRequest(request);
                            header  = completeHeaders(header, request, response);
                            
                            if (!stream.destroyed) {
                                stream.respond(header);
                                stream.end();
                            }                            
                            
                        } else {
                            response.setHeader('location', request.url);
                            request = checkPreflightRequest(request);
                            completeHeaders(null, request, response);
                            if (cacheless) {
                                response.writeHead(301, {                                    
                                    'cache-control': 'no-cache, no-store, must-revalidate', // preventing browsers from using cache
                                    'pragma': 'no-cache',
                                    'expires': '0',
                                    'content-type': bundleConf.server.coreConfiguration.mime[ext]
                                });
                            }                            
                            response.end()                                                        
                        }
                    }
                    return;
                }
                    

                if (cacheless)
                    delete require.cache[require.resolve(filename)];
                
                
                fs.readFile(filename, bundleConf.encoding, function onStaticFileRead(err, file) {
                    if (err) {
                        throwError(response, 404, 'Page not found: \n' + pathname, next);                                               
                    } else if (!response.headersSent) {
                        
                        isBinary = true;
                        
                        try {
                            contentType = getHead(response, filename);                           
                            
                            // adding gina loader
                            if (/text\/html/i.test(contentType) && GINA_ENV_IS_DEV) {
                                isBinary = false;
                                // javascriptsDeferEnabled
                                if  (bundleConf.content.templates._common.javascriptsDeferEnabled ) {
                                    file = file.replace(/\<\/head\>/i, '\t'+ bundleConf.content.templates._common.ginaLoader +'\n</head>');
                                } else {
                                    file = file.replace(/\<\/body\>/i, '\t'+ bundleConf.content.templates._common.ginaLoader +'\n</body>');
                                }                                
                                
                            } else {
                                // adding handler `gina.ready(...)` wrapper
                                hanlersPath = bundleConf.handlersPath;

                                if ( new RegExp('^'+ hanlersPath).test(filename) ) {
                                    isBinary = false;
                                    file = '(gina.ready(function onGinaReady($){\n'+ file + '\n},window["originalContext"]));'
                                }                                  
                            }
                            
                            if ( /http\/2/.test(protocol) ) {
                                self._isStatic      = true;
                                self._referrer      = request.url;                                
                                var ext = request.url.match(/\.([A-Za-z0-9]+)$/);
                                request.url = ( ext != null && typeof(ext[0]) != 'undefined' ) ? request.url : request.url + 'index.html';
                                
                                self._responseHeaders         = response.getHeaders();
                                if (!isBinary && typeof(self._options.template.assets[request.url]) == 'undefined')
                                    self._options.template.assets = getAssets(bundleConf, file);
                                                                                                
                                if ( 
                                    typeof(self._options.template.assets[request.url]) == 'undefined'
                                    || isBinary
                                ) {
                                                                        
                                    self._options.template.assets[request.url] = {
                                        ext: ( ext != null && typeof(ext[0]) != 'undefined' ) ? ext[0] : null,
                                        isAvailable: true,
                                        mime: contentType,
                                        url: request.url,
                                        filename: filename
                                    }
                                }
                                
                                self.instance._isXMLRequest    = request.isXMLRequest;
                                self.instance._getAssetFilenameFromUrl = getAssetFilenameFromUrl;
                                
                                var isPathMatchingUrl = null;
                                if ( !self.instance._http2streamEventInitalized ) {
                                    self.instance._http2streamEventInitalized = true;
                                    self.instance.on('stream', function onHttp2Strem(stream, headers) { 
                                                                                
                                        if (!self._isStatic) return;  
                                             
                                        if (!this._isXMLRequest) {
                                            isPathMatchingUrl = true;
                                            if (headers[':path'] != request.url) {
                                                request.url         = headers[':path'];
                                                isPathMatchingUrl   = false;
                                            }
                                            
                                            // for new requests
                                            if (!isPathMatchingUrl) {
                                                pathname        = ( webroot.length > 1 && re.test(request.url) ) ? request.url.replace(re, '/') : request.url;                                                
                                                isFilenameDir   = (webroot == request.url) ? true: false;
                                                
                                                if ( !isFilenameDir && !/404\.html/.test(filename) && fs.existsSync(filename) )
                                                    isFilenameDir = fs.statSync(filename).isDirectory();                                                
                                                if (!isFilenameDir) {
                                                    filename = this._getAssetFilenameFromUrl(bundleConf, pathname);                                                        
                                                }
                                                    
                                                if ( !isFilenameDir && !fs.existsSync(filename) ) {
                                                    throwError(response, 404, 'Page not found: \n' + pathname, next);
                                                    return;
                                                }    
                                                                                                                                                
                                                
                                                if ( isFilenameDir ) {
                                                    dirname = bundleConf.publicPath + pathname;
                                                    filename =  dirname + 'index.html';
                                                    request.url += 'index.html';
                                                    if ( !fs.existsSync(filename) ) {
                                                        throwError(response, 403, 'Forbidden: \n' + pathname, next);
                                                    } else {
                                                        header = {
                                                            ':status': 301,
                                                            'location': request.url
                                                        };
                                                        
                                                        if (cacheless) {
                                                            header['cache-control'] = 'no-cache, no-store, must-revalidate';
                                                            header['pragma'] = 'no-cache';
                                                            header['expires'] = '0';  
                                                        }
                                                        
                                                        
                                                        stream.respond(header);
                                                        stream.end();
                                                    }
                                                }                                            
                                            }
                                            
                                            contentType = getHead(response, filename);
                                            contentType = contentType +'; charset='+ bundleConf.encoding;   
                                            ext = request.url.match(/\.([A-Za-z0-9]+)$/);    
                                            request.url = ( ext != null && typeof(ext[0]) != 'undefined' ) ? request.url : request.url + 'index.html';          
                                            if ( 
                                                !isPathMatchingUrl
                                                && typeof(self._options.template.assets[request.url]) == 'undefined'                                                 
                                            ) {     
                                                                                         
                                                self._options.template.assets[request.url] = {
                                                    ext: ( ext != null && typeof(ext[0]) != 'undefined' ) ? ext[0] : null,
                                                    //isAvailable: true,
                                                    isAvailable: (!/404\.html/.test(filename)) ? true : false,
                                                    mime: contentType,
                                                    url: request.url,
                                                    filename: filename
                                                }
                                            }
                                                                                                                                   
                                            if (!fs.existsSync(filename)) return;
                                            isBinary = ( /text\/html/i.test(contentType) ) ? false : true;
                                            if ( isBinary ) {
                                                // override                                    
                                                self._options.template.assets[request.url] = {
                                                    ext: ( ext != null && typeof(ext[0]) != 'undefined' ) ? ext[0] : null,
                                                    isAvailable: true,
                                                    mime: contentType,
                                                    url: request.url,
                                                    filename: filename
                                                }
                                            }
                                            self.onHttp2Stream(stream, headers, response);
                                        }              
                                            
                                    }); // EO self.instance.on('stream' ..                                 
                                } 
                                
                                
                                header = {
                                    ':status': 200,
                                    'content-type': contentType + '; charset='+ bundleConf.encoding
                                };
                                
                                if (cacheless) {
                                    // source maps integration for javascript & css
                                    if ( /(.js|.css)$/.test(filename) && fs.existsSync(filename +'.map') && !/sourceMappingURL/.test(file) ) {
                                        //pathname = pathname +'.map';
                                        pathname = webroot + pathname.substr(1) +'.map';
                                        // serve without cache
                                        header['X-SourceMap'] = pathname;
                                        header['cache-control'] = 'no-cache, no-store, must-revalidate';
                                        header['pragma'] = 'no-cache';
                                        header['expires'] = '0';
                                    }    
                                }
                                
                                header  = completeHeaders(header, request, response);
                                if (isBinary) {
                                    stream.respondWithFile(filename, header)
                                } else {
                                    stream.respond(header);
                                    stream.end(file);
                                }
                                // Fixed on march 15 2021 by removing the return
                                // Could be the cause why the push is pending
                                //return;
                            } else {
                                
                                completeHeaders(null, request, response);                                
                                response.setHeader('content-type', contentType +'; charset='+ bundleConf.encoding);  
                                // if (/\.(woff|woff2)$/i.test(filename) )  {
                                //     response.setHeader("Transfer-Encoding", 'Identity')
                                // }
                                if (isBinary) {
                                    response.setHeader('content-length', fs.statSync(filename).size); 
                                }
                                
                                if (cacheless) {
                                    // source maps integration for javascript & css
                                    if ( /(.js|.css)$/.test(filename) && fs.existsSync(filename +'.map') && !/sourceMappingURL/.test(file) ) {
                                        //pathname = pathname +'.map'
                                        pathname = webroot + pathname.substr(1) +'.map';
                                        response.setHeader("X-SourceMap", pathname)
                                    }

                                    // serve without cache
                                    response.writeHead(200, {
                                        'cache-control': 'no-cache, no-store, must-revalidate', // preventing browsers from caching it
                                        'pragma': 'no-cache',
                                        'expires': '0'
                                    });

                                } else {
                                    response.writeHead(200)
                                }                                
                                
                                
                                if (isBinary) { // images, javascript, pdf ....                                    
                                    fs.createReadStream(filename)
                                        .on('end', function onResponse(){
                                            console.info(request.method +' [200] '+ pathname);
                                        })
                                        .pipe(response);
                                } else {
                                    response.write(file, bundleConf.encoding);
                                    response.end();      
                                    console.info(request.method +' [200] '+ pathname);
                                }
                                
                                return;
                            }
                                                        
                        } catch(err) {
                            throwError(response, 500, err.stack)
                        }
                    }
                    
                    return                    
                });               

            }
        })
    }
    
    
    var onRequest = function() {

        var apps = self.bundles;
        var webrootLen = self.conf[self.appName][self.env].server.webroot.length;

        // catch all (request urls)
        self.instance.all('*', function onInstance(request, response, next) {
            
            
            request.setEncoding(self.conf[self.appName][self.env].encoding);
            // be carfull, if you are using jQuery + cross domain, you have to set the header manually in your $.ajax query -> headers: {'X-Requested-With': 'XMLHttpRequest'}
            request.isXMLRequest       = ( request.headers['x-requested-with'] && request.headers['x-requested-with'] == 'XMLHttpRequest' ) ? true : false;

            // Passing credentials :
            //      - if you are using jQuery + cross domain, you have to set the `xhrFields` in your $.ajax query -> xhrFields: { withCredentials: true }
            //      - if you are using another solution or doing it by hand, make sure to properly set the header: headers: {'access-control-allow-credentials': true }
            /**
             * NB.: jQuery
             * The `withCredentials` property will include any cookies from the remote domain in the request,
             * and it will also set any cookies from the remote domain.
             * Note that these cookies still honor same-origin policies, so your JavaScript code can’t access the cookies
             * from document.cookie or the response headers.
             * They can only be controlled/produced by the remote domain.
             * */
            request.isWithCredentials  = ( request.headers['access-control-allow-credentials'] && request.headers['access-control-allow-credentials'] == true ) ? true : false;
                        
            
            local.request = request;
                        
            response.setHeader('x-powered-by', 'Gina/'+ GINA_VERSION );                     
            
            
            
            // Fixing an express js bug :(
            // express is trying to force : /path/dir => /path/dir/
            // which causes : /path/dir/path/dir/  <---- by trying to add a slash in the end
            // if (
            //     webrootLen > 1
            //     && request.url === self.conf[self.appName][self.env].server.webroot + '/' + self.conf[self.appName][self.env].server.webroot + '/'
            // ) {
            //     request.url = self.conf[self.appName][self.env].server.webroot
            // }
            
            // webroot filter
            var isWebrootHandledByRouting = ( self.conf[self.appName][self.env].server.webroot == request.url && !fs.existsSync( _(self.conf[self.appName][self.env].publicPath +'/index.html', true) ) ) ? true : false;
            
            // priority to statics - this portion of code has been duplicated to SuperController : see `isStaticRoute` method
            var staticsArr  = self.conf[self.appName][self.env].publicResources; 
            var staticProps = {
                isStaticFilename: false
            };
            
            if (!isWebrootHandledByRouting) {
                
                staticProps.firstLevel          = '/' + request.url.split(/\//g)[1] + '/';
                
                // to be considered as a stativ content, url must content at least 2 caracters after last `.`: .js, .html are ok
                var ext = request.url.match(/(\.([A-Za-z0-9]+){2}|\/)$/);   
                var isImage = false;
                if ( typeof(ext) != 'undefined' &&  ext != null) {
                    ext = ext[0];
                    // if image with `@` found
                    if ( /^image/i.test(self.conf[self.appName][self.env].server.coreConfiguration.mime[ext.substr(1)]) ) {
                        isImage = true
                    }
                }
                if ( 
                    ext != null 
                    // and must not be an email
                    && !/^(([^<>()[\]\\.,;:\s@\"]+(\.[^<>()[\]\\.,;:\s@\"]+)*)|(\".+\"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/.test(request.url)
                    // and must be handled by mime.types
                    &&  typeof(self.conf[self.appName][self.env].server.coreConfiguration.mime[ext.substr(1)]) != 'undefined' 
                    ||
                    ext != null 
                    && isImage
                    
                ) {                    
                    staticProps.isStaticFilename = true
                }
            }
            
                 
                
            // handle resources from public with webroot in url
            if ( staticProps.isStaticFilename && self.conf[self.appName][self.env].server.webroot != '/' && staticProps.firstLevel == self.conf[self.appName][self.env].server.webroot ) {
                var matchedFirstInUrl = request.url.replace(self.conf[self.appName][self.env].server.webroot, '').match(/[A-Za-z0-9_-]+\/?/);
                if ( matchedFirstInUrl && matchedFirstInUrl.length > 0 ) {
                    staticProps.firstLevel = self.conf[self.appName][self.env].server.webroot + matchedFirstInUrl[0]
                }                
            }
            
            if ( 
                staticProps.isStaticFilename && staticsArr.indexOf(request.url) > -1 
                || staticProps.isStaticFilename && staticsArr.indexOf( request.url.replace(request.url.substr(request.url.lastIndexOf('/')+1), '') ) > -1 
                //|| staticProps.isStaticFilename && staticsArr.indexOf(staticProps.firstLevel) > -1
                // take ^/dir/sub/*
                || staticProps.isStaticFilename && new RegExp('^'+ staticProps.firstLevel).test(request.url)
                || /\/$/.test(request.url) && !isWebrootHandledByRouting && !/\/engine\.io\//.test(request.url)
            ) {
                self._isStatic  = true;
                
                
                self._referrer  = request.url;                
                // by default - used in `composeHeadersMiddleware`: see Default Global Middlewares (gna.js)
                request.routing = {
                    'url': request.url,
                    'method': 'GET'
                };
                request = checkPreflightRequest(request);
                local.request = request; // update request
                // filtered to handle only html for now
                if ( /text\/html/.test(request.headers['accept']) 
                    &&  /^isaac/.test(self.engine) 
                    && self.instance._expressMiddlewares.length > 0 
                    || 
                    request.isPreflightRequest 
                    && /^isaac/.test(self.engine) 
                    && self.instance._expressMiddlewares.length > 0 
                ) {                           
                    
                    nextExpressMiddleware._index        = 0;
                    nextExpressMiddleware._count        = self.instance._expressMiddlewares.length-1;
                    nextExpressMiddleware._request      = request;
                    nextExpressMiddleware._response     = response;
                    nextExpressMiddleware._next         = next;
                    nextExpressMiddleware._nextAction   = 'handleStatics';
                    nextExpressMiddleware._staticProps  = staticProps;
                    
                    
                    nextExpressMiddleware()
                } else {
                    handleStatics(staticProps, request, response, next);  
                }                         
                
            } else { // not a static request                
                self._isStatic  = false;
                // init content                                
                request.body    = ( typeof(request.body) != 'undefined' ) ? request.body : {};
                request.get     = {};
                request.post    = {};
                request.put     = {};
                request.delete  = {};
                request.files   = [];
                //request.patch = {}; ???
                //request.cookies = {}; // ???
                //request.copy ???
                
                         
                
                // multipart wrapper for uploads
                // files are available from your controller or any middlewares:
                //  @param {object} req.files            
                if ( /multipart\/form-data;/.test(request.headers['content-type']) ) {
                    // TODO - get options from settings.json & settings.{env}.json ...
                    // -> https://github.com/mscdex/busboy
                    var opt = self.conf[self.appName][self.env].content.settings.upload;
                    // checking size
                    var maxSize     = parseInt(opt.maxFieldsSize);                    
                    var fileSize    = request.headers["content-length"]/1024/1024; //MB
                    var hasAutoTmpCleanupTimeout = (
                        typeof(opt.autoTmpCleanupTimeout) != 'undefined' 
                        &&  opt.autoTmpCleanupTimeout != ''
                        &&  opt.autoTmpCleanupTimeout != 0
                        &&  !/false/i.test(opt.autoTmpCleanupTimeout)
                    ) ? true : false; 
                    var autoTmpCleanupTimeout = (!hasAutoTmpCleanupTimeout) ? null : opt.autoTmpCleanupTimeout; //ms

                    if (fileSize > maxSize) {
                        return throwError(response, 431, 'Attachment exceeded maximum file size [ '+ opt.maxFieldsSize +' ]');                        
                    }

                    var uploadDir = opt.uploadDir || os.tmpdir();

                    /** 
                     * str2ab
                     * One common practical question about ArrayBuffer is how to convert a String to an ArrayBuffer and vice-versa.
                     * Since an ArrayBuffer is, in fact, a byte array, this conversion requires that both ends agree on how 
                     * to represent the characters in the String as bytes. 
                     * You probably have seen this "agreement" before: it is the 
                     * String's character encoding (and the usual "agreement terms" are, for example, Unicode UTF-16 and iso8859-1). 
                     * Thus, supposing you and the other party have agreed on the UTF-16 encoding 
                     * 
                     * ref.: 
                     *  - https://developers.google.com/web/updates/2012/06/How-to-convert-ArrayBuffer-to-and-from-String
                     *  - https://jsperf.com/arraybuffer-string-conversion/4
                     * 
                     * @param {string} str
                     * 
                     * @returns {array} buffer
                     * */
                    var str2ab = function(str, bits) {
                        
                        var bytesLength = str.length
                            //, bits         = 8 // default bytesLength
                            , bits      = ( typeof (bits) != 'undefined' ) ? (bits/8) : 1 
                            , buffer    = new ArrayBuffer(bytesLength * bits) // `bits`  bytes for each char
                            , bufView   = null;

                        switch (bytesLength) {
                            case 8:
                                bufView = new Uint8Array(buffer);
                                break;

                            case 16:
                                bufView = new Uint16Array(buffer);
                                break;

                            case 32:
                                bufView = new Uint32Array(buffer);
                                break;
                        
                            default:
                                bufView = new Uint8Array(buffer);
                                break;
                        }
                        //var buf = new ArrayBuffer(str.length * 2); // 2 bytes for each char when using Uint16Array(buf)
                        //var buf = new ArrayBuffer(str.length); // Uint8Array
                        //var bufView = new Uint8Array(buf);
                        for (var i = 0, strLen = str.length; i < strLen; i++) {
                            bufView[i] = str.charCodeAt(i);
                        }
                        
                        return buffer;
                    }; 

                    /**
                     * str2ab
                     * 
                     * With TypedArray now available, the Buffer class implements the Uint8Array API 
                     * in a manner that is more optimized and suitable for Node.js.
                     * ref.:
                     *  - https://nodejs.org/api/buffer.html#buffer_buffer_from_buffer_alloc_and_buffer_allocunsafe
                     * 
                     * @param {string} str
                     *
                     * @returns {array} buffer
                     */
                    // var str2ab = function(str, encoding) {
                        
                    //     const buffer = Buffer.allocUnsafe(str.length);

                    //     for (let i = 0, len = str.len; i < len; i++) {
                    //         buffer[i] = str.charCodeAt(i);
                    //     }

                    //     return buffer;
                    // }
                    

                    var fileObj         = null
                        , fileCount     = 0
                        , tmpFilename   = null
                        , writeStreams  = []
                        , index         = 0;

                    request.files = [];
                    request.routing = {
                        'url': request.url,
                        'method': 'POST'
                    };
                    var busboy = new Busboy({ headers: request.headers });
                    
                    // busboy.on('field', function(fieldname, val, fieldnameTruncated, valTruncated) {
                    //     console.log('Field [' + fieldname + ']: value: ' + inspect(val));
                    // });
                    busboy.on('file', function(fieldname, file, filename, encoding, mimetype, group) {
                        
                        file._dataLen = 0; 
                        ++fileCount;
                                                
                        if ( 
                            typeof(group) != 'undefined' 
                            && group != 'untagged' 
                            && typeof(opt.groups[group]) != 'undefined' 
                        ) {
                            // allowed extensions
                            if ( typeof(opt.groups[group].allowedExtensions) != 'undefined' 
                                && opt.groups[group].allowedExtensions != '*'
                            ) {
                                var ext     = opt.groups[group].allowedExtensions;
                                var fileExt = filename.substr(filename.lastIndexOf('.')+1)
                                if ( !Array.isArray(ext) ) {
                                    ext = [ext]
                                }
                                
                                if ( ext.indexOf(fileExt) < 0 ) {
                                    throwError(response, 400, '`'+ fileExt +'` is not an allowed extension. See `'+ group +'` upload group definition.');
                                    return false;
                                } 
                            }
                            
                            // multiple or single
                            if ( typeof(opt.groups[group].isMultipleAllowed) != 'undefined' 
                                && !opt.groups[group].isMultipleAllowed
                                && fileCount > 1
                            ) {
                                throwError(response, 400, 'multiple uploads not allowed. See `'+ group +'` upload group definition.');
                                return false;
                            }                                  
                        }
                        
                        
                        // TODO - https://github.com/TooTallNate/node-wav
                        //file._mimetype = mimetype;
                        
                        // creating file
                        writeStreams[index] = fs.createWriteStream( _(uploadDir + '/' + filename) );
                        // https://strongloop.com/strongblog/practical-examples-of-the-new-node-js-streams-api/
                        var liner = new require('stream').Transform({objectMode: true});
                    
                        liner._transform = function (chunk, encoding, done) {
                            
                            var str = chunk.toString();
                            file._dataLen += str.length;
                        
                            var ab = Buffer.from(str2ab(str));
                            this.push(ab)
                            
                            done()
                        }
                        
                    //     liner._flush = function (done) {
                            
                    //         done()
                    //     }
                                                            
                        file.pipe(liner).pipe(writeStreams[index]);                    
                        ++index;
                        

                        file.on('end', function() {
                            
                            //fileObj = Buffer.from(str2ab(this._dataChunk));
                            //delete this._dataChunk;
                            
                            tmpFilename = _(uploadDir + '/' + filename);

                            request.files.push({
                                name: fieldname,
                                group: group,
                                originalFilename: filename,
                                encoding: encoding,
                                type: mimetype,
                                size: this._dataLen,
                                path: tmpFilename
                            });
                            
                            // /tmp autoTmpCleanupTimeout
                            if (autoTmpCleanupTimeout) {
                                setTimeout((tmpFilename) => {
                                    console.debug('[ BUNDLE ][ '+self.appName+' ][ server ][ upload ] Now removing `'+ tmpFilename +'` from tmp');
                                    var tmpFilename = new _(tmpFilename);
                                    if (tmpFilename.existsSync())
                                        tmpFilename.rmSync();
                                }, autoTmpCleanupTimeout, tmpFilename);
                            }
                            
                            // if (fs.existsSync(tmpFilename))
                            //     fs.unlinkSync(tmpFilename);
                            
                        });
                    });

                    busboy.on('finish', function() {
                        var total = writeStreams.length;
                        for (var ws = 0, wsLen = writeStreams.length; ws < wsLen; ++ws ) {
                            
                            writeStreams[ws].on('error', function(err) {
                                console.error('[ busboy ] [ onWriteError ]', err);
                                throwError(response, 500, 'Internal server error\n' + err, next);

                                this.close(); 
                            });
                            
                            writeStreams[ws].on('finish', function() {
                                this.close( function onUploaded(){
                                    --total;
                                    console.debug('closing writestreams : ' + total);
                                    
                                    if (total == 0) {
                                        loadBundleConfiguration(request, response, next, function onBundleConfigurationLoaded(err, bundle, pathname, config, req, res, next) {
                                            if (!req.handled) {
                                                req.handled = true;
                                                if (err) {
                                                    if (!res.headersSent)
                                                        throwError(response, 500, 'Internal server error\n' + err.stack, next)
                                                } else {
                                                    handle(req, res, next, bundle, pathname, config)
                                                }
                                            }
                                        })
                                    }
                                })
                            });
                        }
                    });
                    
                    request.pipe(busboy);
                } else {
                                       

                    request.on('data', function(chunk){ // for this to work, don't forget the name attr for you form elements
                        if ( typeof(request.body) == 'object') {
                            request.body = '';
                        }
                        request.body += chunk.toString()
                    });

                    request.on('end', function onEnd() {  
                        processRequestData(request, response, next);
                    });

                    if (request.end) request.end();                    
                    

                } //EO if multipart
            }           
                

        });//EO this.instance


        self.instance.listen(self.conf[self.appName][self.env].server.port);//By Default 3100
        self.instance.timeout = (1000 * 300); // e.g.: 1000x60 => 60 sec

        self.emit('started', self.conf[self.appName][self.env], true);
    }
    
    var processRequestData = function(request, response, next) {
        
        var bodyStr = null, obj = null;
        // to compare with /core/controller/controller.js -> getParams()
        switch( request.method.toLowerCase() ) {
            case 'post':
                var configuring = false, msg = null, isPostSet = false;                
                if ( typeof(request.body) == 'string' ) {
                    // get rid of encoding issues
                    try {
                        if ( !/multipart\/form-data;/.test(request.headers['content-type']) ) {
                            if ( /application\/x\-www\-form\-urlencoded/.test(request.headers['content-type']) && /\+/.test(request.body) ) {
                                request.body = request.body.replace(/\+/g, ' ');
                            }

                            if ( request.body.substr(0,1) == '?')
                                request.body = request.body.substr(1);
                            
                            try {
                                bodyStr = decodeURIComponent(request.body); // it is already a string for sure
                            } catch (err) {
                                bodyStr = request.body;
                            }

                            // false & true case
                            if ( /(\"false\"|\"true\"|\"on\")/.test(bodyStr) )
                                bodyStr = bodyStr.replace(/\"false\"/g, false).replace(/\"true\"/g, true).replace(/\"on\"/g, true);
                            
                            try {
                                obj = parseBody(bodyStr);
                                request.post = obj;
                                isPostSet = true;
                            } catch (err) {
                                // ignore this one
                                msg = '[ Could properly evaluate POST ] '+ request.url +'\n'+  err.stack;
                                console.warn(msg);
                            }
                            if (!isPostSet) {
                                try {
                                    if (obj.count() == 0 && bodyStr.length > 1) {
                                        request.post = obj;
                                    } else {
                                        request.post = JSON.parse(bodyStr)
                                    }
                                    
                                } catch (err) {
                                    //throwError(response, 500, err, next)                                
                                    msg = '[ Exception found for POST ] '+ request.url +'\n'+  err.stack;
                                    console.warn(msg);
                                }
                            }
                        }

                    } catch (err) {
                        msg = '[ Could properly evaluate POST ] '+ request.url +'\n'+  err.stack;
                        console.warn(msg);
                    }

                } else {
                    // 2016-05-19: fix to handle requests from swagger/express
                    if (request.body.count() == 0 && typeof(request.query) != 'string' && request.query.count() > 0 ) {
                        request.body = request.query
                    }
                    bodyStr = JSON.stringify(request.body);
                    // false & true case
                    if ( /(\"false\"|\"true\"|\"on\")/.test(bodyStr) )
                        bodyStr = bodyStr.replace(/\"false\"/g, false).replace(/\"true\"/g, true).replace(/\"on\"/g, true);

                    obj = JSON.parse(bodyStr)
                }
                
                try {
                    if ( obj.count() > 0 ) {
                        // still need this to allow compatibility with express & connect middlewares
                        request.body = request.post = obj;
                    }
                } catch (err) {
                    msg = '[ Could complete POST ] '+ request.url +'\n'+ err.stack;
                    console.error(msg);
                    throwError(response, 500, err, next);                    
                }
                    

                // see.: https://www.w3.org/Protocols/rfc2616/rfc2616-sec9.html#POST
                //     Responses to this method are not cacheable,
                //     unless the response includes appropriate cache-control or expires header fields.
                //     However, the 303 (See Other) response can be used to direct the user agent to retrieve a cacheable resource.
                if ( !response.headersSent ) {
                    response.setHeader('cache-control', 'no-cache, no-store, must-revalidate');
                    response.setHeader('pragma', 'no-cache');
                    response.setHeader('expires', '0');
                }
                

                // cleaning
                request.query   = undefined;
                request.get     = undefined;
                request.put     = undefined;
                request.delete  = undefined;
                break;

            case 'get':
                if ( typeof(request.query) != 'undefined' && request.query.count() > 0 ) {   
                    if ( typeof(request.query.inheritedData) != 'undefined' ) {
                        // try {
                        //     bodyStr = decodeURIComponent(request.query.inheritedData); // it is already a string for sure
                        // } catch (err) {
                        //     bodyStr = request.query.inheritedData;
                        // }
                        // delete request.query.inheritedData;
                        // // false & true case
                        // if ( /(\"false\"|\"true\"|\"on\")/.test(bodyStr) )
                        //     bodyStr = bodyStr.replace(/\"false\"/g, false).replace(/\"true\"/g, true).replace(/\"on\"/g, true);
                        // obj = JSON.parse(bodyStr);
                        
                        obj = parseBody(request.query.inheritedData);
                        delete request.query.inheritedData;
                        
                        request.query = merge(request.query, obj);
                        delete obj;
                    }            
                    request.get = request.query;                    
                }                
                // else, will be matching route params against url context instead, once route is identified


                // cleaning
                request.query   = undefined;
                request.post    = undefined;
                request.put     = undefined;
                request.delete  = undefined;
                break;

            case 'put':
                // eg.: PUT /user/set/1
                if ( typeof(request.body) == 'string' ) {
                    // get rid of encoding issues
                    try {
                        if ( !/multipart\/form-data;/.test(request.headers['content-type']) ) {
                            if ( !/application\/x\-www\-form\-urlencoded/.test(request.headers['content-type']) ) {
                                request.body = request.body.replace(/\+/g, ' ');
                            }

                            if ( request.body.substr(0,1) == '?')
                                request.body = request.body.substr(1);

                            // false & true case
                            try {
                                bodyStr = decodeURIComponent(request.body); // it is already a string for sure
                            } catch (err) {
                                bodyStr = request.body;
                            }
                             
                            // false & true case
                            if ( /(\"false\"|\"true\"|\"on\")/.test(bodyStr) )
                                bodyStr = bodyStr.replace(/\"false\"/g, false).replace(/\"true\"/g, true).replace(/\"on\"/g, true);

                            obj = parseBody(bodyStr);

                            if ( typeof(obj) != 'undefined' && obj.count() == 0 && bodyStr.length > 1 ) {
                                try {
                                    request.put = merge(request.put, obj);
                                } catch (err) {
                                    console.log('Case `put` #0 [ merge error ]: ' + (err.stack||err.message))
                                }
                            }
                        }

                    } catch (err) {
                        var msg = '[ '+request.url+' ]\nCould not evaluate PUT.\n'+ err.stack;
                        throwError(response, 500, msg, next);
                    }

                } else {
                    // 2016-05-19: fix to handle requests from swagger/express
                    if (request.body.count() == 0 && typeof(request.query) != 'string' && request.query.count() > 0 ) {
                        request.body = request.query
                    }
                    bodyStr = JSON.stringify(request.body);
                    // false & true case
                    if ( /(\"false\"|\"true\"|\"on\")/.test(bodyStr) )
                        bodyStr = bodyStr.replace(/\"false\"/g, false).replace(/\"true\"/g, true).replace(/\"on\"/g, true);

                    obj = JSON.parse(bodyStr)
                }

                if ( obj && typeof(obj) != 'undefined' && obj.count() > 0 ) {
                    // still need this to allow compatibility with express & connect middlewares
                    request.body = request.put = merge(request.put, obj);
                }


                request.query   = undefined; // added on september 13 2016
                request.post    = undefined;
                request.delete  = undefined;
                request.get     = undefined;
                
                delete obj;
                break;


            case 'delete':
                if ( request.query.count() > 0 ) {
                    request.delete = request.query;

                }
                // else, matching route params against url context instead once, route is identified

                request.post    = undefined;
                request.put     = undefined;
                request.get     = undefined;
                break


        };

        loadBundleConfiguration(request, response, next, function onLoadBundleConfiguration (err, bundle, pathname, config, req, res, next) {
            if (!req.handled) {
                req.handled = true;
                if (err) {
                    throwError(response, 500, 'Internal server error\n' + err.stack, next)
                } else {                                    
                    handle(req, res, next, bundle, pathname, config)                                                                       
                }
            } else {
                if (typeof(next) != 'undefined')
                    return next();
                else
                    return;
            }
            
            return;
        })
    }

    var getHead = function(response, file) {
        try {
            var s       = file.split(/\./);
            var ext     = s[s.length-1];
            var type    = null;
            var mime    = self.conf[self.appName][self.env].server.coreConfiguration.mime;

            if( typeof(mime[ext]) != 'undefined' ) {
                type = mime[ext];
            } else {
                console.warn('[ '+file+' ] extension: `'+s[2]+'` not supported by gina: `core/mime.types`. Replacing with `plain/text` ')
            }
            return type || 'plain/text'
        } catch (err) {
            console.error('Error while trying to getHead('+ file +') extention. Replacing with `plain/text` '+ err.stack);
            return 'plain/text'
        }
        
    }

    var loadBundleConfiguration = function(req, res, next, callback) {

        var config = new Config();
        config.setBundles(self.bundles);
        var conf = config.getInstance(); // for all loaded bundles
        if ( typeof(conf) != 'undefined') {//for cacheless mode
            self.conf = conf;
        }
        
        var pathname    = req.url;
        var bundle      = self.appName; // by default

        // finding bundle
        if (self.isStandalone) {

        end:
            for (var b in conf) {
                if ( typeof(conf[b][self.env].content) != 'undefined' && typeof(conf[b][self.env].content.statics) != 'undefined' && conf[b][self.env].content.statics.count() > 0 ) {
                    for (var s in conf[b][self.env].content.statics) {
                        s = (s.substr(0,1) == '/') ? s.substr(1) : s;
                        if ( (new RegExp('^/'+s)).test(pathname) ) {
                            bundle = b;
                            break end
                        }
                    }
                } else {
                    // no statics ... use startingApp and leave it to handle()
                    self.isNotStatic = true
                    break
                }
            }
        }


        if ( /\/favicon\.ico/.test(pathname) && !hasViews(bundle)) {
            callback(false, bundle, pathname, config, req, res, next);
            return false
        }

        onBundleConfigLoaded(bundle, {
            err         : false,
            config      : config,
            pathname    : pathname,
            req         : req,
            res         : res,
            conf        : config,
            next        : next,
            callback    : callback
        });
        
        return;
    }

    var onBundleConfigLoaded = function(bundle, options) {
        var err         = options.err
            , cacheless = options.config.isCacheless()
            , pathname  = options.pathname
            , req       = options.req
            , res       = options.res
            , config    = options.conf
            , next      = options.next
            , callback  = options.callback;

        //Reloading assets & files.
        // if (!cacheless) { // all but dev & debug
            callback(err, bundle, pathname, options.config, req, res, next)
        // } else {
        //     config.refresh(bundle, function(err, routing) {
        //         if (err) {
        //             throwError(res, 500, 'Internal server error: \n' + (err.stack||err), next)
        //         } else {
        //             refreshing routing at the same time.
        //            self.routing = routing;
        //             callback(err, bundle, pathname, options.config, req, res, next)
        //        }
        //     })
        // }
    }
    
    // Express middleware portability when using another engine instead of expressjs
    var nextExpressMiddleware = function(err) {
                
        var router              = local.router;
        var expressMiddlewares  = self.instance._expressMiddlewares;
        
        if (err) {
            throwError(nextExpressMiddleware._response, 500, (err.stack|err.message|err), nextExpressMiddleware._next, nextExpressMiddleware._nextAction)
        }
        
        expressMiddlewares[nextExpressMiddleware._index](nextExpressMiddleware._request, nextExpressMiddleware._response, function onNext(err, request, response) {
            ++nextExpressMiddleware._index;  
            
            if (err) {
                throwError(nextExpressMiddleware._response, 500, (err.stack||err.message||err), nextExpressMiddleware._next, nextExpressMiddleware._nextAction)
            }
            
            if (request)
                nextExpressMiddleware._request  = request;
            
            if (response)
                nextExpressMiddleware._response = response;         
            
            if (nextExpressMiddleware._index > nextExpressMiddleware._count) { 
                
                if ( nextExpressMiddleware._nextAction == 'route' ) {
                    
                    router._server = self.instance;            
                    router.route(nextExpressMiddleware._request, nextExpressMiddleware._response, nextExpressMiddleware._next, nextExpressMiddleware._request.routing)
                
                } else { // handle statics        
                    self._responseHeaders = nextExpressMiddleware._response.getHeaders();             
                    handleStatics(nextExpressMiddleware._staticProps, nextExpressMiddleware._request, nextExpressMiddleware._response, nextExpressMiddleware._next);
                }
                
            } else {
                nextExpressMiddleware.call(this, err, true)
            }                        
        });        
    };
    
    var checkPreflightRequest = function(request) {
        var config = self.conf[self.appName][self.env];
        // by default, if not set in `${projectPath}/env.json`
        var corsMethod = 'GET, POST, HEAD';
        // See https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS        
        if ( 
            typeof(config.server.response.header['access-control-allow-methods']) != 'undefined' 
            &&
            config.server.response.header['access-control-allow-methods'] != ''
        ) {
            // as defined in `${projectPath}/env.json`
            corsMethod = config.server.response.header['access-control-allow-methods'];
        }
        
        var method                          = ( /http\/2/.test(config.server.protocol) ) ? request.headers[':method'] : request.method
            //, reMethod                      = new RegExp(method, 'i')
            , reAccessAllowMethod           = new RegExp('(' + corsMethod.replace(/\,\s+|\s+\,|\,/g, '|') +')', 'i')
            // preflight support - conditions required
            , isPreflightRequest            = ( 
                    // must meet all the following conditions
                    /OPTIONS/i.test(method) 
                    && typeof(request.headers['access-control-request-method']) != 'undefined'
                    
                    // as defined in `${projectPath}/env.json`,
                    // request method must match: config.server.response.header['access-control-allow-methods']
                    && reAccessAllowMethod.test(request.headers['access-control-request-method'])
                    && typeof(request.headers['access-control-request-headers']) != 'undefined'       
                ) ? true : false
            , accessControlRequestHeaders   = null
            , serverResponseHeaders         = config.server.response.header//config.envConf[self.appName][self.env].server.response.header
        ;
        
        // additional checks
        // /(application\/x\-www\-form\-urlencoded|multipart\/form\-data|text\/plain)/i.test(request.headers['accept']) 
        
        request.isPreflightRequest  = isPreflightRequest;        
        if (isPreflightRequest) { // update request/response                   
            method                      = request.headers['access-control-request-method'];
            // updating to avoid conflict with requested route
            if ( /http\/2/.test(config.server.protocol) ) {
                request.headers[':method'] = method;
            } else {
                request.method = method
            }            
            accessControlRequestHeaders = ( typeof(request.headers['access-control-request-headers']) != 'undefined' ) ? request.headers['access-control-request-headers'] : '';
            if ( typeof(request.headers['access-control-request-credentials']) != 'undefined' && typeof(serverResponseHeaders['access-control-allow-credentials']) != 'undefined' ) {
                request.isWithCredentials = true;
            }
            if (accessControlRequestHeaders.length > 0) {
                for (var h in accessControlRequestHeaders) {
                    if ( /x\-requested\-with/i.test(h) && /x\-requested\-with/i.test(serverResponseHeaders['access-control-allow-headers']) ) {                            
                        request.isXMLRequest = true;
                    }                        
                }
            }
        }   
        
        return request
    }

    var handle = function(req, res, next, bundle, pathname, config) {
        
        var matched             = false
            , isRoute           = {}
            , withViews         = hasViews(bundle)
            , router            = local.router
            , cacheless         = config.isCacheless()
            , wroot             = null
        ;

        //matched = routingUtils.getRouteByUrl(req.url, bundle, (req.method||req[':method']), req);
        
        req = checkPreflightRequest(req);
        var params      = {}
            , _routing  = {}
            , method    = ( /http\/2/.test(self.conf[self.appName][self.env].server.protocol) ) ? req.headers[':method'] : req.method
            , reMethod  = new RegExp(method, 'i')
        ;
        try {            
            
                    
            var routing   = config.getRouting(bundle, self.env);

            if ( routing == null || routing.count() == 0 ) {
                console.error('Malformed routing or Null value for bundle [' + bundle + '] => ' + req.url);
                throwError(res, 500, 'Internal server error\nMalformed routing or Null value for bundle [' + bundle + '] => ' + req.url, next);
            }

        } catch (err) {
            throwError(res, 500, err.stack, next)
        }
        var isMethodAllowed = null, hostname = null;        
        out:
            for (var name in routing) {
                if (typeof(routing[name]['param']) == 'undefined')
                    break;
                
                // updating hostname
                // if ( 
                //     typeof(routing[name].hostname) == 'undefined' && !/^redirect$/.test(routing[name].param.control)  
                //     || !routing[name].hostname && !/^redirect$/.test(routing[name].param.control)
                // ) {
                //     hostname = self.conf[routing[name].bundle][self.env].hostname;
                //     routing[name].hostname = self.conf.routing[name].hostname = hostname;                     
                // }
                
                // For debug only
                // if ( name == 'name-of-targeted-rule@bundle') {
                //     console.debug('checking: ', name);
                // }
                
                if (routing[name].bundle != bundle) continue;
                // method filter    
                method = routing[name].method;
                if ( /\,/.test( method ) && reMethod.test(method) ) {
                    method = req.method
                }      
                
                //Preparing params to relay to the router.
                params = {
                    method              : method,
                    requirements        : routing[name].requirements,
                    namespace           : routing[name].namespace || undefined,
                    url                 : unescape(pathname), /// avoid %20
                    rule                : routing[name].originalRule || name,
                    param               : JSON.clone(routing[name].param),
                    middleware          : JSON.clone(routing[name].middleware),
                    bundle              : routing[name].bundle,
                    isXMLRequest        : req.isXMLRequest,
                    isWithCredentials   : req.isWithCredentials
                };

                //Parsing for the right url.
                try {                    
                    isRoute = routingUtils.compareUrls(params, routing[name].url, req);                        
                } catch (err) {
                    var msg = 'Internal server error.\nRule [ '+name+' ] needs your attention.\n';
                    // TODO - Refactor `ApiError`to handle the following param
                    // var e = new ApiError({ message: msg, stack: err.stack});
                    // throwError(res, e)
                    throwError(res, 500, 'Internal server error.\nRule [ '+name+' ] needs your attention.\n'+ err.stack);
                    break;
                }

                if ( pathname == routing[name].url || isRoute.past ) {

                    _routing = req.routing;                     
                    
                    // comparing routing method VS request.url method
                    isMethodAllowed = reMethod.test(_routing.method);
                    if (!isMethodAllowed) {
                        // Exception - Method override
                        if ( /get/i.test(req.method) && /delete/i.test(_routing.method) ) {
                            console.debug('ignoring case request.method[GET] on routing.method[DELETE]');
                            req.method = _routing.method;
                            isMethodAllowed = true;
                        } else {
                            throwError(res, 405, 'Method Not Allowed.\n'+ ' `'+req.url+'` is expecting `' + _routing.method.toUpperCase() +'` method but got `'+ req.method.toUpperCase() +'` instead');
                            break;
                        }                        
                    }// else {
                        
                        // handling GET method exception - if no param found
                        var methods = ['get', 'delete'], method = req.method.toLowerCase();
                        var p = null;
                        if (
                            methods.indexOf(method) > -1 && typeof(req.query) != 'undefined' && req.query.count() == 0
                            || methods.indexOf(method) > -1 && typeof(req.query) == 'undefined' && typeof(req.params) != 'undefined' && req.params.count() > 1
                        ) {
                            p = 0;
                            for (var parameter in req.params) {
                                if (p > 0) {
                                    // false & true case
                                    if ( /^(false|true|on)$/.test( req.params[parameter] ) && typeof(req.params[parameter]) == 'string' )
                                        req.params[parameter] = ( /^(true|on)$/.test( req.params[parameter] ) ) ? true : false;

                                    req[method][parameter] = req.params[parameter]
                                }
                                ++p
                            }
                            
                        } else if ( method == 'put' ) { // merging req.params with req.put (passed through URI)
                            p = 0;
                            for (var parameter in req.params) {
                                if (p > 0) {
                                    // false & true case
                                    if ( /^(false|true|on)$/.test( req.params[parameter] ) && typeof(req.params[parameter]) == 'string' )
                                        req.params[parameter] = ( /^(true|on)$/.test( req.params[parameter] ) ) ? true : false;

                                    req[method][parameter] = req.params[parameter]
                                }
                                ++p
                            }
                        }


                        // onRouting Event ???
                        if (isRoute.past) {      
                            matched = true;   
                            isRoute = {};  
                            
                            break;
                        }
                    //}
                }
            }
            
            

        if (matched) {
            if ( /^isaac/.test(self.engine) && self.instance._expressMiddlewares.length > 0) {                                            
                nextExpressMiddleware._index        = 0;
                nextExpressMiddleware._count        = self.instance._expressMiddlewares.length-1;
                nextExpressMiddleware._request      = req;
                nextExpressMiddleware._response     = res;
                nextExpressMiddleware._next         = next;
                nextExpressMiddleware._nextAction   = 'route'
                
                nextExpressMiddleware()
            } else {
                router._server = self.instance;
                router.route(req, res, next, req.routing)
            }            
        } else {
            throwError(res, 404, 'Page not found: \n' + pathname, next)
        }
    }

    var throwError = function(res, code, msg, next) {
        
        var withViews       = local.hasViews[self.appName] || hasViews(self.appName);
        var isUsingTemplate = self.conf[self.appName][self.env].template;
        var isXMLRequest    = local.request.isXMLRequest;
        var protocol        = getResponseProtocol(res);
        var stream          = ( /http\/2/.test(protocol) ) ? res.stream : null;
        var header          = ( /http\/2/.test(protocol) ) ? {} : null;        
        var err             = null;
        var bundleConf      = self.conf[self.appName][self.env];
        
        if ( typeof(msg) != 'object' ) {
            err = {
                code: code,
                message: msg
            }
        } else {
            err = JSON.clone(msg);
        }
        
        if (!res.headersSent) {
            res.headersSent = true;
            local.request = checkPreflightRequest(local.request);       
            // updated filter on controller.js : 2020/09/25     
            //if (isXMLRequest || !withViews || !isUsingTemplate ) {
            if (isXMLRequest || !withViews || !isUsingTemplate || withViews && !isUsingTemplate ) {
                // allowing this.throwError(err)                
                if ( typeof(code) == 'object' && !msg && typeof(code.status) != 'undefined' && typeof(code.error) != 'undefined' ) {
                    msg     = code.error;
                    code    = code.status;
                }

                // Internet Explorer override
                if ( /msie/i.test(local.request.headers['user-agent']) ) {
                    if ( /http\/2/.test(protocol) ) {
                        header = {
                            ':status': code,
                            'content-type': 'text/plain; charset='+ bundleConf.encoding
                            //'content-type': bundleConf.server.coreConfiguration.mime[ext]+'; charset='+ bundleConf.encoding
                        };
                    } else {
                        res.writeHead(code, 'content-type', 'text/plain; charset='+ bundleConf.encoding)
                    }
                    
                } else {
                    if ( /http\/2/.test(protocol) ) {
                        header = {
                            ':status': code,
                            'content-type': 'application/json; charset='+ bundleConf.encoding
                        };
                    } else {
                        res.writeHead(code, { 'content-type': 'application/json; charset='+ bundleConf.encoding } )
                    }
                }

                console.error('[ BUNDLE ][ '+self.appName+' ] '+ local.request.method +' [ '+code+' ] '+ local.request.url +'\n'+ msg);
                                
                header = completeHeaders(header, local.request, res);
                if ( /http\/2/.test(protocol) ) {
                    stream.respond(header);
                    stream.end(JSON.stringify({
                        status: code,
                        error: msg
                    }));
                    return;
                } else {
                    return res.end(JSON.stringify({
                        status: code,
                        error: msg
                    }));
                }
                
                
            } else {
                
                //console.error('[ BUNDLE ][ '+self.appName+' ] '+ local.request.method +' [ '+code+' ] '+ local.request.url);                
                console.error(local.request.method +' [ '+code+' ] '+ local.request.url);  
                if ( /http\/2/.test(protocol) ) {
                    header = {
                        ':status': code,
                        'content-type': 'text/html; charset='+ bundleConf.encoding
                        //'content-type': bundleConf.server.coreConfiguration.mime[ext]+'; charset='+ bundleConf.encoding
                    };
                } else {
                    res.writeHead(code, { 'content-type': 'text/html; charset='+ bundleConf.encoding } );
                }
                    
                header = completeHeaders(header, local.request, res);
                if ( /http\/2/.test(protocol) ) {
                    // TODO - Check if the stream has not been closed before sending response
                    // if (stream && !stream.destroyed) {                      
                    stream.respond(header);
                    stream.end('<h1>Error '+ code +'.</h1><pre>'+ msg + '</pre>');
                    // }
                    return;
                } else {                    
                    return res.end('<h1>Error '+ code +'.</h1><pre>'+ msg + '</pre>');
                }
            }            
            
        } else {                        
            if ( typeof(next) != 'undefined' )
                return next();
            else
                return;
        }
    }
};

Server = inherits(Server, EventEmitter);
module.exports = Server