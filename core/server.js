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
        this.cacheless = process.env.IS_CACHELESS;

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

        //console.log('['+ this.appName +'] on port : ['+ this.conf[this.appName].port.http + ']');
        this.onRoutesLoaded( function(success) {//load all registered routes in routing.json
            logger.debug(
                'geena',
                'SERVER:DEBUG:1',
                'Routing loaded' + '\n'+ JSON.stringify(_this.routing, null, '\t'),
                __stack
            );


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

                        _this.routing = require(filename);
                        tmpContent = "";
                    }
                }

                try {
                    if (cacheless) {
                        delete require.cache[_(filename, true)]
                    }

                    tmp = require(filename);
                    //Adding important properties.
                    for (var rule in tmp){
                        tmp[rule].param.app = apps[i];
                    }

                    if (_this.routing.count() > 0) {
                        _this.routing = merge(true, _this.routing, tmp);
                    } else {
                        _this.routing = tmp;
                    }
                    tmp = {}
                } catch (err) {
                    this.routing = null;
                    logger.error('geena', 'SERVER:ERR:2', err, __stack);
                    callback(false)
                }

            } catch (err) {
                logger.warn('geena', 'SERVER:WARN:2', err, __stack);
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

        this.instance.all('*', function(request, response, next) {
            console.log('calling back..');

            //Only for dev & debug.
            _this.loadBundleConfiguration(request, response, next, _this.appName, function(err, req, res, next) {

                if (err) {
                    _this.throwError(response, 500, 'Internal server error\n'+ err.stack)
                }

                var conf = _this.conf[_this.appName];
                var pathname = url.parse(req.url).pathname;
                var uri = pathname.split('/');
                var key = uri.splice(1, 1)[0];
                //statick filter
                if ( typeof(conf.content.views.default.statics[key]) != 'undefined' && typeof(key) != 'undefined') {
                    uri = uri.join('/');
                    var filename = path.join(conf.content.views.default.statics[key], uri);
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

                                res.writeHead(200);
                                res.write(file, "binary");
                                res.end()
                            });
                        } else {
                            _this.handle(req, res, next, pathname)
                        }//EO exists
                    })//EO static filter
                } else {
                    _this.handle(req, res, next, pathname)
                }
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
    loadBundleConfiguration : function(req, res, next, bundle, callback) {

        if ( /\/favicon\.ico/.test(url.parse(req.url).pathname) ) {
            callback(false)
        }

        var config = require('./config')();
        config.setBundles(this.bundles);
        var conf = config.getInstance(bundle);
        if ( typeof(conf) != 'undefined') {//for cacheless mode
            this.conf[bundle] = conf
        }
        var cacheless = config.isCacheless();
        //Reloading assets & files.
        if (!cacheless) { // all but dev & debug
            callback(false)
        } else {
            var _this = this;
            config.refresh(bundle, function(err, routing) {
                if (err) logger.error('geena', 'SERVER:ERR:5', err, __stack);
                //refreshes routing at the same time.
                _this.routing = routing;
                callback(false, req, res, next)
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

        var router = new Router(this.env);
        router.setMiddlewareInstance(this.instance);

        //Middleware configuration.
        req.setEncoding(this.conf[this.appName].encoding);

        if ( this.routing == null || this.routing.count() == 0 ) {
            logger.error(
                'geena',
                'SERVER:ERR:1',
                    'Malformed routing or Null value for application [' + this.appName + '] => ' + req.originalUrl,
                __stack
            );
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

                    logger.debug(
                        'geena',
                        'SERVER:DEBUG:4',
                            'Server routing to '+ pathname,
                        __stack
                    );

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
            res.writeHead(code, { 'Content-Type': 'text/html'} );
            res.end('Error '+ code +'. '+ msg)
        }
    }
};

module.exports = Server