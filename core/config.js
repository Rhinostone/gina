/*
 * This file is part of the geena package.
 * Copyright (c) 2013 Rhinostone <geena@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

var Config;

/**
 * @class Config
 *
 *
 * @package     Geena
 * @namespace   Geena.Config
 * @author      Rhinostone <geena@rhinostone.com>
 * @api         Public
 *
 * TODO - split Config.Env & Config.Host
 */

var Fs              = require('fs'),
    Util            = require('util'),
    Events          = require('events'),
    EventEmitter    = require('events').EventEmitter,
    Utils           = require("geena.utils"),
    Log             = Utils.Logger;


Config  = function(opt){

    var _this = this;
    this.bundles = [];
    this.allBundles = [];
    this.configuration = {};

    var _init =  function(env){
        instances["Config"] = _this;
        Log.debug('geena', 'CONFIG:DEBUG:1', 'Initalizing config', __stack);

        _this.userConf = false;
        var p = new _(_this.executionPath + '/env.json').toString();

        if ( Fs.existsSync( p ) ) {

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
        _getConf();
    };

    var _getConf = function(){

        Log.debug('geena', 'CONFIG:DEBUG:2', 'Loading conf', __stack);

        _this.Env.load( function(err, envConf){
            Log.debug('geena', 'CONFIG:DEBUG:42', 'CONF LOADED 42', __stack);
            Log.info('geena', 'CORE:INFO:42','on this Env LOAD!', __stack);
            if ( typeof(_this.Env.loaded) == "undefined") {
                //On load.
                _this.configuration = envConf;
                _loadBundlesConfiguration( function(err){
                    Log.debug('geena', 'CONFIG:DEBUG:43', 'CONF LOADED 43', __stack);
                    //console.log("::: ", JSON.stringify( _this.getInstance(), null, '\t') );

                    //console.log("found this ",  JSON.stringify(_this.getInstance(), null, '\t'));
                    _this.bundlesConfiguration = {
                        env             : _this.Env.get(),
                        //conf            : _this.Env.getConf(),
                        conf            : _this.getInstance(),
                        bundles         : _this.getBundles(),
                        allBundles      : _this.getAllBundles(),
                        isStandalone    : _this.Host.isStandalone()
                    };
                    _this.Env.loaded = true;

                    Log.info('geena', 'CORE:INFO:42','final :::: ' + _this.Host.isStandalone() , __stack);
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
        console.log("Bundle conf ", bundle, JSON.stringify(this.configuration, null, '\t') );
        if ( typeof(bundle) != 'undefined' && typeof(_this.configuration) != 'undefined' ) {

            try {
                return _this.configuration[bundle][_this.Env.get()];

            } catch (err) {
                Log.error('geena', 'CONFIG:ERR:1', err, __stack);
                return undefined;
            }
        } else if ( typeof(_this.configuration) != 'undefined' ) {
            return _this.configuration;
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
                        this.envConf = envConf;
                        Log.warn('geena', 'CONFIG:WARN:10', 'envConf LOADED !!' + JSON.stringify(envConf, null, '\t') );
                        callback(false, envConf);
                    });
                } else {

                    envConf = this.template;
                    this.envConf = envConf;
                    Log.warn('geena', 'CONFIG:WARN:10', 'envConf LOADED !!' + JSON.stringify(envConf, null, '\t'));
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
        getConf : function(appName, env){
            //console.log("get from ....", appName, env);
            if ( typeof(appName) != 'undefined' && typeof(env) != 'undefined' )
                return ( typeof(this.envConf) != "undefined" ) ? this.envConf[appName][env] : null
            else
                return ( typeof(this.envConf) != "undefined" ) ? this.envConf : null;
        }
//        getDefault : function(){
//            return {
//                "env" : this.template.defEnv,
//                "ext" : this.template.defExt,
//                "registeredEnvs" : this.template.registeredEnvs
//            };
//        }
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

        var _that = _this,
            content = userConf,
        //if nothing to merge.
            newContent = content;

        var isStandalone = true,
            env = _this.Env.get(),
            appsPath = "",
            modelsPath = "",
            masterPort = (
                typeof(content) != "undefined" &&
                    typeof(content[this.startingApp]) != "undefined" &&
                    typeof(content[this.startingApp][env]) != "undefined"
                )
                ? content[this.startingApp][env].port.http
                : template["{bundle}"]["{env}"].port.http;


        //Pushing default app first.
        _this.bundles.push(_this.startingApp);//This is a JSON.push.
        //console.log(" CONTENT TO BE SURE ", app, JSON.stringify(content, null, 4));

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

                    //Check if standalone or shared instance
                    if (app != _this.startingApp && content[app][env].port.http == masterPort) {
                        isStandalone = false;
                        //console.log("PUSHING APPS ", app + "=>" + isStandalone);
                        _this.bundles.push(app);
                    }
                    _this.allBundles.push(app);

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

                    //console.log("result ", newContent[app][env]);
                    callback(false, newContent);

                } else {
                    Log.warn(
                        'geena',
                        'CONFIG:WARN:1',
                        'Server won\'t load [' +app + '] app or apps path does not exists: ' + new _(appsPath).toString(),
                        __stack
                    );
                    callback('Server won\'t load [' +app + '] app or apps path does not exists: ' + new _(appsPath).toString() );
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
        return newContent;
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
            'Pushing apps ' + JSON.stringify(_this.apps, null, '\t'),
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
    var _loadBundlesConfiguration = function(callback, bundle){


        if ( typeof(bundle) == "undefined") {
            var bundle = _this.startingApp;
        }

        var bundles = _this.getBundles();
        Log.info('geena', 'CORE:INFO:42','go ninja  !!!!' + bundles , __stack);
        if (arguments.length > 1) {
            var bundle = arguments[1];
            var callback = arguments[0];
            bundles = bundles.splice(bundles.indexOf(bundle), 1);

        } else {
            var callback = arguments[0];
            var bundle = "";
        }

        //Framework config files.
        var name        = "",
            files       = {},
            appPath     = "",
            modelsPath  = "",
            filename    = "",
            tmp         = "",
            env         =  _this.Env.get();

        var cacheless = _this.isCacheless(), conf = _this.configuration;



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
                    files[name] = null;
                    Log.warn('geena', 'SERVER:WARN:1', filename + err, __stack);
                    Log.debug('geena', 'SERVER:DEBUG:5', filename +err, __stack);
                    //}
                }
            }//EO for (name

            conf[bundle][env].filesContent = files;

            files = {};

        }//EO for each app

        _this.configuration = conf;
        //We always return something.

        Log.info('geena', 'CORE:INFO:42','ninja conf  !!!!' + conf , __stack);
        callback(false);
    };



    this.refresh = function(bundle, callback){

        _loadBundlesConfiguration( function(err){
            if (!err) {
                callback(false);
            } else {
                callback(err);
            }
        }, bundle);
    };

    if (!opt) {
        return {
            getInstance : function(){
                return instances["Config"];
            }
        }
    } else {
        //Defined before init.
        this.startingApp = opt.startingApp,
        this.executionPath = opt.executionPath;
        var env = opt.env, _ready = {err:'not ready', val: null};
        Log.info('geena', 'CORE:INFO:42','about to init !!!! ', __stack);

        //Events
        this.on('complete', function(err, config){
            Log.info('geena', 'CORE:INFO:42','Ninja received EVENT  !!!!');
            _ready = {err: err, val: config};
        });

        _init(opt.env);
    }

    return {

        onReady : function(callback){
            callback(_ready.err, _ready.val);
        },
        /**
         * Check is cache is disabled
         *
         * @return {boolean} isUsingCache
         * */
        isCacheless : function(){
            var env = _this.Env.get();
            return (env == "dev" || env == "debug") ? true : false;
        }
    };
};

Util.inherits(Config, EventEmitter);
module.exports = Config