/*
 * This file is part of the geena package.
 * Copyright (c) 2014 Rhinostone <geena@rhinostone.com>
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

setContext('geena.utils', utils);

var e = new EventEmitter();
gna.initialized = process.initialized = false;

var startWithGeena = (process.argv.length < 4) ? false : true;
var fromSpawn = ( typeof(process.argv[4]) == 'object' ) ? true : false;
var envs = ["dev", "debug", "stage", "prod"];
var env;
console.error("before.. ", process.argv );


//console.log("reading ", startWithGeena, process.argv[3], ( typeof(process.argv[4]) == 'undefined' || envs.indexOf(process.argv[4]) < 0 ));

if (startWithGeena) {
    //if (fromSpawn) {
    //    env = process.argv[2];
    //} else {
        env = process.argv[4];
        if ( typeof(process.argv[4]) == 'undefined' || envs.indexOf(process.argv[4]) < 0 ) {
            env = 'prod';
            process.argv.splice(4,0,env);
        }
    //}
    gna.env = process.env.NODE_ENV = env;

} else {
    var env = process.argv[2] || 'prod';
    gna.env = process.env.NODE_ENV = env;
}

console.log("nananh ", env);
//console.log('ENV => ', env);
//console.log('HOW  ', process.argv.length, process.argv);
var p = new _(process.argv[1]).toUnixStyle().split("/");

if( gna.executionPath == undefined){
    gna.executionPath = "";

//    var appName = p[p.length-1].split(".")[0];
//    gna.executionPath = "";
//    var path = _(process.argv[1]);
//    if ( (/index.js/).test(path) || p[p.length-1] == 'index') {
//        startWithGeena = true;
//
//
//        var m = _(__dirname).split("/");
//        for (var i in m) {
//            if (m[i] != p[i]){
//                break;
//            } else {
//                gna.executionPath +=  p[i] + '/';
//            }
//        }
//        gna.executionPath = _( gna.executionPath.substring(0, gna.executionPath.length-1) );
//    } else {
        for (var i=0; i<p.length-1; ++i) {
            gna.executionPath +=  p[i] + '/';
        }
        gna.executionPath = _( gna.executionPath.substring(0, gna.executionPath.length-1) );
    //}
}

var geenaPath = getPath('geena.core');
if ( typeof(geenaPath) == 'undefined') {
    geenaPath = _(__dirname);
    setPath('geena.core', geenaPath);
}

//Find root ;)
var root = getPath('root');
if ( typeof(root) == 'undefined') {
    var g = _(geenaPath).split('/');
    var max = (g.length > p.length) ? g.length : p.length;
    root = "";
    for (var i=0; i<max; ++i) {
        if (g[i] == p[i]) {
            root += g[i] + '/';
        } else {
            break;
        }
    }
    root = root.substring(0, root.length-1);
    setPath( 'root', root );
}
// Todo - load from env.json or locals  or project.json ??
var bundlesPath = _(root + '/bundles');

var abort = function(err) {
    console.log("got this shit ", process.argv);
    if ( typeof(err.stack) != 'undefined')
        console.log('Geena could not determine which bundle to load: ' + err +' ['+env+']' + '\n' + err.stack);
    else
        console.log('Geena could not determine which bundle to load: ' + err +' ['+env+']');

    process.exit(1);
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
            console.log('ENV: ', env );
            console.log('PROCESS: ', process.argv );
            console.log(" now loading....", modulesPackage);
            //console.log('content ', dep);
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
            console.log("; )look for ");
            console.log("===> ", dep);
            callback(false, project);
        } catch (err) {
            gna.project = project;
            callback(err);
        }

    } else {
        console.error('missing project???');
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
        var pathToMount = utils.generator.createPathSync(bundlesPath, function onPathCreated(err){
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


gna.getProjectConfiguration( function onDoneGettingProjectConfiguration(err, project){
    console.log('loaded ? ', gna.loaded);

    console.log("fucking great ", process.argv);
    console.log("project ", project);
    gna.loaded = true;


    if (err) console.error(err);

//    if (gna.project == undefined) {
        gna.project = project;
        var appName;

        var packs = project.packages;
        if (startWithGeena) {
            //auto path ?
            var isPath = (/\//).test(process.argv[3]);
            if (!isPath) {
                // env ?
                //_(bundlesPath + '/' + process.argv[3] + '/index'
                appName = process.argv[3];
                var path = (env == 'dev' || env == 'debug') ? packs[appName].src : packs[appName].release.target;
            } else {
                var path = process.argv[3]
            }
        } else {
            var path = _(process.argv[1]);
        }

        path = path.replace(root + '/', '');
        var search;
        if ( (/index.js/).test(path) || p[p.length-1] == 'index') {
            var self;
            path = ( self = path.split('/') ).splice(0, self.length-1).join('/');
        }
        console.error('fuck ', env,  startWithGeena, process.argv, path);
        try {
            //finding app
            var target, source, tmp;
            for (var bundle in packs) {
                //is bundle ?
                tmp = "";
                if ( typeof(packs[bundle].release) != 'undefined' && env == 'prod' || typeof(packs[bundle].release) != 'undefined' && env == 'stage') {

                    tmp = packs[bundle].release.target.replace(/\//g, '').replace(/\\/g, '');
                    if ( !appName && tmp == path.replace(/\//g, '').replace(/\\/g, '') ) {
                        appName = bundle;
                        break;
                    }/** else {
                    abort('Path mismatched with env: ' + path);
                }*/
                } else if ( typeof(packs[bundle].src) != 'undefined' && env == 'dev' || typeof(packs[bundle].src) != 'undefined' && env == 'debug') {

                    tmp = packs[bundle].src.replace(/\//g, '').replace(/\\/g, '');
                    if ( !appName && tmp == path.replace(/\//g, '').replace(/\\/g, '') ) {
                        appName = bundle;
                        break;
                    }/** else {
                    abort('Path mismatched with env: ' + path);
                }*/
                } /**else if (startWithGeena && appName == bundle) {
                appName = bundle;
            } else {
                console.log("I'm fucked ! ");
            }*/
                // else, not a bundle
            }

            if (appName == undefined)
                abort('No bundle found for path: ' + path);




        } catch (err) {
            abort(err);
        }
