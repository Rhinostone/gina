//Imports.
var fs              = require('fs');
var path            = require("path");
var EventEmitter    = require('events').EventEmitter;
var express         = require('express');
var url             = require('url');
var Config          = require('./config');
var Router          = require('./router');
var utils           = require('./utils');
var inherits        = utils.inherits;
var merge           = utils.merge;
var Proc            = utils.Proc;
var console         = utils.logger;

function Server(options) {
    var self = this;
    var local = {
        router : null
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

        self.cacheless = (process.env.IS_CACHELESS == 'false') ? false : true;

        //False => multiple apps sharing the same server (port).
        self.isStandalone = options.isStandalone;

        self.executionPath = options.executionPath;

        //console.log("Geena ", options);
        self.bundles = options.bundles;

        //console.log("!!Stand alone ? ", this.isStandalone, this.bundles, '\n'+options.conf);
        //console.log("CONF CONTENT \n",  options.conf[this.appName][this.env]);

        if (!self.isStandalone) {
            //Only load the related conf / env.
            self.conf[self.appName] = options.conf[self.appName][self.env];
            self.conf[self.appName].bundlesPath = options.conf[self.appName][self.env].bundlesPath;
            self.conf[self.appName].modelsPath =  options.conf[self.appName][self.env].modelsPath;
        } else {

            //console.log("Running mode not handled yet..", self.appName, " VS ", self.bundles);
            //Load all conf for the related apps & env.
            var apps = self.bundles;
            for (var i=0; i<apps.length; ++i) {
                self.conf[apps[i]] = options.conf[apps[i]][self.env];
                self.conf[apps[i]].bundlesPath = options.conf[apps[i]][self.env].bundlesPath;
                self.conf[apps[i]].modelsPath = options.conf[apps[i]][self.env].modelsPath;
            }
        }


        self.emit('configured', false, express(), express, self.conf[self.appName])
    }


    this.start = function(instance) {

        if (instance) {
            self.instance = instance
        }

        try {
            self.validHeads =  fs.readFileSync(getPath('geena.core') + '/mime.types').toString();
            self.validHeads = JSON.parse(self.validHeads)
        } catch(err) {
            console.error(err.stack||err.message);
            process.exit(1)
        }

        //console.log('['+ self.appName +'] on port : ['+ self.conf[self.appName].port.http + ']');
        onRoutesLoaded( function(err) {//load all registered routes in routing.json
//            console.debug(
//                'geena',
//                'SERVER:DEBUG:1',
//                'Routing loaded' + '\n'+ JSON.stringify(self.routing, null, '\t'),
//                __stack
//            );
            console.debug('Routing loaded' + '\n'+ JSON.stringify(self.routing, null, '\t'));

            if ( hasViews(self.appName) ) {
                utils.url(self.conf[self.appName], self.routing)
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

        var config = new Config();
        var conf =  config.getInstance(self.appName);
        var cacheless = config.isCacheless();

        var env         = self.env,
            cacheless   = self.cacheless,
            apps        = conf.bundles,
            filename    = "",
            appName     = "",
            name        = "",
            tmp         = {},
            main        = "",
            tmpContent  = "",
            tmpName     = "";

        if (cacheless) {
            self.routing = {}
        }

        //Standalone or shared instance mode. It doesn't matter.
        for (var i=0; i<apps.length; ++i) {
            var appPath = _(self.conf[apps[i]].bundlesPath+ '/' + apps[i]);
            appName =  apps[i];

            //Specific case.
            if (!self.isStandalone && i == 0) appName = apps[i];

            try {
                main = _(appPath + '/config/' + self.conf[apps[i]].files.routing);
                filename = main;//by default

                if (cacheless) {

                    filename = self.conf[apps[i]].files.routing.replace(/.json/, '.' +env + '.json');
                    filename = _(appPath + '/config/' + filename);
                    //Can't do a thing without.
                    if ( !fs.existsSync(filename) ) {
                        filename = main;
                    }
                    delete require.cache[_(filename, true)];
                }


                if (filename != main) {
                    if (cacheless) delete require.cache[_(filename, true)];
                    self.routing = merge(true, require(main), require(filename));
                } else {
                    self.routing = require(filename);
                }


                try {

                    tmp = self.routing;
                    //Adding important properties; also done in core/config.
                    for (var rule in tmp){
                        tmp[rule].param.app = apps[i];

                        if (typeof(tmp[rule].url) != 'object') {
                            if (tmp[rule].url.length > 1 &&tmp[rule].url.substr(0,1) == '/') {
                                tmp[rule].url = tmp[rule].url.substr(1);
                            }
                            tmp[rule].url = conf.server.webroot + tmp[rule].url;
                        } else {
                            if (tmp[rule].url[u].length > 1 && tmp[rule].url[u].substr(0,1) == '/') {
                                tmp[rule].url[u] = tmp[rule].url[u].substr(1);
                            }

                            for (var u=0; u<tmp[rule].url.length; ++u) {
                                tmp[rule].url[u] =  conf.server.webroot + tmp[rule].url[u]
                            }
                        }

                        if( hasViews(apps[i]) ) {
                            tmp[rule].param.file = tmp[rule].param.action;
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

                    if (self.routing.count() > 0) {
                        self.routing = merge(true, self.routing, tmp);
                    } else {
                        self.routing = tmp;
                    }
                    tmp = {};
                } catch (err) {
                    self.routing = null;
                    console.error('geena', 'SERVER:ERR:2', err, __stack);
                    callback(err)
                }

            } catch (err) {
                console.warn(err, err.stack||err.message);
                callback(err)
            }

            self.conf[apps[i]].content.routing = self.routing
        }//EO for.

        callback(false)
    }

    var hasViews = function(bundle) {
        return ( typeof(self.conf[bundle].content['views']) != 'undefined' ) ? true : false;
    }

    var onRequest = function() {

        var apps = self.bundles;

        /**
         self.instance.all('*', function(req, res, next) {
                res.header("Access-Control-Allow-Origin", "*");
                res.header("Access-Control-Allow-Headers", "X-Requested-With");
                next();
            });*/

        self.instance.all('*', function onInstance(request, response, next) {
            //Only for dev & debug.
            self.conf[self.appName]['protocol'] = request.protocol || self.conf[self.appName]['hostname'];
            self.conf[self.appName]['hostname'] = self.conf[self.appName]['protocol'] +'://'+ request.headers.host;

            loadBundleConfiguration(request, response, next, self.appName, function (err, pathname, req, res, next) {
                console.log('calling back..');
                if (err) {
                    throwError(response, 500, 'Internal server error\n' + err.stack)
                }
                handle(req, res, next, pathname)
            })//EO this.loadBundleConfiguration(this.appName, function(err, conf){
        });//EO this.instance

        console.info(
                '\nbundle: [ ' + self.appName +' ]',
                '\nenv: [ '+ self.env +' ]',
                '\nport: ' + self.conf[self.appName].port.http,
                '\npid: ' + process.pid
        );


        self.instance.listen(self.conf[self.appName].port.http);//By Default 8888
    }

    var getHead = function(file) {
        var s = file.split(/\./);
        var type = 'plain/text';
        if( typeof(self.validHeads[s[s.length-1]]) != 'undefiend' ) {
            type = self.validHeads[s[s.length-1]]
        }
        return type
    }

    var loadBundleConfiguration = function(req, res, next, bundle, callback) {

        var pathname = url.parse(req.url).pathname;


        if ( /\/favicon\.ico/.test(pathname) ) {
            callback(false, pathname, req, res, next)
        }

        var config = new Config();
        config.setBundles(self.bundles);
        var conf = config.getInstance(bundle);
        if ( typeof(conf) != 'undefined') {//for cacheless mode
            self.conf[bundle] = conf
        }
        var cacheless = config.isCacheless();

        var uri = '', key = '';
        //webroot test
        if (self.conf[bundle].server.webroot != '/') {
            uri = (self.conf[bundle].server.webroot + pathname.replace(self.conf[bundle].server.webroot, '')).split('/');
            var len = self.conf[bundle].server.webroot.split('/').length;
            key = uri.splice(1, len).join('/');
        } else {
            uri = pathname.split('/');
            key = uri.splice(1, 1)[0]
        }

        //static filter
        if ( typeof(conf.content.statics) != 'undefined' &&  typeof(conf.content.statics[key]) != 'undefined' && typeof(key) != 'undefined') {
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
                            res.setHeader("Content-Type", getHead(filename));
                            res.writeHead(200)
                            res.write(file, 'binary');
                            res.end()
                        }
                    });
                } else {
                    onBundleConfigLoaded(bundle, {
                        err : false,
                        cacheless : cacheless,
                        pathname : pathname,
                        req : req,
                        res : res,
                        conf : config,
                        next : next,
                        callback : callback
                    })
                }//EO exists
            })//EO static filter
        } else {
            onBundleConfigLoaded(bundle, {
                err : false,
                cacheless : cacheless,
                pathname : pathname,
                req : req,
                res : res,
                conf : config,
                next : next,
                callback : callback
            })
        }

    }

    var onBundleConfigLoaded = function(bundle, options) {
        var err = options.err;
        var cacheless = options.cacheless;
        var pathname = options.pathname;
        var req = options.req;
        var res = options.res;
        var config = options.conf;
        var next = options.next;
        var callback = options.callback;

        //Reloading assets & files.
        if (!cacheless) { // all but dev & debug
            callback(err, pathname, req, res, next)
        } else {
            config.refresh(bundle, function(err, routing) {
                if (err) console.error('geena', 'SERVER:ERR:5', err, __stack);
                //refreshes routing at the same time.
                self.routing = routing;

                callback(err, pathname, req, res, next)
            })
        }
    }

    var handle = function(req, res, next, pathname) {

        var matched = false;
        var isRoute = {};
        var withViews = hasViews(self.appName);

        console.log('about to route to ', pathname);

        //var router = new Router(self.env);
        var router = local.router;
        router.setMiddlewareInstance(self.instance);

        //Middleware configuration.
        req.setEncoding(self.conf[self.appName].encoding);

        if ( self.routing == null || self.routing.count() == 0 ) {
            console.error(
                'geena',
                'SERVER:ERR:1',
                    'Malformed routing or Null value for application [' + self.appName + '] => ' + req.originalUrl,
                __stack
            );
            throwError(res, 500, 'Internal server error\nMalformed routing or Null value for application [' + self.appName + '] => ' + req.originalUrl);
        }

        var params = {};
        out:
            for (var rule in self.routing) {
                if (typeof(self.routing[rule]['param']) == 'undefined')
                    break;

                //Preparing params to relay to the router.
                params = {
                    requirements : self.routing[rule].requirements,
                    url : pathname,
                    param : self.routing[rule].param,
                    bundle: self.appName
                };
                //Parsing for the right url.
                isRoute = router.compareUrls(req, params, self.routing[rule].url);
                if (pathname === self.routing[rule].url || isRoute.past) {

                    console.debug(
                        'geena',
                        'SERVER:DEBUG:4',
                            'Server routing to '+ pathname,
                        __stack
                    );
                    var allowed = (typeof(self.routing[rule].method) == 'undefined' || self.routing[rule].method.length > 0 || self.routing[rule].method.indexOf(req.method) != -1)
                    if (!allowed) {
                        throwError(res, 405, 'Method Not Allowed for [' + self.appName + '] => ' + req.originalUrl)
                    } else {
                        router.route(req, res, next, params)
                    }
                    matched = true;
                    isRoute = {};
                    break out;
                }
            }

        if (!matched) {
            if (pathname === '/favicon.ico' && !withViews) {
                res.writeHead(200, {'Content-Type': 'image/x-icon'} );
                res.end()
            }
            throwError(res, 404, 'Page not found\n' + pathname)
        }
    }

    var throwError = function(res, code, msg) {
        var withViews = hasViews(self.appName);

        if ( !withViews ) {
            res.writeHead(code, { 'Content-Type': 'application/json'} );
            res.end(JSON.stringify({
                status: code,
                error: 'Error '+ code +'. '+ msg
            }))
        } else {
            if (!res.headersSent) {
                res.writeHead(code, { 'Content-Type': 'text/html'} );
                res.end('Error '+ code +'. '+ msg)
            }
        }
    };


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