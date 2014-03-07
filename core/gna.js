/*
 * This file is part of the geena package.
 * Copyright (c) 2014 Rhinostone <geena@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * Geena Core Bootstrap
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
setContext('geena.utils', utils);

//Yes it's global...
logger = utils.logger;

// BO cooking..
var startWithGeena = false;
//copy & backup for utils/cmd/app.js.
var tmp = process.argv;

// filter $ node.. o $ geena  with or without env
if (process.argv.length >= 4) {
    startWithGeena = true;

    if (process.argv[1] == 'geena' || process.argv[1] == _(root + '/geena') ) {
        //this test might be useless.
        setContext('paths', JSON.parse(tmp[1]).paths);
        process.argv.splice(1, 1);
        //And so on if you need to.
    } else {
        setContext('paths', JSON.parse(tmp[3]).paths);//And so on if you need to.
        //Cleaning process argv.
        process.argv.splice(3);
    }
}
tmp = null;

setPath( 'node', _(process.argv[0]) );
var root = getPath('root');
/**
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
setPath('root', root);*/

gna.executionPath = root;

var geenaPath = getPath('geena.core');
if ( typeof(geenaPath) == 'undefined') {
    geenaPath = _(__dirname);
    setPath('geena.core', geenaPath);
}

//console.log("before.. ", root );

//if ( logger == undefined ) {
//    logger = gna.utils.logger;
//    var loggerInstance = new (Winston.Logger)({
//        levels : logger.custom.levels,
//        transports : [
//            new (Winston.transports.Console)({
//                colorize: true
//            })
//        ],
//        colors : logger.custom.colors
//    });
//    setContext('geena.utils.logger', loggerInstance);
//}


setContext('geena.utils', utils);

var envs = ["dev", "debug", "stage", "prod"];
var env;
//Setting env.
env =  ( typeof(process.argv[2]) != 'undefined')  ? process.argv[2].toLowerCase() : 'prod';
gna.env = process.env.NODE_ENV = env;
gna.env.isWin32 = process.env.isWin32 = function(){
    return (os.platform() == 'win32') ? true : false;
};
//Cahceless is also defined in the main config : Config::isCacheless().
process.env.IS_CACHELESS = (env == "dev" || env == "debug") ? true : false;

//console.log('ENV => ', env);
//console.log('HOW  ', process.argv.length, process.argv);
//var bundlesPath = _(root + '/bundles');
var bundlesPath = getPath('mountPath');

var p = new _(process.argv[1]).toUnixStyle().split("/");
var isSym = false;
var path;