//    } else {
//        project = gna.project;
//    }
    // BO Cooking...






    //EO cooking

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
    gna.start = process.start = function(){

        console.error('mierda DOS !! ');
        //Get bundle name.
//        if (env == 'dev' || env == 'debug') {
//            appName = p[p.length-2].split(".")[0];
//        } else {
//            //magic case...
//            appName = p[p.length-2].split(".")[0];
//        }
        console.log('appName ', appName);
        var porject = gna.project;
        var core    = gna.core;
        core.startingApp = appName;
        core.executionPath =  root;
        core.geenaPath = geenaPath;

        //Inherits parent (geena) context.
        if ( typeof(process.argv[3]) != 'undefined' ) {
            setContext( JSON.parse(process.argv[3]) );
        }

        //Setting log paths.
        logger.init({
            logs : _(core.executionPath + '/logs'),
            core: _(__dirname)
        });

        var source = (env == 'dev' || env == 'debug') ? _( root +'/'+project.packages[core.startingApp].src) : _( root +'/'+ project.packages[core.startingApp].release.target );
        var linkPath =  _( root +'/'+ project.packages[core.startingApp].release.link );

        gna.mount( bundlesPath, source, linkPath, function onBundleMounted(mountErr){
            var config = new Config({
                env : env,
                executionPath : core.executionPath,
                startingApp : core.startingApp,
                geenaPath : core.geenaPath
            });
            //setContext('config', config);
            config.onReady( function(err, obj){
                var isStandalone = obj.isStandalone;

                if (err) console.error(err, err.stack);

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


                            if (!mountErr) {
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
                                abort(err);
                            }



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
            });//EO config
        });//EO mount
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


});//EO onDoneGettingProjectConfiguration


module.exports = gna;