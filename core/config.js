/*
 * This file is part of the geena package.
 * Copyright (c) 2014 Rhinostone <geena@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * @class Config
 *
 *
 * @package     Geena
 * @namespace
 * @author      Rhinostone <geena@rhinostone.com>
 * @api         Public
 *
 * TODO - split Config.Env & Config.Host
 */

var Config;

//Imports.
var fs              = require('fs'),
    util            = require('util'),
    Events          = require('events'),
    EventEmitter    = require('events').EventEmitter,
    utils           = require("./utils"),
    logger          = utils.logger;

/**
 * Config Constructor
 * @constructor
 * */
Config  = function(opt) {

    var _this = this;
    this.bundles = [];
    this.allBundles = [];

    var init =  function(opt) {

        var env = opt.env;
        _this.startingApp = opt.startingApp;
        _this.executionPath = opt.executionPath;
        _this.task = opt.task || 'run'; // to be aible to filter later on non run task

        logger.debug('geena', 'CONFIG:DEBUG:1', 'Initalizing config ', __stack);

        _this.userConf = false;
        var path = _(_this.executionPath + '/env.json');

        if ( fs.existsSync(path) ) {

            _this.userConf = require(path);

            logger.debug(
                'geena',
                'CONFIG:DEBUG:6',
                'Applicaiton config file loaded ['
                    + _(_this.executionPath + '/env.json') + ']',
                __stack
            );
        }

        _this.Env.parent = _this;
        if (env != 'undefined') _this.Env.set(env);

        _this.Host.parent = _this;

        //Do some checking please.. like already has a PID ?.
        //if yes, join in case of standalone.. or create a new thread.
        _this.Host.setMaster(_this.startingApp);
        getConf()
    }

    var getConf = function() {

        logger.debug('geena', 'CONFIG:DEBUG:2', 'Loading conf', __stack);

        _this.Env.load( function(err, envConf) {
            //logger.debug('geena', 'CONFIG:DEBUG:42', 'CONF LOADED 42', __stack);
            //logger.info('geena', 'CORE:INFO:42','on this Env LOAD!', __stack);

            if ( typeof(_this.Env.loaded) == "undefined") {
                //Need to globalize some of them.
                this.env = env;
                this.envConf = envConf;
                loadBundlesConfiguration( function(err) {
                    //logger.debug('geena', 'CONFIG:DEBUG:42', 'CONF LOADED 43', __stack);

                    //console.log("::: bundles ", _this.getBundles() );

                    //console.log("found this ",  JSON.stringify(_this.getInstance(), null, '\t'));
                    _this.bundlesConfiguration = {
                        env             : _this.Env.get(),
                        conf            : _this.getInstance(),
                        bundles         : _this.getBundles(),
                        allBundles      : _this.getAllBundles(),
                        isStandalone    : _this.Host.isStandalone()
                    };

                    //console.error("found bundles ", _this.bundlesConfiguration.bundles);

                    //TODO - Don't override if syntax is ok - no mixed paths.
                    //Set paths for utils. Override for now.
                    //To reset it, just delete the hidden folder.
                    var geenaPath = opt.geenaPath;
                    var utilsConfig = new utils.Config();
                    setContext('geena.utils.config', utilsConfig);

                    utilsConfig.set('geena', 'locals.json', {
                        project : utilsConfig.getProjectName(),
                        paths : {
                            geena   : geenaPath,
                            utils   : utilsConfig.__dirname,
                            root    : opt.executionPath,
                            env     : opt.executionPath + '/env.json',
                            tmp     : opt.executionPath + '/tmp'
                        },
                        //TODO - Replace by a property by bundle.
                        bundles : _this.bundlesConfiguration.allBundles
                    }, function(err) {
                        _this.Env.loaded = true;
                        _this.emit('complete', err, _this.bundlesConfiguration)
                    });

                    //callback(false, Express(), Express, this.conf[this.appName]);

                    //_this.Env.loaded = true;
                    //_this.emit('complete', false, _this.bundlesConfiguration);
                    //isFileInProject(conf[env]["files"]);
                }, _this.startingApp);//by default.
            }
        });
    }

    /**
     * Get Instance
     *
     * @param {string} [bundle]
     * @return {object|undefined} configuration|"undefined"
     * */
    this.getInstance = function(bundle) {
        var configuration = ( typeof(_this.envConf) == "undefined" ) ? this.envConf : _this.envConf;
        var env = (typeof(_this.env) == "undefined") ? this.env : _this.env;
        _this.Env.parent = _this;
        if (env != 'undefined')
            _this.Env.set(_this.env);

        _this.Host.parent = _this;

        //Do some checking please.. like already has a PID ?.
        //if yes, join in case of standalone.. or create a new thread.
        _this.Host.setMaster(bundle);
        if ( typeof(bundle) != 'undefined' && typeof(configuration) != 'undefined' ) {

            try {
                return configuration[bundle][_this.Env.get()];
            } catch (err) {
                logger.error('geena', 'CONFIG:ERR:1', err, __stack);
                return undefined
            }
        } else if ( typeof(configuration) != 'undefined' ) {
            return configuration
        } else {
            return undefined
        }
    }

    /**
     * @class Env Sub class
     *
     *
     * @package     Geena.Config
     * @namespace   Geena.Config.Env
     * @author      Rhinostone <geena@rhinostone.com>
     */
    this.Env = {
        template : require('./template/conf/env.json'),
        load : function(callback) {
            try {

                var envConf = "";
                //console.error("loading once ", this.parent.userConf);

                //require(this.executionPath + '/env.json');

                if (this.parent.userConf) {

                    loadWithTemplate(this.parent.userConf, this.template, function(err, envConf) {
                        _this.envConf = envConf;
                        //logger.warn('geena', 'CONFIG:WARN:10', 'envConf LOADED !!' + JSON.stringify(envConf, null, '\t') );
                        callback(false, envConf);
                    });
                } else {

                    envConf = this.template;
                    _this.envConf = envConf;
                    //logger.warn('geena', 'CONFIG:WARN:10', 'envConf LOADED !!' + JSON.stringify(envConf, null, '\t'));
                    callback(false, envConf);
                }

            } catch(err) {
                logger.warn('geena', 'CONF:ENV:WARN:1', err, __stack);
                callback(err);
            }
        },

        set : function(env) {
            var found = false;
            logger.debug('geena', 'CONFIG:ENV:DEBUG:1', 'Setting Env',  __stack);
            var registeredEnvs = this.template.registeredEnvs;
            for (var e=0; e<registeredEnvs.length; ++e) {
                if (registeredEnvs[e] == env) {
                    this.current = env;
                    found = true;
                    break;
                }
            }

            if (typeof(found) == "undefined") {
                if (typeof(env) == "undefined") {
                    this.current = this.template.defEnv;
                } else {
                    logger.error('geena', 'CONFIG:ENV:ERR:1', 'Env: ' + env + '] not found');
                    process.exit(1);
                }
            }
        },

        /**
         * Get active env
         * @return {String} env
         **/
        get : function() {
            return this.current
        },

        /**
         * Get env config
         * @return {Object} json conf
         **/
        getConf : function(bundle, env) {
            //console.log("get from ....", appName, env);
            if ( typeof(bundle) != 'undefined' && typeof(env) != 'undefined' )
                return ( typeof(_this.envConf) != "undefined" ) ? _this.envConf[bundle][env] : null;
            else
                return ( typeof(_this.envConf) != "undefined" ) ? _this.envConf : null;
        },
        getDefault : function() {
            return {
                "env" : this.template.defEnv,
                "ext" : this.template.defExt,
                "registeredEnvs" : this.template.registeredEnvs
            }
        }
    }
    /**
     * Host Class
     *
     * @package    Geena.Config
     * @author     Rhinostone <geena@rhinostone.com>
     */
    this.Host = {
        //By default.
        standaloneMode : true,
        /**
         * Set Master instance
         * @param {String} appName Application name
         * @return {Object} instance Instance of the master node
         * */
        setMaster : function(appName) {
            if(typeof(this.master) == "undefined" && this.master !== "") {
                this.master = appName
            }
        },
        /**
         * Get Master instance
         * @return {Object} instance Instance of the master node
         * */
        getMaster : function() {
            return this.master
        },
        isStandalone : function() {
            return this.standaloneMode
        }
    }

    /**
     * Load config according to specific template
     * @param {String} filename  Path of source config file
     * @param {String} template Path of the template to merge with
     * @return {Oject} JSON of the merged config
     **/
    var loadWithTemplate = function(userConf, template, callback) {

        var content = userConf,
        //if nothing to merge.
            newContent = content;

        var isStandalone = true,
            env = _this.Env.get(),
            appsPath = "",
            modelsPath = "";


        //Pushing default app first.
        _this.bundles.push(_this.startingApp);//This is a JSON.push.
        //console.log(" CONTENT TO BE SURE ", app, JSON.stringify(content, null, 4));
        //console.log("bundle list ", _this.bundles);
        var root = new _(_this.executionPath).toUnixStyle();
        try {
            var pkg = require(_(root + '/project.json')).packages;
        } catch (err) {
            callback(err);
        } //bundlesPath will be default.


        //For each app.
        for (var app in content) {
            //Checking if genuine app.
            logger.debug(
                'geena',
                'CONFIG:DEBUG:4',
                'Checking if application is registered ' + app,
                __stack
            );

            //Now check if you have a description for each bundle.
//            if ( typeof(pkg[app]) == 'undefined' ) {
//                throw new Error('No definition found for bundle ['+ app +']in project.json');
//                //Sorry, can't work without... fix your shit.
//                process.kill(process.pid, 'SIGINT');
//            }
                //callback(new Error('No definition found for bundle ['+ app +']in project.json'));


            if ( typeof(content[app][env]) != "undefined" ) {

                if (
                    pkg[app] != 'undefined' && pkg[app]['src'] != 'undefined' && env == 'dev'
                    || pkg[app] != 'undefined' && pkg[app]['src'] != 'undefined' && env == 'debug'
                    ) {
                    var p = _(pkg[app].src);
                    content[app][env]['bundlesPath'] = "{executionPath}/"+ p.replace('/' + app, '');
                    //content[app][env]['bundlesPath'] = root + "/"+ p.replace('/' + app, '');
                } else {
                    var p = ( typeof(pkg[app].release.link) != 'undefined' ) ? _(pkg[app].release.link) : _(pkg[app].release.target);
                    content[app][env]['bundlesPath'] = "{executionPath}/"+ p.replace('/' + app, '');
                }

                appsPath = (typeof(content[app][env]['bundlesPath']) != "undefined")
                    ? content[app][env].bundlesPath
                    : template["{bundle}"]["{env}"].bundlesPath;



                modelsPath = (typeof(content[app][env]['modelsPath']) != "undefined")
                    ?  content[app][env].modelsPath
                    :  template["{bundle}"]["{env}"].modelsPath;

                //I had to for this one...
                appsPath = appsPath.replace(/\{executionPath\}/g, root);
                //modelsPath = modelsPath.replace(/\{executionPath\}/g, mPath);

                //console.log("My env ", env, _this.executionPath, JSON.stringify(template, null, '\t') );
                //Existing app and port sharing => != standalone.
                if ( fs.existsSync(appsPath) ) {
                    var masterPort = content[_this.startingApp][env].port.http;
                    //Check if standalone or shared instance
                    if (content[app][env].port.http != masterPort) {
                        //console.log("should be ok !!");
                        isStandalone = false;
                        _this.Host.standaloneMode = isStandalone
                    } else if (app != _this.startingApp) {
                        _this.bundles.push(app)
                    }
                    _this.allBundles.push(app);

//                    console.log(
//                        "\nenv                  => " + env,
//                        "\napp parsed           => " + app,
//                        "\napp is Standalone    => " + _this.Host.isStandalone(),
//                        "\nstarting app         => " + _this.startingApp,
//                        "\napp port             => " + content[app][env].port.http,
//                        "\nmaster port          => " + masterPort + '  ' + content[_this.startingApp][env].port.http,
//                        "\nRegisterd bundles    => " + _this.bundles
//                    );
                    //console.log("Merging..."+ app, "\n", content[app][env], "\n AND \n", template[app][env]);
                    //Mergin user's & template.
                    newContent[app][env] = utils.extend(
                        true,
                        content[app][env],
                        template["{bundle}"]["{env}"]
                    );


                    //Variables replace. Compare with geena/core/template/conf/env.json.
                    var reps = {
                        "executionPath" : root,
                        "bundlesPath" : appsPath,
                        "modelsPath" : modelsPath,
                        "env" : env,
                        "bundle" : app
                    };


                    //console.error("reps ", reps);
                    newContent = whisper(reps, newContent);
                } else {
                    logger.warn(
                        'geena',
                        'CONFIG:WARN:1',
                        'Server won\'t load [' +app + '] app or apps path does not exists: ' + _(appsPath),
                        __stack
                    );
                    callback('Server won\'t load [' +app + '] app or apps path does not exists: ' + _(appsPath) )
                }

            }
            //Else not in the scenario.

        }//EO for.


        logger.debug(
            'geena',
            'CONFIG:DEBUG:7',
            'Env configuration loaded \n ' + newContent,
            __stack
        );

        //Means all apps sharing the same process.
        if (!isStandalone) _this.Host.standaloneMode = isStandalone;

        logger.debug(
            'geena',
            'CONFIG:DEBUG:3',
            'Is server running as a standalone instance ? ' + isStandalone,
            __stack
        );
        //return newContent;
        callback(false, newContent)
    }

    var isFileInProject = function(file) {

        try {
            var usrConf = require(_this.executionPath +'/'+ file +'.json');
            return true
        } catch(err) {
            logger.warn('geena', 'CONF:HOST:WARN:1', err, __stack);
            return false
        }
    }

    /**
     * Get Registered bundles sharing the same port #
     *
     * @return {array} bundles
     * */
    this.getBundles = function() {

        //Registered apps only.
        logger.debug(
            'geena',
            'CONFIG:DEBUG:4',
            'Pushing apps ' + JSON.stringify(_this.bundles, null, '\t'),
            __stack
        );

        return _this.bundles
    }

    this.getAllBundles = function() {
        //Registered apps only.
        logger.debug(
            'geena',
            'CONFIG:DEBUG:5',
            'Pushing ALL apps ' + JSON.stringify(_this.allBundles, null, '\t'),
            __stack
        );
        return _this.allBundles
    }

    var loadBundleConfig = function(bundle, callback) {
        if ( typeof(bundle) == "undefined") {
            var bundle = _this.startingApp
        }
        var bundles     = _this.getBundles();
        var cacheless   = _this.isCacheless();
        var conf        = _this.envConf;
        var env         = _this.Env.get();

        var tmp         = '';
        //var tmpName     = '';
        var filename    = '';
        var err         = false;

        conf[bundle][env].bundles = bundles;
        conf[bundle].cacheless = cacheless;
        conf[bundle][env].executionPath = getContext("paths").root;

        if (_this.task != 'run' && env == 'prod') { // like for build
            //getting src path instead
            var appPath = _(conf[bundle][env].sources + '/' + bundle)
        } else {
            var appPath = _(conf[bundle][env].bundlesPath + '/' + bundle)
        }

        var files = {};
        for (var name in  conf[bundle][env].files) {
            //Server only because of the shared mode VS the standalone mode.
            if (name == 'routing') continue;

            if (env != 'prod') {
                tmp = conf[bundle][env].files[name].replace(/.json/, '.' +env + '.json')
            } else {
                tmp = conf[bundle][env].files[name]
            }

            filename = _(appPath + '/config/' + tmp);
            //Can't do a thing without.
            if ( fs.existsSync(filename) ) {
                //console.log("app conf is ", filename);
                if (cacheless) delete require.cache[_(filename, true)];

                //tmpName = name +'_'+ env;//?? maybe useless.
                files[name] = require(filename);
                //console.log("watch out !!", files[name][bundle]);
            }
            tmp = '';
            try {

                filename = appPath + '/config/' + conf[bundle][env].files[name];
                if (env != 'prod' && cacheless) delete require.cache[_(filename, true)];

                files[name] = utils.extend( true, files[name], require(filename) )
            } catch (_err) {

                if ( fs.existsSync(filename) ) {
                    //files[name] = "malformed !!";
                    //throw new Error('[ '+name+' ] is malformed !!');
                    log("[ " +filename + " ] is malformed !!");
                    process.exit(1)
                } else {
                    files[name] = null
                }
                err = _err;
                logger.warn('geena', 'SERVER:WARN:1', filename + err, __stack);
                logger.debug('geena', 'SERVER:DEBUG:5', filename +err, __stack)
            }
        }//EO for (name

        //Set default keys/values for views
        if ( typeof(files['views'].default.view) == 'undefined' ) {
            files['views'].default.view =  _(appPath +'/views')
        }
        if ( typeof(files['views'].default.static) == 'undefined' ) {
            files['views'].default.static =  _(appPath +'/views/statics')
        }

        files['views'].default = whisper(
            {
                "view" : files['views'].default.view
            }, files['views'].default
        );

        var defaultAliases = {
            "css" : "{static}/css",
            "images" : "{static}/images",
            "handlers" : "{view}/handlers",
            "js" : "{view}/js",
            "assets" : "{root}/assets"
        };
        if ( typeof(files['views'].default.aliases) == 'undefined' ) {
            files['views'].default.aliases = defaultAliases
        } else if ( typeof(files['views'].default.aliases) != 'undefined') {
            files['views'].default.aliases = utils.extend(true, files['views'].default.aliases, defaultAliases)
        }

        //Constants to be exposed in configuration files.
        var reps = {
            //TODO - remove this duplicate ?
            "root"          : conf[bundle][env].executionPath,
            "env"           : env,
            "executionPath" : conf[bundle][env].executionPath,
            "bundlesPath"   : conf[bundle][env].bundlesPath,
            "mountPath"     : conf[bundle][env].mountPath,
            "bundlePath"    : conf[bundle][env].bundlePath,
            "modelsPath"    : conf[bundle][env].modelsPath,
            "logsPath"      : conf[bundle][env].logsPath,
            "tmpPath"       : conf[bundle][env].tmpPath,
            "handlersPath"  : _(appPath +'/views/handlers'),
            "env"           : env,
            "bundle"        : bundle,
            "theme"         : files['views'].default.theme,
            "view"          : files['views'].default.view,
            "static"        : files['views'].default.static
        };

        files = whisper(reps, files);
        conf[bundle][env].content   = files;
        conf[bundle][env].bundle    = bundle;
        conf[bundle][env].env       = env;

        callback(err, files)
    }

    /**
     * Load Apps Configuration
     *
     * TODO - simplify / optimize
     * */
     var loadBundlesConfiguration = function(callback) {

        var bundles = _this.getBundles();
        var count = bundles.length;
        //For each bundles.
        for (var i=0; i<bundles.length; ++i) {
            bundle = bundles[i];
            loadBundleConfig(bundle, function(){
                --count;
                if (count == 0) {
                    //We always return something.
                    callback(false)
                }
            })
        }//EO for each app
    }
 //    var loadBundlesConfiguration = function(callback, bundle) {
//
//        if ( typeof(bundle) == "undefined") {
//            var bundle = _this.startingApp
//        }
//
//        var bundles = _this.getBundles();
//
//        //logger.info('geena', 'CORE:INFO:42','go ninja  !!!!' + bundles , __stack);
//        if (arguments.length > 1) {
//            var bundle = arguments[1];
//            var callback = arguments[0];
//            //if (!_this.Host.isStandalone())
//             //   bundles = bundles.splice(bundles.indexOf(bundle), 1);
//
//        } else {
//            var callback = arguments[0];
//            var bundle = ""
//        }
//        //console.log("bundle list ", _this.bundles);
//        //Framework config files.
//        var name        = "",
//            tmpName     = "",
//            files       = {},
//            appPath     = "",
//            modelsPath  = "",
//            filename    = "",
//            tmp         = "",
//            env         =  _this.Env.get();
//
//        var cacheless = _this.isCacheless(), conf = _this.envConf;
//
//
//        //For each bundles.
//        for (var i=0; i<bundles.length; ++i) {
//
//            bundle = bundles[i];
//            conf[bundle][env].bundles = bundles;
//            conf[bundle].cacheless = cacheless;
//            conf[bundle][env].executionPath = getContext("paths").root;
//
//            appPath = _(conf[bundle][env].bundlesPath + '/' + bundle);
//            modelsPath = _(conf[bundle][env].modelsPath);
//            //files = conf[bundle][env].files;
//
//            for (var name in  conf[bundle][env].files) {
//                //Server only because of the shared mode VS the standalone mode.
//                if (name == 'routing') continue;
//
//                if (env != 'prod') {
//
//                    tmp = conf[bundle][env].files[name].replace(/.json/, '.' +env + '.json');
//                    //console.log("tmp .. ", tmp);
//                    filename = _(appPath + '/config/' + tmp);
//                    //Can't do a thing without.
//                    if ( fs.existsSync(filename) ) {
//                        //console.log("app conf is ", filename);
//                        if (cacheless) delete require.cache[_(filename, true)];
//
//                        tmpName = name +'_'+ env;//?? maybe useless.
//                        files[name] = require(filename);
//                        //console.log("watch out !!", files[name][bundle]);
//                    }
//                    tmp = ""
//                }
//
//                try {
//
//                    filename = appPath + '/config/' + conf[bundle][env].files[name];
//                    if (env != 'prod' && cacheless) delete require.cache[_(filename, true)];
//
//                    //console.log("here ", name, " VS ", filename, "\n", conf[bundle][env].files[name]);
//                    files[name] = utils.extend( true, files[name], require(filename) )
//                    //console.log("Got filename ", name ,files[name]);
//                } catch (err) {
//
//                    if ( fs.existsSync(filename) ) {
//                        //files[name] = "malformed !!";
//                        //throw new Error('[ '+name+' ] is malformed !!');
//                        log("[ " +filename + " ] is malformed !!");
//                        process.exit(1)
//                    } else {
//                        files[name] = null
//                    }
//                    logger.warn('geena', 'SERVER:WARN:1', filename + err, __stack);
//                    logger.debug('geena', 'SERVER:DEBUG:5', filename +err, __stack)
//                }
//            }//EO for (name
//
//            //Set default keys/values for views
//            if ( typeof(files['views'].default.view) == 'undefined' ) {
//                files['views'].default.view =  _(appPath +'/views')
//            }
//            if ( typeof(files['views'].default.static) == 'undefined' ) {
//                files['views'].default.static =  _(appPath +'/views/statics')
//            }
//
//            files['views'].default = whisper(
//                {
//                    "view" : files['views'].default.view
//                }, files['views'].default
//            );
//
//            var defaultAliases = {
//                "css" : "{static}/css",
//                "images" : "{static}/images",
//                "handlers" : "{view}/handlers",
//                "js" : "{view}/js",
//                "assets" : "{root}/assets"
//            };
//            if ( typeof(files['views'].default.aliases) == 'undefined' ) {
//                files['views'].default.aliases = defaultAliases
//            } else if ( typeof(files['views'].default.aliases) != 'undefined') {
//                files['views'].default.aliases = utils.extend(true, files['views'].default.aliases, defaultAliases)
//            }
//
//            //Constants to be exposed in configuration files.
//            var reps = {
//                //TODO - remove this duplicate ?
//                "root"          : conf[bundle][env].executionPath,
//                "executionPath" : conf[bundle][env].executionPath,
//                "bundlesPath"   : conf[bundle][env].bundlesPath,
//                "mountPath"     : conf[bundle][env].mountPath,
//                "bundlePath"    : conf[bundle][env].bundlePath,
//                "modelsPath"    : conf[bundle][env].modelsPath,
//                "logsPath"      : conf[bundle][env].logsPath,
//                "tmpPath"       : conf[bundle][env].tmpPath,
//                "handlersPath"  : _(appPath +'/views/handlers'),
//                "env"           : env,
//                "bundle"        : bundle,
//                "theme"         : files['views'].default.theme,
//                "view"          : files['views'].default.view,
//                "static"        : files['views'].default.static
//            };
//
//            files = whisper(reps, files);
//            conf[bundle][env].content   = files;
//            conf[bundle][env].bundle    = bundle;
//            conf[bundle][env].env       = env;
//            files = {}
//
//        }//EO for each app
//
//        //We always return something.
//        callback(false)
//    }

    /**
     * Check is cache is disabled
     *
     * @return {boolean} isUsingCache
     * */
    this.isCacheless = function() {
        var env = _this.Env.get();
        //Also defined in core/gna.
        return (env == "dev" || env == "debug") ? true : false
    }
    /**
     * Refresh for cachless mode
     *
     * @param {string} bundle
     *
     * @callback callback
     * @param {boolean|string} err
     * */
    this.refresh = function(bundle, callback) {
        var env = _this.Env.get();
        var conf = _this.envConf;

        //Reload models.
        var modelsPath = _(conf[bundle][env].modelsPath);
        var path;
        try {
            var files = fs.readdirSync(modelsPath);
            if ( typeof(files) == 'object' && files.count() > 0 ) {
                for (var f=0; f<files.length; ++f) {
                    path = _(modelsPath + '/' + files[f], true);
                    delete require.cache[path]
                }

                var Model   = require('./model');
                for (var m in conf[bundle][env].content.connectors) {
                    setContext(m+'Model',  new Model(conf[bundle][env].bundle + "/" + m))
                }
            }
        } catch (err) {
            console.log(err.stack)
        }

        //Reload conf.
        loadBundleConfig( bundle, function(err) {
            if (!err) {
                callback(false)
            } else {
                callback(err)
            }
        })

    }//EO refresh.


    if (!opt) {
        //Interface
        return {
            getInstance : function(bundle) {
                return _this.getInstance(bundle)
            },
            isCacheless : function() {
                //logger.info('geena', 'CORE:INFO:42','ninja conf  !!!!' + this.envConf, __stack);
                return _this.isCacheless()
            },
            refresh : function(bundle, callback) {
                _this.refresh(bundle, function() {
                    callback()
                })
            },
            Env : _this.Env,
            Host : _this.Host,
            setBundles : function(bundles) {
                _this.bundles = bundles
            }
        }

    } else {

        //Defined before init.
        var env = opt.env, _ready = {err:'not ready', val: null};
        //logger.info('geena', 'CORE:INFO:42','about to init !!!! ', __stack);

        this.env = opt.env;
        init(opt);

        return {
            onReady : function(callback) {
                _this.once('complete', function(err, config) {
                    callback(err, config)
                })
            },
            getInstance : function(bundle) {
                return _this.getInstance(bundle)
            }
        }
    }


};

util.inherits(Config, EventEmitter);
module.exports = Config