/*
 * This file is part of the gina package.
 * Copyright (c) 2017 Rhinostone <gina@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * Gina Core Bootstrap
 *
 * @package    Gina
 * @author     Rhinostone <gina@rhinostone.com>
 */

var fs              = require('fs');
var EventEmitter    = require('events').EventEmitter;
var e               = new EventEmitter();

var gna         = {core:{}};
var Config      = require('./config');
var config      = null;
//var helpers     = require('./../helpers');
var lib         = require('./../lib');
var console     = lib.logger;
var Proc        = lib.Proc;
var locales     = require('./locales');
var plugins     = lib.plugins;
var modelUtil   = new lib.Model();




gna.initialized = process.initialized = false;
gna.routed      = process.routed = false;

gna.utils       = lib;
//gna.helpers     = helpers;
gna.locales     = locales;
gna.plugins     = plugins;


// BO cooking..

var isLoadedThroughCLI      = false; // with gina
var isLoadedThroughWorker   = false;

//copy & backup for utils/cmd/app.js.
var tmp         = JSON.parse(JSON.stringify(process.argv)); // by default
var projectName = null;

// filter $ node.. o $ gina  with or without env
if (process.argv.length >= 3 /**&& /gina$/.test(process.argv[1])*/ ) {

    var ctxObj = null;
    if ( /(child)\.js$/.test(tmp[1]) ) { // required under a worker
        
        isLoadedThroughWorker = true;
        var ctxFilename = null;
        
        for (var a = 0, aLen = tmp.length; a < aLen; ++a) {
            
            if (/^--argv-filename=/.test(tmp[a])) {
                ctxFilename = tmp[a].split(/=/)[1];                    
                console.debug('[ FRAMEWORK ] Found context file `' + ctxFilename +'`' );
                break;
            }
        }
        

        if (ctxFilename) {

            setContext('argvFilename', _(ctxFilename, true));
            
            var importedContext = JSON.parse( fs.readFileSync(_(ctxFilename, true)) );
            
            tmp[2] = {};
            tmp[2].paths = importedContext.paths;
            tmp[2].envVars = importedContext.envVars;
            tmp[2].processList = importedContext.processList;
            tmp[2].ginaProcess = importedContext.ginaProcess;

            tmp[3] = importedContext.project;
            tmp[4] = importedContext.bundle;

            setContext('env', importedContext.env);
            setContext('bundles', importedContext.bundles);
            
            ctxObj = tmp[2];

        } else {
            throw new Error('[ FRAMEWORK ] No *.ctx file found to import context !')
        }
    } else {
        isLoadedThroughCLI = true;
        ctxObj = JSON.parse(tmp[2]);
    }


    try {
        
        require(ctxObj.paths.gina.root + '/utils/helper');
        
        setContext('paths', ctxObj.paths);//And so on if you need to.
        
        setContext('processList', ctxObj.processList);
        setContext('ginaProcess', ctxObj.ginaProcess);

        projectName = tmp[3];
        setContext('projectName', projectName);
        setContext('bundle', tmp[4]);

        var obj = ctxObj.envVars;
        var evar = '';

        if ( typeof(obj) != 'undefined') {

            for (var a in obj) {

                if (
                    a.substr(0, 5) === 'GINA_'
                    || a.substr(0, 7) === 'VENDOR_'
                    || a.substr(0, 5) === 'USER_'
                ) {
                    evar = obj[a];

                    //Boolean values.

                    if (obj[a] === "true") {
                        evar = true
                    }
                    if (obj[a] === "false") {
                        evar = false
                    }

                    setEnvVar(a, evar, true)

                }

            }
            defineDefault(obj)
        }

        
        //Cleaning process argv.
        if (isLoadedThroughCLI )
            process.argv.splice(2);
            
    } catch (error) {
        console.error('[ FRAMEWORK ][ configurationError ] ', error.stack | error.message | error)
    }
}

tmp = null;

