/**
 * Server Class
 *
 * @package     Geena
 * @author      Rhinostone
 */
var Fs              = require("fs"),
    express         = require("express"),
    url             = require("url"),
    child           = {},
    path            = require('path'),
    Utils           = require("geena.utils"),
    Server          = {
    conf : {},
    routing : {},
    activeChild : 0,
    /**
    * setConf
    * @param {object} options Configuration
    * @callback
    * @public
    */
    setConf : function(options, callback){

        //Starting app.
        this.appName = options.appName;
        this.env = options.env;
        //False => multiple apps sharing the same server (port).
        this.isStandalone = options.isStandalone;
        this.executionPath = options.executionPath;
        this.apps = options.apps;

        //TODO - Don't override if syntax is ok - no mixed paths.
        //Set paths for utils. Override for now.
        //To reset it, just delete the hidden folder.
        Utils.Config.set('geena', 'project.json', {
            //project : Utils.Config.getProjectName(),
            paths : {
                utils : Utils.Config.__dirname,
                executionPath : this.executionPath,
                env : this.executionPath + '/env.json',
                tmp : this.executionPath + '/tmp'
            },
            bundles : options.allApps
        });

        //process.exit(42);
        console.log("!!Stand alone ? ", this.isStandalone, this.apps);

        if (this.isStandalone) {
            //Only load the related conf / env.
            this.conf[this.appName] = options.conf[this.appName][this.env];
            this.conf[this.appName].appsPath = this.executionPath + options.conf[this.appName][this.env].appsPath;

        } else {

            console.log("Running mode not handled yet..", this.appName, " VS ", this.apps);
            //console.log( JSON.stringify(options.conf, null, 4) );

            //Load all conf for the related apps & env.
            var apps = this.apps;
            for (var i=0; i<apps.length; ++i) {

                this.conf[apps[i]] = options.conf[apps[i]][this.env];
                this.conf[apps[i]].appsPath = this.executionPath + options.conf[apps[i]][this.env].appsPath;
                //console.log("making conf for ", apps[i]);
            }
        }

        //console.log("My Conf ",JSON.stringify(this.conf, null, '\t'));
        this.libPath = _(__dirname);//Server Lib Path.
        callback(true);
    },

    init : function(){

        var _this = this;
        process.title = 'geena: '+ this.appName;
        this.instance = express();

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

        //_this.isReady = true;

        //console.log("exiting..."); process.exit(42);

        this.onRoutesLoaded(function(success){//load all registered routes in routing.json
            Log.debug(
                'geena',
                'SERVER:DEBUG:1',
                'Routing loaded' + '\n'+ JSON.stringify(_this.routing, null, '\t'),
                __stack
            );

            if (success) {
                _this.onBeforeRouting( function(err, conf){
                    if (!err) {
                        _this.configure();
                        _this.onRequest();
                    }
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
        console.info("Trigged onRoutesLoaded");
        console.info('\nENV : ', this.env, '\nPORT :', this.conf[this.appName].port,  '\nAPP NAME :', this.appName);
        //console.info('ENV : ', this.conf[this.appName].env, '\n routing file\n ', this.conf[this.appName].files);

        var _this       = this,
            env         = this.env,
            apps        = this.apps,
            filename    = "",
            appName     = "";
            tmp         = {};

        //Standalone or shared instance mode. It doesn't matter.
        for (var i=0; i<apps.length; ++i) {

            var appPath = _(this.conf[apps[i]].appsPath);
            var cacheless = (this.env == "dev" || this.env == "debug") ? true : false;
            appName =  apps[i];

            //Spécific case.
            if (!this.isStandalone && i == 0) appName = apps[i];
            try {
                var files = Utils.cleanFiles(Fs.readdirSync(appPath));
                if (files.length > 0 && files.inArray(apps[i])) {
                    filename = _(appPath + '/' + apps[i] + '/config/' + _this.conf[apps[i]].files.routing);

                    //console.log("my files ", filename);
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

                        console.log("making route for ", apps[i], "\n", _this.routing);
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
        callback(true);

    },

    onBeforeRouting : function(callback){
        var _this = this;
        //console.info('app name..............>>>>>>>>>>>', this.appName);
        //Reload everything for dev and debug only - Cache handled by express.
        console.log("appname is ", this.appName);
        console.log("load ing conf....");
        this.loadAppsConfiguration(this.appName, function(err, conf){
            if (!err) {
                callback(false, conf);
            }
        });
    },
    /**
     * Configure applications
     *
     * @private
     * */
    configure : function(){
        Log.debug(
            'geena',
            'SERVER:DEBUG:12',
            'Starting server configuration',
            __stack
        );
        //Express js part
        //console.info("configuring express.....", this.conf[this.appName], " PATH : ", this.conf[this.appName].appsPath);
        this.instance.set('env', this.env);

        var app = this.instance, _this = this;

        var apps = this.apps, path;
        //Do it for each app.
        for (var i=0; i<apps.length; ++i) {
            path = (typeof(this.conf[apps[i]]["staticPath"]) != "undefined")
                ? this.executionPath + this.conf[apps[i]].staticPath
                : '/static';

            console.log(" static found ? ", path, Fs.existsSync( _(path) ));
            //Only applies when static folder exists.
            if (Fs.existsSync( _(path) )) {
                app.configure(this.env, function() {
                    //console.info('Configuring middleware for the prod environment.', _this.conf[_this.appName].appsPath);
                    app.use(express.bodyParser());//in order to get POST params
                    //Configuring path
                    app.use("/js", express.static(path + '/js'));
                    app.use("/css", express.static(path + '/theme_default/css'));
                    app.use("/images", express.static(path + '/theme_default/images'));
                    app.use("/assets", express.static(path + '/assets', { maxAge: 3600000 }));//60 min of caching (=3600000)

                    //Setting frontend handlers: like we said, only when statics path is defined.
                    app.use("/"+ apps[i] +"/handlers", express.static(_this.conf[apps[i]].appsPath +'/'+ apps[i] +'/handlers'));
                });

                Log.notice('geena', 'SERVER:NOTICE:3', 'Server runing with static folder: ' + path);
            } else {
                Log.notice('geena', 'SERVER:NOTICE:3', 'Server runing without static folder');
            }
        }

    },
    onRequest : function(){

        var _this = this, apps = this.apps;
        /**
        this.instance.all('*', function(req, res, next) {
            res.header("Access-Control-Allow-Origin", "*");
            res.header("Access-Control-Allow-Headers", "X-Requested-With");
            next();
        });*/
        this.instance.all('*', function(request, response, next){



            var pathname        = url.parse(request.url).pathname,
                matched         = false,
                Router          = require('./router.js'),
                params          = {},
                isRoute         = {};

            //CONFIGURATION.
            request.setEncoding(_this.conf[_this.appName].encoding);

            Router.parent = _this;
            Router.setRequest(request);
            if (_this.routing.count() == 0) {
                Log.error(
                    'geena',
                    'SERVER:ERR:1',
                    'Malformed routing or Null value for application ' + _this.appName,
                    __stack
                );
            }


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
                isRoute = Router.compareUrls(params, _this.routing[rule].url);
                if (pathname === _this.routing[rule].url || isRoute.past) {



                    Log.debug(
                        'geena',
                        'SERVER:DEBUG:4',
                        'Server routing to '+ pathname,
                        __stack
                    );
                    request = isRoute.request;
                    Router.route(request, response, params, next);
                    matched = true;
                    isRoute = {};
                    break out;
                }
            }


            if (!matched) {
                Log.error(
                    'geena',
                    'SERVER:ERR:2',
                    'caught 404 request ' + url.parse(request.url).pathname,
                    __stack
                );
                response.send('Error 404. Page not found : ' + url.parse(request.url).pathname, 404);
                response.end();
            }
        });

        //console.log("what th fuck !!..", this.conf[this.appName].port.http);
        console.log("\nPID: " + process.pid);
        this.instance.listen(this.conf[this.appName].port.http);//By Default 8888

    },
    loadAppsConfiguration : function(appName, callback){

        //Framework.
        var _this       = this,
            apps        = this.apps,
            app         = [],//App variables & constants.
            view        = [],
            settings    = [],
            models      = [],//databases.
            appPath     = "",
            error       = "",
            filename    = "",
            cacheless   = false;

        console.log("inside conf....", apps.length);

        //For each apps.
        for (var i=0; i<apps.length; ++i) {
            appName = apps[i];
            appPath = _(this.conf[appName].appsPath + '/' + appName);
            cacheless = (this.conf[appName].env == "dev" || this.conf[appName].env == "debug") ? true : false;

            //App : dev configuration & variables - not required.
            filename = _(appPath + '/config/' + this.conf[appName].files.app);
            try {
                if (cacheless) delete require.cache[filename];

                app[appName] = require(filename);

            } catch (err) {
                app[appName] = null;
                Log.warn('geena', 'SERVER:WARN:1', err);
                Log.debug('geena', 'SERVER:DEBUG:5', err, __stack);
            }


            //Views main configuration.
            filename = _(appPath + '/config/' + this.conf[appName].files.view);
            try {
                if(cacheless) delete require.cache[filename];

                view[appName] = require(filename);
            } catch (err) {
                view[appName] = null
                Log.warn('geena', 'SERVER:WARN:2', err);
                Log.debug('geena', 'SERVER:DEBUG:6', err, __stack);
            }

            //Settings : cache, debug, env.
            filename = _(appPath + '/config/' + this.conf[appName].files.settings);
            try {
                if (cacheless)  delete require.cache[filename];

                settings[appName] = require(filename);
            } catch (err) {
                settings[appName] = null;
                Log.warn('geena', 'SERVER:WARN:3', err);
                Log.debug('geena', 'SERVER:DEBUG:7', err,  __stack);
            }

            //models: cache, debug, env.
            filename = _(appPath + '/config/' + this.conf[appName].files.models);
            try {
                if(cacheless) delete require.cache[filename];

                models[appName] = require(filename);
            } catch (err) {
                models[appName] = null;
                Log.warn('geena', 'SERVER:WARN:4', err);
                Log.debug('geena', 'SERVER:DEBUG:8', err, __stack);
            }

            this.conf[appName].app      = app;
            this.conf[appName].view     = view;
            this.conf[appName].settings = settings;
            this.conf[appName].models   = models;

            filename = "", app = [], view = [], settings = [], models = [];
        }//EO for each app

        Log.warn("geena", "SERVER:WARN:10", "!!!!!!APPPPP " + this.conf[appName].app );
        callback(false, this.conf[appName]);
    }/**,
    spawnChild : function(action, params){
        var i = this.activeChild,
            id  = i,
            __this = Server;
        console.info("spawning child now...", action, '\n Execution path ');
        child[i] = Child(path.join(__dirname , 'router.child.js'));
        //this.child[i] = Child(path.join(this.parent.Server.executionPath, 'app_dev2.child.js'));
        //console.info("Child ", i, this.child[i]);

        child[i].on('stdout', function(txt) {
            console.log('child '+id+' stdout: ' + txt);
        });

        child[i].on('stderr', function(txt) {
            console.log('child '+id+' stderr: ' + txt);
        });

        child[i].on('child::method', function(status) {
            console.log('Parent: Child says: ', status);
            child[id].emit('parent::method', action, params);
            //child[id].emit('parent::method', {'action' : action, 'params' : params});
        });

        child[i].on('child::quit', function() {
            console.log('Parent: Child '+id+' wants to quit!');
            process.nextTick(function(){
              child[id].stop();
              --i;
              console.info(i, (i>0)? ' processes left' : 'no process left');
            });
        });

        child[i].start();
        ++i;
    } */
};
module.exports = Server;