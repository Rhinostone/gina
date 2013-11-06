/*
 * This file is part of the geena package.
 * Copyright (c) 2013 Rhinostone <geena@rhinostone.com>
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
var Fs              = require('fs'),
    Util            = require('util'),
    Events          = require('events'),
    EventEmitter    = require('events').EventEmitter,
    Utils           = require("geena.utils"),
    Log             = Utils.Logger;

/**
 * Config Constructor
 * @constructor
 * */
Config  = function(opt){

    var _this = this;
    this.bundles = [];
    this.allBundles = [];


    var init =  function(env){

        Log.debug('geena', 'CONFIG:DEBUG:1', 'Initalizing config ', __stack);

        _this.userConf = false;
        var path = _(_this.executionPath + '/env.json');

        if ( Fs.existsSync(path) ) {

            _this.userConf = require(_this.executionPath + '/env.json');

            Log.debug(
                'geena',
                'CONFIG:DEBUG:6',
                'Applicaiton config file loaded ['
                    + _(_this.executionPath + '/env.json') + ']',
                __stack
            );
        }

        _this.Env.parent = _this;
        if (env != 'undefined')
            _this.Env.set(env);

        _this.Host.parent = _this;

        //Do some checking please.. like already has a PID ?.
        //if yes, join in case of standalone.. or create a new thread.
        _this.Host.setMaster(_this.startingApp);
        getConf();
    };

    var getConf = function(){

        Log.debug('geena', 'CONFIG:DEBUG:2', 'Loading conf', __stack);

        _this.Env.load( function(err, envConf){
            //Log.debug('geena', 'CONFIG:DEBUG:42', 'CONF LOADED 42', __stack);
            //Log.info('geena', 'CORE:INFO:42','on this Env LOAD!', __stack);
            if ( typeof(_this.Env.loaded) == "undefined") {
                //Need to globalize some of them.
                this.env = env;
                this.envConf = envConf;

                loadBundlesConfiguration( function(err){
                    //Log.debug('geena', 'CONFIG:DEBUG:42', 'CONF LOADED 43', __stack);

                    //console.log("::: bundles ", _this.getBundles() );

                    //console.log("found this ",  JSON.stringify(_this.getInstance(), null, '\t'));
                    _this.bundlesConfiguration = {
                        env             : _this.Env.get(),
                        conf            : _this.getInstance(),
                        bundles         : _this.getBundles(),
                        allBundles      : _this.getAllBundles(),
                        isStandalone    : _this.Host.isStandalone()
                    };
                    //console.log("found bundles ", _this.bundlesConfiguration.bundles);
                    _this.Env.loaded = true;

                    _this.emit('complete', false, _this.bundlesConfiguration);
                    //isFileInProject(conf[env]["files"]);
                }, _this.startingApp);//by default.
            }
        });
    };

    /**
     * Get Instance
     *
     * @param {string} [bundle]
     * @return {object|undefined} configuration|"undefined"
     * */
    this.getInstance = function(bundle){
        var configuration = ( typeof(_this.envConf) == "undefined" ) ? this.envConf : _this.envConf;
        var env = (typeof(_this.env) == "undefined") ? this.env : _this.env;
        _this.Env.parent = _this;
        if (env != 'undefined')
            _this.Env.set(_this.env);

        _this.Host.parent = _this;

        //Do some checking please.. like already has a PID ?.
        //if yes, join in case of standalone.. or create a new thread.
        _this.Host.setMaster(bundle);

//        Log.info('geena', 'CORE:INFO:42','final env :::: ' + _this.env , __stack);
//        Log.info('geena', 'CORE:INFO:42','final cache :::: ' + _this.isCacheless() , __stack);
//        Log.info('geena', 'CORE:INFO:42','final :::: ' + "Bundle conf ====> " + bundle + JSON.stringify(configuration, null, '\t'), __stack);

        if ( typeof(bundle) != 'undefined' && typeof(configuration) != 'undefined' ) {

            try {
                return configuration[bundle][_this.Env.get()];

            } catch (err) {
                Log.error('geena', 'CONFIG:ERR:1', err, __stack);
                return undefined;
            }
        } else if ( typeof(configuration) != 'undefined' ) {
            return configuration;
        } else {
            return undefined;
        }
    };

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
        load : function(callback){
            try {

                var envConf = "";
                //console.log("loading once ", this.parent.userConf);

                //require(this.executionPath + '/env.json');

                if (this.parent.userConf) {
                    loadWithTemplate(this.parent.userConf, this.template, function(err, envConf){
                        _this.envConf = envConf;
                        //Log.warn('geena', 'CONFIG:WARN:10', 'envConf LOADED !!' + JSON.stringify(envConf, null, '\t') );
                        callback(false, envConf);
                    });
                } else {

                    envConf = this.template;
                    _this.envConf = envConf;
                    //Log.warn('geena', 'CONFIG:WARN:10', 'envConf LOADED !!' + JSON.stringify(envConf, null, '\t'));
                    callback(false, envConf);
                }

            } catch(err) {
                Log.warn('geena', 'CONF:ENV:WARN:1', err, __stack);
                callback(err);
            }
        },

        set : function(env){
            var found = false;
            Log.debug('geena', 'CONFIG:ENV:DEBUG:1', 'Setting Env',  __stack);
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
                    Log.error('geena', 'CONFIG:ENV:ERR:1', 'Env: ' + env + '] not found');
                    process.exit(1);
                }
            }
        },

        /**
         * Get active env
         * @return {String} env
         **/
        get : function(){
            return this.current;
        },

        /**
         * Get env config
         * @return {Object} json conf
         **/
        getConf : function(bundle, env){
            //console.log("get from ....", appName, env);
            if ( typeof(bundle) != 'undefined' && typeof(env) != 'undefined' )
                return ( typeof(_this.envConf) != "undefined" ) ? _this.envConf[bundle][env] : null
            else
                return ( typeof(_this.envConf) != "undefined" ) ? _this.envConf : null;
        },
        getDefault : function(){
            return {
                "env" : this.template.defEnv,
                "ext" : this.template.defExt,
                "registeredEnvs" : this.template.registeredEnvs
            };
        }
    };
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
        setMaster : function(appName){
            if(typeof(this.master) == "undefined" && this.master !== ""){
                this.master = appName;
            }
        },
        /**
         * Get Master instance
         * @return {Object} instance Instance of the master node
         * */
        getMaster : function(){
            return this.master;
        },
        isStandalone : function(){
            return this.standaloneMode;
        }
    };

    /**
     * Load config according to specific template
     * @param {String} filename  Path of source config file
     * @param {String} template Path of the template to merge with
     * @return {Oject} JSON of the merged config
     **/
    var loadWithTemplate = function(userConf, template, callback){

        var content = userConf,
        //if nothing to merge.
            newContent = content;

        var isStandalone = true,
            env = _this.Env.get(),
            appsPath = "",
            modelsPath = "";
//            masterPort = (
//                typeof(content) != "undefined" &&
//                    typeof(content[this.startingApp]) != "undefined" &&
//                    typeof(content[this.startingApp][env]) != "undefined"
//                )
//                ? content[this.startingApp][env].port.http
//                : template["{bundle}"]["{env}"].port.http;
""

        //Pushing default app first.
        _this.bundles.push(_this.startingApp);//This is a JSON.push.
        //console.log(" CONTENT TO BE SURE ", app, JSON.stringify(content, null, 4));
        //console.log("bundle list ", _this.bundles);
        var root = new _(_this.executionPath).toUnixStyle();
        //For each app.
        for (var app in content) {
            //Checking if genune app.
            Log.debug(
                'geena',
                'CONFIG:DEBUG:4',
                'Checking if application is registered ' + app,
                __stack
            );

            if ( typeof(content[app][env]) != "undefined" ) {

                appsPath = (typeof(content[app][env]['bundlesPath']) != "undefined")
                    ? content[app][env].appsPath
                    : template["{bundle}"]["{env}"].bundlesPath;


                //I had to for this one...
                appsPath = appsPath.replace(/\{executionPath\}/g, root);



                modelsPath = (typeof(content[app][env]['modelsPath']) != "undefined")
                    ?  content[app][env].modelsPath
                    :  template["{bundle}"]["{env}"].modelsPath;

                //console.log("My env ", env, _this.executionPath, JSON.stringify(template, null, '\t') );

                //Existing app and port sharing => != standalone.
                if ( Fs.existsSync(appsPath) ) {
                    var masterPort = content[_this.startingApp][env].port.http;
                    //Check if standalone or shared instance
                    if (content[app][env].port.http != masterPort) {
                        //console.log("should be ok !!");
                        isStandalone = false;
                        _this.Host.standaloneMode = isStandalone;
                        //console.log("PUSHING APPS ", app + "=>" + isStandalone);
                    } else if(app != _this.startingApp) {
                        _this.bundles.push(app);
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
                    newContent[app][env] = Utils.extend(
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
                    var jess = JSON.stringify(newContent).replace(/\{(\w+)\}/g, function(s, key) {
                        return reps[key] || s;
                    });
                    //console.log("damn path ", jess, null, 4);
                    newContent = JSON.parse(
                        JSON.stringify(newContent).replace(/\{(\w+)\}/g, function(s, key) {
                            return reps[key] || s;
                        }) );

                    //console.log("result ", _this.bundles,"\n",newContent[app][env]);
                    //console.log("bundle list ", _this.bundles);
                    //callback(false, newContent);

                } else {
                    Log.warn(
                        'geena',
                        'CONFIG:WARN:1',
                        'Server won\'t load [' +app + '] app or apps path does not exists: ' + _(appsPath),
                        __stack
                    );
                    callback('Server won\'t load [' +app + '] app or apps path does not exists: ' + _(appsPath) );
                }
            }
            //Else not in the scenario.


        }//EO for.



        Log.debug(
            'geena',
            'CONFIG:DEBUG:7',
            'Env configuration loaded \n ' + newContent,
            __stack
        );

        //Means all apps sharing the same process.
        if (!isStandalone) _this.Host.standaloneMode = isStandalone;

        Log.debug(
            'geena',
            'CONFIG:DEBUG:3',
            'Is server running as a standalone instance ? ' + isStandalone,
            __stack
        );
        //return newContent;
        callback(false, newContent);
    };

    var isFileInProject = function(file){

        try {
            var usrConf = require(_this.executionPath +'/'+ file +'.json');
            return true;
        } catch(err) {
            Log.warn('geena', 'CONF:HOST:WARN:1', err, __stack);
            return false;
        }
    };

    /**
     * Get Registered bundles sharing the same port #
     *
     * @return {array} bundles
     * */
    this.getBundles = function(){
        //Registered apps only.
        Log.debug(
            'geena',
            'CONFIG:DEBUG:4',
            'Pushing apps ' + JSON.stringify(_this.bundles, null, '\t'),
            __stack
        );
        return _this.bundles;
    };

    this.getAllBundles = function(){
        //Registered apps only.
        Log.debug(
            'geena',
            'CONFIG:DEBUG:5',
            'Pushing ALL apps ' + JSON.stringify(_this.allBundles, null, '\t'),
            __stack
        );
        return _this.allBundles;
    };

    /**
     * Load Apps Configuration
     *
     * TODO - simplify / optimize
     * */
    var loadBundlesConfiguration = function(callback, bundle){

        if ( typeof(bundle) == "undefined") {
            var bundle = _this.startingApp;
        }

        var bundles = _this.getBundles();

        //Log.info('geena', 'CORE:INFO:42','go ninja  !!!!' + bundles , __stack);
        if (arguments.length > 1) {
            var bundle = arguments[1];
            var callback = arguments[0];
            //if (!_this.Host.isStandalone())
             //   bundles = bundles.splice(bundles.indexOf(bundle), 1);

        } else {
            var callback = arguments[0];
            var bundle = "";
        }
        //console.log("bundle list ", _this.bundles);
        //Framework config files.
        var name        = "",
            files       = {},
            appPath     = "",
            modelsPath  = "",
            filename    = "",
            tmp         = "",
            env         =  _this.Env.get();

        var cacheless = _this.isCacheless(), conf = _this.envConf;



        //For each bundles.
        for (var i=0; i<bundles.length; ++i) {

            bundle = bundles[i];

            conf[bundle][env].bundles = bundles;
            conf[bundle].cacheless = cacheless;

            appPath = _(conf[bundle][env].bundlesPath + '/' + bundle);
            modelsPath = _(conf[bundle][env].modelsPath);
            //files = conf[bundle][env].files;

            for (name in  conf[bundle][env].files) {
                //Server only because of the shared mode VS the standalone mode.
                if (name == 'routing' ) continue;

                if (env != 'prod') {

                    tmp = conf[bundle][env].files[name].replace(/.json/, '.' +env + '.json');
                    //console.log("tmp .. ", tmp);
                    filename = appPath + '/config/' + tmp;
                    //Can't do a thing without.
                    if ( Fs.existsSync(filename) ) {
                        //console.log("app conf is ", filename);
                        if (cacheless) delete require.cache[filename];

                        name = name +'_'+env;
                        files[name] = require(filename);
                        //console.log("watch out !!", files[name][bundle]);
                    } else {
                        filename = appPath + '/config/' + conf[bundle][env].files[name];
                    }
                    tmp = "";
                }

                filename = appPath + '/config/' + conf[bundle][env].files[name];


                try {
                    if (cacheless) delete require.cache[filename];

                    //console.log("here ", name, " VS ", filename, "\n", conf[bundle][env].files[name]);
                    files[name] = Utils.extend( true, files[name], require(filename) );
                    //files[name] = require(filename);
                    //_this.configuration[bundle].config = files[name][bundle];

                    //console.log("Got filename ", name ,files[name]);
                } catch (err) {
                    //if ( typeof(files[name]) != 'undefined') {
                    if ( Fs.existsSync(filename) )
                        files[name] = "malformed !!";
                    else
                        files[name] = null;

                    Log.warn('geena', 'SERVER:WARN:1', filename + err, __stack);
                    Log.debug('geena', 'SERVER:DEBUG:5', filename +err, __stack);
                    //}
                }
            }//EO for (name


            conf[bundle][env].content   = files;
            conf[bundle][env].bundle    = bundle;

            files = {};

        }//EO for each app

        //We always return something.

        //Log.info('geena', 'CORE:INFO:42','ninja conf  !!!!' + JSON.stringify(conf, null, '\t') , __stack);
        callback(false);
    };

    /**
     * Check is cache is disabled
     *
     * @return {boolean} isUsingCache
     * */
    this.isCacheless = function(){
        var env = _this.Env.get();
        return (env == "dev" || env == "debug") ? true : false;
    };

    this.refresh = function(bundle, callback){

        loadBundlesConfiguration( function(err){
            if (!err) {
                callback(false);
            } else {
                callback(err);
            }
        }, bundle);
    };

    if (!opt) {

        //Interface
        return {
            getInstance : function(bundle){
                return _this.getInstance(bundle)
            },
            isCacheless : function() {
                //Log.info('geena', 'CORE:INFO:42','ninja conf  !!!!' + this.envConf, __stack);
                return _this.isCacheless()
            },
            refresh : function(bundle, callback) {
                _this.refresh(bundle, function(){
                    callback();
                });
            },
            Env : _this.Env,
            Host : _this.Host
        };
    } else {
        //Defined before init.
        this.startingApp = opt.startingApp,
        this.executionPath = opt.executionPath;
        var env = opt.env, _ready = {err:'not ready', val: null};
        //Log.info('geena', 'CORE:INFO:42','about to init !!!! ', __stack);

        //Events
        this.once('complete', function(err, config){
            //Log.info('geena', 'CORE:INFO:42','Ninja received EVENT  !!!!');
            _ready = {err: err, val: config};
        });
        _this.env = opt.env;
        init(opt.env);

        return {
            onReady : function(callback){
                callback(_ready.err, _ready.val);
            }
        };
    }


};

Util.inherits(Config, EventEmitter);
module.exports = Config