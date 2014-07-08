/**
 * Express Server Class
 *
 * @package     Geena
 * @author      Rhinostone
 */
var fs              = require('fs'),
    path            = require("path"),
    EventEmitter    = require('events').EventEmitter,
    express         = require('express'),
    url             = require('url'),
    utils           = require('./utils'),
    merge           = utils.merge
    Proc            = utils.Proc,

    Server          = {
    conf : {},
    routing : {},
    activeChild : 0,
    /**
    * Set Configuration
    * @param {object} options Configuration
    *
    *
    * @callback callback responseCallback
    * @param {boolean} complete
    * @public
    */
    setConf : function(options, callback){

        var _this = this;
        //Starting app.
        this.appName = options.bundle;

        this.env = options.env;
        this.cacheless = (process.env.IS_CACHELESS == 'false') ? false : true;

        //False => multiple apps sharing the same server (port).
        this.isStandalone = options.isStandalone;

        this.executionPath = options.executionPath;

        //console.log("Geena ", options);
        this.bundles = options.bundles;

        //console.log("!!Stand alone ? ", this.isStandalone, this.bundles, '\n'+options.conf);
        //console.log("CONF CONTENT \n",  options.conf[this.appName][this.env]);

        if (!this.isStandalone) {
            //Only load the related conf / env.
            this.conf[this.appName] = options.conf[this.appName][this.env];
            this.conf[this.appName].bundlesPath = options.conf[this.appName][this.env].bundlesPath;
            this.conf[this.appName].modelsPath =  options.conf[this.appName][this.env].modelsPath;
        } else {

            //console.log("Running mode not handled yet..", this.appName, " VS ", this.bundles);
            //Load all conf for the related apps & env.
            var apps = this.bundles;
            for (var i=0; i<apps.length; ++i) {
                this.conf[apps[i]] = options.conf[apps[i]][this.env];
                this.conf[apps[i]].bundlesPath = options.conf[apps[i]][this.env].bundlesPath;
                this.conf[apps[i]].modelsPath = options.conf[apps[i]][this.env].modelsPath;
            }
        }

        callback(false, express(), express, this.conf[this.appName]);
    },

    init : function(instance){
        var _this = this;
        this.instance = instance;
        try {
            this.validHeads =  fs.readFileSync(getPath('geena.core') + '/mime.types').toString();
            this.validHeads = JSON.parse(this.validHeads)
        } catch(err) {
            log(err.stack);
            process.exit(1)
        }

        //console.log('['+ this.appName +'] on port : ['+ this.conf[this.appName].port.http + ']');
        this.onRoutesLoaded( function(success) {//load all registered routes in routing.json
//            logger.debug(
//                'geena',
//                'SERVER:DEBUG:1',
//                'Routing loaded' + '\n'+ JSON.stringify(_this.routing, null, '\t'),
//                __stack
//            );
            console.debug('Routing loaded' + '\n'+ JSON.stringify(_this.routing, null, '\t'))


            if (success) {
                _this.onRequest()
            }
        })
    },
    /**
     * onRoutesLoaded
     *
     *
     * */
    onRoutesLoaded : function(callback) {

        var config = require('./config')();
        var conf =  config.getInstance(this.appName);
        var cacheless = config.isCacheless();

        var _this       = this,
            env         = this.env,
            cacheless   = this.cacheless,
            apps        = conf.bundles,
            filename    = "",
            appName     = "",
            name        = "",
            tmp         = {},
            tmpContent  = "",
            tmpName     = "";

        if (cacheless) {
            this.routing = {}
        }

        //Standalone or shared instance mode. It doesn't matter.
        for (var i=0; i<apps.length; ++i) {
            var appPath = _(this.conf[apps[i]].bundlesPath+ '/' + apps[i]);
            appName =  apps[i];

            //Specific case.
            if (!this.isStandalone && i == 0) appName = apps[i];

            try {
                filename = _(appPath + '/config/' + _this.conf[apps[i]].files.routing);

                if (cacheless) {

                    var tmpContent = _this.conf[apps[i]].files.routing.replace(/.json/, '.' +env + '.json');
                    tmpName = _(appPath + '/config/' + tmpContent);
                    //Can't do a thing without.
                    if ( fs.existsSync(tmpName) ) {
                        filename = tmpName;
                        if (cacheless) delete require.cache[_(filename, true)];

                        this.routing = require(filename);
                        tmpContent = "";
                    }
                }

                try {
//                    if (cacheless) {
//                        delete require.cache[_(filename, true)]
//                    }
//

                    tmp = require(filename);
                    //Adding important properties.
                    for (var rule in tmp){
                        tmp[rule].param.app = apps[i];
                        if( this.hasViews(apps[i])) {
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

                    if (this.routing.count() > 0) {
                        this.routing = merge(true, this.routing, tmp);
                    } else {
                        this.routing = tmp;
                    }
                    tmp = {}
                } catch (err) {
                    this.routing = null;
                    //logger.error('geena', 'SERVER:ERR:2', err, __stack);
                    console.error(err.stack||err.message);
                    callback(false)
                }

            } catch (err) {
                //logger.warn('geena', 'SERVER:WARN:2', err, __stack);
                console.warn(err.stack||err.message);
                callback(false)
            }

        }//EO for.
        callback(true)
    },

    hasViews : function(bundle) {
        return ( typeof(this.conf[bundle].content['views']) != 'undefined' ) ? true : false;
    },

    onRequest : function(){

        var _this = this, apps = this.bundles;

            /**
             this.instance.all('*', function(req, res, next) {
                res.header("Access-Control-Allow-Origin", "*");
                res.header("Access-Control-Allow-Headers", "X-Requested-With");
                next();
            });*/

        this.instance.all('*', function onInstance(request, response, next) {

//            switch(request.method) {
//                case 'GET':
//                    break;
//                case 'POST':
//                    break;
//                case 'PUT':
//                    break;
//                case 'DELETE':
//                    break;
//            }
//            this.throwError(res, 500, 'Internal server error\nMalformed routing or Null value for application [' + this.appName + '] => ' + req.originalUrl);

            //Only for dev & debug.
            _this.loadBundleConfiguration(request, response, next, _this.appName, function(err, pathname, req, res, next) {
                console.log('calling back..');
                if (err) {
                    _this.throwError(response, 500, 'Internal server error\n'+ err.stack)
                }
                _this.handle(req, res, next, pathname)
            });//EO this.loadBundleConfiguration(this.appName, function(err, conf){
        });//EO this.instance

        console.log(
            '\nbundle: [ ' + this.appName +' ]',
            '\nenv: [ '+ this.env +' ]',
            '\nport: ' + this.conf[this.appName].port.http,
            '\npid: ' + process.pid
        );


        this.instance.listen(this.conf[this.appName].port.http);//By Default 8888

    },
    getHead : function(file) {
        var s = file.split(/\./);
        var type = 'plain/text';
        if( typeof(this.validHeads[s[s.length-1]]) != 'undefiend' ) {
            type = this.validHeads[s[s.length-1]]
        }
        return type
    },
    loadBundleConfiguration : function(req, res, next, bundle, callback) {
        var _this = this;
        var pathname = url.parse(req.url).pathname;
        if ( /\/favicon\.ico/.test(pathname) ) {
            callback(false, pathname, req, res, next)
        }

        var config = require('./config')();
        config.setBundles(this.bundles);
        var conf = config.getInstance(bundle);
        if ( typeof(conf) != 'undefined') {//for cacheless mode
            this.conf[bundle] = conf
        }
        var cacheless = config.isCacheless();

        var uri = pathname.split('/');
        var key = uri.splice(1, 1)[0];
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
                            res.setHeader("Content-Type", _this.getHead(filename));
                            res.writeHead(200)
                            res.write(file, 'binary');
                            res.end()
                        }
                    });
                } else {
                    _this.onBundleConfigLoaded(bundle, {
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
            this.onBundleConfigLoaded(bundle, {
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

    },

    onBundleConfigLoaded : function(bundle, options) {
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
            var _this = this;
            config.refresh(bundle, function(err, routing) {
                //if (err) logger.error('geena', 'SERVER:ERR:5', err, __stack);
                if (err) console.error(err.stack||err.message);
                //refreshes routing at the same time.
                _this.routing = routing;

                callback(err, pathname, req, res, next)
            })
        }
    },

    handle : function(req, res, next, pathname) {
        var _this = this;
        var matched         = false,
            isRoute         = {};
        try {
            Router          = require('./router.js');
        } catch(err) {
                console.error(err.stack);
                process.exit(1)
        }

        var hasViews = this.hasViews(this.appName);
        console.log('about to route to ', pathname);
        var router = new Router(this.env);
        router.setMiddlewareInstance(this.instance);

        //Middleware configuration.
        req.setEncoding(this.conf[this.appName].encoding);

        if ( this.routing == null || this.routing.count() == 0 ) {
//            logger.error(
//                'geena',
//                'SERVER:ERR:1',
//                    'Malformed routing or Null value for application [' + this.appName + '] => ' + req.originalUrl,
//                __stack
//            );
            console.error( 'Malformed routing or Null value for application [' + this.appName + '] => ' + req.originalUrl);
            this.throwError(res, 500, 'Internal server error\nMalformed routing or Null value for application [' + this.appName + '] => ' + req.originalUrl);
        }

        var params = {};
        out:
            for (var rule in this.routing) {
                if (typeof(this.routing[rule]['param']) == 'undefined')
                    break;

                //Preparing params to relay to the router.
                params = {
                    requirements : this.routing[rule].requirements,
                    url : pathname,
                    param : _this.routing[rule].param,
                    bundle: _this.appName
                };
                //Parsing for the right url.
                isRoute = router.compareUrls(req, params, this.routing[rule].url);
                if (pathname === this.routing[rule].url || isRoute.past) {

//                    logger.debug(
//                        'geena',
//                        'SERVER:DEBUG:4',
//                            'Server routing to '+ pathname,
//                        __stack
//                    );
                    console.debug( 'Server routing to '+ pathname);
                    router.route(req, res, next, params);
                    matched = true;
                    isRoute = {};
                    break out;
                }
            }

        if (!matched) {
            if (pathname === '/favicon.ico' && !hasViews) {
                rese.writeHead(200, {'Content-Type': 'image/x-icon'} );
                res.end()
            }

            this.throwError(res, 404, 'Page not found\n' + pathname)
        }
    },
    //TODO - might move to some other place... like to utils
    throwError : function(res, code, msg) {
        var hasViews = this.hasViews(this.appName);

        if ( !hasViews ) {
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
    }
};

module.exports = Server