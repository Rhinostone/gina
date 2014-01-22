/*
 * This file is part of the geena package.
 * Copyright (c) 2014 Rhinostone <geena@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * AppCommand Class
 *
 * @package    Geena.Utils.Cmd
 * @author     Rhinostone <geena@rhinostone.com>
 */
var fs          = require('fs');
var spawn       = require('child_process').spawn;
var Winston     = require('winston');
var logger      = require('../logger');
var Proc        = require('../proc');
//var generator   = require('../generator');

var AppCommand = {
    opt : {},
    allowedOptions : [
        '-a',
        '--add',
        '-b',
        '--build',
        '-d',
        '--delete',
        '-s',
        '--start',
        '-k',
        '--kill',
        '--stop',
        '-r',
        '--restart',
        '-t',
        '--status'
    ],
    allowedArguments : [
        '-t',
        '--type',
        'dev',
        'debug',
        '--stack',
        'stage',
        'staging',
        'prod'
    ],
    allowedTypes : [
        'blog',
        'cms',
        'app'
    ],

    /**
     * Run cmd
     *
     * @param {object} options
     * @param {object} message
     * @param {boolean} longCMD
     * */
    run : function(options, message, longCMD){

        //herited from gna.js.
        var root = getPath('root');
        this.argv = getContext('process.argv') || process.argv;

        this.options = options;
        this.msg = message;
        this.opt['option'] = this.argv[2];

        if (this.argv[2] == '-s' || this.argv[2] == '--start') {
            this.PID = new Proc('geena', process);
            //herited from gna.js.
            this.bundle = this.argv[3].replace(/.js/, '');
        } else {
            this.PID = new Proc('geena', process, false);
        }
        this.PID.setMaster();


        if (longCMD) {
            this.opt['argument'] = this.argv[4];
            this.opt['type'] = this.argv[5];
            if (this.opt['option'] != 'a' && this.opt['option'] != '-add') {
                //this.allowedArguments(this.opt);.
                //console.log(this.msg.default[1]);.
                //return false;.
            }
        } else {
            this.opt['argument'] =  this.argv[4];
        }

        //Setting default env.
        if (this.opt['option'] != 's' && this.opt['option'] != '-start') {
            if (typeof(this.argv[4]) != 'undefined') {
                //if (process.argv[5] != 'undefined') {
                //    this.opt['argument2']  = process.argv[5];
                //}
                var env = this.argv[4];
                this.opt['argument'] = env;
            } else {
                var env = 'prod';
                this.argv[4] = env;
                this.opt['argument'] = env;
            }
            this.env = env;
        }


        //Setting log paths.
        logger.setEnv(this.env);
        logger.init({
            logs    : _(this.options.root + '/logs'),
            core    : _(this.options.core)
        });

        //console.log("=> setting my core ", this.options.core);;
        this.isAllowedOption(this.opt);
    },
    isAllowedOption : function(opt){
        var found = false;
        for (var i=0; i<this.allowedOptions.length; ++i) {
            if (opt['option'] == this.allowedOptions[i]) {
                found = true;
                break;
            }
        }
        if (found) {
            this.map(opt);
        } else {
            log(this.msg.default[0].replace(
                "%command%",
                "geena " + opt['option']
            ) + this.msg.app[3]);
        }
    },
    isAllowedArgument : function(opt, callback){
        var found = false;
        for (var i=0; i<this.allowedArguments.length; ++i) {
            if (this.opt['argument'] == this.allowedArguments[i]) {
                //Zif (typeof(this.opt['argument2']) &&)

                found = true;
                break;
            }
        }
        if (found || this.opt['argument'] == undefined) {
            callback(true);
        } else {
            log(this.msg.default[2]
                        .replace("%arg%", this.opt['argument']));
            callback(false);
        }
    },
    isAllowedType : function(opt, callback){
        var found = false;
        for (var i=0; i<this.allowedTypes.length; ++i) {
            if (opt['type'] == this.allowedTypes[i]) {
                found = true;
                break;
            }
        }
        callback(found);
    },
    isMounted : function(bundle){

    },
    isRealApp : function(callback){
        var _this = this;
        var allClear = false;
        var p, d;
        var app = this.bundle;
        var env = this.env;


        try {
            //This is mostly for dev.
            var pkg = require( _(this.options.root + '/project.json') ).packages;
            if (
                pkg[app] != 'undefined' && pkg[app]['src'] != 'undefined' && env == 'dev'
                || pkg[app] != 'undefined' && pkg[app]['src'] != 'undefined' && env == 'debug'
                ) {
                var path = pkg[app].src;

                p = _( this.options.root +"/"+ path );//path.replace('/' + app, '')
                d = _( this.options.root +"/"+ path + '/index.js' );
                this.bundleDir = path.replace('/' + app, '');
                setContext("bundle_dir", this.bundleDir);
                this.bundlesPath =  _( this.options.root +"/"+ this.bundleDir );
                this.bundleInit = d;

            } else {
                //Use releases for prod.
                var path = pkg[app].release.target;
                var version = pkg[app].release.version;
                p = _( this.options.root +"/"+ path );//path.replace('/' + app, '')
                d = _( this.options.root +"/"+ path + '/index.js' );

                //this.bundleDir = path.replace('/' + app + '/' + version, '');
                this.bundleDir = path;
                this.bundlesPath = _(this.options.root + '/'+ this.bundleDir);
//                p = _(this.options.root + '/'+this.bundleDir+'/' + this.bundle);
//                d = _(this.options.root + '/'+this.bundleDir+'/' + this.bundle + '/index.js');
                this.bundleInit = d;
//                var path = pkg[app].release.target;
//                console.error('use release');
            }

        } catch (err) {
            // default bundlesPath.
            // TODO - log warn ?
            this.bundleDir = 'bundles';
            this.bundlesPath = _(this.options.root + '/'+this.bundleDir);
            p = _(this.options.root + '/'+this.bundleDir+'/' + this.bundle);
            d = _(this.options.root + '/'+this.bundleDir+'/' + this.bundle + '/index.js');
            this.bundleInit = d;
        }



        //p = _(this.options.root + '/' + this.bundle + '.js'),
        log("checking... ", p, " && ", d, " => ", this.bundleDir);
        //process.exit(42);
        //Checking root.
        fs.exists(d, function(exists){
            if (exists) {
                //checking app directory.
                fs.stat(p, function(err, stats){

                    if (err) {
                        callback(false);
                    } else {

                        if ( stats.isDirectory() ) {
                            callback(true);
                        } else {
                            callback(false);
                        }
                    }
                });
            } else {
                callback(false);
            }
        });
    },
    map : function(opt){
        var _this = this;

        switch (opt['option']){
            case '-a':
            case '--add':
                this.isAllowedType(opt, function(found) {
                    if (found) {
                        _this.add(opt);
                    } else {
                        var msg = _this.msg.app[2]
                                .replace("%type%", opt['type'])
                                .replace("%command%", 'geena '
                                + opt['option'] +' '
                                + _this.bundle
                                +' '+ opt['argument']
                                +' '+ opt['type']);
                        log(msg);
                    }
                });
            break;

            case '-b':
            case '--build':
                _this.isAllowedArgument(opt, function(found){
                    if (found) {
                        _this.build(opt.option);
                    }
                    return false;
                });
            break;

            case '-d':
            case '--delete':
                this.remove(opt);
            break;

            case '-k':
            case '--kill':
            case '--stop':
                this.kill(opt);
            break;

            case '-r':
            case '--restart':
                this.restart(opt);
            break;

            case '-s':
            case '--start':
                _this.isAllowedArgument(opt, function(found){
                    if (found) {
                        _this.start(opt);
                    }
                    return false;
                });

            break;

            case '-t':
            case '--status':
                this.getStatus(opt);
            break;
        }
    },
    abort : function(code, err){

    },
    add : function(opt){
        log('adding app now...', opt);
    },
    build : function(opt){
        console.log('Releasing build...');
        //Getting project infos.
        try {
            var project = require( _(getPath('root') + '/project.json') );
        } catch (err) {
            console.error(err.stack);
        }

        var bundle = process.argv[3];
        if ( typeof(bundle) != 'undefined') {
            //is it a real bundle ?
            if ( typeof(project.packages[bundle]) != 'undefined' ) {

            } else {

            }
        }


        try {


            if ( typeof(bundle) != 'undefined' ) {
                var buildCmd = require('./geena-build')(project, bundle);
            } else {
                var buildCmd = require('./geena-build')(project);
            }
        } catch (err) {
            console.error(err.stack);
        }

    },
    remove : function(opt){
        log('deleting app now...', opt);
    },
    //trash...
//    kill : function(opt) {
//        log('killing app now...', opt);
//    },
    restart : function(opt){
        log('restarting app now...', opt);
    },
    /**
     * Start  server
     * @param {object} opt Options
     * */
    start : function(opt){
        var _this = this;

        this.isRealApp(function(real){

            var loggerInstance = new (Winston.Logger)({
                levels : logger.custom.levels,
                transports : [
                    new (Winston.transports.Console)({
                        colorize: true
                    })
                ],
                colors : logger.custom.colors
            });

            setContext('logger', loggerInstance);

            if (!real) {
                logger.getPath('geena', function(pathErr, path){
                    if (!pathErr) {
                        var filename = _(path +'/'+ logger.getFilename('geena'));
                        var data = '[LOG]' + JSON.stringify({
                            "filename" : filename,
                            "env" : logger.getEnv(),
                            "msg" : {
                                "logger"    : "geena",
                                "label"     : "SERVER:EMERG:1",
                                "level"     : "err",
                                "profile"   : logger.getEnv(),
                                "message"   : "SERVER:EMERG:1",
                                "explicit"  : "" + _this.msg.app[4].replace("%app%", _this.bundle)
                            }
                        });

                        logger.onMessage(data, function(msg){
                            //Node exception.
                            //logger.err(msg);
                            loggerInstance.err(msg);
                        });
                    }
                });

            } else {

                //var bundlePath = _(_this.bundlesPath);
                //var appPath = ( new RegExp(_this.bundleDir+'\/').test(bundlePath) ) ? bundlePath : bundlePath +"\/" + _this.bundleDir;
                var appPath = _this.bundleInit;
                var isPath = (/\//).test(appPath);
                if (!isPath) {
                    appPath = _(_this.bundlesPath +'/'+ appPath + '/index');
                }

                //var appPath = 'releases/agent/0.0.7-dev/index';

                //console.log("spawning ...", opt, "\n VS \n");
                //log("spawning ...", opt['argument']);
                //console.log("command ", "node ",appPath, opt['argument'], JSON.stringify( getContext() ));
//                _this.prc = spawn('node', [
//                    appPath,
//                    "dev"
//                ]);
                _this.prc = spawn('node', [
                    //"--debug-brk=63342",
                    //"--debug-brk=5858",
                    appPath,
                    opt['argument']//,
                    //JSON.stringify( getContext() )//Passing context to child.
                ],
                {
                    detached : true
                });
                // detached : true
                var bundleProcess = new Proc(_this.bundle, _this.prc);

                //On message.
                _this.prc.stdout.setEncoding('utf8');//Set encoding.
                _this.prc.stdout.on('data', function(data){
                    if ( typeof(data) == "undefined" )
                        var data = "";

                    //Catching all console.log(..)
                    // TODO - Bind or prototype console.log => logger.trace(...) to have the same stack time/order
                    if ( data.substr(0, 5) != "[LOG]" ) {
                        //console.log("traces => ", data);
                        var out = data;
                        loggerInstance["trace"](out);//Not shared with the main flow...
                        //fix it...
                        //logger.warn('geena', 'CONSOLE:LOG:1', data);
                    } else {
                        //var data = JSON.parse(data);
                        //console.log("[traces] => ", data);

                        // TODO - Few exception to take in consideration.
                        logger.onMessage(data, function(msg){
                            loggerInstance[msg.level](msg);
                        });
                    }

                });


                //On error. Might be useless.
                _this.prc.stderr.setEncoding('utf8');//Set encoding.
                _this.prc.stderr.on('data', function(err){

                    logger.getPath('geena', function(pathErr, path){
                        if (!pathErr) {
                            //var filename = _(logger.getPath('geena') +'/'+ logger.getFilename('geena'));
                            var filename = _(path +'/'+ logger.getFilename('geena'));
                            //var test = JSON.stringify({"error" :err});
                            //console.log("[TRACE]" + JSON.parse(test).error);
                            var data = '[LOG]' + JSON.stringify({
                                "filename" : filename,
                                "env" : logger.getEnv(),
                                "msg" : {
                                    "logger"    : "geena",
                                    "label"     : "SERVER:RUNTIME:ERR:2",
                                    "level"     : "err",
                                    "profile"   : logger.getEnv(),
                                    "message"   : "SERVER:RUNTIME:ERR:2",
                                    "explicit"  : "" + err
                                }
                            });

                            logger.onMessage(data, function(msg){
                                //Node exception.
                                loggerInstance.err(msg);
                            });
                        }
                    });
                });
            }
        });//EO this.isRealApp.

    },
    getStatus : function(opt){
        log('getting status for app now...', opt);
    },
    /**
     * Stop  server
     * @param {Object} opt Options
     * */
    stop : function(opt){
        var _this = this, row = "";

        this.isRealApp( function(real){
            if (!real) {
                log(_this.msg.app[4].replace("%app%", _this.bundle));
                process.exit(1);
            } else {
                //look for pid and kill it
            }
        });
    }
};

module.exports = AppCommand;