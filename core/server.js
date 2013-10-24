/**
 * Server Class
 *
 * @package     Geena
 * @author      Rhinostone
 */
var Fs              = require('fs'),
    EventEmitter    = require('events').EventEmitter,
    Express         = require('express'),
    Url             = require('url'),
    Utils           = require('geena.utils'),
    Config          = require('./config')(),
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

        //Starting app.
        this.appName = options.appName;
        this.env = options.env;
        //False => multiple apps sharing the same server (port).
        this.isStandalone = options.isStandalone;

        this.executionPath = options.executionPath;
        var geenaPath = options.geenaPath;
        console.log("Geena ", options);
        this.bundles = options.bundles;


        //TODO - Don't override if syntax is ok - no mixed paths.
        //Set paths for utils. Override for now.
        //To reset it, just delete the hidden folder.
        Utils.Config.set('geena', 'project.json', {
            //project : Utils.Config.getProjectName(),
            paths : {
                geena : geenaPath,
                utils : Utils.Config.__dirname,
                executionPath : this.executionPath,
                env : this.executionPath + '/env.json',
                tmp : this.executionPath + '/tmp'
            },
            //TODO - Replace by a property by bundle.
            bundles : options.allBundles
        });
        //console.log("!!Stand alone ? ", this.isStandalone, this.bundles, '\n'+options.conf);
        //console.log("CONF CONTENT \n",  options.conf[this.appName][this.env]);

        if (!this.isStandalone) {
            //Only load the related conf / env.
            console.log("none standalone conf => ", options.conf);
            this.conf[this.appName] = options.conf[this.appName][this.env];

            this.conf[this.appName].bundlesPath = options.conf[this.appName][this.env].bundlesPath;
            this.conf[this.appName].modelsPath =  options.conf[this.appName][this.env].modelsPath;
            //console.log("FUCK0 ", this.conf[this.appName]);
            //console.log("FUCK1 ", this.conf[this.appName].modelsPath);
            //console.log("FUCK2 ",  options.conf[this.appName][this.env].bundlesPath);
        } else {

            console.log("Running mode not handled yet..", this.appName, " VS ", this.bundles);
            //Load all conf for the related apps & env.
            var apps = this.bundles;
            for (var i=0; i<apps.length; ++i) {
                this.conf[apps[i]] = options.conf[apps[i]][this.env];
                this.conf[apps[i]].bundlesPath = options.conf[apps[i]][this.env].bundlesPath;
                this.conf[apps[i]].modelsPath = options.conf[apps[i]][this.env].modelsPath;
                //console.log("making conf for ", apps[i]);
            }
        }
        //console.log("My Conf ",JSON.stringify(this.conf, null, '\t'));
        this.libPath = _(__dirname);//Server Lib Path.
        this.instance = Express();
        callback(false, this.instance, Express, this.conf[this.appName]);
    },

    init : function(){

        var _this = this;
        process.title = 'geena: '+ this.appName;
        //this.instance = Express();

        Log.debug(
            'geena',
            'SERVER:DEBUG:11',
            'Server init in progress',
            __stack
        );

        Log.notice(
            'geena',
            'SERVER:NOTICE:1',
            'Init ['+ this.appName +'] on port : ['+ this.conf[this.appName].port.http + ']'
        );

        this.onRoutesLoaded( function(success){//load all registered routes in routing.json
            Log.debug(
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
        var conf =  Config.getInstance(this.appName);
        var _this       = this,
            env         = this.env,
            apps        = conf.bundles,
            filename    = "",
            appName     = "";
            tmp         = {};
        console.info('\nENVi : ', this.env, '\nPORT :', this.conf[this.appName].port,  '\nBUNDLE :', this.appName, '\nBundles ', apps, apps.length);
        //Standalone or shared instance mode. It doesn't matter.
        for (var i=0; i<apps.length; ++i) {

            var appPath = _(this.conf[apps[i]].bundlesPath);
            var cacheless = (this.env == "dev" || this.env == "debug") ? true : false;
            appName =  apps[i];

            //Specific case.
            if (!this.isStandalone && i == 0) appName = apps[i];
            //console.log("trying..", new _(this.conf[apps[i]].bundlesPath) );
            try {

                var files = Utils.cleanFiles(Fs.readdirSync(appPath));

                if (files.length > 0 && files.inArray(apps[i])) {
                    filename = _(appPath + '/' + apps[i] + '/config/' + _this.conf[apps[i]].files.routing);

                    //console.log("!!! my files ", filename);
                    try {
                        if (cacheless) {
                            delete require.cache[filename];
                        }

                        tmp = require(filename);
                        //Adding important properties.
                        for (var rule in tmp){
                            tmp[rule].param.app = apps[i];
                        }

                        if (_this.routing.count() > 0) {

                            _this.routing = Utils.extend(true, _this.routing, tmp);
                        } else {
                            _this.routing = tmp;
                        }

                        //console.log("making route for ", apps[i], "\n", _this.routing);
                        tmp = {};
                    } catch (err) {
                        this.routing = null;
                        Log.error('geena', 'SERVER:ERR:2', err, __stack);
                        callback(false);
                    }
                } else {
                    Log.error(
                        'geena',
                        'SERVER:ERR:3',
                        'Routing not matching : ' +apps[i]+ ' did not match route files ' + files,
                        __stack
                    );
                    callback(false);
                }


            } catch (err) {
                Log.warn('geena', 'SERVER:WARN:2', err, __stack);
                callback(false);
            }

        }//EO for.
        console.log("found routing ", _this.routing);
        callback(true);
    },

    /**
     * Configure applications
     *
     * @private
     * */
    configure : function(callback){
        Log.debug(
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

        var apps = this.bundles, path;
        //Do it for each app.
        for (var i=0; i<apps.length; ++i) {
            path = (typeof(this.conf[apps[i]]["staticPath"]) != "undefined")
                ? this.executionPath + this.conf[apps[i]].staticPath
                : '/static';

            console.log(" static found ? ", path, Fs.existsSync( _(path) ));
            //Only applies when static folder exists.
            if (Fs.existsSync( _(path) )) {
                app.configure(this.env, function() {
                    //console.info('Configuring middleware for the prod environment.', _this.conf[_this.appName].bundlesPath);
                    app.use(Express.bodyParser());//in order to get POST params
                    //Configuring path
                    app.use("/js", Express.static(path + '/js'));
                    app.use("/css", Express.static(path + '/theme_default/css'));
                    app.use("/images", Express.static(path + '/theme_default/images'));
                    app.use("/assets", Express.static(path + '/assets', { maxAge: 3600000 }));//60 min of caching (=3600000)

                    //Setting frontend handlers: like we said, only when statics path is defined.
                    app.use("/"+ apps[i] +"/handlers", Express.static(_this.conf[apps[i]].bundlesPath +'/'+ apps[i] +'/handlers'));
                });

                Log.notice('geena', 'SERVER:NOTICE:3', 'Server runing with static folder: ' + path);
            } else {
                Log.notice('geena', 'SERVER:NOTICE:3', 'Server runing without static folder ');
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
            console.log("routing ...", _this.routing);
            //Only for dev & debug.
            _this.loadBundleConfiguration(_this.appName, function(err, conf){

                if (err) Log.error('geena', 'SERVER:ERR:6', err, __stack);

                var matched         = false,
                    Router          = require('./router.js'),
                    isRoute         = {};

                var router = new Router(_this.env);

                //Middleware configuration.
                request.setEncoding(_this.conf[_this.appName].encoding);

                if ( _this.routing.count() == 0 ) {
                    Log.error(
                        'geena',
                        'SERVER:ERR:1',
                        'Malformed routing or Null value for application ' + _this.appName,
                        __stack
                    );
                }

                var params = {}, pathname = Url.parse(request.url).pathname;
                out:
                    for (var rule in _this.routing) {
                        console.log("\nrules ", rule);

                        if (typeof(_this.routing[rule]["param"]) == "undefined")
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

                            Log.debug(
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
                if (!matched /**&& pathname != '/favicon.ico'*/) {
                    Log.error(
                        'geena',
                        'SERVER:ERR:2',
                        'caught 404 request ' + Url.parse(request.url).pathname,
                        __stack
                    );

                    if ( typeof(_this.conf[_this.appName].template) == "undefined" || !_this.conf[_this.appName].template) {

                        response.setHeader("Content-Type", "application/json");
                        response.send('404', JSON.stringify({
                            status: 404,
                            error: "Error 404. Page not found : " + Url.parse(request.url).pathname
                        }));

                    } else {
                        response.send('404', 'Error 404. Page not found : ' + Url.parse(request.url).pathname);
                    }

                    response.end();
                }
            });//EO this.loadBundleConfiguration(this.appName, function(err, conf){
        });//EO this.instance

        console.log("what th fuck !!..", this.conf[this.appName].port.http);
        console.log(
            "\nPID: " + process.pid,
            "\nPORT: " + this.conf[this.appName].port.http
        );

        this.instance.listen(this.conf[this.appName].port.http);//By Default 8888
    },
    loadBundleConfiguration : function(bundle, callback) {

        console.log("bundle [", bundle, "] VS config ", Config.getInstance(bundle) );
        var _this = this, cacheless = Config.isCacheless();
        console.log("is cacheless ", cacheless);
        //Reloading assets & files.
        if (!cacheless) {
            callback(false);
        } else {
            Config.refresh(bundle, function(err){
                if (err) Log.error('geena', 'SERVER:ERR:5', err, __stack);

                //Also refresh routing.
                callback(false);
            });
        }
    }

};

module.exports = Server;