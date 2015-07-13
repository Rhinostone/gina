/*
 * This file is part of the gina package.
 * Copyright (c) 2015 Rhinostone <gina@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */


//Imports.
var fs              = require('fs');
var util            = require('util');
var Events          = require('events');
var EventEmitter    = require('events').EventEmitter;
var utils           = require("./utils");
var merge           = utils.merge;
var inherits        = utils.inherits;
var console         = utils.logger;
var modelUtil       = new utils.Model();


/**
 * @class Config
 *
 *
 * @package     Gina
 * @namespace
 * @author      Rhinostone <gina@rhinostone.com>
 * @api         Public
 *
 * TODO - split Config.Env & Config.Host
 */

function Config(opt) {

    var self = this;
    this.bundles = [];
    this.allBundles = [];

    /**
     * Config Constructor
     * @constructor
     * */
    var init =  function(opt) {

        if ( !Config.initialized) {
            var env = opt.env;

            self.startingApp = opt.startingApp;
            self.executionPath = opt.executionPath;

            self.task = opt.task || 'run'; // to be aible to filter later on non run task

            self.userConf = false;
            var path = _(self.executionPath + '/env.json');

            if ( fs.existsSync(path) ) {

                self.userConf = require(path);
                console.debug('Applicaiton config file loaded ['
                    + _(self.executionPath + '/env.json') + ']');
            }

            self.Env.parent = self;
            if (env != 'undefined') self.Env.set(env);

            self.Host.parent = self;

            //Do some checking please.. like already has a PID ?.
            //if yes, join in case of standalone.. or create a new thread.
            self.Host.setMaster(self.startingApp);

            getConf()
        }
    }

    var getConf = function() {

        console.debug('Loading conf...');

        self.Env.load( function(err, envConf) {

            if ( typeof(self.Env.loaded) == "undefined") {
                //Need to globalize some of them.
                self.env = env;
                self.envConf = envConf;

                loadBundlesConfiguration( function(err, file, routing) {

                    if ( typeof(Config.initialized) == 'undefined' ) {
                        Config.initialized = true;
                        self.isStandalone = self.Host.isStandalone();

                        Config.instance = self
                    }


                    //logger.debug('gina', 'CONFIG:DEBUG:42', 'CONF LOADED 43', __stack);
                    self.bundlesConfiguration = {
                        env             : self.Env.get(),
                        conf            : self.getInstance(),
                        bundles         : self.getBundles(),
                        allBundles      : self.getAllBundles(),
                        isStandalone    : self.Host.isStandalone()
                    };

                    //console.error("found bundles ", self.bundlesConfiguration.bundles);

                    //TODO - Don't override if syntax is ok - no mixed paths.
                    //Set paths for utils. Override for now.
                    //To reset it, just delete the hidden folder.
                    var ginaPath = opt.ginaPath;
                    var utilsConfig = new utils.Config();
                    //setContext('gina.utils.config', utilsConfig);

                    utilsConfig.set('gina', 'locals.json', {
                        project : utilsConfig.getProjectName(),
                        paths : {
                            gina   : ginaPath,
                            utils   : utilsConfig.__dirname,
                            root    : opt.executionPath,
                            env     : opt.executionPath + '/env.json',
                            tmp     : opt.executionPath + '/tmp'
                        },
                        //TODO - Replace property by bundle.
                        bundles : self.bundlesConfiguration.allBundles
                        //envs :
                    }, function(err) {
                        self.Env.loaded = true;
                        self.emit('complete', err, self.bundlesConfiguration)
                    })

                }, self.startingApp);//by default.
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

        self = Config.instance;
        var configuration = self.envConf;
        var env = self.env;

        self.Env.parent = self;
        if (env != 'undefined')
            self.Env.set(self.env);

        self.Host.parent = self;

        //Do some checking please.. like already has a PID ?.
        //if yes, join in case of standalone.. or create a new thread.
        self.Host.setMaster(bundle);
        if ( typeof(bundle) != 'undefined' && typeof(configuration) != 'undefined' ) {

            try {
                return configuration[bundle][self.Env.get()];
            } catch (err) {
                //logger.error('gina', 'CONFIG:ERR:1', err, __stack);
                console.error(err.stack||err.message);
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
     * @package     Gina.Config
     * @namespace   Gina.Config.Env
     * @author      Rhinostone <gina@rhinostone.com>
     */
    this.Env = {
        template : require('./template/conf/env.json'),
        load : function(callback) {
            try {

                var envConf = '';
                //console.error("loading once ", this.parent.userConf);
                //require(this.executionPath + '/env.json');

                if (this.parent.userConf) {

                    loadWithTemplate(this.parent.userConf, this.template, function(err, envConf) {
                        self.envConf = envConf;
                        //logger.warn('gina', 'CONFIG:WARN:10', 'envConf LOADED !!' + JSON.stringify(envConf, null, '\t') );
                        callback(false, envConf);
                    });
                } else {

                    envConf = this.template;
                    self.envConf = envConf;
                    //logger.warn('gina', 'CONFIG:WARN:10', 'envConf LOADED !!' + JSON.stringify(envConf, null, '\t'));
                    callback(false, envConf);
                }

            } catch(err) {
                //logger.warn('gina', 'CONF:ENV:WARN:1', err, __stack);
                console.warn(err.stack||err.message);
                callback(err);
            }
        },

        set : function(env) {
            var found = false;
            //logger.debug('gina', 'CONFIG:ENV:DEBUG:1', 'Setting Env',  __stack);
            //console.debug('Setting Env',  __stack);
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
                    //logger.error('gina', 'CONFIG:ENV:ERR:1', 'Env: ' + env + '] not found');
                    console.error(new Error('Env: ' + env + '] not found'));
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
            if ( typeof(bundle) != 'undefined' && typeof(env) != 'undefined' ) {
                if (!self.isStandalone) {
                    return ( typeof(self.envConf) != "undefined" ) ? self.envConf[bundle][env] : null;
                } else {
                    return ( typeof(self.envConf) != "undefined" ) ? self.envConf[self.startingApp][env] : null;
                }

            } else {
                return ( typeof(self.envConf) != "undefined" ) ? self.envConf : null
            }
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
     * @package    Gina.Config
     * @author     Rhinostone <gina@rhinostone.com>
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
            newContent = JSON.parse( JSON.stringify(content) );

        var isStandalone = true,
            env = self.Env.get(),
            appsPath = "",
            modelsPath = "";


        //Pushing default app first.
        self.bundles.push(self.startingApp);//This is a JSON.push.
        var root = new _(self.executionPath).toUnixStyle();
        try {
            var pkg = require(_(root + '/project.json')).bundles;
        } catch (err) {
            callback(err);
        } //bundlesPath will be default.


        //For each app.
        for (var app in content) {
            //Checking if genuine app.
            console.debug('Checking if application [ '+ app +' ]is registered ');

            if ( typeof(content[app][env]) != "undefined" ) {

                if (
                    pkg[app] != 'undefined' && pkg[app]['src'] != 'undefined' && env == 'dev'
                    || pkg[app] != 'undefined' && pkg[app]['src'] != 'undefined' && env == 'debug'
                ) {
                    var p = _(pkg[app].src);
                    content[app][env]['bundlesPath'] = "{executionPath}/"+ p.replace('/' + app, '');
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

                //console.log("My env ", env, self.executionPath, JSON.stringify(template, null, '\t') );
                //Existing app and port sharing => != standalone.
                if ( !fs.existsSync(appsPath) ) {
                    new _(appsPath).mkdirSync()
                }
                var masterPort = content[self.startingApp][env].port.http;
                //Check if standalone or shared instance
                if (content[app][env].port.http != masterPort) {
                    isStandalone = false;
                    self.Host.standaloneMode = isStandalone
                } else if (app != self.startingApp) {
                    self.bundles.push(app)
                }
                self.allBundles.push(app);

                //Mergin user's & template.
                newContent[app][env] = merge(
                    newContent[app][env],
                    JSON.parse( JSON.stringify(template["{bundle}"]["{env}"]))//only copy of it.
                );


                //Variables replace. Compare with gina/core/template/conf/env.json.
                var version = undefined;
                try {
                    version = require(_(getPath('gina') +'/package.json' )).version
                } catch (err) {
                    console.debug(err.stack)
                }

                var reps = {
                    "executionPath" : root,
                    "bundlesPath" : appsPath,
                    "modelsPath" : modelsPath,
                    "env" : env,
                    "bundle" : app,
                    "version": version
                };


                //console.error("reps ", reps);
                newContent = whisper(reps, newContent);


            }
            //Else not in the scenario.

        }//EO for.


        console.debug('Env configuration loaded \n ' + newContent);

        // TRUE means that all apps sharing the same process will merge into one.
        if (!isStandalone) self.Host.standaloneMode = isStandalone;

        console.debug('Is server running as a standalone instance ? ' + isStandalone);

        callback(false, newContent)
    }

    var isFileInProject = function(file) {

        try {
            var usrConf = require(self.executionPath +'/'+ file +'.json');
            return true
        } catch(err) {
            console.warn('CONF:HOST:WARN:1', err.stack||err.message);
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
        console.debug('Pushing apps ' + JSON.stringify(self.bundles, null, '\t'));
        return self.bundles
    }

    this.getAllBundles = function() {
        //Registered apps only.
        console.debug('Pushing ALL apps ' + JSON.stringify(self.allBundles, null, '\t'));
        return self.allBundles
    }

    /**
     * Get original rule
     *
     * @param {string} rule
     * @param {object} routing
     *
     * @return {string} originalRule
     * */
    this.getOriginalRule = function(rule, routing) {

        var currentRouting  = routing[rule]
            , originalRule  = undefined;

        for (var f in routing) {
            if (
                routing[f].param.action == currentRouting.param.action
                && routing[f].bundle == currentRouting.bundle
                && f != rule
                && new RegExp(f+"$").test(rule)
            ) {
                originalRule = f
            }
        }
        return originalRule
    }

    var loadBundleConfig = function(bundles, b, callback, reload, collectedRules) {

        if ( typeof(bundles[b]) == "undefined") {
            var bundle = self.startingApp
        } else {
            var bundle = bundles[b]
        }
        var cacheless   = self.isCacheless();
        var env         = self.env || self.Env.get();
        if ( typeof(collectedRules) == 'undefined') {
            var collectedRules = {}
        }

        var routing     = {
            //"home": {
            //    "bundle" : "framework",
            //    "url": "/@doc",
            //    "param": {
            //        "action": "doc"
            //    }
            //}
        };

        var standaloneRouting = {};
        var tmp         = '';
        var filename    = '';
        var appPath     = '';
        var err         = false;
        var conf        = self.envConf
            , wroot         = conf[bundle][env].server.webroot
            , localWroot    = null
            , originalRules = []
            , oRuleCount    = 0;
        // standalone setup
        if ( self.Host.isStandalone() && bundle != self.startingApp && wroot == '/') {
            wroot = '/'+ bundle;
            conf[bundle][env].server.webroot = wroot
        }

        conf[bundle][env].bundles = bundles;
        conf[bundle][env].cacheless = cacheless;
        conf[bundle][env].executionPath = getContext("paths").root;


        if ( self.task == 'run' && env != 'dev' ) {
            appPath = _(conf[bundle][env].bundlesPath + '/' + bundle)
        } else { //getting src path instead
            appPath = _(conf[bundle][env].sources + '/' + bundle);
            conf[bundle][env].bundlesPath = conf[bundle][env].sources;
        }


        var files = {"routing": {}};
        var main = '';
        for (var name in  conf[bundle][env].files) {
            main = _(appPath +'/config/'+ conf[bundle][env].files[name]).replace('.'+env, '');

            //Server only because of the shared mode VS the standalone mode.
            if (name == 'routing' && cacheless && typeof(reload) != 'undefined') {
                tmp = conf[bundle][env].files[name].replace(/.json/, '.' +env + '.json');
                filename = _(appPath + '/config/' + tmp);
                if ( !fs.existsSync(filename) ) {
                    filename = main;
                }

                delete require.cache[_(filename, true)];
                try {
                    routing = merge( true, require(_(filename, true)), routing);
                } catch (err) {
                    callback(err)
                }

                if (filename != main) {
                    delete require.cache[_(main, true)];
                    try {
                        routing = merge(true, require(main), routing)
                    } catch (err) {
                        callback(err)
                    }
                }

                tmp = '';

                //setting app param
                for (var rule in routing) {
                    routing[rule].bundle = (routing[rule].bundle) ? routing[rule].bundle : bundle; // for reverse search
                    //webroot control
                    routing[rule].param.file = ( typeof(routing[rule].param.file) != 'undefined' ) ? routing[rule].param.file: rule; // get template file

                    if ( typeof(routing[rule].url) != 'object' ) {
                        // adding / if missing
                        if (routing[rule].url.length > 1 && routing[rule].url.substr(0,1) != '/') {
                            routing[rule].url = '/' + routing[rule].url
                        } else {
                            if (wroot.substr(wroot.length-1,1) == '/') {
                                wroot = wroot.substr(wroot.length-1,1).replace('/', '')
                            }
                        }

                        if (routing[rule].bundle != bundle) { // allowing to override bundle name in routing.json
                            // originalRule is used to facilitate cross bundles (hypertext)linking
                            originalRules[oRuleCount] = ( self.Host.isStandalone() && routing[rule] && bundle != self.startingApp) ? bundle + '-' + rule : rule;
                            ++oRuleCount;

                            localWroot = conf[routing[rule].bundle][env].server.webroot;
                            // standalone setup
                            if ( self.Host.isStandalone() && routing[rule].bundle != self.startingApp && localWroot == '/') {
                                localWroot = '/'+ routing[rule].bundle;
                                conf[routing[rule].bundle][env].server.webroot = localWroot
                            }
                            if (localWroot.substr(localWroot.length-1,1) == '/') {
                                localWroot = localWroot.substr(localWroot.length-1,1).replace('/', '')
                            }

                            routing[rule].url = localWroot + routing[rule].url
                        } else {
                            routing[rule].url = wroot + routing[rule].url
                        }
                    } else {
                        for (var u=0; u<routing[rule].url.length; ++u) {
                            if (routing[rule].url[u].length > 1 && routing[rule].url[u].substr(0,1) != '/') {
                                routing[rule].url[u] = '/' + routing[rule].url[u]
                            //} else if (routing[rule].url.length > 1 && conf[bundle][env].server.webroot.substr(conf[bundle][env].server.webroot.length-1,1) == '/' && routing[rule].url[u] != '/') {
                            //    routing[rule].url[u] = routing[rule].url[u].substr(1)
                            } else {
                                if (wroot.substr(wroot.length-1,1) == '/') {
                                    wroot = wroot.substr(wroot.length-1,1).replace('/', '')
                                }
                            }

                            routing[rule].url[u] =  wroot + routing[rule].url[u]
                        }
                    }

                    if ( self.Host.isStandalone() && routing[rule] && bundle != self.startingApp ) {
                        standaloneRouting[bundle + '-' + rule] = JSON.parse(JSON.stringify(routing[rule]))
                    }
                }

                files[name] = collectedRules = merge(true, collectedRules, ((self.Host.isStandalone() && bundle != self.startingApp ) ? standaloneRouting : routing));
                // originalRule is used to facilitate cross bundles (hypertext)linking
                for (var r = 0, len = originalRules.length; r < len; r++) { // for each rule ( originalRules[r] )
                    files[name][originalRules[r]].originalRule = collectedRules[originalRules[r]].originalRule = (files[name][originalRules[r]].bundle === self.startingApp ) ?  self.getOriginalRule(originalRules[r], files[name]) : self.getOriginalRule(files[name][originalRules[r]].bundle +'-'+ originalRules[r], files[name])
                }
                continue;
            } else if (name == 'routing') {
                continue;
            }


            tmp = conf[bundle][env].files[name].replace(/.json/, '.' +env + '.json');
            filename = _(appPath + '/config/' + tmp);
            if (!fs.existsSync(filename) ) {
                filename = _(appPath +'/config/'+ conf[bundle][env].files[name])
            } else {
                conf[bundle][env].files[name] = tmp
            }

            //Can't do a thing without.
            try {
                if (cacheless) {
                    delete require.cache[_(filename, true)];
                }
                files[name] = require(_(filename, true));
                tmp = '';

                if (filename != main) {
                    if (cacheless) {
                        delete require.cache[_(main, true)];
                    }
                    files[name] = merge(files[name], require(_(main, true)));
                }
            } catch (_err) {

                if ( fs.existsSync(filename) ) {
                    callback( new Error('[ ' +filename + ' ] is malformed !!') )
                } else {
                    files[name] = undefined
                }
            }

        }//EO for (name


        var hasViews = (typeof(files['views']) != 'undefined' && typeof(files['views']['default']) != 'undefined') ? true : false;


        //Set default keys/values for views
        if ( hasViews &&  typeof(files['views'].default.views) == 'undefined' ) {
            files['views'].default.views =  _(appPath +'/views')
        }

        if ( hasViews && typeof(files['views'].default.html) == 'undefined' ) {
            files['views'].default.html =  _(appPath +'/views/html')
        }

        if ( hasViews && typeof(files['views'].default.theme) == 'undefined' ) {
            files['views'].default.theme =  'default_theme'
        }


        //Constants to be exposed in configuration files.
        var reps = {
            "root"          : conf[bundle][env].executionPath,
            "env"           : env,
            "executionPath" : conf[bundle][env].executionPath,
            "bundlesPath"   : conf[bundle][env].bundlesPath,
            "mountPath"     : conf[bundle][env].mountPath,
            "bundlePath"    : conf[bundle][env].bundlePath,
            "modelsPath"    : conf[bundle][env].modelsPath,
            "logsPath"      : conf[bundle][env].logsPath,
            "tmpPath"       : conf[bundle][env].tmpPath,
            "bundle"        : bundle,
            "host"          : conf[bundle][env].host
        };

        if (hasViews && typeof(files['views'].default) != 'undefined') {
            reps['views'] = files['views'].default.views;
            reps['html'] = files['views'].default.html;
            reps['theme'] = files['views'].default.theme;
        }

        var ports = conf[bundle][env].port;
        for (var p in ports) {
            reps[p+'Port'] = ports[p]
        }

        var localEnv = conf[bundle][env].executionPath + '/env.local.json';
        if ( env == 'dev' && fs.existsSync(localEnv) ) {
            //conf[bundle][env] = merge(true, require(localEnv), conf[bundle][env]);
            conf[bundle][env] = merge(true, conf[bundle][env], require(localEnv));
        }
        var envKeys = conf[bundle][env];
        for (var k in envKeys) {
            if ( typeof(envKeys[k]) != 'object' && typeof(envKeys[k]) != 'array' ) {
                reps[k] = envKeys[k]
            }
        }


        try {
            var settingsPath = _(getPath('gina.core') +'/template/conf/settings.json', true);
            var staticsPath = _(getPath('gina.core') +'/template/conf/statics.json', true);
            var viewsPath = _(getPath('gina.core') +'/template/conf/views.json', true);

            if ( typeof(files['settings']) == 'undefined' ) {
                files['settings'] = require(settingsPath)
            } else if ( typeof(files['settings']) != 'undefined' ) {
                var defaultSettings = require(settingsPath);

                files['settings'] = merge(files['settings'], defaultSettings)
            }

            if (fs.existsSync(staticsPath))
                delete require.cache[staticsPath];


            if (hasViews && typeof(files['statics']) == 'undefined') {
                files['statics'] = require(staticsPath)
            } else if ( typeof(files['statics']) != 'undefined' ) {
                var defaultAliases = require(staticsPath);

                files['statics'] = merge(files['statics'], defaultAliases)
            }

            // public root directories
            var d = 0
                , dirs = fs.readdirSync(reps['views'])
                , statics = {};
            // removing html/template directory
            dirs.splice(dirs.indexOf(new _(reps.html, true).toArray().last()), 1);
            // making statics allowed directories
            while ( d < dirs.length) {
                if ( !/^\./.test(dirs[d]) && fs.lstatSync(_(reps.views +'/'+ dirs[d], true)).isDirectory() ) {
                    statics[dirs[d]] = _('{views}/'+dirs[d], true)
                }
                ++d
            }
            files['statics'] = merge(files['statics'], statics);

            if (hasViews && typeof(files['views']) == 'undefined') {
                files['views'] = require(viewsPath)
            } else if ( typeof(files['views']) != 'undefined' ) {
                var defaultViews = require(viewsPath);

                files['views'] = merge(files['views'], defaultViews)
            }
        } catch (err) {
            callback(err)
        }



        //webroot statics
        if (hasViews &&
            conf[bundle][env].server.webroot  != '/' &&
            typeof(files['statics']) != 'undefined'
        ) {
            var newStatics = {}, _wroot = '';
            if (!wroot) {
                _wroot = ( conf[bundle][env].server.webroot.substr(0,1) == '/' ) ?  conf[bundle][env].server.webroot.substr(1) : conf[bundle][env].server.webroot;
            } else {
                _wroot = ( wroot.substr(0,1) == '/' ) ?  wroot.substr(1) : wroot;
            }

            var k;
            for (var i in files['statics']) {
                k = i;
                if ( !(new RegExp(wroot)).test(i) ) {

                    if (i.substr(0, 1) != '/') {
                        i = '/' + i
                    }

                    newStatics[ _wroot + i] = files['statics'][k]
                } else {
                    newStatics[k] = files['statics'][k]
                }
                delete files['statics'][k]
            }
            files['statics'] = JSON.parse( JSON.stringify(newStatics) );
        }

        //webroot javascripts
        if (hasViews &&
            conf[bundle][env].server.webroot  != '/' &&
            typeof(files['views'].default.javascripts) != 'undefined'
        ) {
            for (var i=0; i<files['views'].default.javascripts.length; ++i) {
                if (
                    files['views'].default.javascripts[i].substr(0,1) != '{' &&
                    !/\:\/\//.test(files['views'].default.javascripts[i])
                ) {
                    if (files['views'].default.javascripts[i].substr(0,1) != '/')
                        files['views'].default.javascripts[i] = '/'+files['views'].default.javascripts[i];

                    // support src like:
                    if (/^\/\//.test(files['views'].default.javascripts[i]) )
                        files['views'].default.javascripts[i] = files['views'].default.javascripts[i]
                    else
                        files['views'].default.javascripts[i] = conf[bundle][env].server.webroot + files['views'].default.javascripts[i]
                }
            }
        }
        //webroot stylesheets
        if (hasViews &&
            conf[bundle][env].server.webroot  != '/' &&
            typeof(files['views'].default.stylesheets) != 'undefined'
        ) {
            for (var i=0; i<files['views'].default.stylesheets.length; ++i) {
                if (
                    files['views'].default.stylesheets[i].substr(0,1) != '{' &&
                    !/\:\/\//.test(files['views'].default.stylesheets[i])
                ) {
                    if (files['views'].default.stylesheets[i].substr(0,1) != '/')
                        files['views'].default.stylesheets[i] = '/'+files['views'].default.stylesheets[i];

                    if (/^\/\//.test(files['views'].default.stylesheets[i]) )
                        files['views'].default.stylesheets[i] = files['views'].default.stylesheets[i]
                    else
                        files['views'].default.stylesheets[i] = conf[bundle][env].server.webroot + files['views'].default.stylesheets[i]
                }
            }
        }

        files = whisper(reps, files);

        if ( typeof(conf[bundle][env].content) == 'undefined') {
            conf[bundle][env].content = {}
        }

        conf[bundle][env].content   = files;
        conf[bundle][env].bundle    = bundle;
        conf[bundle][env].env       = env;


        ++b;
        if (b < bundles.length) {
            loadBundleConfig(bundles, b, callback, reload, collectedRules)
        } else {
            if ( !self.Host.isStandalone() ) {
                callback(err, files, collectedRules)
            } else {
                callback(err, files, collectedRules)
            }
        }
    }

    /**
     * Load Apps Configuration
     *
     * TODO - simplify / optimize
     * */
    var loadBundlesConfiguration = function(callback) {
        var bundles = self.getBundles();

        loadBundleConfig(bundles, 0, callback)
    }

    /**
     * Check is cache is disabled
     *
     * @return {boolean} isUsingCache
     * */
    this.isCacheless = function() {
        var env = self.Env.get();//Config.instance.Env.get();
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
        //Reload conf. who likes repetition ?
        loadBundleConfig(
            self.bundles,
            0,
            function doneLoadingBundleConfig(err, files, routing) {
                if (!err) {
                    callback(false, routing)
                } else {
                    callback(err)
                }
            }, true)
    }//EO refresh.

    /**
     * Reloading bundle model
     *
     * @param {string} bundle - bundle name
     * @callback {function} callback
     * @param {boolean} error
     * */
    this.refreshModels = function(bundle, env, callback) {
        var conf = self.envConf[bundle][env]
            //Reload models.
            , modelsPath = _(conf.modelsPath);

        fs.exists(modelsPath, function(exists){
            if (exists) {
                modelUtil.reloadModels(
                    conf,
                    function doneReloadingModel() {
                        callback(false)
                    })
            } else {
                callback(false)
            }
        })
    }

    /**
     * Setting routing for non dev env
     *
     * @param {object} routing
     * */
    this.setRouting = function(bundle, env, routing) {
        self.envConf[bundle][env].content.routing = routing
    }

    if (!opt) {

        this.setBundles = function(bundles) {
            self.bundles = bundles
        }
    } else {

        //Defined before init.
        var env = opt.env, _ready = {err:'not ready', val: null};

        this.env = opt.env;


        this.onReady = function(callback) {
            self.once('complete', function(err, config) {
                callback(err, config)
            })
            return self
        };

        init(opt)
    }

    return this
};

Config = inherits(Config, EventEmitter);
module.exports = Config