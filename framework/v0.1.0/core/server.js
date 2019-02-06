//Imports.
var fs              = require('fs');
var os              = require('os');
var path            = require('path');
var EventEmitter    = require('events').EventEmitter;
var Busboy          = require('busboy');
const Stream        = require('stream')
var zlib            = require('zlib'); // gzip / deflate
var url             = require('url');
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
            if ( 
                typeof(options.conf[self.appName][self.env].content.settings.server) != 'undefined' 
                && options.conf[self.appName][self.env].content.settings.server != ''
                && options.conf[self.appName][self.env].content.settings.server != null
            ) {
                serverOpt = options.conf[self.appName][self.env].content.settings.server;
            }
            
            serverOpt = merge(serverOpt, {
                engine: options.conf[self.appName][self.env].server.engine,
                protocol: options.conf[self.appName][self.env].server.protocol,
                scheme: options.conf[self.appName][self.env].server.scheme
            });
            
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
            self.instance   = instance;
            //Router configuration.
            var router      = local.router;
            instance.throwError = throwError;
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
                        tmp[rule +'@'+ appName] = tmp[rule];
                        delete tmp[rule];
                        file = ruleShort = rule;
                        rule = rule +'@'+ appName;


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
                            standaloneTmp[rule] = JSON.parse(JSON.stringify(tmp[rule]))
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
    
    /**
     * Default http/1.x statics handler - For http/2.x check the SuperController
     * @param {object} staticProps - Expected : .isStaticFilename & .firstLevel
     * @param {*} request 
     * @param {*} response 
     * @param {*} next 
     */
    var handleStatics = function(staticProps, request, response, next) {        
        
        var conf            = self.conf
            , bundleConf    = conf[self.appName][self.env]
            , webroot       = bundleConf.server.webroot
            , re            = new RegExp('^'+ webroot)
            , pathname      = ( webroot.length > 1 && re.test(request.url) ) ? request.url.replace(re, '/') : request.url
            , contentType   = null
        ;
        
        var cacheless       = bundleConf.cacheless;  
        // by default
        var filename        = bundleConf.publicPath + pathname;
        
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
                
        
        fs.exists(filename, function onStaticExists(exist) {
            
            if (!exist) {
                throwError(response, 404, 'Page not found: \n' + pathname, next);
            } else {
                
                if ( fs.statSync(filename).isDirectory() ) {
                    filename += 'index.html';
                    
                    if ( !fs.existsSync(filename) ) {
                        throwError(response, 403, 'Forbidden: \n' + pathname, next);  
                        return;
                    }
                }
                    

                if (cacheless)
                    delete require.cache[require.resolve(filename)];
                

                fs.readFile(filename, 'binary', function(err, file) {
                    if (err) {
                        throwError(response, 404, 'Page not found: \n' + pathname, next);                        
                    } else if (!response.headersSent) {
                        try {
                            contentType = getHead(filename);
                            response.setHeader("Content-Type", contentType +'; charset='+ bundleConf.encoding);
                            
                            // adding gina loader
                            if (/text\/html/i.test(contentType) && GINA_ENV_IS_DEV) {
                                // javascriptsDeferEnabled
                                if  (bundleConf.content.templates._common.javascriptsDeferEnabled ) {
                                    file = file.replace(/\<\/head\>/i, '\t'+ bundleConf.content.templates._common.ginaLoader +'\n</head>');
                                } else {
                                    file = file.replace(/\<\/body\>/i, '\t'+ bundleConf.content.templates._common.ginaLoader +'\n</body>');
                                }
                            }
                            
                            // adding handler `gina.ready(...)` wrapper
                            var hanlersPath   = bundleConf.handlersPath;

                            if ( new RegExp('^'+ hanlersPath).test(filename) ) {
                                file = '(gina.ready(function onGinaReady($){\n'+ file + '\n},window["originalContext"]));'
                            }

                            if (cacheless) {
                                // source maps integration for javascript & css
                                if ( /(.js|.css)$/.test(filename) && fs.existsSync(filename +'.map') ) {
                                    pathname = pathname +'.map'
                                    response.setHeader("X-SourceMap", pathname)
                                }

                                // serve without cache
                                response.writeHead(200, {
                                    'Cache-Control': 'no-cache, no-store, must-revalidate', // preventing browsers from caching it
                                    'Pragma': 'no-cache',
                                    'Expires': '0'
                                });

                            } else {
                                response.writeHead(200)
                            }

                            response.write(file, 'binary');
                            response.end();
                            console.info(request.method +' [200] '+ pathname);
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
            
            local.request = request;
                        
            response.setHeader('X-Powered-By', 'Gina/'+ GINA_VERSION );
            
            
            
            // Fixing an express js bug :(
            // express is trying to force : /path/dir => /path/dir/
            // which causes : /path/dir/path/dir/  <---- by trying to add a slash in the end
            // if (
            //     webrootLen > 1
            //     && request.url === self.conf[self.appName][self.env].server.webroot + '/' + self.conf[self.appName][self.env].server.webroot + '/'
            // ) {
            //     request.url = self.conf[self.appName][self.env].server.webroot
            // }
            
            // priority to statics
            var staticsArr = self.conf[self.appName][self.env].publicResources;
            var staticProps = {
                firstLevel          : '/' + request.url.split(/\//g)[1] + '/',
                //isFile      :  /^\/[A-Za-z0-9_-]+\.(.*)$/.test(request.url)
                // to be considered as a stativ content, url must content at least 2 caracters after last `.`: .js, .html are ok
                isStaticFilename    : /(\.([A-Za-z0-9]+){2}|\/)$/.test(request.url)
            };  
            
            // handle resources from public with webroot in url
            if ( staticProps.isStaticFilename && self.conf[self.appName][self.env].server.webroot != '/' && staticProps.firstLevel == self.conf[self.appName][self.env].server.webroot ) {
                var matchedFirstInUrl = request.url.replace(self.conf[self.appName][self.env].server.webroot, '').match(/[A-Za-z0-9_-]+\/?/);
                if ( matchedFirstInUrl && matchedFirstInUrl.length > 0 ) {
                    staticProps.firstLevel = self.conf[self.appName][self.env].server.webroot + matchedFirstInUrl[0]
                }                
            }
            
            if ( 
                staticProps.isStaticFilename && staticsArr.indexOf(request.url) > -1 
                || staticProps.isStaticFilename && staticsArr.indexOf(staticProps.firstLevel) > -1
            ) {
                //local['handle'+ self.conf[self.appName][self.env].server.protocolShort +'Statics'](staticProps, request, response, next);
                handleStatics(staticProps, request, response, next);
                
            } else { // none statics
                
                
                
                request.body    = ( typeof(request.body) != 'undefined' ) ? request.body : {};
                request.get     = {};
                request.post    = {};
                request.put     = {};
                request.delete  = {};
                request.files   = [];
                //request.patch = {}; ???
                //request.cookies = {}; // ???
                
                // be carfull, if you are using jQuery + cross domain, you have to set the header manually in your $.ajax query -> headers: {'X-Requested-With': 'XMLHttpRequest'}
                request.isXMLRequest       = ( request.headers['x-requested-with'] && request.headers['x-requested-with'] == 'XMLHttpRequest' ) ? true : false;

                // Passing credentials :
                //      - if you are using jQuery + cross domain, you have to set the `xhrFields` in your $.ajax query -> xhrFields: { withCredentials: true }
                //      - if you are using another solution or doing it by hand, make sure to properly set the header: headers: {'Access-Control-Allow-Credentials': true }
                /**
                 * NB.: jQuery
                 * The `withCredentials` property will include any cookies from the remote domain in the request,
                 * and it will also set any cookies from the remote domain.
                 * Note that these cookies still honor same-origin policies, so your JavaScript code can’t access the cookies
                 * from document.cookie or the response headers.
                 * They can only be controlled/produced by the remote domain.
                 * */
                request.isWithCredentials  = ( request.headers['access-control-allow-credentials'] && request.headers['access-control-allow-credentials'] == true ) ? true : false;
                            
                
                // multipart wrapper for uploads
                // files are available from your controller or any middlewares:
                //  @param {object} req.files            
                if ( /multipart\/form-data;/.test(request.headers['content-type']) ) {
                    // TODO - get options from settings.json & settings.{env}.json ...
                    // -> https://github.com/andrewrk/node-multiparty
                    var opt = self.conf[self.appName][self.env].content.settings.upload;
                    // checking size
                    var maxSize     = parseInt(opt.maxFieldsSize);
                    var fileSize    = request.headers["content-length"]/1024/1024; //MB

                    if (fileSize > maxSize) {
                        throwError(response, 431, 'Attachment exceeded maximum file size [ '+ opt.maxFieldsSize +' ]');
                        return false
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
                        , tmpFilename   = null
                        , writeStreams  = []
                        , index         = 0;

                    request.files = [];

                    var busboy = new Busboy({ headers: request.headers });
                    busboy.on('file', function(fieldname, file, filename, encoding, mimetype) {
                        
                        file._dataLen = 0; 
                        // TODO - https://github.com/TooTallNate/node-wav
                        //file._mimetype = mimetype;
                        
                        
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
                                originalFilename: filename,
                                encoding: encoding,
                                type: mimetype,
                                size: this._dataLen,
                                path: tmpFilename
                            });
                            
                            // write to /tmp
                            // if (fs.existsSync(tmpFilename))
                            //     fs.unlinkSync(tmpFilename);
                            
                        });
                    });

                    busboy.on('finish', function(params) {
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
                                    console.debug('closing it : ' + total);
                                    
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


                    
                    // request.body = '';
                    // request.on('data', function(chunk) { // for this to work, don't forget the name attr for you form elements
                        
                    //     request.body += Buffer.from(new Uint8Array(chunk))
                    //     // if (!files[data.name]) {
                    //     //     files[data.name] = Object.assign({}, struct, chunk);
                    //     //     files[data.name].data = [];
                    //     // }
                        
                    //     // //convert the ArrayBuffer to Buffer 
                    //     // data.data = Buffer.from(new Uint8Array(data.data));
                    //     // //save the data 
                    //     // files[data.name].data.push(data.data);
                    //     // files[data.name].slice++;

                    //     // if (files[data.name].slice * 100000 >= files[data.name].size) {
                    //     //     var fileBuffer = Buffer.concat(files[data.name].data);

                    //     //     fs.write(_(uploadDir +'/' + data.name), fileBuffer, (err) => {
                    //     //         delete files[data.name];
                    //     //         request.files = files;
                    //     //         //if (err) return socket.emit('upload error');
                    //     //         request.emit('end');
                    //     //     });
                    //     // }
                    // });

                    
                    /**
                    var i = 0, form = new multiparty.Form(opt);
                    
                    form.parse(request, function(err, fields, files) {
                        if (err) {
                            throwError(response, 400, err.stack||err.message);
                            return
                        }

                        if ( request.method.toLowerCase() === 'post') {
                            for (i in fields) {

                                // false & true case
                                if ( /^(false|true|on)$/.test( fields[i][0] ) && typeof(fields[i][0]) == 'string' )
                                    fields[i][0] = ( /^(true|on)$/.test( fields[i][0] ) ) ? true : false;

                                // should be: request.post[i] = fields[i];
                                request.post[i] = fields[i][0]; // <-- to fixe on multiparty
                            }
                        } else if ( request.method.toLowerCase() === 'get') {
                            for (i in fields) {

                                // false & true case
                                if ( /^(false|true|on)$/.test( fields[i][0] ) && typeof(fields[i][0]) == 'string' )
                                    fields[i][0] = ( /^(true|on)$/.test( fields[i][0] ) ) ? true : false;

                                // should be: request.get[i] = fields[i];
                                request.get[i] = fields[i][0]; // <-- to fixe on multiparty
                            }
                        }

                        request.files = [];
                        var f = 0;
                        for (var i in files) {
                            // should be: request.files[i] = files[i];
                            //request.files[i] = files[i][0]; // <-- to fixe on multiparty
                            
                            
                            request.files[f] = {
                                name                : files[i][f].fieldName,
                                originalFilename    : files[i][f].originalFilename,
                                size                : files[i][f].size,
                                source              : files[i][f].path,
                            }

                            if ( typeof(files[i][f].headers) != 'undefined' ) {

                                request.files[f].headers = files[i][f].headers;

                                if (files[i][f].headers['content-type'])
                                    request.files[f].type = files[i][f].headers['content-type'];

                                if (files[i][f].headers['content-length']) {
                                    files[i][f].headers['content-length'] = parseInt(files[i][f].headers['content-length']);

                                    request.files[f].size = files[i][f].headers['content-length'];
                                }
                                    
                            }

                            ++f
                        }

                        if (request.fields) delete request.fields; // <- not needed anymore

                        loadBundleConfiguration(request, response, next, function (err, bundle, pathname, config, req, res, next) {
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
                    })*/
                } else {
                                       

                    request.on('data', function(chunk){ // for this to work, don't forget the name attr for you form elements
                        if ( typeof(request.body) == 'object') {
                            request.body = '';
                        }
                        request.body += chunk.toString()
                    });

                    request.on('end', function onEnd() {                                                
                        processRequestData(request, response, next)
                    });

                    if (request.end) request.end();                    
                    

                } //EO if multipart
            }           
                

        });//EO this.instance


        self.instance.listen(self.conf[self.appName][self.env].server.port);//By Default 3100

        self.emit('started', self.conf[self.appName][self.env], true);
    }
    
    var processRequestData = function(request, response, next) {
        
        // to compare with /core/controller/controller.js -> getParams()
        switch( request.method.toLowerCase() ) {
            case 'post':
                var obj = {}, configuring = false;
                if ( typeof(request.body) == 'string' ) {
                    // get rid of encoding issues
                    try {
                        if ( !/multipart\/form-data;/.test(request.headers['content-type']) ) {
                            if ( /application\/x\-www\-form\-urlencoded/.test(request.headers['content-type']) ) {
                                request.body = request.body.replace(/\+/g, ' ');
                            }

                            if ( request.body.substr(0,1) == '?')
                                request.body = request.body.substr(1);

                            // false & true case
                            if ( /(\"false\"|\"true\"|\"on\")/.test(request.body) )
                                request.body = request.body.replace(/\"false\"/g, false).replace(/\"true\"/g, true).replace(/\"on\"/g, true);

                            obj = parseBody(request.body);
                            if (obj.count() == 0 && request.body.length > 1) {
                                try {
                                    request.post = JSON.parse(request.body);
                                } catch (err) {}
                            }
                        }

                    } catch (err) {
                        var msg = '[ '+request.url+' ]\nCould not decodeURIComponent(requestBody).\n'+ err.stack;
                        console.warn(msg);
                    }

                } else {
                    // 2016-05-19: fix to handle requests from swagger/express
                    if (request.body.count() == 0 && typeof(request.query) != 'string' && request.query.count() > 0 ) {
                        request.body = request.query
                    }
                    var bodyStr = JSON.stringify(request.body);
                    // false & true case
                    if ( /(\"false\"|\"true\"|\"on\")/.test(bodyStr) )
                        bodyStr = bodyStr.replace(/\"false\"/g, false).replace(/\"true\"/g, true).replace(/\"on\"/g, true);

                    obj = JSON.parse(bodyStr)
                }

                if ( obj.count() > 0 ) {
                    // still need this to allow compatibility with express & connect middlewares
                    request.body = request.post = obj;
                }

                // see.: https://www.w3.org/Protocols/rfc2616/rfc2616-sec9.html#POST
                //     Responses to this method are not cacheable,
                //     unless the response includes appropriate Cache-Control or Expires header fields.
                //     However, the 303 (See Other) response can be used to direct the user agent to retrieve a cacheable resource.
                response.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
                response.setHeader('Pragma', 'no-cache');
                response.setHeader('Expires', '0');

                // cleaning
                request.query   = undefined;
                request.get     = undefined;
                request.put     = undefined;
                request.delete  = undefined;
                break;

            case 'get':
                if ( typeof(request.query) != 'undefined' && request.query.count() > 0 ) {
                    request.get = request.query;
                }
                // else, will be matching route params against url context instead once route is identified


                // cleaning
                request.query   = undefined;
                request.post    = undefined;
                request.put     = undefined;
                request.delete  = undefined;
                break;

            case 'put':
                // eg.: PUT /user/set/1
                var obj = {};
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
                            if ( /(\"false\"|\"true\"|\"on\")/.test(request.body) )
                                request.body = request.body.replace(/\"false\"/g, false).replace(/\"true\"/g, true).replace(/\"on\"/g, true);

                            obj = parseBody(request.body);

                            if ( typeof(obj) != 'undefined' && obj.count() == 0 && request.body.length > 1 ) {
                                try {
                                    request.put = merge(request.put, JSON.parse(request.body));
                                } catch (err) {
                                    console.log('Case `put` #0 [ merge error ]: ' + (err.stack||err.message))
                                }
                            }
                        }

                    } catch (err) {
                        var msg = '[ '+request.url+' ]\nCould not decodeURIComponent(requestBody).\n'+ err.stack;
                        console.error(msg);
                        throwError(response, 500, msg);
                    }

                } else {
                    // 2016-05-19: fix to handle requests from swagger/express
                    if (request.body.count() == 0 && typeof(request.query) != 'string' && request.query.count() > 0 ) {
                        request.body = request.query
                    }
                    var bodyStr = JSON.stringify(request.body);
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
                break;


            case 'delete':
                if ( request.query.count() > 0 ) {
                    request.delete = request.query;

                }
                // else, matching route params against url context instead once route is identified

                request.post    = undefined;
                request.put     = undefined;
                request.get     = undefined;
                break


        };

        loadBundleConfiguration(request, response, next, function (err, bundle, pathname, config, req, res, next) {
            if (!req.handled) {
                req.handled = true;
                if (err) {
                    if (!res.headersSent)
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

    var getHead = function(file) {
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
    }

    var loadBundleConfiguration = function(req, res, next, callback) {

        var config = new Config();
        config.setBundles(self.bundles);
        var conf = config.getInstance(); // for all loaded bundles
        if ( typeof(conf) != 'undefined') {//for cacheless mode
            self.conf = conf;
        }

        //var pathname    = url.parse(req.url, true).pathname;
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
        if (!cacheless) { // all but dev & debug
            callback(err, bundle, pathname, options.config, req, res, next)
        } else {
            // config.refresh(bundle, function(err, routing) {
            //     if (err) {
            //         throwError(res, 500, 'Internal Server Error: \n' + (err.stack||err), next)
            //     } else {
                    //refreshing routing at the same time.
            //        self.routing = routing;
                    callback(err, bundle, pathname, options.config, req, res, next)
            //    }
            // })
        }
    }
    
    // Express middleware portability when using another engine instead of expressjs
    var nextExpressMiddleware = function(err) {
                
        var router              = local.router;
        var expressMiddlewares  = self.instance._expressMiddlewares;
        
        if (err) {
            throwError(nextExpressMiddleware._response, 500, (err.stack|err.message|err), nextExpressMiddleware._next)
        }
        
        expressMiddlewares[nextExpressMiddleware._index](nextExpressMiddleware._request, nextExpressMiddleware._response, function onNext(err) {
            ++nextExpressMiddleware._index;  
            
            if (err) {
                throwError(nextExpressMiddleware._response, 500, (err.stack||err.message||err), nextExpressMiddleware._next)
            }
            
                     
            
            if (nextExpressMiddleware._index > nextExpressMiddleware._count) {    
                router._server = self.instance;            
                router.route(nextExpressMiddleware._request, nextExpressMiddleware._response, nextExpressMiddleware._next, nextExpressMiddleware._request.routing)
                
                //handle(nextExpressMiddleware._request, nextExpressMiddleware._response, nextExpressMiddleware._next, nextExpressMiddleware._bundle, nextExpressMiddleware._pathname, nextExpressMiddleware._config)
            } else {
                nextExpressMiddleware.call(this, err, true)
            }                        
        });        
    };
    
    

    var handle = function(req, res, next, bundle, pathname, config) {
        
        var matched             = false
            , isRoute           = {}
            , withViews         = hasViews(bundle)
            , router            = local.router
            , cacheless         = config.isCacheless()
            , wroot             = null
        ;

    
        var params      = {}
            , _routing  = {}
            , reMethod  = new RegExp(req.method, 'i')
            , method    = null
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
                
                if (routing[name].bundle != bundle) continue;
                // method filter    
                method = routing[name].method;
                if ( /\,/.test( method ) && reMethod.test(method) ) {
                    method = req.method
                }               
                //if (method != req.method) continue;
                
                //Preparing params to relay to the router.
                params = {
                    method              : method,
                    requirements        : routing[name].requirements,
                    namespace           : routing[name].namespace || undefined,
                    url                 : unescape(pathname), /// avoid %20
                    rule                : routing[name].originalRule || name,
                    param               : JSON.parse(JSON.stringify(routing[name].param)),
                    middleware          : JSON.parse(JSON.stringify(routing[name].middleware)),
                    bundle              : routing[name].bundle,
                    isXMLRequest        : req.isXMLRequest,
                    isWithCredentials   : req.isWithCredentials
                };

                //Parsing for the right url.
                try {                    
                    isRoute = routingUtils.compareUrls(params, routing[name].url, req);
                        
                } catch (err) {
                    throwError(res, 500, 'Rule [ '+name+' ] needs your attention.\n'+ err.stack);
                    break;
                }

                if ( pathname == routing[name].url || isRoute.past ) {

                    _routing = req.routing;      
                    // comparing routing method VS request.url method
                    isMethodAllowed = reMethod.test(_routing.method);
                    if (!isMethodAllowed) {
                        throwError(res, 405, 'Method Not Allowed.\n'+ ' `'+req.url+'` is expecting `' + _routing.method.toUpperCase() +'` method but got `'+ req.method.toUpperCase() +'` instead');
                        break;
                    } else {

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
                    }
                    
                    //break;
                }
            }
            
            

        if (matched) {
            if ( cacheless ) {
                // config.refreshModels(params.bundle, self.env, function onModelRefreshed(err){
                //     if (err) {
                //         throwError(res, 500, err.msg||err.stack , next)
                //     } else {
                        
                        if ( /^isaac/.test(self.engine) && self.instance._expressMiddlewares.length > 0) {                                            
                            nextExpressMiddleware._index = 0;
                            nextExpressMiddleware._count = self.instance._expressMiddlewares.length-1;
                            nextExpressMiddleware._request = req;
                            nextExpressMiddleware._response = res;
                            nextExpressMiddleware._next = next;
                            
                            nextExpressMiddleware()
                        } else {
                            router._server = self.instance;
                            router.route(req, res, next, req.routing)
                        }
                        
                //     }
                // })
            } else {                                
                
                if ( /^isaac/.test(self.engine) && self.instance._expressMiddlewares.length > 0) {                                            
                    nextExpressMiddleware._index = 0;
                    nextExpressMiddleware._count = self.instance._expressMiddlewares.length-1;
                    nextExpressMiddleware._request = req;
                    nextExpressMiddleware._response = res;
                    nextExpressMiddleware._next = next;
                    
                    nextExpressMiddleware()
                } else {
                    router._server = self.instance;
                    router.route(req, res, next, req.routing)
                }
            }
        } else {
            throwError(res, 404, 'Page not found: \n' + pathname, next)
        }
    }

    var throwError = function(res, code, msg, next) {
        var withViews       = local.hasViews[self.appName] || hasViews(self.appName);
        var isUsingTemplate = self.conf[self.appName][self.env].template;
        var isXMLRequest    = local.request.isXMLRequest;
        
        var err = null;
        if ( typeof(msg) != 'object' ) {
            err = {
                code: code,
                message: msg
            }
        } else {
            err = JSON.parse(JSON.stringify(msg))
        }
        
        if (!res.headersSent) {
            res.headersSent = true;
            
            if (isXMLRequest || !withViews || !isUsingTemplate ) {
                // allowing this.throwError(err)
                
                if ( typeof(code) == 'object' && !msg && typeof(code.status) != 'undefined' && typeof(code.error) != 'undefined' ) {
                    msg     = code.error;
                    code    = code.status;
                }

                // Internet Explorer override
                if ( /msie/i.test(local.request.headers['user-agent']) ) {
                    res.writeHead(code, "Content-Type", "text/plain")
                } else {
                    res.writeHead(code, { 'Content-Type': 'application/json'} )
                }

                console.error('[ BUNDLE ][ '+self.appName+' ] '+ local.request.method +' [ '+code+' ] '+ local.request.url);
                return res.end(JSON.stringify({
                    status: code,
                    error: msg
                }));
                //res.headersSent = true
            } else {
                res.writeHead(code, { 'Content-Type': 'text/html'} );
                console.error('[ BUNDLE ][ '+self.appName+' ] '+ local.request.method +' [ '+code+' ] '+ local.request.url);
                return res.end('<h1>Error '+ code +'.</h1><pre>'+ msg + '</pre>');
                //res.headersSent = true
            }
        } else {
                        
            if (typeof(next) != 'undefined')
                return next();
            else
                return;
        }
    }


    //return this
};

Server = inherits(Server, EventEmitter);
module.exports = Server