var isPath = (/\//).test(process.argv[1]) || (/\\/).test(process.argv[1]);
if (!isPath) {
    //lequel ?
    try {
        isSym = fs.lstatSync( _(bundlesPath +'/'+ process.argv[1]) ).isSymbolicLink();
    } catch (err) {
        //Did not find it ^^.
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
    console.log('source: ', source);
    console.log('checking before mounting ', target, fs.existsSync(target), bundlesPath);
    if ( fs.existsSync(target) ) {
        try {
            fs.unlinkSync(target)
        } catch (err) {
            callback(err)
        }
    }
    if ( exists ) {
        //will override existing each time you restart.
        var pathToMount = utils.generator.createPathSync(bundlesPath, function onPathCreated(err){
            if (!err) {
                try {
                    if ( type != undefined)
                        fs.symlinkSync(source, target, type)
                    else
                        fs.symlinkSync(source, target);

                    callback(false)
                } catch (err) {
                    if ( fs.existsSync(target) ) {
                        var stats = fs.lstatSync(target);
                        if ( stats.isDirectory() ) {
                            var d = new _(target).rm( function(err){
                                callback(err);
                            })
                        } else {
                            fs.unlinkSync(target);
                            callback(err)
                        }
                    }
                }
            } else {
                console.error(err);
                callback(err)
            }
        });
    } else {
        // Means that it did not find the release. Build and re mount.
        callback('Found no release to mount for: ', source)
    }
};



gna.getProjectConfiguration( function onDoneGettingProjectConfiguration(err, project){

    //console.log("project ", project);

    if (err) console.error(err.stack);

//    if (gna.project == undefined) {
    //gna.project = project;
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
        //finding app.
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
                if ( /**!appName &&*/ tmp == path.replace(/\//g, '').replace(/\\/g, '') ) {
                    appName = bundle;
                    break;
                }
            } else {
                abort('Path mismatched with env: ' + path);
            }
            // else, not a bundle
        }

        if (appName == undefined) {
            abort('No bundle found for path: ' + path);
        } else {
            setContext('bundle', appName);
            //if ( !process.env.isWin32() ) {
            var bundleProcess = new Proc(appName, process);
            bundleProcess.register(appName, process.pid)
            //}
            //what then ??
        }

    } catch (err) {
        abort(err);
    }
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
                        console.error(err.stack);
                        return undefined;
                    }
                } else {
                    //console.error("config!!!! ", conf);
                    tmp = JSON.stringify(conf);
                    return JSON.parse(tmp);
                }
            };
            try {
                callback(e, instance, express);

            } catch (err) {
                // TODO Output this to the error logger.
                console.log('Could not complete initialization: ', err.stack);
            }
        })
    };

    gna.getShutdownConnector = process.getShutdownConnector = function(callback){
        var connPath = _(bundlesPath +'/'+ appName + '/config/connector.json');
        fs.readFile(connPath, function onRead(err, content){
            try {
                callback(err, JSON.parse(content).httpClient.shutdown);
            } catch (err) {
                callback(err);
            }
        });
    };

    gna.getShutdownConnectorSync = process.getShutdownConnectorSync = function(){
        var connPath = _(bundlesPath +'/'+ appName + '/config/connector.json');
        try {
            var content = fs.readFileSync(connPath);
            return JSON.parse(content).httpClient.shutdown;
        } catch (err) {
            return undefined;
        }
    };

    gna.getMountedBundles = process.getMountedBundles = function(callback){
        fs.readdir(bundlesPath, function onRead(err, files){
            callback(err, files);
        });
    };

    gna.getMountedBundlesSync = process.getMountedBundlesSync = function(){
        try {
            return fs.readdirSync(bundlesPath);
        } catch (err){
            return err.stack;
        }
    };

    gna.getRunningBundlesSync = process.getRunningBundlesSync = function(){

        //TODO - Do that thru IPC or thru socket.
        var conf = gna.getConfig();
        var pidPath = _(conf.tmpPath +'/pid');
        var files = fs.readdirSync(pidPath);
        var content = [];
        for (var f=0; f<files.length; ++f) {
            content[f] = {};
            content[f]['pid']  = files[f];
            content[f]['name'] = fs.readFileSync( _(pidPath +'/'+ files[f]) ).toString();
            content[f]['path'] = _(pidPath +'/'+ files[f]);
        }
        return content;
    };

    gna.getVersion = process.getVersion = function(bundle){
        var name = bundle || appName;
        name = name.replace(/geena: /, '');

        if ( name != undefined) {
            try {
                var str = fs.readFileSync( _(bundlesPath + '/' + bundle + '/config/app.json') ).toString();
                var version = JSON.parse(str).version;
                return version;
            } catch (err){
                return err;
            }
        } else {
            return undefined;
        }
    };

    /**
     * Start server
     *
     * @param {string} [executionPath]
     * */
    gna.start = process.start = function(){


        var core    = gna.core;
        //Get bundle name.
        console.log('appName ', appName);
        core.startingApp = appName;
        core.executionPath =  root;
        core.geenaPath = geenaPath;

        //Inherits parent (geena) context.
        if ( typeof(process.argv[3]) != 'undefined' ) {
            setContext( JSON.parse(process.argv[3]) );
        }

        //Setting log paths.
        logger.init({
            //logs : _(core.executionPath + '/logs'),
            logs : getPath('logsPath'),
            core: _(__dirname)
        });
        setContext('geena.utils.logger', logger);
        //check here for mount point source...
        var source = (env == 'dev' || env == 'debug') ? _( root +'/'+project.packages[core.startingApp].src) : _( root +'/'+ project.packages[core.startingApp].release.target );
        var tmpSource = _(bundlesPath +'/'+ core.startingApp);

        var linkPath =  _( root +'/'+ project.packages[core.startingApp].release.link );

        gna.mount( bundlesPath, source, linkPath, function onBundleMounted(mountErr){
            var config = new Config({
                env             : env,
                executionPath   : core.executionPath,
                startingApp     : core.startingApp,
                geenaPath       : core.geenaPath
            });

            setContext('geena.config', config);
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
                            //TODO - Reload using cacheless method for DEV env.
                            //Loading models.
                            if ( typeof(conf.content['connector']) != 'undefined' ) {
                                // TODO - utils.loadModels();
                                var Model   = require('./model');
                                for (var m in conf.content.connector) {
                                    //var apiModel    = new Model(config.bundle + "/api");
                                    setContext(m+'Model',  new Model(conf.bundle + "/" + m));
                                }
                            }

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
                                console.error('mounted!! ', conf.bundle, process.pid);
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

                        } else {
                            logger.error(
                                'geena',
                                'CORE:ERROR:1',
                                'Geena::Core.setConf() error. '+ err+ '\n' + err.stack
                            )
                        }
                    })
            })//EO config.
        })//EO mount.
    };

    /**
     * Stop server
     * */
    gna.stop = process.stop = function(pid, code){
        log("stoped server");
        if(typeof(code) != "undefined")
            process.exit(code);

        process.exit()
    };

    /**
     * Get Status
     * */
    gna.status = process.status = function(bundle){
        log("getting server status")
    };
    /**
     * Restart server
     * */
    gna.restart = process.restart = function(){
        log("starting server")
    };


});//EO onDoneGettingProjectConfiguration.


module.exports = gna;