setPath( 'node', _(process.argv[0]) );

var ginaPath = null;
try {
    ginaPath = getPath('gina').core;
} catch(err) {
    ginaPath = _(__dirname);
    setPath('gina.core', ginaPath);
    ginaPath = getPath('gina').core;
}

if ( typeof(getEnvVar) == 'undefined') {
    console.debug('[ FRAMEWORK ][PROCESS ARGV] Process ARGV error ' + process.argv);
}
//console.debug('[ FRAMEWORK ] GINA_HOMEDIR ' + getEnvVar('GINA_HOMEDIR') );
var projects    = require( _(GINA_HOMEDIR + '/projects.json') );
var root        = projects[projectName].path;

gna.executionPath = root;
setPath('project', root);



setContext('gina.utils', lib);
setContext('gina.Config', Config);
setContext('gina.locales', locales);
setContext('gina.plugins', plugins);



//Setting env.
var env = projects[projectName]['dev_env']
    , isDev = (projects[projectName]['dev_env'] === projects[projectName]['def_env']) ? true: false;

gna.env = process.env.NODE_ENV = env;
gna.env.isWin32 = process.env.isWin32 = isWin32;

//Cahceless is also defined in the main config : Config::isCacheless().
process.env.IS_CACHELESS = isDev;

var bundlesPath = (GINA_ENV_IS_DEV) ? projects[projectName]['path'] + '/src' : projects[projectName]['path'] + '/bundles';
setPath('bundles', _(bundlesPath, true));


var Router      = require('./router');
setContext('gina.Router', Router);
//TODO require('./server').http
//TODO  - HTTP vs HTTPS
var Server  = require('./server');

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
        process.argv[2] == '-s' && isLoadedThroughCLI
        || process.argv[2] == '--start' && isLoadedThroughCLI
        //Avoid -h, -v  ....
        || !isLoadedThroughCLI && isPath && process.argv.length > 3

    ) {
        if (isPath && !isLoadedThroughCLI) {
            console.debug('[ FRAMEWORK ] You are trying to load gina by hand: just make sure that your env ['+env+'] matches the given path ['+ path +']\n'+ err);
        } else if ( typeof(err.stack) != 'undefined' ) {
            console.debug('[ FRAMEWORK ] Gina could not determine which bundle to load: ' + err +' ['+env+']' + '\n' + err.stack);
        } else {
            console.debug('[ FRAMEWORK ] Gina could not determine which bundle to load: ' + err +' ['+env+']');
        }
        process.exit(1);
    }
};


gna.emit = e.emit;

/**
 * Get project conf from project.json
 *
 *
 * @param {function} callback
 * @return {object} data - Result conf object
 * */
