 /*
 * This file is part of the gina package.
 * Copyright (c) 2016 Rhinostone <gina@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */


//Imports.
var fs              = require('fs');
var dns             = require('dns');
var util            = require('util');
var Events          = require('events');
var EventEmitter    = require('events').EventEmitter;
var lib             = require('./../lib');
var merge           = lib.merge;
var inherits        = lib.inherits;
var console         = lib.logger;
var Collection      = lib.Collection;
var modelUtil       = new lib.Model();


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
    // framework settings from homedir
    var framework = {
        ports : _( GINA_HOMEDIR +'/ports.json', true),
        portsReverse : _( GINA_HOMEDIR +'/ports.reverse.json', true),
        project : _( GINA_HOMEDIR +'/projects.json', true)
    };

    this.bundles = [];
    this.allBundles = [];

    /**
     * Config Constructor
     * @constructor
     * */
    var init =  function(opt) {
                
        if ( !Config.initialized) {
            var env = opt.env;

            self.projectName    = opt.projectName || getContext('projectName');
            self.startingApp    = opt.startingApp;
            self.executionPath  = opt.executionPath; // project path

            self.task = opt.task || 'run'; // to be aible to filter later on non run task

            self.userConf = false;
            var path = _(self.executionPath + '/env.json');

            if ( fs.existsSync(path) ) {

                self.userConf = require(path);
                console.debug('Application config file loaded [' + path + ']');
            }

            self.Env.parent = self;
            if (env != 'undefined') self.Env.set(env);

            self.Host.parent = self;

            //Do some checking please.. like already has a PID ?.
            //if yes, join in case of standalone.. or create a new thread.
            self.Host.setMaster(opt.startingApp);

            getConf(env)
        } else {
            if (!opt) {
                return Config.instance
            } else {
                return self.getInstance(opt.startingApp)
            }
        }
    }

    var getConf = function(env) {
        
        self.env = env;
        console.debug('[ config ] Loading conf...');

        // framework settings
        var filename = null, content = null;

        for (var file in framework) {

            filename = framework[file];

            if ( self.isCacheless() ) {
                delete require.cache[require.resolve(filename)];
            }

            if (file == 'project') {
                content = require(filename)[self.projectName] // get only related project infos
            } else {
                content = require(filename);
            }

            setContext('gina.'+ file, content)
        }


        self.Env.load( function(err, envConf) {

            if ( typeof(self.Env.loaded) == 'undefined') {
                // Need to globalize some of them.                
                self.envConf = envConf;
                
                loadBundlesConfiguration( function(err, file, routing) {

                    if ( typeof(Config.initialized) == 'undefined' ) {
                        Config.initialized  = true;
                        self.isStandalone   = self.Host.isStandalone();
                        self.bundle         = self.startingApp;
                        Config.instance     = self
                    }


                    //logger.debug('gina', 'CONFIG:DEBUG:42', 'CONF LOADED 43', __stack);
                    self.bundlesConfiguration = {
                        env             : self.Env.get(),
                        version         : self.version,
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
                    var utilsConfig = new lib.Config();

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
                        if (err != null && err != false)
                            console.error('Error found while settings up locals' + err);

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

        if ( typeof(Config.instance) == 'undefined' && typeof(getContext('gina')) != 'undefined' ) {
            Config.instance = merge( self, getContext('gina').config, true );
            self.envConf = Config.instance.envConf
        }

        var configuration = Config.instance.envConf;

        var env = self.env;

        Config.instance.Env.parent = Config.instance;

        if (env != 'undefined')
            Config.instance.Env.set(Config.instance.env);

        Config.instance.Host.parent = Config.instance;

        //Do some checking please.. like already has a PID ?.
        //if yes, join in case of standalone.. or create a new thread.
        Config.instance.Host.setMaster(bundle);

        self = Config.instance;

        if ( typeof(bundle) != 'undefined' && typeof(configuration) != 'undefined' ) {
            try {
                //return configuration[bundle][env];
                return Config.instance || configuration[bundle][env];
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
     * Set server core conf
     *
     * Status Code, Mime Types etc ...
     * */
    this.setServerCoreConf = function(bundle, env, conf) {
        self.envConf[bundle][env].server['coreConfiguration'] = conf
    }

    this.getServerCoreConf = function(bundle, env) {
        try {
            return self.envConf[bundle][env].server['coreConfiguration']
        } catch(err) {
            console.debug('Could not get server core configuration for <'+ bundle +'>:<'+ env +'>');
            console.error(err.stack||err.message);
            process.exit(1)
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
            loadWithTemplate(this.parent.userConf, this.template, function(err, envConf) {
                self.envConf = envConf;
                callback(false, envConf);
            });
        },

        set : function(env) {
            this.current = env || this.template.defEnv;
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
         *
         * @param {string} bundle
         * @param {string} env
         *
         * @return {Object} json conf
         **/
        getConf : function(bundle, env) {

            if ( !self.isStandalone ) {
                if ( !bundle && typeof(self.bundle) != 'undefined' ) {
                    var bundle = self.bundle
                }
                
                                
                return ( typeof(self.envConf) != 'undefined' ) ? self.envConf[bundle][env]  : null;
                
            } else {

                if (!bundle) { // if getContext().bundle is lost .. eg.: worker context
                    var model       = (arguments.length == 1) ? bundle : model
                        , file      = ( !/node_modules/.test(__stack[1].getFileName()) ) ?  __stack[1].getFileName() : __stack[2].getFileName()
                        , a         = file.replace('.js', '').split('/')
                        , i         = a.length-1
                        , bundles   = getContext('gina').config.bundles
                        , index     = 0;

                    for (; i >= 0; --i) {
                        index = bundles.indexOf(a[i]);
                        if ( index > -1 ) {
                            bundle = bundles[index];
                            break
                        }
                    }
                }


                if ( typeof(self.envConf) != 'undefined' ) {
                    
                    var protocol    = self.envConf[self.startingApp][env].content.settings.server.protocol || self.envConf[self.startingApp][env].server.protocol;
                    var scheme      = self.envConf[self.startingApp][env].content.settings.server.scheme || self.envConf[self.startingApp][env].server.scheme;
                    
                    self.envConf[self.startingApp][env].hostname = scheme + '://' + self.envConf[self.startingApp][env].host + ':' + self.envConf[self.startingApp][env].server.port;

                    self.envConf[bundle][env].hostname = self.envConf[self.startingApp][env].hostname;
                    self.envConf[bundle][env].content.routing = self.envConf[self.startingApp][env].content.routing;

                    if ( bundle && env ) {
                        return self.envConf[bundle][env]
                    } else if ( bundle && !env ) {
                        return self.envConf[bundle]
                    } else {
                        return self.envConf
                    }
                }

                return null
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
        standaloneMode : self.isStandalone || true,
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

        var content     = userConf,
            //if nothing to merge.
            newContent = JSON.parse( JSON.stringify(content) );

        var isStandalone    = true,
            masterPort      = null,
            appPort         = null,
            env             = self.Env.get(),
            appsPath        = '',
            modelsPath      = '',
            ctx             = getContext('gina'),
            projectConf     = ctx.project,
            portsReverse    = ctx.portsReverse;

        
        //Pushing default app first.        
        self.bundles.push(self.startingApp);//This is a JSON.push.
        var root = new _(self.executionPath).toUnixStyle();
        try {
            var pkg     = require(_(root + '/project.json')).bundles;
            // by default but may be overriden
            masterPort = portsReverse[self.startingApp+'@'+self.projectName][env][projectConf.def_protocol][projectConf.def_scheme]
        } catch (err) {
            console.error(err.stack);

            callback(err);
        } //bundlesPath will be default.


        //For each app.
        var bundleSettings = null
            , bundHasSettings = true
            , bundlesPath   = getPath('bundles')
            , protocol      = null
            , scheme        = null;
            
        for (var app in content) {
            //Checking if genuine app.
            console.debug('Checking if application [ '+ app +' ] is registered ');

            if ( typeof(content[app][env]) != "undefined" ) {
                
                if ( !fs.existsSync(_(bundlesPath +'/'+ app +'/config/settings.json'))) {
                    bundHasSettings = false
                } else {
                    bundleSettings = requireJSON(_(bundlesPath +'/'+ app +'/config/settings.json'));
                }
                
                
                
                // setting protocol & port
                if ( typeof(portsReverse[app+'@'+self.projectName]) == 'undefined' )
                    continue;

                if (
                    pkg[app] != 'undefined' && pkg[app]['src'] != 'undefined' && GINA_ENV_IS_DEV
                ) {
                    var p = _(pkg[app].src);
                    content[app][env]['bundlesPath'] = "{executionPath}/"+ p.replace('/' + app, '');
                } else {
                    var p = ( typeof(pkg[app].release.link) != 'undefined' ) ? _(pkg[app].release.link) : _(pkg[app].release.target);
                    content[app][env]['bundlesPath'] = "{executionPath}/"+ p.replace('/' + app, '');
                }

                appsPath = (typeof(content[app][env]['bundlesPath']) != 'undefined')
                    ? content[app][env].bundlesPath
                    : template["{bundle}"]["{env}"].bundlesPath;



                modelsPath = (typeof(content[app][env]['modelsPath']) != 'undefined')
                    ?  content[app][env].modelsPath
                    :  template["{bundle}"]["{env}"].modelsPath;

           
                
                if ( typeof(content[app][env].server ) != 'undefined' ) {
                    newContent[app][env].server = content[app][env].server;
                    
                } else if ( bundHasSettings && typeof(bundleSettings.server) != 'undefined') {
                    newContent[app][env].server = bundleSettings.server;
                } else {
                    newContent[app][env].server = template["{bundle}"]["{env}"].server
                }
                
                // getting server protocol: bundle's settings first, if not available ->W project's config
                // If the users has set a different protocol in its /config/settings.json, it will override the project protocol
                // at server init (see server.js) 
                
                // by default
                if ( typeof(newContent[app][env].server.protocol) == 'undefined' ) {
                    newContent[app][env].server.protocol = ( bundHasSettings && typeof(bundleSettings.server) != 'undefined' && typeof(bundleSettings.server.protocol) != 'undefined' ) ? bundleSettings.server.protocol : projectConf.def_protocol; // from ~/.gina/projects.json
                    newContent[app][env].server.protocolShort = newContent[app][env].server.protocol.split(/\./)[0];
                }
                
                if ( typeof(newContent[app][env].server.scheme) == 'undefined' ) {
                    newContent[app][env].server.scheme = ( bundHasSettings && typeof(bundleSettings.server) != 'undefined' && typeof(bundleSettings.server.scheme) != 'undefined' ) ? bundleSettings.server.scheme : projectConf.def_scheme; // from ~/.gina/projects.json
                }
                
                // getting server port
                if ( typeof (newContent[app][env].port) == 'undefined' ) {
                    newContent[app][env].port = {}
                }
                
                if ( typeof (newContent[app][env].port[ newContent[app][env].server.protocol ]) == 'undefined' ) {
                    newContent[app][env].port[ newContent[app][env].server.protocol ] = {}
                }
                
                if ( typeof (newContent[app][env].port[ newContent[app][env].server.protocol ][ newContent[app][env].server.scheme ]) == 'undefined' ) {
                    newContent[app][env].port[ newContent[app][env].server.protocol ][ newContent[app][env].server.scheme ] = {}
                }
                
                newContent[app][env].server.port = portsReverse[ app +'@'+ self.projectName ][env][projectConf.def_protocol][projectConf.def_scheme];
                try {
                    appPort = portsReverse[app+'@'+self.projectName][env][ newContent[app][env].server.protocol ][ newContent[app][env].server.scheme ];
                } catch (err) {
                    console.emerg('[ config ][ settings.server.protocol ] Protocol or scheme settings inconsistency found in `'+ app +'/config/settings`. To fix this, try to run `gina project:import @'+ self.projectName +' --path='+  projectConf.path +'`\n\r'+ err.stack);
                    process.exit(1)
                }
                //I had to for this one...
                appsPath = appsPath.replace(/\{executionPath\}/g, root);
                //modelsPath = modelsPath.replace(/\{executionPath\}/g, mPath);

                //console.log("My env ", env, self.executionPath, JSON.stringify(template, null, '\t') );
                //Existing app and port sharing => != standalone.
                if ( !fs.existsSync(appsPath) ) {
                    new _(appsPath).mkdirSync()
                }


                newContent[app][env].port[ newContent[app][env].server.protocol ][ newContent[app][env].server.scheme ] = appPort;
                
                

                //Check if standalone or shared instance
                if (appPort != masterPort) {
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
                var version = undefined, middleware = undefined;
                try {
                    self.version    = version = require(_(getPath('gina').root +'/package.json' )).version;
                    self.middleware = middleware = fs.readFileSync(_(getPath('gina').root + '/MIDDLEWARE')).toString() || 'none';

                    setContext('gina.version', version);
                    setContext('gina.middleware', middleware);

                } catch (err) {
                    console.debug(err.stack)
                }

                var reps = {
                    "frameworkDir"  : GINA_FRAMEWORK_DIR,
                    "executionPath" : root,
                    "bundlesPath" : appsPath,
                    "modelsPath" : modelsPath,
                    "env" : env,
                    "bundle" : app,
                    "version" : version
                };


                //console.error("reps ", reps);
                newContent = whisper(reps, newContent);


            }
            //Else not in the scenario.

        }//EO for.


        console.debug('[ '+ app +' ] [ '+ env +' ] Env configuration loaded \n');

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
        return self.bundles
    }

    this.getAllBundles = function() {
        //Registered apps only.
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

        var currentRouting  = routing[rule];

        for (var f in routing) {
            if (
                routing[f].param.action == currentRouting.param.action
                && routing[f].bundle == currentRouting.bundle
                && f != rule
                && new RegExp(f+"$").test(rule)
            ) {
                return f
            }
        }
        return undefined
    }

    var parseFileConf = function(root, arr, obj, len, i, content) {


        var key = arr[i];
        if (/\-/.test(key)) {
            key = key.replace(/-([a-z])/g, function(g) { return g[1].toUpperCase(); })
        }

        if (i == len - 1) { // end
            if (!obj.hasOwnProperty(key)) {
                obj[key] = content;
            } else { // overiding exiting
                obj[key] = merge(content, obj[key]);
            }
            return root
        }

        if (typeof (obj[key]) == 'undefined') {

            obj[key] = {};
            ++i;

            return parseFileConf(root, arr, obj[key], len, i, content);
        }


        for (var k in obj) {

            if (k == key) {
                ++i;
                return parseFileConf(root, arr, obj[key], len, i, content);
            }
        }
    }

    var loadBundleConfig = function(bundles, b, callback, reload, collectedRules) {
        
        // current bundle
        var bundle = null;
        if ( typeof(bundles[b]) == 'undefined' ) {
            bundle = self.startingApp
        } else {
            bundle = bundles[b]
        }
        
        // environment
        var cacheless       = self.isCacheless()
            , standalone    = self.Host.isStandalone()
            , env           = self.env || self.Env.get() // env
            , conf          = self.envConf // env conf
        ;
        console.debug('[ CONFIG ] loading `'+ bundle +'/'+ env +'` configuration, please wait ...');
        
        // bundle paths, ports, protocols
        var appPath         = ''
            , appPort       = null
            , masterPort    = null
            , portsReverse  = getContext('gina').portsReverse
            , exists        = false
            , protocol      = null
            , scheme        = null
        ;
        

        conf[bundle][env].projectName   = getContext('projectName');
        conf[bundle][env].allBundles    = bundles;
        conf[bundle][env].cacheless     = cacheless;
        conf[bundle][env].standalone    = standalone;
        conf[bundle][env].executionPath = getContext('paths').root;
                       
        if ( self.task == 'run' && !GINA_ENV_IS_DEV ) {
            appPath = _(conf[bundle][env].bundlesPath + '/' + bundle)
        } else { //getting src path instead
            appPath = _(conf[bundle][env].sources + '/' + bundle);
            conf[bundle][env].bundlesPath = conf[bundle][env].sources;
        }        
        
            
        // bundle web root
        var wroot                   = ( !conf[bundle][env].server.webroot || conf[bundle][env].server.webroot == '' ) ? '/' : conf[bundle][env].server.webroot            
            , webrootAutoredirect   = conf[bundle][env].server.webrootAutoredirect
            , localWroot            = null
            , localHasWebRoot       = null
        ;
        // formating wroot to have /mywebroot/
        wroot = ( !/^\//.test(wroot) ) ? '/' + wroot : wroot;
        wroot = ( !/\/$/.test(wroot) ) ? wroot + '/' : wroot;
        
        // standalone setup
        if ( standalone && bundle != self.startingApp && wroot == '/') {
            wroot += bundle + '/';            
        }
        conf[bundle][env].server.webroot = wroot;
        var hasWebRoot = (wroot.length >1) ? true : false;
        
        // bundle routing
        if ( typeof(collectedRules) == 'undefined') {
            var collectedRules = {}
        }
        var standaloneRouting   = {}
            , originalRules     = []
            , oRuleCount        = 0
            , routing           = {}
            , reverseRouting    = {}
        ;
        
        
        var tmp                     = ''
            , err                   = false
            // template file
            , file                  = null
            , filename              = null
            // files to be ignored while parsing config dir
            , defaultConfigFiles    = (conf[bundle][env].files.join(".json,") + '.json').split(',')            
        ;
  
        
        var fName       = null, fNameWithNoExt = null;
        var files       = { "routing": {} }, filesList = {};
        var main        = '';
        var name        = null;
        
        var fileContent = null
            , nameArr   = null
            , foundDevVersion = null
        ;
            
        // getting bunddle config files    
        var configFiles = fs.readdirSync(_(appPath + '/config'))
            , c         = 0
            , cLen      = configFiles.length
        ;
        for (; c < cLen; ++c) {

            foundDevVersion = false;

            fName = configFiles[c];
            if (/^\./.test(fName) || /\.dev\.json$/.test(fName) || !/\.json$/.test(fName)  )
                continue;

            name            = fName.replace(/\.json$/, '');
            fNameWithNoExt  = fName.replace(/.json/, '');


            if (/\-/.test(name)) {
                name = name.replace(/-([a-z])/g, function(g) { return g[1].toUpperCase(); })
            }

            filesList[name] = fName;

            // handle registered config files
            main = fName;
            tmp = fName.replace(/.json/, '.' + env + '.json'); // dev


            files[name] = ( typeof(files[name]) != 'undefined' ) ? files[name] : {};
            fileContent = files[name];

            // loading dev if exists
            if (GINA_ENV_IS_DEV) {
                filename = _(appPath + '/config/' + tmp);
                try {
                    exists = fs.existsSync(_(filename, true));
                    if (cacheless && exists) {
                        delete require.cache[require.resolve(_(filename, true))];
                    }

                    if (exists) {
                        foundDevVersion = true;
                        fileContent = merge(require(_(filename, true)), fileContent);
                    }

                } catch (_err) {

                    if (fs.existsSync(filename)) {
                        callback(new Error('[ ' + filename + ' ] is malformed !!'))
                    } else {
                        fileContent = undefined
                    }
                }
            }


            // loading main
            filename = _(appPath + '/config/' + main);
            //Can't do anything without.
            try {
                exists = fs.existsSync(_(filename, true));
                if (cacheless && exists) {
                    delete require.cache[require.resolve(_(filename, true))];
                }

                if (exists) {                    
                    fileContent = merge(fileContent, requireJSON(_(filename, true)));
                } else {
                    console.warn('[ ' + app + ' ] [ ' + env + ' ]' + new Error('[ ' + filename + ' ] not found'));
                }
            } catch (_err) {

                if (fs.existsSync(filename)) {
                    var e = '[ ' + filename + ' ] is malformed !!\n\r' + (_err.stack || _err.message);
                    console.error(e);
                    callback(new Error(e))
                } else {
                    fileContent = undefined
                }
            }

            if (/\./.test(fNameWithNoExt)) {
                nameArr = fNameWithNoExt.split(/\./g);
                if ( typeof(files[nameArr[0]]) == 'undefined')
                    files[nameArr[0]] = {};
                
                files = parseFileConf(files, nameArr, files, nameArr.length, 0, fileContent);
                continue;
            } else {
                files[name] = fileContent;
            }

        } // EO for (var c = 0, cLen = configFiles.length; c < cLen; ++c)


        // building file list
        conf[bundle][env].configFiles = filesList;

        name = 'routing';
        routing = files[name];
        //Server only because of the shared mode VS the standalone mode.
        if (cacheless && typeof (reload) != 'undefined') {
                        
            //setting app param
            var r = null, rLen = null;
            for (var rule in routing) {
                routing[rule +'@'+ bundle] = routing[rule];
                delete routing[rule];
                
                file        = rule;
                rule        = rule +'@'+ bundle;
                
                localWroot  = webroot; // by default   
                      
                if ( routing[rule].bundle != bundle ) {
                    localWroot  = conf[routing[rule].bundle][env].server.webroot;
                    // formating localWroot to have /mywebroot/
                    localWroot  = ( !/^\//.test(localWroot) ) ? '/' + localWroot : localWroot;
                    localWroot  = ( !/\/$/.test(localWroot) ) ? localWroot + '/' : localWroot;  
                     
                    // standalone setup
                    if ( standalone && bundle != self.startingApp && localWroot == '/') {
                        localWroot += bundle + '/';            
                    }
                     
                    conf[routing[rule].bundle][env].server.webroot = localWroot               
                }
                localHasWebRoot = (localWroot.length >1) ? true : false;       
               

                routing[rule].bundle = (routing[rule].bundle) ? routing[rule].bundle : bundle; // for reverse lookup
                // route file
                routing[rule].param.file = ( typeof(routing[rule].param.file) != 'undefined' ) ? routing[rule].param.file: file; // get template file

                // by default, method is inherited from the request.method
                if (
                    localHasWebRoot && typeof(routing[rule].param.path) != 'undefined' && typeof(routing[rule].param.ignoreWebRoot) == 'undefined'
                    || localHasWebRoot && typeof(routing[rule].param.path) != 'undefined' && !routing[rule].param.ignoreWebRoot
                ) {
                    routing[rule].param.path = localWroot + ( /^\//.test(routing[rule].param.path) ) ? routing[rule].param.path.substr(1) : routing[rule].param.path
                }

                if ( /string/.test( typeof(routing[rule].url) ) ) {
                    
                    if ( !routing[rule].url.length ) {// adding localWroot if url is missing
                        routing[rule].url = localWroot
                    } else {
                        routing[rule].url = ( /^\//.test(routing[rule].url) ) ? routing[rule].url.substr(1) : routing[rule].url
                    }
                    // ignoreWebRoot test
                    if ( typeof(routing[rule].param.ignoreWebRoot) == 'undefined' || !routing[rule].param.ignoreWebRoot ) {
                        routing[rule].url = (routing[rule].url.length > 1) ? localWroot + routing[rule].url : routing[rule].url
                    }
                        
                    if (routing[rule].bundle != bundle) { // allowing to override bundle name in routing.json
                        // originalRule is used to facilitate cross bundles (hypertext)linking
                        originalRules[oRuleCount] = ( standalone && routing[rule] && bundle != self.startingApp) ? bundle + '-' + rule : rule;
                        ++oRuleCount;

                        // if ( typeof(routing[rule].param.ignoreWebRoot) == 'undefined' || !routing[rule].param.ignoreWebRoot )
                        //     routing[rule].url = localWroot + routing[rule].url
                        // standalone setup
                        // if ( standalone && routing[rule].bundle != self.startingApp && localWroot == '/') {
                        //     localWroot = '/'+ routing[rule].bundle;
                        //     conf[routing[rule].bundle][env].server.webroot = localWroot
                        // }
                        // if (localWroot.substr(localWroot.length-1,1) == '/') {
                        //     localWroot = localWroot.substr(localWroot.length-1,1).replace('/', '')
                        // }
                        // if ( typeof(routing[rule].param.ignoreWebRoot) == 'undefined' || !routing[rule].param.ignoreWebRoot )
                        //     routing[rule].url = localWroot + routing[rule].url
                    }/** else {
                        if ( typeof(routing[rule].param.ignoreWebRoot) == 'undefined' || !routing[rule].param.ignoreWebRoot )
                            routing[rule].url = wroot + routing[rule].url
                        else if (!routing[rule].url.length)
                            routing[rule].url += '/'
                    }*/

                } else {
                    r = 0;
                    rLen = routing[rule].url.length;
                    for (; r < rLen; ++r) {
                        if (routing[rule].url[r].length > 1 && routing[rule].url[r].substr(0,1) != '/') {
                            routing[rule].url[r] = '/' + routing[rule].url[r]
                        } else {
                            if (localWroot.substr(localWroot.length-1,1) == '/') {
                                localWroot = localWroot.substr(localWroot.length-1,1).replace('/', '')
                            }
                        }

                        if ( typeof(routing[rule].param.ignoreWebRoot) == 'undefined' || !routing[rule].param.ignoreWebRoot ) {
                            routing[rule].url[r] = localWroot + routing[rule].url[r]
                        } else if (!routing[rule].url.length) {
                            routing[rule].url += '/'
                        }
                    }
                }
            }

            files[name] = collectedRules = merge(collectedRules, ((standalone && bundle != self.startingApp ) ? standaloneRouting : routing), true);

            // originalRule is used to facilitate cross bundles (hypertext)linking
            r = 0;
            rLen = originalRules.length;
            for (; r < rLen; ++r) { // for each rule ( originalRules[r] )
                files[name][originalRules[r]].originalRule = collectedRules[originalRules[r]].originalRule = (files[name][originalRules[r]].bundle === self.startingApp ) ?  self.getOriginalRule(originalRules[r], files[name]) : self.getOriginalRule(files[name][originalRules[r]].bundle +'-'+ originalRules[r], files[name])
            }
            // creating rule for auto redirect: / => /webroot
            if (localHasWebRoot && webrootAutoredirect) {
                files[name]["@webroot"] = {
                    url: "/",
                    param: {
                        action: "redirect",
                        path: wroot,
                        code: 302
                    },
                    bundle: (files[name].bundle) ? files[name].bundle : bundle
                }
            }

            self.setRouting(bundle, env, files[name]);
            // reverse routing
            for (var rule in files[name]) {
                if ( typeof(files[name][rule].url) != 'object' ) {
                    reverseRouting[files[name][rule].url] = rule
                } else {
                    r = 0;
                    rLen = files[name][rule].url.length;
                    for (; r < rLen; ++u) {
                        reverseRouting[files[name][rule].url[r]] = rule
                    }
                }
            }
            self.setReverseRouting(bundle, env, reverseRouting);            
        }




        var hasViews = (typeof(files['templates']) != 'undefined' && typeof(files['templates']['_common']) != 'undefined') ? true : false;

        // e.g.: 404 rendering for JSON APIs by checking `env.template`: JSON response can be forced even if the bundle has views
        if ( hasViews && typeof(self.userConf[bundle][env].template) != 'undefined' && self.userConf[bundle][env].template == false) {
            conf[bundle][env].template = false
        } else if (hasViews) {
            conf[bundle][env].template = true;
        }

               

        //Constants to be exposed in configuration files.
        var reps = {
            "gina"          : getPath('gina').root,
            "frameworkDir"  : GINA_FRAMEWORK_DIR,
            "root"          : conf[bundle][env].executionPath,
            "env"           : env,
            "project"       : getPath('project'),
            "executionPath" : conf[bundle][env].executionPath,
            "bundlesPath"   : conf[bundle][env].bundlesPath,
            "mountPath"     : conf[bundle][env].mountPath,
            "bundlePath"    : conf[bundle][env].bundlePath,
            "templatesPath" : conf[bundle][env].templatesPath,
            "publicPath"    : conf[bundle][env].publicPath,
            "modelsPath"    : conf[bundle][env].modelsPath,
            "logsPath"      : conf[bundle][env].logsPath,
            "tmpPath"       : conf[bundle][env].tmpPath,
            "bundle"        : bundle,
            //"host"          : conf[bundle][env].host,
            "version"       : getContext('gina').version
        };
        
        var corePath = getPath('gina').core;            
        var settingsPath = _(corePath +'/template/conf/settings.json', true);
        var staticsPath = _(corePath +'/template/conf/statics.json', true);
        var viewsPath = _(corePath +'/template/conf/templates.json', true);
        
        var defaultTemplateConf = requireJSON(viewsPath);
        if (hasViews && typeof(files['templates']._common) != 'undefined') {
            reps['templates']   = files['templates']._common.templates || defaultTemplateConf._common.templates;            
            reps['html']        = files['templates']._common.html || defaultTemplateConf._common.html;
            reps['theme']       = files['templates']._common.theme || defaultTemplateConf._common.theme;            
        }

        var ports = conf[bundle][env].port;
        for (var p in ports) {
            reps[p+'Port'] = ports[p]
        }

        var localEnv = conf[bundle][env].executionPath + '/env.local.json';
        if ( GINA_ENV_IS_DEV && fs.existsSync(localEnv) ) {
            conf[bundle][env] = merge(conf[bundle][env], require(localEnv), true);
        }
        var envKeys = conf[bundle][env];
        for (var k in envKeys) {
            if ( typeof(envKeys[k]) != 'object' && typeof(envKeys[k]) != 'array' ) {
                reps[k] = envKeys[k]
            }
        }


        try {                        

            if ( typeof(files['settings']) == 'undefined' ) {
                files['settings'] = requireJSON(settingsPath)
            } else if ( typeof(files['settings']) != 'undefined' ) {
                var defaultSettings = requireJSON(settingsPath);

                files['settings'] = merge(files['settings'], defaultSettings)
            }

            if (fs.existsSync(staticsPath))
                delete require.cache[require.resolve(staticsPath)];


            if (hasViews && typeof(files['statics']) == 'undefined') {
                files['statics'] = requireJSON(staticsPath)
            } else if ( typeof(files['statics']) != 'undefined' ) {
                var defaultAliases = requireJSON(staticsPath);

                files['statics'] = merge(files['statics'], defaultAliases)
            }
           
            
            // public resources ref
            if ( typeof(conf[bundle][env].publicResources) == 'undefined') {
                conf[bundle][env].publicResources = []
            }
            // static resources 
            if ( typeof(conf[bundle][env].staticResources) == 'undefined') {
                conf[bundle][env].staticResources = []
            }
            
            // templates root directories
            var d           = 0
                , dirs      = null
                , pCount    = 0
                , sCount    = 0
            ;
            if (conf[bundle][env].publicPath && fs.existsSync(conf[bundle][env].publicPath) ) {
                var publicResources = []
                    , lStat = null
                ;
                
                d = 0;
                dirs = fs.readdirSync(conf[bundle][env].publicPath);
                // ignoring html (template files) directory
                //dirs.splice(dirs.indexOf(new _(reps.html, true).toArray().last()), 1);
                // making statics allowed directories
                while ( d < dirs.length) {
                    lStat = fs.lstatSync(_(conf[bundle][env].publicPath +'/'+ dirs[d], true));
                    if ( !/^\./.test(dirs[d]) && lStat.isDirectory() ) {
                        publicResources[pCount] = '/'+ dirs[d] +'/';
                        ++pCount
                    } else if ( !/^\./.test(dirs[d]) && lStat.isFile() ) {
                        publicResources[pCount] = '/'+ dirs[d];
                        ++pCount
                    }
                    ++d
                }

                // if (hasWebRoot) {
                //     var wrootKey = wroot.substr(1);
                //     for (var p in files['statics']) {
                //         files['statics'][wrootKey +'/'+ p] = files['statics'][p]
                //     }
                // }

                //files['statics'] = merge(files['statics'], statics);
                
                conf[bundle][env].publicResources = publicResources
            } else {
                console.warn('no public dir to scan...')
            }


            if (hasViews && typeof(files['templates']) == 'undefined') {
                files['templates'] = requireJSON(viewsPath)
            }
            
            if ( typeof(files['templates']) != 'undefined' ) {
                
                var defaultViews = requireJSON(viewsPath);
                
                var css     = {
                        name    : '',
                        media   : 'screen',
                        rel     : 'stylesheet',
                        type    : 'text/css',
                        url     : '',
                        isCommon : false,
                    },
                    js      = {
                        name    : '',
                        type    : 'text/javascript',
                        url     : ''
                    }
                ;
                
                var excluded            = {}
                    , excludedType      = null
                    , excludedStr       = null
                    , currentCollection = null
                    , noneDefaultJs     = null
                    , noneDefaultCss    = null
                ;
                var t       = null
                    , tLen  = null
                    , tTmp  = null
                    , url   = null
                ;                   
                for (var section in files['templates']) {
                                                            
                    // updating javascripts & css order                        
                    noneDefaultJs   = (files['templates'][section].javascripts) ? JSON.parse(JSON.stringify(files['templates'][section].javascripts)) : [];  
                    noneDefaultCss  = (files['templates'][section].stylesheets) ? JSON.parse(JSON.stringify(files['templates'][section].stylesheets)) : [];                                       
                    
                    if ( Array.isArray(noneDefaultJs) && noneDefaultJs.length > 0 && typeof(noneDefaultJs[0].url) == 'undefined' ) {
                        tTmp    = JSON.parse(JSON.stringify(noneDefaultJs));
                        t       = 0;
                        tLen    = tTmp.length;
                        noneDefaultJs = [];
                        for (; t < tLen; ++t) {
                            noneDefaultJs[t]        = JSON.parse(JSON.stringify(js));
                            url                     = tTmp[t];                               
                            noneDefaultJs[t].url    = url;                                
                            noneDefaultJs[t].name   = url.substring(url.lastIndexOf('/')+1, url.lastIndexOf('.')).replace(/\W+/g, '-');                            
                        }                
                    }
                    if ( /^_common$/.test(section) ) {
                        noneDefaultJs = merge.setKeyComparison('url')(defaultViews._common.javascripts, noneDefaultJs);    
                    } else {
                        noneDefaultJs = merge.setKeyComparison('url')(files['templates']._common.javascripts, noneDefaultJs);
                    }
                    
                    // checking js names
                    t = 0;
                    tLen = noneDefaultJs.length;
                    for (; t < tLen; ++t) {
                        url = noneDefaultJs[t].url;
                        if ( typeof(noneDefaultJs[t].name) == 'undefined' || noneDefaultJs[t].name == '' ) {                                
                            noneDefaultJs[t].name = url.substring(url.lastIndexOf('/')+1, url.lastIndexOf('.')).replace(/\W+/g, '-');                                
                        }
                        // support src like:
                        if ( !/^\/\//.test(noneDefaultJs.url) ) {
                            noneDefaultJs[t].url = conf[bundle][env].server.webroot + ( ( /^\//.test(noneDefaultJs[t].url) ) ? noneDefaultJs[t].url.substr(1) : noneDefaultJs[t].url )
                        } 
                        noneDefaultJs[t].type  = ( typeof(noneDefaultJs[t].type) != 'undefined' ) ? noneDefaultJs[t].type : js.type;
                    }
                    
                    
                    if ( Array.isArray(noneDefaultCss) && noneDefaultCss.length > 0 && typeof(noneDefaultCss[0].url) == 'undefined' ) {
                        tTmp    = JSON.parse(JSON.stringify(noneDefaultCss));
                        t       = 0;
                        tLen    = tTmp.length;
                        noneDefaultCss = [];
                        for (; t < tLen; ++t) {
                            noneDefaultCss[t]       = JSON.parse(JSON.stringify(css));
                            url                     = tTmp[t];                               
                            noneDefaultCss[t].url  = url;                                
                            noneDefaultCss[t].name = url.substring(url.lastIndexOf('/')+1, url.lastIndexOf('.')).replace(/\W+/g, '-');
                            noneDefaultCss[t].isCommon = ( /^_common$/.test(section) ) ? true : false;
                        }                
                    }
                    
                    if ( /^_common$/.test(section) ) {
                        noneDefaultCss = merge.setKeyComparison('url')(defaultViews._common.stylesheets, noneDefaultCss);
                    } else {
                        noneDefaultCss = merge.setKeyComparison('url')(files['templates']._common.stylesheets, noneDefaultCss);
                    }
                    
                    // checking css names
                    t = 0;
                    tLen = noneDefaultCss.length;
                    for (; t < tLen; ++t) {
                        url = noneDefaultCss[t].url;
                        if ( typeof(noneDefaultCss[t].name) == 'undefined' || noneDefaultCss[t].name == '' ) {                                
                            noneDefaultCss[t].name = url.substring(url.lastIndexOf('/')+1, url.lastIndexOf('.')).replace(/\W+/g, '-');                                
                        }
                        // support src like:
                        if ( !/^\/\//.test(noneDefaultCss.url) ) {
                            noneDefaultCss[t].url = conf[bundle][env].server.webroot + ( ( /^\//.test(noneDefaultCss[t].url) ) ? noneDefaultCss[t].url.substr(1) : noneDefaultCss[t].url )
                        } 
                        
                        noneDefaultCss[t].rel   = ( typeof(noneDefaultCss[t].rel) != 'undefined' ) ? noneDefaultCss[t].rel : css.rel;
                        noneDefaultCss[t].type  = ( typeof(noneDefaultCss[t].type) != 'undefined' ) ? noneDefaultCss[t].type : css.type;
                        noneDefaultCss[t].isCommon = ( typeof(noneDefaultCss[t].isCommon) != 'undefined' ) ? noneDefaultCss[t].isCommon : ( ( /^_common$/.test(section) ) ? true : false );
                    }
                    
                    files['templates'][section].javascripts = noneDefaultJs;
                    files['templates'][section].stylesheets = noneDefaultCss;
                    
                    
                    
                    if (!/^_common/.test(section)) {
                        
                        excludedType = [];
                        // merging other common properties
                        for (var ref in files['templates']._common) {
                            if ( /^(javascripts|stylesheets)$/.test(ref) ) {
                                excludedType.push(ref);
                                continue;
                            }
                                                        
                            files['templates'][section][ref] = files['templates']._common[ref];
                        }
                        
                        // removes common definitions from the common definitions from the current section
                        r = 0;
                        rLen = excludedType.length;
                        if (rLen > 0) {
                            for (; r < rLen; ++r) {                                
                                excludedStr = excludedType[r] +'Excluded';
                                
                                if ( typeof(files['templates'][section][excludedStr]) != 'undefined' ) {
                                    currentCollection = new Collection(files['templates'][section][excludedType[r]]);
                                    excluded = ( /string/.test( typeof(files['templates'][section][excludedStr]) ) ) ? files['templates'][section][excludedStr].split(/(\,|\;)/g) : files['templates'][section][excludedStr];
                                    
                                    t = 0; tLen = excluded.length;
                                    for (; t < tLen; ++t) {
                                        if (/^(\*|all)$/.test(excluded[t]) ) {
                                            currentCollection = currentCollection
                                                                    .update({ name: 'gina'}, { isCommon: false })
                                                                    .delete({ 'isCommon': true });
                                            break;
                                        } else {
                                            currentCollection = currentCollection
                                                                    .notIn({ name: 'gina'})
                                                                    .delete({ 'name': excluded[t] });
                                        }
                                    }       
                                    files['templates'][section][excludedType[r]] = currentCollection.toRaw();                  
                                }
                            }
                        }

                        
                    } else {
                        for (var ref in defaultViews._common) {
                            if ( /^(javascripts|stylesheets)$/.test(ref) ) continue;
                            
                            files['templates'][section][ref] = defaultViews._common[ref];
                        }
                    }
                } // EO for section                
                
            }

        } catch (err) {
            console.error(err.stack||err.message||err);
            callback(err);
            return;
        }



        //webroot vs statics
        // if (// Please, don't add `hasViews` condition. You can download files without having views: like for a `webdrive` API
        //     conf[bundle][env].server.webroot  != '/' &&
        //     typeof(files['statics']) != 'undefined'
        // ) {
        //     var newStatics = {}
        //         , _wroot = ''
        //     ;
        //     if (!wroot) {
        //         _wroot = ( conf[bundle][env].server.webroot.substr(0,1) == '/' ) ?  conf[bundle][env].server.webroot.substr(1) : conf[bundle][env].server.webroot;
        //     } else {
        //         _wroot = ( wroot.substr(0,1) == '/' ) ?  wroot.substr(1) : wroot;
        //     }

        //     var k = null;
        //     for (var i in files['statics']) {
        //         k = i;
        //         if ( !(new RegExp(wroot)).test(i) ) {
        //             if (i.substr(0, 1) != '/') {
        //                 i = '/' + i
        //             }
        //             //newStatics[ _wroot + i] = files['statics'][k]
        //             newStatics[i] = files['statics'][k]
        //         } else {
        //             newStatics[k] = files['statics'][k]
        //         }

        //         delete files['statics'][k]
        //     }

        //     files['statics'] = JSON.parse( JSON.stringify(newStatics) );
        // }
        
        
        if ( typeof(files['statics']) != 'undefined' ) {   
            pCount = conf[bundle][env].publicResources.length || 0;
            sCount = conf[bundle][env].staticResources.length || 0;
            
            for (var i in files['statics']) {
                if (!/^\//.test(i) ) {                    
                    files['statics'][ '/'+ i ] = files['statics'][i];
                    delete files['statics'][i];
                    i = '/'+ i
                }
                
                if ( !/\.(.*)$/.test(i) && !/\/$/.test(i) ) {
                    files['statics'][ i + '/' ] = files['statics'][i];
                    delete files['statics'][i];
                    i += '/' 
                }
                
                // adding to public resources
                if ( conf[bundle][env].publicResources.indexOf(i) < 0 ) {
                    conf[bundle][env].publicResources[pCount] = i;                    
                    ++pCount;
                }
                
                // adding to static resources
                if ( conf[bundle][env].staticResources.indexOf(i) < 0 ) {
                    conf[bundle][env].staticResources[sCount] = i;                    
                    ++sCount;
                }
                
                // adding to first level resources
                
            }
        }
        

        //webroot javascripts
        // if (hasViews &&
        //     conf[bundle][env].server.webroot  != '/' &&
        //     typeof(files['templates']._common.javascripts) != 'undefined'
        // ) {
            
        //     for (var v in files['templates']) { // for each section
                
        //         if (!files['templates'][v].javascripts) continue;                
              
        //         for (var i=0; i<files['templates'][v].javascripts.length; ++i) {
        //             if (
        //                 files['templates'][v].javascripts[i].substr(0,1) != '{' &&
        //                 !/\:\/\//.test(files['templates'][v].javascripts[i])
        //             ) {
        //                 if (files['templates'][v].javascripts[i].substr(0,1) != '/')
        //                     files['templates'][v].javascripts[i] = '/'+files['templates'][v].javascripts[i];

        //                 // support src like:
        //                 if (/^\/\//.test(files['templates'][v].javascripts[i]) )
        //                     files['templates'][v].javascripts[i] = files['templates'][v].javascripts[i]
        //                 else
        //                     files['templates'][v].javascripts[i] = conf[bundle][env].server.webroot + files['templates'][v].javascripts[i]
        //             }
        //         }
        //     }

        // }
        
        // //webroot stylesheets
        // if (hasViews &&
        //     conf[bundle][env].server.webroot  != '/' &&
        //     typeof(files['templates']._common.stylesheets) != 'undefined'
        // ) {
        //     var rec = null;
        //     for (var v in files['templates']) {
                
        //         if (!files['templates'][v].stylesheets) continue;
                
        //         for (var i=0; i<files['templates'][v].stylesheets.length; ++i) {                    
                    
        //             if ( typeof(files['templates'][v].stylesheets[i].url) == 'undefined') continue;
                    
        //             if (
        //                 files['templates'][v].stylesheets[i].url.substr(0,1) != '{' &&
        //                 !/\:\/\//.test(files['templates'][v].stylesheets[i].url)
        //             ) {
        //                 if (files['templates'][v].stylesheets[i].url.substr(0,1) != '/')
        //                     files['templates'][v].stylesheets[i].url = '/'+files['templates'][v].stylesheets[i].url;

        //                 if (/^\/\//.test(files['templates'][v].stylesheets[i].url) )
        //                     files['templates'][v].stylesheets[i].url = files['templates'][v].stylesheets[i].url
        //                 else
        //                     files['templates'][v].stylesheets[i].url = conf[bundle][env].server.webroot + files['templates'][v].stylesheets[i].url
        //             }
        //         }
        //     }
        // }

        files = whisper(reps, files);
        
        // favicons rewrite
        // var faviconsPath = files['statics'][  ( (_wroot) ? _wroot +'/' : '' ) + 'favicons'];
        // if ( hasViews && typeof(files['statics']) != 'undefiened' && fs.existsSync( faviconsPath ) ) {
        //     var favFiles = fs.readdirSync(faviconsPath);
        //     for (var f = 0, fLen = favFiles.length; f < fLen; ++f) {
        //         if ( !/^\./.test(favFiles[f]) )
        //             files['statics'][ ( (_wroot) ? _wroot +'/' : '' ) + favFiles[f] ] = faviconsPath +'/'+ favFiles[f];                
        //     }
        // }

        // loading forms rules
        if (hasViews && typeof(files['templates']._common.forms) != 'undefined') {
            try {
                files['forms'] = loadForms(files['templates']._common.forms)
            } catch (err) {
                callback(err)
            }
        }

        // plugin loader (frontend framework)
        if ( hasViews && typeof(files['templates']._common.pluginLoader) != 'undefined' ) {
            var loaderSrcPath = null;
            loaderSrcPath = files['templates']._common.pluginLoader.replace(/(\{src\:|\}$)/g, '');
            try {
                // will get a buffer
                if (cacheless) {
                    delete require.cache[require.resolve(_(loaderSrcPath, true))]
                }
                var pluginLoader = fs.readFileSync( _(loaderSrcPath, true));               
                                           
                for (var section in files['templates']) {
                    files['templates'][section].pluginLoader = pluginLoader;
                }
            } catch (err) {
                callback(err)
            }
        }

        if ( typeof(conf[bundle][env].content) == 'undefined') {
            conf[bundle][env].content = {}
        }        
        
        
        

        conf[bundle][env].content   = files;
       
        
        conf[bundle][env].bundle    = bundle;
        if (bundle == self.startingApp)
            conf[bundle][env].bundles   = self.getBundles();

        conf[bundle][env].env       = env;
        
        // this setting is replace on http requests by the value extracted form the request header
        if ( 
            typeof(conf[bundle][env].content.settings) != 'undefined' 
            && typeof(conf[bundle][env].content.settings.server) != 'undefined' 
            && typeof(conf[bundle][env].content.settings.server.protocol) != 'undefined'
            && typeof(conf[bundle][env].content.settings.server.scheme) != 'undefined' 
        ) {
            protocol    = conf[bundle][env].server.protocol = conf[bundle][env].content.settings.server.protocol; // from user's bundle/config/settings.json
            scheme      = conf[bundle][env].server.scheme = conf[bundle][env].content.settings.server.scheme; // from user's bundle/config/settings.json     
            
            // getting server port
            conf[bundle][env].server.port = portsReverse[ bundle +'@'+ self.projectName ][env][protocol][scheme];
            appPort = portsReverse[bundle+'@'+self.projectName][env][protocol][scheme];    
            conf[bundle][env].port[ protocol ][ scheme ] = appPort;  
      
            
        } else {
            protocol = conf[bundle][env].server.protocol;
            scheme = conf[bundle][env].server.scheme;
        }
        
        conf[bundle][env].hostname = scheme + '://' + conf[bundle][env].host + ':' + conf[bundle][env].server.port;

        
        self.envConf[bundle][env] = conf[bundle][env];
        ++b;
        if (b < bundles.length) {
            loadBundleConfig(bundles, b, callback, reload, collectedRules)
        } else {
            callback(err, files, collectedRules)
        }
    }

    var loadForms = function(formsDir) {
        var forms = { rules: {}}, cacheless = self.isCacheless(), root = '';

        if ( fs.existsSync(formsDir) ) {
            root = ''+formsDir;
            // browsing dir
            var readDir = function (dir, forms, key) {
                var files       = fs.readdirSync(dir)
                    , filename  = ''
                    , k         = null;

                for (var i = 0, len = files.length; i < len; ++i) {
                    if ( !/^\./.test(files[i]) ) {
                        filename = _(dir + '/' + files[i], true);

                        if ( fs.statSync(filename).isDirectory() ) {
                            key += dir.replace(root, '') +'/'+ files[i] + '/';
                            k = key.split(/\//g);
                            forms[k[k.length-2]] = {};

                            readDir( filename, forms[ k[k.length-2] ], key );

                        } else {

                            key = files[i].replace('.json', '').replace(/\-/g, '.');
                            try {

                                if (cacheless) {
                                    delete require.cache[require.resolve(filename)];
                                }

                                k = key.split(/\//g);
                                forms[ k[k.length-1] ] = require(filename)

                            } catch(err) {
                                throw new Error('[ ' +filename + ' ] is malformed !!')
                            }
                        }
                    }
                }
            };

            readDir(formsDir, forms, '/')
        }

        return forms
    }

    /**
     * Load Apps Configuration
     *
     * TODO - simplify / optimize
     * */
    var loadBundlesConfiguration = function(callback) {
        //var bundles = self.getBundles();
        var bundles = self.getAllBundles();

        loadBundleConfig(bundles, 0, callback)
    }

    /**
     * Check is cache is disabled
     *
     * @return {boolean} isUsingCache
     * */
    this.isCacheless = function() {
        //var env = self.Env.get();//Config.instance.Env.get();
        //Also defined in core/gna.
        return (GINA_ENV_IS_DEV) ? true : false
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
            self.allBundles,
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
        var conf            = self.envConf[bundle][env]
            //Reload models.
            , modelsPath    = _(conf.modelsPath);


        fs.exists(modelsPath, function(exists){
            if (exists && self.startingApp == conf.bundle) {
                modelUtil.reloadModels(
                    conf,
                    function doneReloadingModel(err) {
                        callback(err)
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
        if (!self.envConf[bundle][env].content)
            self.envConf[bundle][env].content = {};

        self.envConf[bundle][env].content.routing = routing;
    }

    this.getRouting = function(bundle, env) {        
        var routing = self.envConf[bundle][env].content.routing;

        return routing;
    }

    this.setReverseRouting = function(bundle, env, reverseRouting) {
        self.envConf[bundle][env].content.reverseRouting = reverseRouting
    }


    if (!opt) {

        this.setBundles = function(bundles) {
            self.bundles = bundles
        }

        if (Config.instance)
            return Config.instance;

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