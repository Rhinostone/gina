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
 * @namespace   Geena.Config
 * @author      Rhinostone <geena@rhinostone.com>
 * @api         Public
 *
 * TODO - split Config.Env & Config.Host
 */

var Fs      = require('fs'),
    Utils   = require("geena.utils"),
    Log     = Utils.Logger,
    Config  = {
    bundles : [],
    allBundles : [],
    configuration: {},
    //Defined before init.
    startingApp : "",
    //Defined before init.
    executionPath : "",
    init : function(env, callback){

        Log.debug('geena', 'CONFIG:DEBUG:1', 'Initalizing config', __stack);
        var _this = this;

        this.userConf = false;
        var p = new _(this.executionPath + '/env.json').toString();
        if (Fs.existsSync( p )) {
            this.userConf = require(this.executionPath + '/env.json');
            Log.debug(
                'geena',
                'CONFIG:DEBUG:6',
                'Applicaiton config file loaded ['
                + _(this.executionPath + '/env.json') + ']',
                __stack
            );
        }

        this.Env.parent = this;
        if (env != 'undefined')
            this.Env.set(env);

        this.Host.parent = this;

        //Do some checking please.. like already has a PID ?.
        //if yes, join in case of standalone.. or create a new thread.
        this.Host.setMaster(this.startingApp);


        Log.debug('geena', 'CONFIG:DEBUG:2', 'Loading conf', __stack);

        this.Env.load(function(ready){
            //On load.
            _this.configuration = _this.Env.getConf();
            _this.loadBundlesConfiguration( function(err){

                console.log("found this ",  JSON.stringify(_this.getInstance(), null, '\t'));
                var config = {
                    env             : _this.Env.get(),
                    //conf            : _this.Env.getConf(),
                    conf            : _this.getInstance(),
                    bundles        : _this.getBundles(),
                    allBundles     : _this.getAllBundles()
                };

                callback(config);
                //_this.isFileInProject(conf[env]["files"]);
            });
        });
    },
    /**
     * Get Instance
     *
     * @param {string} [bundle]
     * @return {object|undefined} configuration|"undefined"
     * */
    getInstance : function (bundle){
        //console.log("Bundle conf ", bundle, this.configuration);

        if ( typeof(bundle) != 'undefined' && typeof(this.configuration) != 'undefined' ) {

            try {
                return this.configuration[bundle][this.Env.get()];

            } catch (err) {
                Log.error('geena', 'CONFIG:ERR:1', err, __stack);
                return undefined;
            }
        } else if ( typeof(this.configuration) != 'undefined' ) {
            return this.configuration;
        } else {
            return undefined;
        }
    },

    /**
     * @class Env Sub class
     *
     *
     * @package     Geena.Config
     * @namespace   Geena.Config.Env
     * @author      Rhinostone <geena@rhinostone.com>
     */
    Env : {
        template : require('./template/conf/env.json'),
        load : function(callback){

            try {

                var envConf = "";

                if (this.parent.userConf) {
                    envConf = this.parent.loadWithTemplate(this.template);
                } else {
                    envConf = this.template;
                }

                this.envConf = envConf;
                //console.log("LOADED envConf ", envConf);
                //Log.warn('geena', 'CONFIG:WARN:10', 'envConf LOADED !!' + envConf);
                callback(true);
            } catch(err) {
                Log.warn('geena', 'CONF:ENV:WARN:1', err, __stack);
                callback(false);
            }
            //console.log("loaded var env", env);
        },
        set : function(env){
            var _this = this, found = false;
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
            console.log("get from ....", appName, env);
            if (typeof(appName) != 'undefined' && typeof(env) != 'undefined')
                return (typeof(this.envConf) != "undefined") ? this.envConf[appName][env] : null
            else
                return (typeof(this.envConf) != "undefined") ? this.envConf : null;
        },
        getDefault : function(){
            return {
                "env" : this.template.defEnv,
                "ext" : this.template.defExt,
                "registeredEnvs" : this.template.registeredEnvs
            };
        }
    },
    /**
     * Host Class
     *
     * @package    Geena.Config
     * @author     Rhinostone <geena@rhinostone.com>
     */
    Host : {
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
        isStandalone : function(conf){
            return this.standaloneMode;
        }
    },
    /**
     * Load config according to specific template
     * @param {String} filename  Path of source config file
     * @param {String} template Path of the template to merge with
     * @return {Oject} JSON of the merged config
     **/
    loadWithTemplate : function(template){

        var _this = this,
            content = this.userConf,
            //if nothing to merge.
            newContent = content;

        var isStandalone = true,
            env = this.Env.get(),
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
        this.bundles.push(this.startingApp);//This is a JSON.push.
        //console.log(" CONTENT TO BE SURE ", JSON.stringify(content, null, 4));
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
                appsPath = appsPath.replace(/\{executionPath\}/g, _this.executionPath);



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
                        "executionPath" : _this.executionPath,
                        "bundlesPath" : appsPath,
                        "modelsPath" : modelsPath,
                        "env" : env,
                        "bundle" : app
                    };

                    newContent = JSON.parse(
                        JSON.stringify(newContent).replace(/\{(\w+)\}/g, function(s, key) {
                            return reps[key] || s;
                        }) );
                    //console.log("result ", newContent[app][env]);
                } else {
                    Log.warn(
                        'geena',
                        'CONFIG:WARN:1',
                        'Server won\'t load [' +app + '] app or apps path does not exists: ' + _(appsPath),
                         __stack
                    );
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
        if (!isStandalone) this.Host.standaloneMode = isStandalone;

        Log.debug(
            'geena',
            'CONFIG:DEBUG:3',
            'Is server running as a standalone instance ? ' + isStandalone,
            __stack
        );

        return newContent;

    },
    isFileInProject : function(file){

        try {
            var usrConf = require(this.executionPath +'/'+ file +'.json');
            return true;
        } catch(err) {
            Log.warn('geena', 'CONF:HOST:WARN:1', err, __stack);
            return false;
        }
    },
    /**
     * Get Registered bundles sharing the same port #
     *
     * @return {array} bundles
     * */
    getBundles : function(){
        //Registered apps only.
        Log.debug(
            'geena',
            'CONFIG:DEBUG:4',
            'Pushing apps ' + JSON.stringify(this.apps, null, '\t'),
            __stack
        );
        return this.bundles;
    },
    getAllBundles : function(){
        //Registered apps only.
        Log.debug(
            'geena',
            'CONFIG:DEBUG:5',
            'Pushing ALL apps ' + JSON.stringify(this.allBundles, null, '\t'),
            __stack
        );
        return this.allBundles;
    },
    /**
     * Load Apps Configuration
     *
     * TODO - simplify / optimize
     * */
    loadBundlesConfiguration : function(){

        if (arguments.length > 1) {
            var bundle = arguments[0];
            var callback = arguments[1];
            var bundles = this.getBundles();
            bundles = bundles.splice(bundles.indexOf(bundle), 1);

        } else {
            var callback = arguments[0];
            var bundle = "", bundles = this.getBundles();
        }

        //Framework.
        var _this       = this,
            name        = "",
            files       = {},
            appPath     = "",
            modelsPath  = "",
            filename    = "",
            tmp         = "",
            env         =  this.Env.get();

        var cacheless = this.isCacheless(), conf = this.configuration;

        //For each bundles.
        for (var i=0; i<bundles.length; ++i) {

            bundle = bundles[i];

            conf[bundle][env].bundles = bundles;
            conf[bundle].cacheless = cacheless;

            appPath = _(conf[bundle][env].bundlesPath + '/' + bundle);
            modelsPath = _(conf[bundle][env].modelsPath);

            for (name in  conf[bundle][env].files) {
                //Server only because of the shared mode VS the standalone mode.
                if (name == 'routing' ) continue;

                if (env != 'prod') {

                    tmp = conf[bundle][env].files[name].replace(/.json/, '.' +env + '.json');
                    //console.log("tmp .. ", tmp);
                    filename = _(appPath + '/config/' + tmp);
                    //Can't do a thing without.
                    if ( Fs.existsSync(filename) ) {
                        //console.log("app conf is ", filename);
                        if (cacheless) delete require.cache[filename];

                        name = name +'_'+env;
                        files[name] = require(filename);
                        //console.log("watch out !!", files[name][bundle]);
                    } else {
                        filename = _(appPath + '/config/' + conf[bundle][env].files[name]);
                    }
                    tmp = "";
                }

                filename = _(appPath + '/config/' + conf[bundle][env].files[name]);

                try {
                    if (cacheless) delete require.cache[filename];

                    files[name] = Utils.extend( true, files[name], require(filename) );
                    //console.log("FILE ", files);
                    //this.configuration[bundle].config = files[name][bundle];

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

        //this.configuration = conf;
        //We always return womething.
        callback(false);
    },
    /**
     * Check is cache is disabled
     *
     * @return {boolean} isUsingCache
     * */
    isCacheless : function(){
        var env = this.Env.get();
        return (env == "dev" || env == "debug") ? true : false;
    },
    refresh : function(bundle, callback){
        this.loadBundlesConfiguration(bundle, function(err){
            if (!err) {
                callback(false);
            } else {
                callback(err);
            }
        });
    }
};

module.exports = Config;