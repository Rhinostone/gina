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
                //console.log("making conf for ", apps[i]);
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

        this.onRoutesLoaded( function(success){//load all registered routes in routing.json
            logger.debug(
                'geena',
                'SERVER:DEBUG:1',
                'Routing loaded' + '\n'+ JSON.stringify(_this.routing, null, '\t'),
                __stack
            );


            if (success) {

                _this.configure( function(success){
                    //Override configuration with user settings.
                   _this.onRequest();
                });
            }
        });

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

            //var cacheless = (this.env == "dev" || this.env == "debug") ? true : false;
            appName =  apps[i];

            //Specific case.
            if (!this.isStandalone && i == 0) appName = apps[i];
            //console.log("trying..",  _(this.conf[apps[i]].bundlesPath) );
            try {

//                var files = utils.cleanFiles(fs.readdirSync(appPath));

//                if (files.length > 0 && files.inArray(apps[i])) {

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
                        callback(false);
                    }
//                } else {
//                    logger.error(
//                        'geena',
//                        'SERVER:ERR:3',
//                        'Routing not matching : ' +apps[i]+ ' did not match route files ' + files,
//                        __stack
//                    );
//                    callback(false);
//                }


            } catch (err) {
                logger.warn('geena', 'SERVER:WARN:2', err, __stack);
                callback(false);
            }

        }//EO for.
        //console.log("found routing ", _this.routing);
        callback(true);
    },

    hasViews : function(bundle) {
        return ( typeof(this.conf[bundle].content['views']) != 'undefined' ) ? true : false;
    },

    /**
     * Configure applications
     *
     * @private
     * */
    configure : function(callback){
        logger.debug(
            'geena',
            'SERVER:DEBUG:12',
            'Starting server configuration',
            __stack
        );
        //Express js part
        //console.info("configuring express.....", this.conf[this.appName], " PATH : ", this.conf[this.appName].bundlesPath);
        //TODO - Forward to main bundle file.
        //this.onConfigure();
        this.instance.set('env', this.env);

        var app = this.instance, _this = this;
        app.use(Express.bodyParser());//in order to get POST params
        var path, theme = '';
        var apps = this.bundles;
        var hasViews;
        var aliases = undefined;
        //Do it for each app.
        for (var i=0; i<apps.length; ++i) {
            hasViews = this.hasViews(apps[i]);
            if (hasViews ) { // configure statics only if bundle has views
                //default is mandatory: you would have to loop again to support all pages/topics
                path = this.conf[apps[i]].content['views'].default.static;
                aliases = this.conf[apps[i]].content['views'].default.aliases;
                logger.notice('geena', 'SERVER:NOTICE:3', 'Server runing with static folder: ' + path);
                if ( typeof(aliases) != 'undefined' && fs.existsSync( _(path) )) {
                    app.configure( this.env, function() {
                        //Configuring path
                        for (var a in aliases) {
                            var k = a;
                            a = (a.substring(0, 1) != '/') ? '/'+ a : a;
                            console.log('express using ', a, ' => ', aliases[k]);
                            app.use(a, Express.static(aliases[k]) );
                            //app.use("/css", express.static(path + '/theme_default/css'));
                        }
                        //app.use("/css", Express.static("/Workflow/www/vitrinedemo.com/src/frontend/views/ressources/default_theme/css") );
                    })
                }

            } else {
                logger.notice('geena', 'SERVER:NOTICE:3', 'Server runing without static folder ');
            }
        }

        callback(true);

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
            _this.loadBundleConfiguration(_this.appName, function(err, conf){

                if (err) logger.error('geena', 'SERVER:ERR:6', err, __stack);

                var matched         = false,
                    Router          = require('./router.js'),
                    isRoute         = {};

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

                //TODO - replace the string by the setting variable.
                if (!matched /**|| pathname == '/favicon.ico'*/) {

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

                    if ( !hasViews ) {
                        response.writeHead(404, { 'Content-Type': 'application/json'} );
                        response.end(JSON.stringify({
                            status: 404,
                            error: "Error 404. Page not found : " + url.parse(request.url).pathname
                        }));

                    } else {
                        response.writeHead(404, { 'Content-Type': 'text/html'} );
                        response.end('Error 404. Page not found : ' + url.parse(request.url).pathname)
                    }
                }
            });//EO this.loadBundleConfiguration(this.appName, function(err, conf){
        });//EO this.instance

        //console.log("what th fuck !!..", this.conf[this.appName].port.http);
        /**
        console.log(
            "\nPID: " + process.pid,
            "\nPORT: " + this.conf[this.appName].port.http,
            "\nPATHS: " + getPaths()
        );*/

        this.instance.listen(this.conf[this.appName].port.http);//By Default 8888
    },
    loadBundleConfiguration : function(bundle, callback) {

        //var config  = getContext('geena.config');
        var config = require('./config')();
        config.setBundles(this.bundles);

        console.log("bundle [", bundle, "] VS config ", config.getInstance(bundle) );
        var _this = this, cacheless = config.isCacheless();
        console.log("is cacheless ", cacheless);
        //Reloading assets & files.
        if (!cacheless) {
            callback(false);
        } else {
            config.refresh(bundle, function(err){
                if (err) logger.error('geena', 'SERVER:ERR:5', err, __stack);

                //Also refresh routing.
                callback(false);
            });
        }
    }

};


module.exports = Server;