gna.getProjectConfiguration = function (callback){

    var modulesPackage = _(root + '/project.json');
    var project     = {}
        , bundles   = [];
    
    //console.debug('modulesPackage ', modulesPackage, fs.existsSync(modulesPackage));
    //Merging with existing;
    if ( fs.existsSync(modulesPackage) ) {
        try {

            var dep = require(modulesPackage);
            //console.log('ENV: ', env );
            //console.log('PROCESS: ', process.argv );
            //console.log(" now loading....", modulesPackage);
            //console.log('content ', dep);
            if ( typeof(dep['bundles']) == "undefined") {
                dep['bundles'] = {};
            }

            if (
                typeof(dep['bundles']) != "undefined"
                && typeof(project['bundles']) != "undefined"
            ) {

                for (var d in dep) {

                    if (d == 'bundles') {
                        for (var p in dep[d]) {
                            project['bundles'][p] = dep['bundles'][p];
                        }
                    } else {
                        project[d] = dep[d];
                    }

                }
            } else {
                project = dep;
            }
            gna.project = project;

            var bundle = getContext('bundle');
            var bundlePath = getPath('project') + '/';
            bundlePath += ( GINA_ENV_IS_DEV ) ? project.bundles[ bundle ].src : project.bundles[ bundle ].release.link;

            for (var b in project.bundles) {
                bundles.push(b)
            }

            setContext('env', env);
            setContext('bundles', bundles);
            setPath('bundle', _(bundlePath, true));

            callback(false, project);
        } catch (err) {
            gna.project = project;
            callback(err);
        }

    } else {
        console.warn('[ FRAMEWORK ] Missing project !');
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
    console.debug('[ FRAMEWORK ][ MOUNT ] Source: ', source);
    console.debug('[ FRAMEWORK ][ MOUNT ]checking before mounting ', target, fs.existsSync(target), bundlesPath);
    if ( fs.existsSync(target) ) {
        try {
            fs.unlinkSync(target)
        } catch (err) {
            callback(err)
        }
    }
    if ( exists ) {
        //will override existing each time you restart.
        var pathToMount = gna.utils.generator.createPathSync(bundlesPath, function onPathCreated(err){
            if (!err) {
                try {
                    if ( type != undefined)
                        fs.symlinkSync(source, target, type)
                    else
                        fs.symlinkSync(source, target);

                    callback(false)
                } catch (err) {
                    if (err) {
                        console.emerg('[ FRAMEWORK ] '+ (err.stack||err.message));
                        process.exit(1)
                    }
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
        callback('[ FRAMEWORK ] Found no release to mount for: ', source)
    }
};


// get configuration
gna.getProjectConfiguration( function onGettingProjectConfig(err, project) {

    if (err) console.error(err.stack);

    

    /**
     * On middleware initialization
     *
     * @callback callback
     *
     * */
    gna.onInitialize = process.onInitialize = function(callback) {

        gna.initialized = true;
        e.once('init', function(instance, middleware, conf) {

            var configuration = config.getInstance();

            modelUtil.loadAllModels(
                conf.bundles,
                configuration,
                env,
                function() {

                    joinContext(conf.contexts);
                    gna.getConfig = function(name){
                        var tmp = '';
                        if ( typeof(name) != 'undefined' ) {
                            try {
                                //Protect it.
                                tmp = JSON.stringify(conf.content[name]);
                                return JSON.parse(tmp)
                            } catch (err) {
                                console.error('[ FRAMEWORK ] ', err.stack);
                                return undefined
                            }
                        } else {                            
                            tmp = JSON.stringify(conf);
                            return JSON.parse(tmp)
                        }
                    };
                    try {
                        //configureMiddleware(instance, express); // no, no and no...                        
                        callback(e, instance, middleware)
                    } catch (err) {
                        // TODO Output this to the error logger.
                        console.error('[ FRAMEWORK ] Could not complete initialization: ', err.stack)
                    }

                })// EO modelUtil

        })
    }

    /**
     * On Server started
     *
     * @callback callback
     *
     * */
    gna.onStarted = process.onStarted = function(callback) {

        gna.started = true;
        e.once('server#started', function(conf){


            // open default browser for dev env only
            // if (env == 'dev') {
            //     var payload = JSON.stringify({
            //         code    : 200,
            //         command  : "reload"
            //     });
            //
            //     if (self.ioClient) { // if client has already made connexion
            //
            //     } else {
            //         // get default home
            //         child.spawn('open', [conf.hostname])
            //     }
            // }

            // will start watchers from here
            callback()
        })
    }

    gna.onRouting = process.onRouting = function(callback) {

        gna.routed = true;
        e.once('route', function(request, response, next, params) {

            try {
                callback(e, request, response, next, params)
            } catch (err) {
                // TODO Output this to the error logger.
                console.error('[ FRAMEWORK ] Could not complete routing: ', err.stack)
            }
        })
    }

    gna.getShutdownConnector = process.getShutdownConnector = function(callback) {
        var connPath = _(bundlesPath +'/'+ appName + '/config/connector.json');
        fs.readFile(connPath, function onRead(err, content) {
            try {
                callback(err, JSON.parse(content).httpClient.shutdown)
            } catch (err) {
                callback(err)
            }
        })
    }

    gna.onError = process.onError = function(callback) {
        gna.errorCatched = true;
        e.on('error', function(err, request, response, next) {
            
            callback(err, request, response, next)
        })
    }

    gna.getShutdownConnectorSync = process.getShutdownConnectorSync = function() {
        var connPath = _(bundlesPath +'/'+ appName + '/config/connector.json');
        try {
            var content = fs.readFileSync(connPath);
            return JSON.parse(content).httpClient.shutdown
        } catch (err) {
            return undefined
        }
    }

    gna.getMountedBundles = process.getMountedBundles = function(callback) {
        fs.readdir(bundlesPath, function onRead(err, files) {
            callback(err, files)
        })
    }

    gna.getMountedBundlesSync = process.getMountedBundlesSync = function() {
        try {
            return fs.readdirSync(bundlesPath)
        } catch (err) {
            return err.stack
        }
    }

    gna.getRunningBundlesSync = process.getRunningBundlesSync = function() {

        //TODO - Do that thru IPC or thru socket. ???
        var pidPath = _(getPath('globalTmpPath') +'/pid');
        var files = fs.readdirSync(pidPath);

        var name = '';
        var indexTmp = null;

        var content = [];
        var contentGina = [];
        var shutdown = [];
        var shutdownGina = [];

        var bundleGinaPid = getContext('ginaProcess');

        //Sort Bundle / Gina instance to get a array [BUNDLE,GINA,SHUTDOWN,GINASHUTDOWN].
        for (var f=0; f<files.length; ++f) {

            name = fs.readFileSync( _(pidPath +'/'+ files[f]) ).toString();

            if ( name == "shutdown" ) {
                shutdown[0] = {};
                shutdown[0]['pid']  = files[f];
                shutdown[0]['name'] = name;
                shutdown[0]['path'] = _(pidPath +'/'+ files[f]);
            } else if ( files[f] == bundleGinaPid ){
                shutdownGina[0] = {};
                shutdownGina[0]['pid']  = files[f];
                shutdownGina[0]['name'] = name;
                shutdownGina[0]['path'] = _(pidPath +'/'+ files[f]);
            } else if ( name == "gina" ) {
                indexTmp = contentGina.length;
                contentGina[indexTmp] = {};
                contentGina[indexTmp]['pid']  = files[f];
                contentGina[indexTmp]['name'] = name;
                contentGina[indexTmp]['path'] = _(pidPath +'/'+ files[f]);
            } else {
                indexTmp = content.length;
                content[indexTmp] = {};
                content[indexTmp]['pid']  = files[f];
                content[indexTmp]['name'] = name;
                content[indexTmp]['path'] = _(pidPath +'/'+ files[f]);
            }
        }

        //Remove GINA instance, avoid killing gina bundle before/while bundle is remove.
        //Bundle kill/remove gina instance himself.
        //content = content.concat(contentGina);
        content = content.concat(shutdown);
        content = content.concat(shutdownGina);

        return content
    }

    gna.getVersion = process.getVersion = function(bundle) {
        var name = bundle || appName;
        name = name.replace(/gina: /, '');

        if ( name != undefined) {
            try {
                var str = fs.readFileSync( _(bundlesPath + '/' + bundle + '/config/app.json') ).toString();
                var version = JSON.parse(str).version;
                return version
            } catch (err) {
                return err
            }
        } else {
            return undefined
        }
    }

    /**
     * Start server
     *
     * @param {string} [executionPath]
     * */
    gna.start = process.start = function() { //TODO - Add protocol in arguments

        var core    = gna.core;
        //Get bundle name.
        if (appName == undefined) {
           var appName = getContext('bundle')
        }

        if (projectName == undefined) {
            var projectName = getContext('projectName')
        }

        //console.log('[ FRAMEWORK ] appName ', appName);
        core.projectName        = projectName;
        core.startingApp        = appName;
        core.executionPath      = root;
        core.ginaPath           = ginaPath;


        //Inherits parent (gina) context.
        if ( typeof(process.argv[3]) != 'undefined' ) {
            setContext( JSON.parse(process.argv[3]) )
        }

        //check here for mount point source...
        if ( typeof(project.bundles[core.startingApp].release.version) == 'undefined' && typeof(project.bundles[core.startingApp].tag) != 'undefined') {
            project.bundles[core.startingApp].release.version = project.bundles[core.startingApp].tag
        }
        project.bundles[core.startingApp].release.target = 'releases/'+ core.startingApp +'/' + env +'/'+ project.bundles[core.startingApp].release.version;

        var source = (isDev) ? _( root +'/'+project.bundles[core.startingApp].src) : _( root +'/'+ project.bundles[core.startingApp].release.target );
        var tmpSource = _(bundlesPath +'/'+ core.startingApp);

        var linkPath =  _( root +'/'+ project.bundles[core.startingApp].release.link );

        gna.mount( bundlesPath, source, linkPath, function onBundleMounted(mountErr) {

            if (mountErr) {
                console.error(mountErr.stack);
                process.exit(1)
            }

            if (!Config.instance) {
                config = new Config({
                    env             : env,
                    executionPath   : core.executionPath,
                    projectName     : core.projectName,
                    startingApp     : core.startingApp,
                    ginaPath        : core.ginaPath
                });
            } else {
                config = Config.instance
            }


            setContext('gina.config', config);
            config.onReady( function(err, obj){
                var isStandalone = obj.isStandalone;

                if (err) console.error(err, err.stack);

                var initialize = function(err, instance, middleware, conf) {

                    if (!err) {

                        //On user conf complete.
                        e.on('complete', function(instance){

                            server.on('started', function (conf) {

                                // catching unhandled errors
                                if ( /** /^express/.test(instance.engine) && */typeof(instance.use) == 'function' ) {
                                    instance.use( function onUnhandledError(err, req, res, next){
                                        
                                        if (arguments.length < 4) {
                                            next = res;
                                            res = req;
                                            req = err;
                                            err = false ;
                                        }
                                        
                                        if (err) {
                                            e.emit('error', err, req, res, next)
                                        } else {
                                            next()
                                        }
                                    })
                                }


                                console.info('[ FRAMEWORK ] Bundle started !',
                                    '\nbundle: [ ' + conf.bundle +' ]',
                                    '\nenv: [ '+ conf.env +' ]',
                                    '\nengine: ' + conf.server.engine,
                                    '\nprotocol: ' + conf.server.protocol,
                                    '\nscheme: ' + conf.server.scheme,
                                    '\nport: ' + conf.server.port,
                                    '\npid: ' + process.pid,
                                    '\nThis way please -> '+ conf.hostname + conf.server.webroot
                                );

                                e.emit('server#started', conf)

                            });


                            console.debug('[ FRAMEWORK ][ '+ process.pid +' ] '+ conf.bundle +'@'+ core.projectName +' mounted ! ');
                            server.start(instance);


                            // switching back logger flow
                            //console.switchFlow('default');
                        });



                        if (!mountErr) {
                            // -- BO
                            e.emit('init', instance, middleware, conf);
                            //In case there is no user init.
                            if (!gna.initialized) {
                                e.emit('complete', instance);
                            }


                            // -- EO
                        } else {

                            console.error( '[ FRAMEWORK ] Could not mount bundle ' + core.startingApp + '. ' + 'Could not mount bundle ' + core.startingApp + '. ' + (err.stack||err.message));

                            abort(err)
                        }

                    } else {
                        console.error('[ FRAMEWORK ] ', err.stack||err.message)
                    }
                };

                var opt = {
                    projectName     : core.projectName,
                    bundle          : core.startingApp,
                    //Apps list.
                    bundles         : obj.bundles,
                    allBundles      : obj.allBundles,
                    env             : obj.env,
                    isStandalone    : isStandalone,
                    executionPath   : core.executionPath,
                    conf            : obj.conf
                };

                var server = new Server(opt);
                server.onConfigured(initialize);
                

            })//EO config.
        })//EO mount.
    }

    /**
     * Stop server
     * */
    gna.stop = process.stop = function(pid, code) {
        console.info('[ FRAMEWORK ] Stopped service');
        if(typeof(code) != 'undefined')
            process.exit(code);

        process.exit()
    }

    /**
     * Get Status
     * */
    gna.status = process.status = function(bundle) {
        console.info('[ FRAMEWORK ] Getting service status')
    }
    /**
     * Restart server
     * */
    gna.restart = process.restart = function() {
        console.info('[ FRAMEWORK ] Starting service')
    }



    var appName = null, path = null;

    var packs = project.bundles;
    if (isLoadedThroughCLI) {
        if (!isPath) {
            appName = getContext('bundle');
            if (typeof (packs[appName].release.version) == 'undefined' && typeof (packs[appName].tag) != 'undefined') {
                packs[appName].release.version = packs[appName].tag
            }
            packs[appName].release.target = 'releases/' + appName + '/' + env + '/' + packs[appName].release.version;
            path = (isDev) ? packs[appName].src : packs[appName].release.target
        } else {
            path = _(process.argv[1])
        }
    } else {
        path = _(process.argv[1])
    }

    path = path.replace(root + '/', '');
    var search;
    if ((/index.js/).test(path) || p[p.length - 1] == 'index') {
        var self;
        path = (self = path.split('/')).splice(0, self.length - 1).join('/')
    }

    try {
        //finding app.
        if (!isLoadedThroughWorker) {
            var target, source, tmp;
            for (var bundle in packs) {
                //is bundle ?
                tmp = '';
                if (
                    typeof (packs[bundle].release) != 'undefined' && env == 'prod'
                    || typeof (packs[bundle].release) != 'undefined' && env == 'stage'
                ) {


                    if (typeof (packs[bundle].release.version) == 'undefined' && typeof (packs[bundle].tag) != 'undefined') {
                        packs[bundle].release.version = packs[bundle].tag
                    }
                    packs[bundle].release.target = 'releases/' + bundle + '/' + env + '/' + packs[bundle].release.version;
                    tmp = packs[bundle].release.target.replace(/\//g, '').replace(/\\/g, '');

                    if (!appName && tmp == path.replace(/\//g, '').replace(/\\/g, '')) {
                        appName = bundle;
                        break
                    }
                } else if (
                    typeof (packs[bundle].src) != 'undefined' && isDev
                ) {

                    tmp = packs[bundle].src.replace(/\//g, '').replace(/\\/g, '');
                    if (tmp == path.replace(/\//g, '').replace(/\\/g, '')) {
                        appName = bundle;
                        break
                    }
                } else {
                    abort('Path mismatched with env: ' + path)
                }
                // else, not a bundle
            }

            if (appName == undefined) {
                setContext('bundle', undefined);
                abort('No bundle found for path: ' + path)
            } else {
                setContext('bundle', appName);
                //to remove after merging gina processes into a single process.
                var projectName = getContext('projectName');
                var processList = getContext('processList');
                process.list = processList;
                var bundleProcess = new Proc(appName + '@' + projectName, process);
                bundleProcess.register(appName + '@' + projectName, process.pid)
            }

        } else {
            appName = getContext('bundle');
            var projectName = getContext('projectName');
            var processList = getContext('processList');
            process.list = processList;
            var bundleProcess = new Proc(appName + '@' + projectName, process);
            bundleProcess.register(appName + '@' + projectName, process.pid)
        }
        
        

    } catch (err) {
        abort(err)
    }


});//EO onDoneGettingProjectConfiguration.

module.exports = gna