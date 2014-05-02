/**
 * Server Class
 *
 * @package     Geena
 * @author      Rhinostone
 */
var fs              = require('fs'),
    EventEmitter    = require('events').EventEmitter,
    Express         = require('express'),
    url             = require('url'),
    utils           = require('./utils'),
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
        callback(false, Express(), Express, this.conf[this.appName]);
    },

    init : function(instance){
        var _this = this;
        this.instance = instance;

        logger.debug(
            'geena',
            'SERVER:DEBUG:11',
            'Server init in progress',
            __stack
        );

        logger.notice(
            'geena',
            'SERVER:NOTICE:1',
            'Init ['+ this.appName +'] on port : ['+ this.conf[this.appName].port.http + ']'
        );

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
    onRoutesLoaded : function(callback){
        //console.info("Trigged onRoutesLoaded");

        //console.info('ENV : ', this.conf[this.appName].env, '\n routing file\n ', this.conf[this.appName].files);
        var config = getContext('geena.config');
        //var config = require('./config')();
        var conf =  config.getInstance(this.appName);
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

        //console.info('\nENVi : ', this.env, '\nPORT :', this.conf[this.appName].port,  '\nBUNDLE :', this.appName, '\nBundles ', apps, apps.length);
        //Standalone or shared instance mode. It doesn't matter.
        for (var i=0; i<apps.length; ++i) {

            var appPath = _(this.conf[apps[i]].bundlesPath+ '/' + apps[i]);
            appName =  apps[i];

            //Specific case.
            if (!this.isStandalone && i == 0) appName = apps[i];
            //console.log("trying..",  _(this.conf[apps[i]].bundlesPath) );
            try {
                if (env != 'prod') {

                    var tmpContent = _this.conf[apps[i]].files.routing.replace(/.json/, '.' +env + '.json');
                    //console.log("tmp .. ", tmp);
                    filename = _(appPath + '/config/' + tmpContent);
                    //Can't do a thing without.
                    if ( fs.existsSync(filename) ) {
                        //console.log("app conf is ", filename);
                        if (cacheless) delete require.cache[_(filename, true)];

                        tmpName = name +'_'+ env;//?? maybe useless.
                        _this.routing = require(filename);
                        tmpContent = "";
                    }
                }
                filename = _(appPath + '/config/' + _this.conf[apps[i]].files.routing);

                //console.log("!!! my files ", filename);
                try {
                    if (env != 'prod' && cacheless) {
                        delete require.cache[_(filename, true)];
                    }

                    tmp = require(filename);
                    //Adding important properties.
                    for (var rule in tmp){
                        tmp[rule].param.app = apps[i];
                    }

                    if (_this.routing.count() > 0) {
                        _this.routing = utils.extend(true, true, tmp, _this.routing);
                    } else {
                        _this.routing = tmp;
                    }

                    //console.log("making route for ", apps[i], "\n", _this.routing);
                    tmp = {};
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
        //console.log("found routing ", _this.routing);
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

        this.instance.all('*', function(request, response, next){
            console.log('calling back..');
            //Only for dev & debug.
            _this.loadBundleConfiguration(request, _this.appName, function(err, conf) {

                if (conf) {//for cacheless mode
                    _this.conf[_this.appName] = conf
                }

                if (err) {
                    _this.throwError(response, 500, 'Internal server error\n'+ err.stack)
                }

                var matched         = false,
                    isRoute         = {};
                try {
                    Router          = require('./router.js');
                } catch(err) {
                    if (err) {
                        console.error(err.stack);
                        process.exit(1)
                    }
                }

                var hasViews = _this.hasViews(_this.appName);

                var router = new Router(_this.env);
                router.setMiddlewareInstance(_this.instance);

                //Middleware configuration.
                request.setEncoding(_this.conf[_this.appName].encoding);

                if ( _this.routing == null || _this.routing.count() == 0 ) {
                    logger.error(
                        'geena',
                        'SERVER:ERR:1',
                        'Malformed routing or Null value for application [' + _this.appName + '] => ' + request.originalUrl,
                        __stack
                    );
                    _this.throwError(response, 500, 'Internal server error\nMalformed routing or Null value for application [' + _this.appName + '] => ' + request.originalUrl);
                }

                var params = {}, pathname = url.parse(request.url).pathname;
                out:
                    for (var rule in _this.routing) {
                        //console.log("\nrules ", rule);

                        if (typeof(_this.routing[rule]['param']) == 'undefined')
                            break;

                        //Preparing params to relay to the router.
                        params = {
                            requirements : _this.routing[rule].requirements,
                            url : pathname,
                            param : _this.routing[rule].param
                        };
                        //Parsing for the right url.
                        //console.log("urls \n", _this.routing[rule].url);
                        isRoute = router.compareUrls(request, params, _this.routing[rule].url);
                        if (pathname === _this.routing[rule].url || isRoute.past) {

                            logger.debug(
                                'geena',
                                'SERVER:DEBUG:4',
                                'Server routing to '+ pathname,
                                __stack
                            );
                            request = isRoute.request;
                            router.route(request, response, next, params);
                            matched = true;
                            isRoute = {};
                            break out;
                        }
                    }

                if (!matched) {
                    if (pathname === '/favicon.ico' && !hasViews) {
                        response.writeHead(200, {'Content-Type': 'image/x-icon'} );
                        response.end();
                        //console.Log('handled favicon.ico');
                    }
                    logger.error(
                        'geena',
                        'SERVER:ERR:2',
                        'caught 404 request ' + url.parse(request.url).pathname,
                        __stack
                    );

                    _this.throwError(response, 404, 'Page not found\n' + url.parse(request.url).pathname)
                }
            });//EO this.loadBundleConfiguration(this.appName, function(err, conf){
        });//EO this.instance

        /**
        console.log(
            "\nPID: " + process.pid,
            "\nPORT: " + this.conf[this.appName].port.http,
            "\nPATHS: " + getPaths()
        );*/

        this.instance.listen(this.conf[this.appName].port.http);//By Default 8888
    },
    loadBundleConfiguration : function(req, bundle, callback) {

        var _this = this;
        //var config  = getContext('geena.config');
        var config = require('./config')();
        config.setBundles(this.bundles);
        var conf = config.getInstance(bundle);

        //console.log("bundle [", bundle, "] VS config ", config.getInstance(bundle) );
        var cacheless = config.isCacheless();
        console.log("is cacheless ", cacheless);
        //Reloading assets & files.
        if (!cacheless) {
            callback(false)
        } else {
            config.refresh(bundle, function(err) {
                if (err) logger.error('geena', 'SERVER:ERR:5', err, __stack);
                //TODO - refresh at the same time routing.
                callback(false, conf)
            })
        }
    },
    //TODO - might move to some other place.. like to utils
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