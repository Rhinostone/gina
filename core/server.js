//Imports.
var fs              = require('fs');
var path            = require('path');
var EventEmitter    = require('events').EventEmitter;
var express         = require('express');
var url             = require('url');
var Config          = require('./config');
var Router          = require('./router');
var util            = require('util');
var utils           = require('./utils');
var inherits        = utils.inherits;
var merge           = utils.merge;
var Proc            = utils.Proc;
var console         = utils.logger;
var multiparty      = utils.multiparty;


function Server(options) {
    var self = this;
    var local = {
        router : null,
        hasViews: {}
    };

    this.conf = {};
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

        //Starting app.
        self.appName = options.bundle;

        self.env = options.env;
        local.router = new Router(self.env);

        //True => multiple bundles sharing the same server (port).
        self.isStandalone = options.isStandalone;

        self.executionPath = options.executionPath;

        self.bundles = options.bundles;
        self.conf = {};

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


        self.emit('configured', false, express(), express, self.conf[self.appName][self.env])
    }


    this.start = function(instance) {

        if (instance) {
            self.instance = instance
        }

        try {
            self.validHeads =  fs.readFileSync(getPath('gina.core') + '/mime.types').toString();
            self.validHeads = JSON.parse(self.validHeads)
        } catch(err) {
            console.error(err.stack||err.message);
            process.exit(1)
        }

        onRoutesLoaded( function(err) {//load all registered routes in routing.json
            console.debug('Routing loaded' + '\n'+ JSON.stringify(self.routing, null, '\t'));

            if ( hasViews(self.appName) ) {
                utils.url(self.conf[self.appName][self.env], self.routing)
            }

            if (!err) {
                onRequest()
            }
        })
    }

    /**
     * onRoutesLoaded
     *
     *
     * */
    var onRoutesLoaded = function(callback) {

        var config          = new Config()
            , conf          =  config.getInstance(self.appName)
            , cacheless     = config.isCacheless()
            , env           = self.env
            , apps          = conf.bundles
            , filename      = ''
            , appName       = ''
            , name          = ''
            , tmp           = {}
            , standaloneTmp = {}
            , main          = ''
            , tmpContent    = ''
            , tmpName       = ''
            , i             = 0
            , wroot         = null
            , localWroot    = null
            , originalRules = []
            , oRuleCount    = 0;

        if (cacheless) {
            self.routing = {}
        }

        //Standalone or shared instance mode. It doesn't matter.
        for (; i<apps.length; ++i) {
            var appPath = _(self.conf[apps[i]][self.env].bundlesPath+ '/' + apps[i]);
            appName =  apps[i];

            //Specific case.
            if (!self.isStandalone && i == 0) appName = apps[i];

            try {
                main = _(appPath + '/config/' + self.conf[apps[i]][self.env].files.routing);
                filename = main;//by default
                filename = self.conf[apps[i]][self.env].files.routing.replace(/.json/, '.' +env + '.json');
                filename = _(appPath + '/config/' + filename);
                //Can't do a thing without.
                if ( !fs.existsSync(filename) ) {
                    filename = main
                }

                if (cacheless) {
                    delete require.cache[_(filename, true)]
                }

                if (filename != main) {
                    self.routing = merge(true, require(main), require(filename));
                } else {
                    self.routing = require(filename);
                }

                try {

                    tmp = self.routing;
                    //Adding important properties; also done in core/config.
                    for (var rule in tmp){
                        tmp[rule].bundle = (tmp[rule].bundle) ? tmp[rule].bundle : apps[i]; // for reverse search
                        wroot = self.conf[apps[i]][self.env].server.webroot;
                        tmp[rule].param.file = ( typeof(tmp[rule].param.file) != 'undefined' ) ? tmp[rule].param.file : rule; // get template file

                        // renaming rule for standalone setup
                        if ( self.isStandalone && apps[i] != self.appName && wroot == '/') {
                            wroot = '/'+ apps[i];
                            self.conf[apps[i]][self.env].server.webroot = wroot
                        }

                        if (typeof(tmp[rule].url) != 'object') {
                            if (tmp[rule].url.length > 1 && tmp[rule].url.substr(0,1) != '/') {
                                tmp[rule].url = '/'+tmp[rule].url
                            } else if (tmp[rule].url.length > 1 && self.conf[apps[i]][self.env].server.webroot.substr(self.conf[apps[i]][self.env].server.webroot.length-1,1) == '/') {
                                tmp[rule].url = tmp[rule].url.substr(1)
                            } else {
                                if (wroot.substr(wroot.length-1,1) == '/') {
                                    wroot = wroot.substr(wroot.length-1,1).replace('/', '')
                                }
                            }


                            if (tmp[rule].bundle != apps[i]) { // allowing to override bundle name in routing.json
                                // originalRule is used to facilitate cross bundles (hypertext)linking
                                originalRules[oRuleCount] = ( self.isStandalone && tmp[rule] && apps[i] != self.appName) ? apps[i] + '-' + rule : rule;
                                ++oRuleCount;

                                localWroot = self.conf[tmp[rule].bundle][self.env].server.webroot;
                                // standalone setup
                                if ( self.isStandalone && tmp[rule].bundle != self.appName && localWroot == '/') {
                                    localWroot = '/'+ routing[rule].bundle;
                                    self.conf[tmp[rule].bundle][self.env].server.webroot = localWroot
                                }
                                if (localWroot.substr(localWroot.length-1,1) == '/') {
                                    localWroot = localWroot.substr(localWroot.length-1,1).replace('/', '')
                                }
                                tmp[rule].url = localWroot + tmp[rule].url
                            } else {
                                tmp[rule].url = wroot + tmp[rule].url
                            }

                        } else {

                            for (var u=0; u<tmp[rule].url.length; ++u) {
                                if (tmp[rule].url[u].length > 1 && tmp[rule].url[u].substr(0,1) != '/') {
                                    tmp[rule].url[u] = '/'+tmp[rule].url[u]
                                //} else if (tmp[rule].url[u].length > 1 && self.conf[apps[i]][self.env].server.webroot.substr(self.conf[apps[i]][self.env].server.webroot.length-1,1) == '/') {
                                //    tmp[rule].url[u] = tmp[rule].url[u].substr(1)
                                } else {
                                    if (wroot.substr(wroot.length-1,1) == '/') {
                                        wroot = wroot.substr(wroot.length-1,1).replace('/', '')
                                    }
                                }

                                tmp[rule].url[u] = wroot + tmp[rule].url[u]
                            }
                        }

                        if( hasViews(apps[i]) ) {
                            // This is only an issue when it comes to the frontend dev
                            // views.useRouteNameAsFilename is set to true by default
                            // IF [ false ] the action is used as filename
                            if ( !self.conf[apps[i]][self.env].content['views']['default'].useRouteNameAsFilename && tmp[rule].param.bundle != 'framework') {
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
                            if (apps[i] != self.appName) {
                                standaloneTmp[apps[i] + '-' + rule] = JSON.parse(JSON.stringify(tmp[rule]))
                            } else {
                                standaloneTmp[rule] = JSON.parse(JSON.stringify(tmp[rule]))
                            }
                        }
                    }

                } catch (err) {
                    self.routing = null;
                    console.error(err.stack||err.message);
                    callback(err)
                }

            } catch (err) {
                console.warn(err, err.stack||err.message);
                callback(err)
            }

            //self.conf[apps[i]][self.env].content.routing = (self.isStandalone) ? standaloneTmp : tmp;
        }//EO for.

        self.routing = merge(true, self.routing, ((self.isStandalone && apps[i] != self.appName ) ? standaloneTmp : tmp));
        // originalRule is used to facilitate cross bundles (hypertext)linking
        for (var r = 0, len = originalRules.length; r < len; r++) { // for each rule ( originalRules[r] )
            self.routing[originalRules[r]].originalRule = (self.routing[originalRules[r]].bundle === self.appName ) ?  config.getOriginalRule(originalRules[r], self.routing) : config.getOriginalRule(self.routing[originalRules[r]].bundle +'-'+ originalRules[r], self.routing)
        }

        callback(false)
    }

    var hasViews = function(bundle) {
        var _hasViews = false;
        if (typeof(local.hasViews[bundle]) != 'undefined') {
            _hasViews = local.hasViews[bundle];
        } else {
            _hasViews = ( typeof(self.conf[bundle][self.env].content['views']) != 'undefined' ) ? true : false;
            local.hasViews[bundle] = _hasViews;
        }

        return _hasViews
    }

    var parseBody = function(body) {
        var obj = {}, arr = body.split(/&/g);
        var el = {};
        for (var i=0; i<arr.length; ++i) {
            if (!arr[i]) continue;
            el = arr[i].split(/=/);
            if ( /\{\}\"\:/.test(el[1]) ) { //might be a json
                try {
                    el[1] = JSON.parse(el[1])
                } catch (err) {
                    console.error('could not parse body: ' + el[1])
                }
            }

            if ( typeof(el[1]) == 'string' && !/\[object /.test(el[1])) {
                obj[ el[0] ] = el[1].replace(/%2B/g, ' ') // & ensure true white spaces
            }
        }
        return obj
    }

    var onRequest = function() {

        var apps = self.bundles;
        var webrootLen = self.conf[self.appName][self.env].server.webroot.length;

        //var body = '';
        //self.instance.on('data', function(chunk){
        //    if ( typeof(body) == 'object') {
        //        body = ''
        //    }
        //    body += chunk.toString()
        //});

        self.instance.all('*', function onInstance(request, response, next) {
            // Fixing an express js bug :(
            // express is trying to force : /path/dir => /path/dir/
            // which causes : /path/dir/path/dir/  <---- by trying to add a slash in the end
            if (
                webrootLen > 1
                && request.url === self.conf[self.appName][self.env].server.webroot + '/' + self.conf[self.appName][self.env].server.webroot + '/'
            ) {
                request.url = self.conf[self.appName][self.env].server.webroot
            }
            //Only for dev & debug.
            self.conf[self.appName][self.env]['protocol'] = request.protocol || self.conf[self.appName][self.env]['hostname'];
            self.conf[self.appName][self.env]['hostname'] = self.conf[self.appName][self.env]['protocol'] +'://'+ request.headers.host;

            request.post = {};
            request.get = {};
            //request.cookies = {}; // ???
            //request.put = {}; //?
            //request.delete = {}; //?
            request.body = {};



            // multipart wrapper for uploads
            // files are available from your controller or any middlewares:
            //  @param {object} req.files
            if ( /multipart\/form-data;/.test(request.headers['content-type']) ) {
                // TODO - get options from settings.json & settings.{env}.json ...
                // -> https://github.com/andrewrk/node-multiparty
                var opt = self.conf[self.appName][self.env].content.settings.upload;
                var i = 0, form = new multiparty.Form(opt);
                form.parse(request, function(err, fields, files) {
                    if (err) {
                        self.throwError(response, 400, err.stack||err.message);
                        return
                    }

                    if ( request.method.toLowerCase() === 'post') {
                        for (i in fields) {
                            // should be: request.post[i] = fields[i];
                            request.post[i] = fields[i][0]; // <-- to fixe on multiparty
                        }
                    } else if ( request.method.toLowerCase() === 'get') {
                        for (i in fields) {
                            // should be: request.get[i] = fields[i];
                            request.get[i] = fields[i][0]; // <-- to fixe on multiparty
                        }
                    }

                    request.files = {};
                    for (var i in files) {
                        // should be: request.files[i] = files[i];
                        request.files[i] = files[i][0]; // <-- to fixe on multiparty
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
                })
            } else {
                request.on('data', function(chunk){ // for this to work, don't forget the name attr for you form elements
                    if ( typeof(request.body) == 'object') {
                        request.body = '';
                    }
                    request.body += chunk.toString()
                });

                request.on('end', function onEnd() {

                        switch( request.method.toLowerCase() ) {
                            case 'post':
                                var obj = {}, configuring = false;
                                if ( typeof(request.body) == 'string' ) {
                                    // get rid of encoding issues
                                    try {
                                        if ( !/multipart\/form-data;/.test(request.headers['content-type']) ) {
                                            request.body = decodeURIComponent( request.body );
                                            if ( request.body.substr(0,1) == '?')
                                                request.body = request.body.substr(1);


                                            obj = parseBody(request.body)
                                        }

                                    } catch (err) {
                                        var msg = '[ '+request.url+' ]\nCould not decodeURIComponent(requestBody).\n'+ err.stack;
                                        console.warn(msg);
                                    }
                                }

                                if ( obj.count() > 0 ) {
                                    request.body = request.post = obj;
                                }
                                break;

                            case 'get':
                                request.get = request.query;
                                break;
                            //
                            //case 'put':
                            //    request.put = request.? || undefined;
                            //    break;
                            //
                            //case 'delete':
                            //    request.delete = request.? || undefined;
                            //    break


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
                            }
                        })

                });
            } //EO if multipart

        });//EO this.instance

        var hostname = self.conf[self.appName][self.env].protocol + '://' + self.conf[self.appName][self.env].host + ':' + self.conf[self.appName][self.env].port[self.conf[self.appName][self.env].protocol];
        console.info(
                '\nbundle: [ ' + self.appName +' ]',
                '\nenv: [ '+ self.env +' ]',
                //'\nport: ' + self.conf[self.appName][self.env].port.http,
                '\npid: ' + process.pid,
                '\nThis way please -> '+ hostname
        );


        self.instance.listen(self.conf[self.appName][self.env].port.http);//By Default 3100
    }

    var getHead = function(file) {
        var s = file.split(/\./);
        var type = undefined;
        if( typeof(self.validHeads[s[s.length-1]]) != 'undefiend' ) {
            type = self.validHeads[s[s.length-1]];
            if (!type) {
                console.warn('[ '+file+' ] extension: `'+s[2]+'` not supported by gina: `core/mime.types`. Replacing with `plain/text` ')
            }
        }
        return type || 'plain/text'
    }

    var loadBundleConfiguration = function(req, res, next, callback) {

        var config = new Config();
        config.setBundles(self.bundles);
        var conf = config.getInstance(bundle);
        if ( typeof(conf) != 'undefined') {//for cacheless mode
            self.conf = conf
        }

        var pathname = url.parse(req.url, true).pathname;
        var bundle = self.appName; // by default

        // finding bundle
        if (self.isStandalone) {

            end:
                for (var b in conf) {
                    if ( typeof(conf[b][self.env].content.statics) != 'undefined' && conf[b][self.env].content.statics.count() > 0 ) {
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
            callback(false, bundle, pathname, req, res, next);
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
        })
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
            config.refresh(bundle, function(err, routing) {
                if (err) {
                    throwError(res, 500, 'Internal Server Error: \n' + (err.stack||err), next)
                } else {
                    //refreshing routing at the same time.
                    self.routing = routing;
                    callback(err, bundle, pathname, options.config, req, res, next)
                }
            })
        }
    }

    var handle = function(req, res, next, bundle, pathname, config) {
        var matched         = false
            , isRoute       = {}
            , withViews     = hasViews(bundle)
            , router        = local.router
            , cacheless     = config.isCacheless()
            , wroot         = null;

        console.debug('about to handle [ '+ pathname + ' ] route');
        router.setMiddlewareInstance(self.instance);

        //Middleware configuration.
        req.setEncoding(self.conf[bundle][self.env].encoding);

        if ( self.routing == null || self.routing.count() == 0 ) {
            console.error('Malformed routing or Null value for bundle [' + bundle + '] => ' + req.originalUrl);
            throwError(res, 500, 'Internal server error\nMalformed routing or Null value for bundle [' + bundle + '] => ' + req.originalUrl, next);
        }

        var params = {}
            , routing = JSON.parse(JSON.stringify(self.routing));
        out:
            for (var rule in routing) {
                if (typeof(routing[rule]['param']) == 'undefined')
                    break;

                //Preparing params to relay to the router.
                params = {
                    requirements : routing[rule].requirements,
                    url : pathname,
                    rule: routing[rule].originalRule || rule,
                    param : routing[rule].param,
                    middleware : routing[rule].middleware,
                    bundle: routing[rule].bundle
                };
                //Parsing for the right url.
                isRoute = router.compareUrls(req, params, routing[rule].url);
                if (pathname === routing[rule].url || isRoute.past) {

                    console.debug('Server routing to '+ pathname);

                    var allowed = (typeof(routing[rule].method) == 'undefined' || routing[rule].method.length > 0 || routing[rule].method.indexOf(req.method) != -1)
                    if (!allowed) {
                        throwError(res, 405, 'Method Not Allowed for [' + params.bundle + '] => ' + req.originalUrl, next)
                    } else {
                        // onRouting Event ???
                        if ( cacheless ) {
                            config.refreshModels(params.bundle, self.env, function onModelRefreshed(){
                                router.route(req, res, next, params)
                            })
                        } else {
                            router.route(req, res, next, params)
                        }
                    }
                    matched = true;
                    isRoute = {};
                    break out;

                }
            }


        if (!matched) {

            if ( typeof(self.isNotStatic) != 'undefined' && !res.headersSent) {
                delete self.isNotStatic;
                throwError(res, 404, 'Page not found: \n' + pathname, next)
            }
            // find targeted bundle
            var allowed     = null
                , conf      = null
                , uri       = ''
                , key       = ''
                , conf      = self.conf[bundle][self.env]
                , wroot     = conf.server.webroot;

            //webroot test
            if (wroot != '/') {
                uri = (wroot + pathname.replace(wroot, '')).split('/');
                var len = wroot.split('/').length;
                key = uri.splice(1, len).join('/');
            } else {
                uri = pathname.split('/');
                key = uri.splice(1, 1)[0]
            }

            //static filter
            if ( typeof(conf.content.statics) != 'undefined'
                && typeof(conf.content.statics[key]) != 'undefined'
                && typeof(key) != 'undefined'
                && req.url === wroot + req.url.replace(wroot, '')
            ) {
                // No sessions for statics
                if (req.session) {
                    delete req['session']
                }

                uri = uri.join('/');
                var filename = path.join(conf.content.statics[key], uri);

                fs.exists(filename, function(exists) {

                    if(exists) {

                        if (fs.statSync(filename).isDirectory()) filename += '/index.html';

                        fs.readFile(filename, "binary", function(err, file) {
                            if (err) {
                                res.writeHead(500, {"Content-Type": "text/plain"});
                                res.write(err.stack + "\n");
                                res.end();
                                return
                            }
                            if (!res.headersSent) {
                                try {
                                    res.setHeader("Content-Type", getHead(filename));
                                    if (cacheless) {
                                        // source maps integration for javascript
                                        if ( /\.js$/.test(filename) && fs.existsSync(filename +'.map') ) {
                                            res.setHeader("X-SourceMap", pathname +'.map')
                                        }
                                    }

                                    res.writeHead(200)
                                    res.write(file, 'binary');
                                    res.end()
                                } catch(err) {
                                    throwError(res, 500, err.stack)
                                }
                            }
                        });
                    } else {
                        // else
                        if (wroot.substr(wroot.length-1,1) == '/') {
                            wroot = wroot.substr(wroot.length-1,1).replace('/', '')
                        }
                        // web services case ... when you hit from a web browser
                        if (pathname === wroot + '/favicon.ico' && !withViews && !res.headersSent ) {
                            res.writeHead(200, {'Content-Type': 'image/x-icon'} );
                            res.end()
                        }

                        if (!res.headersSent)
                            throwError(res, 404, 'Page not found: \n' + pathname, next)

                    }//EO exists
                })//EO static filter

            } else {
                // else
                if (wroot.substr(wroot.length-1,1) == '/') {
                    wroot = wroot.substr(wroot.length-1,1).replace('/', '')
                }

                if (pathname === wroot + '/favicon.ico' && !withViews && !res.headersSent ) {
                    res.writeHead(200, {'Content-Type': 'image/x-icon'} );
                    res.end()
                }
                if (!res.headersSent)
                    throwError(res, 404, 'Page not found: \n' + pathname, next)
            }

        }
    }

    var throwError = function(res, code, msg, next) {
        var withViews = local.hasViews[self.appName] || hasViews(self.appName);

        if ( !withViews ) {
            if (!res.headersSent) {
                res.writeHead(code, { 'Content-Type': 'application/json'} );
                res.end(JSON.stringify({
                    status: code,
                    error: 'Error '+ code +'. '+ msg
                }));
                res.headersSent = true
            } else {
                next()
            }

        } else {
            if (!res.headersSent) {
                res.writeHead(code, { 'Content-Type': 'text/html'} );
                res.end('<h1>Error '+ code +'.</h1><pre>'+ msg + '</pre>');
                res.headersSent = true
            } else {
                next()
            }
        }
    }


    this.onConfigured = function(callback) {
        self.once('configured', function(err, instance, middleware, conf) {
            callback(err, instance, middleware, conf)
        });
        init(options)
    }

    return this
};

Server = inherits(Server, EventEmitter);
module.exports = Server