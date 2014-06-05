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
var os          = require('os');
var Winston     = require('winston');
var logger      = require('../logger');
var Proc        = require('../proc');
var EventEmitter  = require('events').EventEmitter;
var inherits    = require('../inherits');
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
        '-i',
        '--init',
        '-s',
        '--start',
        '-av',
        '-a -v',
        '--add-views'
        //'-k',
        //'--kill',
        //'--stop',
        //'-r',
        //'--restart',
        //'-t',
        //'--status'
    ],
    allowedArguments : [
        '-t',
        '--type',
        'dev',
        'debug',
        '--stack',
        'stage',
        'prod'
    ],
    envs : ['dev', 'debug', 'stage', 'prod'],
    allowedTypes : [
        'blog',
        'cms',
        'app'
    ],
    checkEnv : function() {
        var envFound = false;
        var envs = this.envs;

        if (envs.indexOf(process.argv[4]) > -1) {
            envFound = true;
            this.env = process.argv[4]
        } else {
            process.argv[4] = this.env
        }
        return envFound
    },
    /**
     * Run cmd
     *
     * @param {object} options
     * @param {object} message
     * @param {boolean} longCMD
     * */
    run : function(options, message, longCMD){

        //inherited from utils/index.
        var root = getPath('root');
        this.options = options;
        this.msg = message;
        this.opt['option'] = process.argv[2];
        this.env = 'prod'; // by default

        if (process.argv[2] == '-s' || process.argv[2] == '--start') {
            //use registeredEnvs for this.....
            var envFound = this.checkEnv();
//            var envFound = false;
//            var envs = this.envs;
//
//            if (envs.indexOf(process.argv[4]) > -1) {
//                envFound = true;
//                this.env = process.argv[4]
//            } else {
//                process.argv[4] = this.env
//            }

            if (process.argv.length >= 5 && !envFound) {
                this.env = 'prod';
                process.argv.splice(4, 0, this.env);
            }

            this.PID = new Proc('geena', process);
            //herited from gna.js.

        } else {
            var envFound = this.checkEnv();
            this.PID = new Proc('geena', process, false);
        }

        this.PID.setMaster(process.pid);

        if (longCMD) {
            this.opt['argument'] = process.argv[4];

//            if (this.opt['option'] == 'a' || this.opt['option'] == '-add') {
//                this.opt['type'] = process.argv[5];
//            }
        } else {
            this.opt['argument'] =  process.argv[4];
        }

        if (process.argv[5] != undefined && process.argv[5].indexOf('=')) {
            var p = process.argv[5].split(/=/);
            this.opt[p[0]] = p[1];
        }

        this.bundle = process.argv[3].replace(/.js/, '');
        //Setting log paths.
        logger.setEnv(this.env);
        logger.init({
            logs    : _(this.options.root + '/logs'),
            core    : _(this.options.core)
        });
        process.env.NODE_ENV = this.env;
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
            ) +'\n'+ this.msg.app[3]);
        }
    },
    isAllowedArgument : function(opt, callback){
        var found = false;
        for (var i=0; i<this.allowedArguments.length; ++i) {
            if (this.opt['argument'] == this.allowedArguments[i]) {
                found = true;
                break
            }
        }
        if (found || this.opt['argument'] == undefined) {
            callback(true)
        } else {
            log(this.msg.default[2]
                        .replace("%arg%", this.opt['argument']));
            callback(false)
        }
    },
    isAllowedType : function(opt, callback){
        var found = false;
        for (var i=0; i<this.allowedTypes.length; ++i) {
            if (opt['type'] == this.allowedTypes[i]) {
                found = true;
                break
            }
        }
        callback(found)
    },

    isRealApp : function(callback){
        var _this = this;
        var allClear = false;
        var p, d;
        var bundle = this.bundle;
        var env = this.env;


        try {
            //This is mostly for dev.
            var pkg = require( _(this.options.root + '/project.json') ).bundles;
            if ( typeof(pkg[bundle].release.version) == 'undefined' && typeof(pkg[bundle].tag) != 'undefined') {
                pkg[bundle].release.version = pkg[bundle].tag
            }
            if (
                pkg[bundle] != 'undefined' && pkg[bundle]['src'] != 'undefined' && env == 'dev'
                || pkg[bundle] != 'undefined' && pkg[bundle]['src'] != 'undefined' && env == 'debug'
                ) {
                var path = pkg[bundle].src;

                p = _( this.options.root +"/"+ path );//path.replace('/' + bundle, '')
                d = _( this.options.root +"/"+ path + '/index.js' );
                this.bundleDir = path.replace('/' + bundle, '');
                setContext("bundle_dir", this.bundleDir);
                this.bundlesPath =  _( this.options.root +"/"+ this.bundleDir );
                this.bundleInit = d;

            } else {
                //Others releases.
                var path = 'releases/'+ bundle +'/' + env +'/'+ pkg[bundle].release.version;
                var version = pkg[bundle].release.version;
                p = _( this.options.root +"/"+ path );//path.replace('/' + bundle, '')
                d = _( this.options.root +"/"+ path + '/index.js' );

                this.bundleDir = path;
                this.bundlesPath = _(this.options.root + '/'+ this.bundleDir);
                this.bundleInit = d;
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
        fs.exists(d, function(exists) {
            if (exists) {
                //checking bundle directory.
                fs.stat(p, function(err, stats) {

                    if (err) {
                        callback(err)
                    } else {

                        if ( stats.isDirectory() ) {
                            callback(false)
                        } else {
                            callback('[ '+ d +' ] is not a directory')
                        }
                    }
                });
            } else {
                callback('[ '+ d +' ] does not exists')
            }
        })
    },
    map : function(opt){
        var _this = this;

        switch (opt['option']){
            case '-a':
            case '--add':
                this.env = 'dev';
                this.isAllowedArgument(opt, function(found) {
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
                    if (found && _this.env != 'dev') {
                        _this.build(opt.option);
                    } else {
                        var msg = _this.msg.app[5]
                            .replace("%env%", _this.env)
                            .replace("%bundle%", _this.bundle);

                        log(msg);
                    }
                });
                break;

            case '-d':
            case '--delete':
                this.env = 'dev';
                this.remove(opt);
            break;

            case '-i':
            case '--init':
                _this.isAllowedArgument(opt, function(found){
                    if (found) {
                        _this.initProject(opt.option);
                    }
                    return false;
                });
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

            case '-av':
            case '-a -v':
            case '--add-views':
                this.env = 'dev';
                this.addViews();
                break;

            case '-t':
            case '--status':
                this.env = 'dev';
                this.getStatus(opt);
                break;
        }
    },
    abort : function(code, err) {

    },
    add : function(opt) {
        try {
            var project = _(getPath('root') + '/project.json');
            var envDotJson = _(getPath('root') + '/env.json');
        } catch (err) {
            console.error(err.stack)
        }

        var bundle = this.bundle;
        try {
            //is Real bundle ?.
            if ( typeof(bundle) != 'undefined' && fs.existsSync(project[bundle]) ) {
                //existing app
                console.error('Bundle [ '+bundle+' ] already exists !')
            } else {
                var addCmd = require('./geena-add-bundle')(opt, project, envDotJson, bundle)
            }
        } catch (err) {
            console.error(err.stack);
            process.exit(1)
        }

    },
    addViews : function() {
        var _this = this;
        this.isRealApp( function(err) {
            var real = false;
            if (err) {
                console.error(err.stack);
                process.exit(1)
            }

            try {
                var addViews = require('./geena-add-views')(_this.bundle, _this.env)
            } catch (err) {
                console.error(err.stack);
                process.exit(1)
            }
        })
    },
    build : function(opt, argument) {

        console.log('Releasing build...');
        //Getting project infos.
        try {
            var project = require( _(getPath('root') + '/project.json') );
        } catch (err) {
            console.error(err.stack);
        }

        var bundle = this.bundle;
        try {
            //is Real bundle ?.
            if ( typeof(bundle) != 'undefined' && typeof(project.bundles[bundle]) != 'undefined') {
                var BuildCmd = require('./geena-build');
                if ( typeof(project.bundles[bundle]['script']) != 'undefined' && typeof(project.bundles[bundle]['script']['build']) != 'undefined') {
                    var CustomBuild = require(_(getPath('root') +'/'+ project.bundles[bundle].src + '/' + project.bundles[bundle].script.build));
                    CustomBuild = inherits(CustomBuild, BuildCmd);
                    CustomBuild = inherits( CustomBuild, EventEmitter);

                    var buildCmd = new CustomBuild(project, bundle);
                    buildCmd.init()
                } else {
                    var buildCmd = new BuildCmd(project, bundle)
                }

            } else if (bundle == undefined) {
                var buildCmd = require('./geena-build')(project)
            } else {
                console.error('Bundle [ '+ bundle +' ] not found.')
            }
        } catch (err) {
            console.error(err.stack);
            process.exit(1)
        }

    },
    initProject : function() {
        var project = process.argv[3];
        try {
            console.log('creating new project...');
            var initCmd = require('./geena-init-project')(project)
        } catch (err) {
            console.error(err.stack);
            process.exit(1)
        }
    },
    remove : function(opt){
        log('deleting app now...', opt);
    },

    restart : function(opt){
        log('restarting app now...', opt);
    },
    /**
     * Start  server
     * @param {object} opt Options
     * */
    start : function(opt){
        var _this = this;

        this.isRealApp( function(err) {
            var real = false;
            if (err) {
                console.error(err.stack)
            } else {
                real = true
            }

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
                            //Node exception. Will lead to a log(msg)
                            loggerInstance.err(msg)
                        });
                    }
                });

            } else {

                var appPath = _this.bundleInit;
                var isPath = (/\//).test(appPath);
                if (!isPath) {
                    appPath = _(_this.bundlesPath +'/'+ appPath + '/index');
                }

                process.list = (process.list == undefined) ? [] : process.list;
                setContext('processList', process.list);
                setContext('geenaProcess', process.pid);
                var params = [
                    //"--debug-brk=5858",//what ever port you want.
                    (opt['--debug-brk']) ? '--debug-brk=' + opt['--debug-brk'] : '',
                    appPath,
                    opt['argument'],
                    JSON.stringify( getContext() )//Passing context to child.
                ];



                for (var i=0; i<params.length; ++i) {
                    if (params[i] == '') {
                        params.splice(i,1);
                    }
                }

                _this.prc = spawn('node', params,
                    {
                        detached : true
                    }
                );
                _this.PID.register(_this.bundle, _this.prc.pid);

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
                        //loggerInstance.onMessage(data, function(msg){

                        logger.onMessage(data, function(msg){
                            loggerInstance[msg.level](msg);

                            //logger[msg.level](msg);
                        });
                    }

                });


                //On error. Might be useless.
                _this.prc.stderr.setEncoding('utf8');//Set encoding.
                _this.prc.stderr.on('data', function(err){

                    logger.getPath('geena', function(pathErr, path){
                        if (!pathErr) {
                            var filename = _(path +'/'+ logger.getFilename('geena'));
                             //var test = JSON.stringify({"error" :err});
                            //console.log("[TRACE]" + JSON.parse(test).error);
                            /**
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
                            });*/



                            //logger.onMessage(data, function(msg){
                                //Node exception.
                                //loggerInstance.err(msg);
                            //});
                            //logger.onMessage(data, function(msg){
                                //Node exception.
                                //loggerInstance.err(msg);
                            //});/***/
                        }
                    });
                    /**
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
                     */
                });
                /** */
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

        this.isRealApp( function(err){
            if (err) {
                console.error(err.stack);
                log(_this.msg.app[4].replace("%app%", _this.bundle));
                process.exit(1);
            }
        });
    }
};

module.exports = AppCommand;