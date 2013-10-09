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
    Server  = require('./server');

Gna.Utils = require('geena.utils');
Gna.Model = require('./model');

Log       = Gna.Utils.Logger;

/**
 * Start server
 * @param {string} executionPath - Path in option
 * */
Gna.start = function(executionPath){
    //WTF !.
    var core   = this.core,
        _this   = core,
        env     = process.argv[2];

    if(executionPath == undefined){
        var p = new _(process.argv[1]).toUnixStyle().split("/");
        var appName = p[p.length-1].split(".")[0];

        executionPath = "";
        for(var i=1; i<p.length-1; ++i){
            executionPath += '/' + p[i];
        }
    }

    core.executionPath = new _(executionPath).toString();
    core.startingApp = appName;
    core.geenaPath = new _(__dirname).toString();

    //Setting env.
    if (env != 'undefined') {
        Log.setEnv(env);
    }
    //Setting log paths.

    Log.init({
        logs : new _(core.executionPath + '/logs').toString(),
        core: new _(__dirname).toString()
    });

    Config.executionPath = core.executionPath;
    Config.startingApp = core.startingApp;
    Config.init(env, function(config){

        var isStandalone = Config.Host.isStandalone();

        Log.info('geena', 'CORE:INFO:2', 'Execution Path : ' + core.executionPath);
        Log.info('geena', 'CORE:INFO:3', 'Standalone mode : ' + isStandalone);

        //console.log("bundlde ocn f",  config.bundleConf );

        Server.setConf({
            appName         : core.startingApp,
            //Apps list.
            bundles         : config.bundles,
            allBundles      : config.allBundles,
            env             : config.env,
            isStandalone    : isStandalone,
            executionPath   : core.executionPath,
            geenaPath       : core.geenaPath,
            conf            : config.conf
        },
        function(complete){
            if (complete) {

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
                Server.init();
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