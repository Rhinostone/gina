/*
 * This file is part of the geena package.
 * Copyright (c) 2009-2013 Rhinostone <geena@rhinostone.com>
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
 */

var Fs      = require('fs'),
    Utils   = require("geena.utils"),
    Log     = Utils.Logger,
    Config  = {
    apps : [],
    init : function(env, callback){

        Log.debug('geena', 'CONFIG:DEBUG:1', 'Initalizing config', __stack);
        var _this = this;
        this.executionPath = this.parent.executionPath;
        this.startingApp = this.parent.startingApp;

        this.userConf = false;
        if (Fs.existsSync( _(this.executionPath + '/env.json') )) {
            this.userConf = require(this.executionPath + '/env.json');
            Log.debug(
                'geena',
                'CONFIG:DEBUG:5',
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
            var conf = _this.Env.getConf(),
                apps = _this.getApps();
            /**
            for(var apps in confs){

            }*/
            callback(conf, apps);
            //_this.isFileInProject(conf[env]["files"]);
        });
    },
    getInstance : function(){
        var _this = this,
            conf = this.Env.getConf();
        return (typeof(conf) != 'undefined') ? conf : null;
    },
    /**
     * @class Env
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
                Log.warn('geena', 'CONF:ENV:WARN:1', err);
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
            newContent = content;
        var isStandalone = true,
            env = this.Env.get(),
            appsPath = "",
            masterPort = (
                typeof(content) != "undefined" &&
                typeof(content[this.startingApp]) != "undefined" &&
                typeof(content[this.startingApp][env]) != "undefined"
            )
            ? content[this.startingApp][env].port.http
            : template["{appName}"]["{appEnv}"].port.http;

        //Pushing default app first.
        this.apps.push(this.startingApp);//This is a JSON.push
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

            if (typeof(content[app][env]) != "undefined") {

                appsPath = (typeof(content[app][env]['appsPath']) != "undefined")
                        ? this.executionPath + content[app][env].appsPath
                        : this.executionPath + template["{appName}"]["{appEnv}"].appsPath;

                //Existing app and port sharing => != standalone.
                if (Fs.existsSync(appsPath)) {
                    //Check if standalone or shared instance
                    if (app != _this.startingApp && content[app][env].port.http == masterPort) {
                        isStandalone = false;
                        //console.log("PUSHING APPS ", app + "=>" + isStandalone);
                        _this.apps.push(app);
                    }

                    newContent[app][env] = Utils.extend(
                        true,
                        newContent[app][env],
                        template["{appName}"]["{appEnv}"]
                    );

                } else {
                    Log.warn('geena', 'CONFIG:WARN:1', 'Server won\'t load [' +app + '] app or apps path does not exists: ' + _(appsPath));
                }
            }
            //Else not in the scenario.

        }//EO for.
        console.log("YOIUR NEW CONTENT ", newContent);
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
            var usrConf = require(this.parent.executionPath +'/'+ file +'.json');
            return true;
        } catch(err) {
            Log.warn('geena', 'CONF:HOST:WARN:1', err);
            return false;
        }
    },
    getApps : function(){
        //Registered apps only.
        Log.debug(
            'geena',
            'CONFIG:DEBUG:4',
            'Pushing apps ' + JSON.stringify(this.apps, null, '\t'),
            __stack
        );
        return this.apps;
    }

};

module.exports = Config;