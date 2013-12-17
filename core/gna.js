/*
 * This file is part of the geena package.
 * Copyright (c) 2013 Rhinostone <geena@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * Geena Bootstrap
 *
 * @package    Geena
 * @author     Rhinostone <geena@rhinostone.com>
 */
var gna     = {core:{}};
var fs      = require('fs');
var Config  = require('./config');
var utils   = require('./utils');
var Proc    = utils.Proc;
var server  = require('./server');
var Winston = require('./../node_modules/winston');
var EventEmitter = require('events').EventEmitter;

gna.utils = utils;

logger = getContext('geena.utils.logger');

if ( logger == undefined ) {
    logger = gna.utils.logger;
    var loggerInstance = new (Winston.Logger)({
        levels : logger.custom.levels,
        transports : [
            new (Winston.transports.Console)({
                colorize: true
            })
        ],
        colors : logger.custom.colors
    });
    setContext('geena.utils.logger', loggerInstance);
}

if ( logger == undefined ) {
    logger = gna.utils.logger;
    var loggerInstance = new (Winston.Logger)({
        levels : logger.custom.levels,
        transports : [
            new (Winston.transports.Console)({
                colorize: true
            })
        ],
        colors : logger.custom.colors
    });
    setContext('geena.utils.logger', loggerInstance);
}

setContext('geena.utils', utils);

var e = new EventEmitter();
gna.initialized = process.initialized = false;
var startWithoutGeena = false;
if( gna.executionPath == undefined){
    var p = new _(process.argv[1]).toUnixStyle().split("/");
    var appName = p[p.length-1].split(".")[0];
    gna.executionPath = "";
    if ( (/index.js/).test(process.argv[1]) || p[p.length-1] == 'index') {
        startWithoutGeena = true;
        appName = p[p.length-2].split(".")[0];
        //Find root ;)
        var m = _(__dirname).split("/");
        gna.executionPath = "";
        for (var i in m) {
            if (m[i] != p[i]){
                break;
            } else {
                gna.executionPath +=  p[i] + '/';
            }
        }
        gna.executionPath = _( gna.executionPath.substring(0, gna.executionPath.length-1) );
    } else {
        for (var i=0; i<p.length-1; ++i) {
            gna.executionPath +=  p[i] + '/';
        }
        gna.executionPath = _( gna.executionPath.substring(0, gna.executionPath.length-1) );
    }
}

var root = getPath('root');
var geenaPath = getPath('geena.core');

if ( typeof(root) == 'undefined') {
    root = gna.executionPath;
    setPath( 'root', root );
}
if ( typeof(geenaPath) == 'undefined') {
    geenaPath = _(__dirname);
    setPath('geena.core', geenaPath);
}

var core    = gna.core;
var env     = process.argv[2] || 'prod';
gna.env = process.env.NODE_ENV = env;

/**
 * On middleware initialization
 *
 * @callback callback
 *
 * */
gna.onInitialize = process.onInitialize = function(callback){

    gna.initialized = true;
    e.on('init', function(instance, express, conf){

        joinContext(conf.contexts);
        gna.getConfig = function(name){
            var tmp = "";
            if ( typeof(name) != 'undefined' ) {
                try {
                    //Protect it.
                    tmp = JSON.stringify(conf.content[name]);
                    console.warn("parsing ", conf.content);
                    return JSON.parse(tmp);
                } catch (err) {
                    return undefined;
                }
            } else {
                //console.error("config!!!! ", conf);
                tmp = JSON.stringify(conf);
                return JSON.parse(tmp);
            }
        };
        callback(e, instance, express);
    });
};

/**
 * Start server
 *
 * @param {string} [executionPath]
 * */
