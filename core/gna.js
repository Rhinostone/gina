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
var e = new EventEmitter();
gna.initialized = process.initialized = false;
gna.utils = utils;

logger = getContext('geena.utils.logger');

// BO cooking..
var startWithGeena = false;
//copy & backup for utils/cmd/app.js.
var tmp = JSON.stringify(process.argv);
setContext('process.argv', JSON.parse(tmp) );
tmp = null;

// filter $ node.. o $ geena  with or without env
if (process.argv.length >= 4) {
    startWithGeena = true;
    if (process.argv[1] == 'geena') {
        process.argv.splice(1, 1);
    } else {
        process.argv.splice(1, 2);
    }
}

var root = "";
var getRoot = function(){
    var paths = _(__dirname).split('/');
    var newPath;
    for (var i = paths.length; i>0; --i) {
        paths.splice(paths.length-1, 1);
        newPath = paths.join('/');
        if ( fs.existsSync( newPath + '/project.json') || fs.existsSync( newPath + '/geena') && !fs.statSync( newPath + '/geena').isDirectory() || fs.existsSync( newPath + '/.gna') ) {
            return newPath;
            break;
        }
    }
};

var root = getRoot();
setPath('root', root);
gna.executionPath = root;

var geenaPath = getPath('geena.core');
if ( typeof(geenaPath) == 'undefined') {
    geenaPath = _(__dirname);
    setPath('geena.core', geenaPath);
}

//console.log("before.. ", root );
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

var envs = ["dev", "debug", "stage", "prod"];
var env;
//if (process.argv[0] == 'node') {
//    env =  ( typeof(process.argv[1]) != 'undefined')  ? process.argv[1].toLowerCase() : 'prod';
//} else {
env =  ( typeof(process.argv[2]) != 'undefined')  ? process.argv[2].toLowerCase() : 'prod';
//}

gna.env = process.env.NODE_ENV = env;

//console.log('ENV => ', env);
//console.log('HOW  ', process.argv.length, process.argv);
var bundlesPath = _(root + '/bundles');

var p = new _(process.argv[1]).toUnixStyle().split("/");
var isSym = false;
var path;

var isPath = (/\//).test(process.argv[1]) || (/\\/).test(process.argv[1]);
if (!isPath) {
    //lequel ?
    try {
        isSym = fs.lstatSync( _(bundlesPath +'/'+ process.argv[1]) ).isSymbolicLink();
    } catch (err) {
        //Did not find it ^^

    }
} else {
    process.argv[1] = _(process.argv[1]);
}


// Todo - load from env.json or locals  or project.json ??

var abort = function(err) {
    if (
        process.argv[2] == '-s' && startWithGeena
            || process.argv[2] == '--start' && startWithGeena
            //Avoid -h, -v  ....
            || !startWithGeena && isPath && process.argv.length > 3

    ) {
        if (isPath && !startWithGeena) {
            console.log('You are trying to load geena by hand: just make sure that your env ['+env+'] matches the given path ['+ path +']');
        } else if ( typeof(err.stack) != 'undefined' ) {
            console.log('Geena could not determine which bundle to load: ' + err +' ['+env+']' + '\n' + err.stack);
        } else {
            console.log('Geena could not determine which bundle to load: ' + err +' ['+env+']');
        }
        process.exit(1);
    }
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
            //console.log('ENV: ', env );
            //console.log('PROCESS: ', process.argv );
            //console.log(" now loading....", modulesPackage);
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
            //console.log("; )look for ");
            //console.log("===> ", dep);
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

        callback('Found no release to mount for: ', source);
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

    //console.log("project ", project);

    if (err) console.error(err);

//    if (gna.project == undefined) {
    gna.project = project;
    var appName;

    var packs = project.packages;
    if (startWithGeena) {
        //auto path ?
        //var isPath = (/\//).test(process.argv[3]);
        if (!isPath) {
            // env ?
            //_(bundlesPath + '/' + process.argv[3] + '/index'
            appName = process.argv[1];
            path = (env == 'dev' || env == 'debug') ? packs[appName].src : packs[appName].release.target;
        } else {
            //path = ( process.argv[0] == 'node' ) ? process.argv[2] : process.argv[1];
            path = process.argv[1];
        }
    } else {
        //path = ( process.argv[0] == 'node' ) ? process.argv[2] : process.argv[1];
        path = _(process.argv[1]);
    }



    path = path.replace(root + '/', '');
    var search;
    if ( (/index.js/).test(path) || p[p.length-1] == 'index') {
        var self;
        path = ( self = path.split('/') ).splice(0, self.length-1).join('/');
    }
    //console.error('fuck ', env,  startWithGeena, process.argv, path);
    try {
        //finding app
        var target, source, tmp;
        for (var bundle in packs) {
            //is bundle ?
            tmp = "";
            if (
                typeof(packs[bundle].release) != 'undefined' && env == 'prod'
                || typeof(packs[bundle].release) != 'undefined' && env == 'stage'
            ) {

                tmp = packs[bundle].release.target.replace(/\//g, '').replace(/\\/g, '');
                if ( !appName && tmp == path.replace(/\//g, '').replace(/\\/g, '') ) {
                    appName = bundle;
                    break;
                }
            } else if (
                typeof(packs[bundle].src) != 'undefined' && env == 'dev'
                || typeof(packs[bundle].src) != 'undefined' && env == 'debug'
            ) {

                tmp = packs[bundle].src.replace(/\//g, '').replace(/\\/g, '');
                if ( !appName && tmp == path.replace(/\//g, '').replace(/\\/g, '') ) {
                    appName = bundle;
                    break;
                }
            } else {
                abort('Path mismatched with env: ' + path);
            }
            // else, not a bundle
        }

        if (appName == undefined)
            abort('No bundle found for path: ' + path);
        else
            setContext('bundle', appName);

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

        //check here for mount point source...
        var source = (env == 'dev' || env == 'debug') ? _( root +'/'+project.packages[core.startingApp].src) : _( root +'/'+ project.packages[core.startingApp].release.target );

        var tmpSource = _(bundlesPath +'/'+ core.startingApp);
        if ( fs.existsSync(tmpSource) && env == 'prod' || fs.existsSync(tmpSource) && env == 'stage' ) {
            try {
                var stats = fs.lstatSync(tmpSource);
                if ( stats.isSymbolicLink() ) {
                    source = _( fs.readlinkSync(tmpSource) );
                } else {
                    source = tmpSource;
                }
            } catch (err) {
                //silently...
                source = (env == 'dev' || env == 'debug') ? _( root +'/'+project.packages[core.startingApp].src) : _( root +'/'+ project.packages[core.startingApp].release.target );
            }
        }

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