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
    Config  = require('./config.js'),
    Server  = require('./server.js');

Gna.Utils = require("geena.utils");
Log       = Gna.Utils.Logger;

/**
 * Start server
 * @param {string} executionPath - Path in option
 * */
Gna.start = function(executionPath){

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

    Config.parent = $this;

    Config.init(env, function(conf, apps, allApps){

        var isStandalone = Config.Host.isStandalone();

        Log.info('geena', 'CORE:INFO:2', 'Execution Path : ' + $this.executionPath);
        Log.info('geena', 'CORE:INFO:3', 'Standalone mode : ' + isStandalone);


        //Server.parent = $this; man...you don't need it

        Server.setConf({
            "appName" : $this.startingApp,
            "apps" : apps,//Apps list.
            "allApps" : allApps,
            "appsPath" : $this.appsPath,
            "env" : env,
            "isStandalone" : isStandalone,
            "executionPath" : $this.executionPath,
            "conf" : conf
        },
        function(done){
            if (done) {
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
Gna.stop = function(code){
    log("stoped server");
    if(typeof(code) != "undefined")
        process.exit(code);

    process.exit();
};
/**
 * Get Sttus
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
/**
Gna.core = {
    init : function(executionPath){
        var _this = this,
            error = "",
            conf = {},
            appArg = process.argv[1].split("/"),
            env = process.argv[2],
            appName = appArg[appArg.length-1];

        if(!executionPath){
            var error = {
                "error" : {
                    "code" : "1",
                    "message" : "GNA:ENV:ERR:1",
                    "explicit" : "No execution path defined. Try with Gna.init(__dirname);"
                }
            };
            this.Server.log(error);
        }
        this.executionPath = executionPath;
        this.startingApp = appName;

        this.Utils = require('./utils.js');
        this.Server = require('./server.js');
        this.Server.parent = this;

        this.Config = require('./config.js');
        this.Config.parent = this;


        this.Controller = require('./controller.js');
        this.Controller.parent = this;
        this.Controller.init();

        this.Router = require('./router.js');
        this.Router.parent = this;
        this.Router.init();

        this.Config.init(env, function(conf){
            var conf = conf,
                isStandalone = _this.Config.Host.isStandalone();

            console.log('initializing geena', '\n Exec Path : ', _this.executionPath, '\nStandalone : ', isStandalone);


            return false;
            _this.Server.setConf({
                "appName" : _this.startingApp,
                "env" : env,
                "isStandalone" : isStandalone,
                "executionPath" : _this.executionPath,
                "conf" : conf
            });
            _this.Server.init();
        });


        //console.info('la conf...', this.Server.conf);

    }
};
*/
/**
var Gna = {
    init : function(executionPath){
        if(typeof(options) != 'undefined'){
            this.options = options;
            console.log("options ", options);
        }
    }
};**/


module.exports = Gna;