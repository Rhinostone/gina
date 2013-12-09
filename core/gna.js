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
var Gna     = {core:{}},
    Config  = require('./config'),
    server  = require('./server'),
    utils   = require('geena.utils'),
    Proc    = utils.Proc,
    EventEmitter = require('events').EventEmitter;

Gna.Utils = require('geena.utils');
//Gna.Model = require('./model');

Log     = Gna.Utils.Logger;

var e = new EventEmitter();
Gna.initialized = false;
var startWithoutGeena = false;
if( Gna.executionPath == undefined){
    var p = new _(process.argv[1]).toUnixStyle().split("/");
    var appName = p[p.length-1].split(".")[0];
    Gna.executionPath = "";
    if ( (/index.js/).test(process.argv[1]) ) {
        startWithoutGeena = true;
        appName = p[p.length-2].split(".")[0];
        //Find root ;)
        var m = _(__dirname).split("/");
        Gna.executionPath = "";
        for (var i in m) {
            if (m[i] != p[i]){
                break;
            } else {
                Gna.executionPath +=  p[i] + '/';
            }
        }
        Gna.executionPath = _( Gna.executionPath.substring(0, Gna.executionPath.length-1) );
    } else {
        for (var i=0; i<p.length-1; ++i) {
            Gna.executionPath +=  p[i] + '/';
        }
        Gna.executionPath = _( Gna.executionPath.substring(0, Gna.executionPath.length-1) );
    }

}

var root = getPath('root');
var geenaPath = getPath('geena.core');

if ( typeof(root) == 'undefined') {
    root = Gna.executionPath;
    setPath( 'root', root );
}
if ( typeof(geenaPath) == 'undefined') {
    geenaPath = _(__dirname);
    setPath('geena.core', geenaPath);
}

/**
 * On middleware initialization
 *
 * @callback callback
 *
 * */
Gna.onInitialize = function(callback){

    Gna.initialized = true;
    e.on('init', function(instance, express, conf){

        joinContext(conf.contexts);

        Gna.getConfig = function(name){
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
Gna.start = function(executionPath){

    //WTF !.
    var core    = Gna.core,
        env     = process.argv[2];

    if ( typeof(executionPath) != 'undefined' ) {
        Gna.executionPath = _(executionPath);
    } else {
        var executionPath = root;
    }


    console.error('WTF !! ', executionPath);
    //Get bundlesDir.
    console.error('getting bundlesDIR: ', process.argv[1], "[",appName,"]");

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
        Log.setEnv(env);
    }

    //Setting log paths.
    Log.init({
        logs : _(core.executionPath + '/logs'),
        core: _(__dirname)
    });
    console.error("rock n roll !!! ", core.executionPath);
    var config = new Config({
        env : env,
        executionPath : core.executionPath,
        startingApp : core.startingApp
    });
    //setContext('config', config);
    config.onReady( function(err, obj){

        Gna.Model = require('./model');

        var isStandalone = obj.isStandalone;

        Log.info('geena', 'CORE:INFO:2', 'Execution Path : ' + core.executionPath);
        Log.info('geena', 'CORE:INFO:3', 'Standalone mode : ' + isStandalone);
        server.setConf({
                appName         : core.startingApp,
                //Apps list.
                bundles         : obj.bundles,
                allBundles      : obj.allBundles,
                env             : obj.env,
                isStandalone    : isStandalone,
                executionPath   : core.executionPath,
                geenaPath       : core.geenaPath,
                conf            : obj.conf
            },
            function(err, instance, express, conf){
                if (!err) {
                    Log.debug(
                        'geena',
                        'CORE:DEBUG:1',
                        'Server conf loaded',
                        __stack
                    );

                    Log.notice(
                        'geena',
                        'CORE:NOTICE:2',
                        'Starting [' + core.startingApp + '] instance'
                    );

                    //On user conf complete.
                    e.on('complete', function(instance){
                        //server.instance = instance;
                        server.init(instance);
                    });

                    e.emit('init', instance, express, conf);
                    //In case there is no user init.
                    if (!Gna.initialized) {
                        e.emit('complete', instance);
                    }
                } else {
                    Log.error(
                        'geena',
                        'CORE:ERROR:1',
                        'Geena::Core.setConf() error. '+ err
                    );
                }
            });

    });
};

/**
 * Stop server
 * */
Gna.stop = function(pid, code){
    log("stoped server");
    if(typeof(code) != "undefined")
        process.exit(code);

    process.exit();
};

/**
 * Get Status
 * */
Gna.status = function(){
    log("getting server status");
};
/**
 * Restart server
 * */
Gna.restart = function(){
    log("starting server");
};

module.exports = Gna;