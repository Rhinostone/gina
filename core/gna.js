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
    Server  = require('./server'),
    Util    = require('util'),
    Proc    = require('geena.utils').Proc,
    EventEmitter = require('events').EventEmitter;

Gna.Utils = require('geena.utils');
Gna.Model = require('./model');

Log     = Gna.Utils.Logger;

var e = new EventEmitter();
Gna.initialized = false;

/**
 * On middleware initialization
 *
 * @callback callback
 *
 * */
Gna.onInitialize = function(callback){

    Gna.initialized = true;

    e.on('init', function(instance, express, conf){
        addTopic(conf);
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


    if( executionPath == undefined){

        var p = new _(process.argv[1]).toUnixStyle().split("/");
        var appName = p[p.length-1].split(".")[0];
        var executionPath = "";

        for (var i=0; i<p.length-1; ++i) {
            executionPath +=  p[i] + '/';
        }

        var executionPath = executionPath.substring(0, executionPath.length-1);
    }

    core.executionPath = _(executionPath);
    core.startingApp = appName;
    core.geenaPath = _(__dirname);


    //Inherits parent (geena) context.
    setContext( JSON.parse(process.argv[3]) );

    //Setting env.
    if (env != 'undefined') {
        Log.setEnv(env);
    }
    //Setting log paths.
    Log.init({
        logs : _(core.executionPath + '/logs'),
        core: _(__dirname)
    });


    var config = new Config({
        env : env,
        executionPath : core.executionPath,
        startingApp : core.startingApp
    });

    config.onReady( function(err, obj){
        var isStandalone = obj.isStandalone;

        Log.info('geena', 'CORE:INFO:2', 'Execution Path : ' + core.executionPath);
        Log.info('geena', 'CORE:INFO:3', 'Standalone mode : ' + isStandalone);

        Server.setConf({
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
                        Server.instance = instance;
                        Server.init();
                    });
                    e.emit('init', instance, express, conf);
                    //In case there is no user init.
                    if (!Gna.initialized) {
                        e.emit('complete', instance);
                    }
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