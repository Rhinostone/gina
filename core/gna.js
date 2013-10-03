/*
 * This file is part of the geena package.
 * Copyright (c) 2009-2013 Rhinostone <geena@rhinostone.com>
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
    var $this   = this.core,
        _this   = $this,
        env     = process.argv[2];

    if(executionPath == undefined){
        var p = process.argv[1].split("/");
        var appName = p[p.length-1].split(".")[0];

        executionPath = "";
        for(var i=1; i<p.length-1; ++i){
            executionPath += '/' + p[i];
        }
    }

    $this.executionPath = _(executionPath);
    $this.startingApp = appName;
    //Setting env.
    if (env != 'undefined') {
        Log.setEnv(env);
    }
    //Setting log paths.
    Log.init({
        logs : _($this.executionPath + '/logs'),
        core: __dirname
    });

    Config.executionPath = $this.executionPath;
    Config.startingApp = $this.startingApp;
    Config.init(env, function(config){

        var isStandalone = Config.Host.isStandalone();

        Log.info('geena', 'CORE:INFO:2', 'Execution Path : ' + $this.executionPath);
        Log.info('geena', 'CORE:INFO:3', 'Standalone mode : ' + isStandalone);

        //console.log("bundlde ocn f",  config.bundleConf );

        Server.setConf({
            appName         : $this.startingApp,
            //Apps list.
            bundles         : config.bundles,
            allBundles      : config.allBundles,
            env             : config.env,
            isStandalone    : isStandalone,
            executionPath   : $this.executionPath,
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
                    'Starting [' + $this.startingApp + '] instance'
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