gna.start = process.start = function(executionPath){

    if ( typeof(executionPath) != 'undefined' ) {
        gna.executionPath = _(executionPath);
    } else {
        var executionPath = root;
    }

    //Get bundlesDir.
    //console.error('getting bundlesDIR: ', process.argv[1], "[",appName,"]");

    //core.executionPath = executionPath.replace('\/bundles', '');

    //console.error("found context ",  core.executionPath);
    core.startingApp = appName;
    core.executionPath =  root;
    core.geenaPath = geenaPath;

    //Inherits parent (geena) context.
    if ( typeof(process.argv[3]) != 'undefined' ) {
        setContext( JSON.parse(process.argv[3]) );
    }

    //Setting env.
    if (env != 'undefined') {
        logger.setEnv(env);
    }

    //Setting log paths.
    logger.init({
        logs : _(core.executionPath + '/logs'),
        core: _(__dirname)
    });

    var config = new Config({
        env : env,
        executionPath : core.executionPath,
        startingApp : core.startingApp,
        geenaPath : core.geenaPath
    });
    //setContext('config', config);
    config.onReady( function(err, obj){
        var isStandalone = obj.isStandalone;

        logger.info('geena', 'CORE:INFO:2', 'Execution Path : ' + core.executionPath);
        logger.info('geena', 'CORE:INFO:3', 'Standalone mode : ' + isStandalone);

        server.setConf({
                bundle          : core.startingApp,
                //Apps list.
                bundles         : obj.bundles,
                allBundles      : obj.allBundles,
                env             : obj.env,
                isStandalone    : isStandalone,
                executionPath   : core.executionPath,
                conf            : obj.conf
            },
            function(err, instance, express, conf){
                if (!err) {
                    gna.Model = require('./model');
                    logger.debug(
                        'geena',
                        'CORE:DEBUG:1',
                        'Server conf loaded',
                        __stack
                    );

                    logger.notice(
                        'geena',
                        'CORE:NOTICE:2',
                        'Starting [' + core.startingApp + '] instance'
                    );

                    //On user conf complete.
                    e.on('complete', function(instance){
                        server.init(instance);
                    });



                    gna.getProjectConfiguration( function onDoneGettingProjectConfiguration(err, project){

                        var source = (env == 'dev' || env == 'debug') ? _( root +'/'+project.packages[core.startingApp].src) : _( root +'/'+ project.packages[core.startingApp].release.target );
                        var linkPath =  _( root +'/'+ project.packages[core.startingApp].release.link );

                        gna.mount( conf.bundlesPath, source, linkPath, function onBundleMounted(err){
                            if (!err) {
                                // -- BO
                                e.emit('init', instance, express, conf);
                                //In case there is no user init.
                                if (!gna.initialized) {
                                    e.emit('complete', instance);
                                }
                                console.error('mounted!! ', conf.bundle);
                                // -- EO
                            } else {
                                logger.error(
                                    'geena',
                                    'CORE:ERR:2',
                                    'Could not mount bundle ' + core.startingApp + '. ' + err + '\n' + err.stack,
                                    err.stack
                                );
                            }
                        });
                    });


//                    e.emit('init', instance, express, conf);
//                    //In case there is no user init.
//                    if (!gna.initialized) {
//                        e.emit('complete', instance);
//                    }
                } else {
                    logger.error(
                        'geena',
                        'CORE:ERROR:1',
                        'Geena::Core.setConf() error. '+ err+ '\n' + err.stack
                    );
                }
            });
    });
};

/**
 * Stop server
 * */
gna.stop = process.stop = function(pid, code){
    log("stoped server");
    if(typeof(code) != "undefined")
        process.exit(code);

    process.exit();
};

/**
 * Get Status
 * */
gna.status = process.status = function(){
    log("getting server status");
};
/**
 * Restart server
 * */
gna.restart = process.restart = function(){
    log("starting server");
};

/**
* Get project conf from project.json
*
*
* @param {function} callback
* @return {object} data - Result conf object
* */
gna.getProjectConfiguration = function (callback){
    var modulesPackage = _(root + '/project.json');
    var project = {};
    //Merging with existing;
    if ( fs.existsSync(modulesPackage) ) {
        try {
            var dep = require(modulesPackage);

            if ( typeof(dep['packages']) == "undefined") {
                dep['packages'] = {};
            }

            if (
                typeof(dep['packages']) != "undefined"
                    && typeof(project['packages']) != "undefined"
                ) {

                for (var d in dep) {

                    if (d == 'packages')
                        for (var p in dep[d]) project['packages'][p] = dep['packages'][p];
                    else
                        project[d] = dep[d];

                }
            } else {
                project = dep;
            }
            gna.project = project;
            callback(false, project);
        } catch (err) {
            gna.project = project;
            callback(err);
        }

    } else {
        gna.project = project;
        callback(false, project);
    }
};

/**
 * mount release => bundle
 * @param {string} source
 * @param {string} target
 * @param {string} type
 *
 * @callback callback
 * @param {boolean|string} err
 * */
gna.mount = process.mount = function(bundlesPath, source, target, type, callback){
    if ( typeof(type) == 'function') {
        var callback = type;
        type = 'dir';
    }
    //creating folders.
    //use junction when using Win XP os.release == '5.1.2600'
    var exists = fs.existsSync(source);
    if ( exists ) {
        var path = utils.generator.createPathSync(bundlesPath, function onPathCreated(err){
            if (!err) {
                try {
                    if ( fs.existsSync(target) ) {
                        fs.unlinkSync(target);
                    }
                    if ( type != undefined) {
                        fs.symlinkSync(source, target, type);
                    } else {
                        fs.symlinkSync(source, target);
                    }
                    callback(false);
                } catch (err) {
                    if ( fs.existsSync(target) ) {
                        var stats = fs.lstatSync(target);
                        if ( stats.isDirectory() ) {
                            var d = new _(target).rm( function(err){
                                callback(err);
                            });
                        } else {
                            fs.unlinkSync(target);
                            callback(err);
                        }
                    }
                }
            } else {
                //console.error(err);
                callback(err);
            }
        });
    } else {
        // Means that it did not find the release. Build and re mount.

        callback('No release was found to mount for: ', source);
// Auto build ? Well, I don't know yet. We'll see
//
//        gna.build(source, target, type, function(err){
//
//        });
    }
};

//gna.build = function(source, target, type, callback) {
//    var project = gna.project;
//    console.log("building project ", project);
//
//    //Mount
//};

module.exports = gna;