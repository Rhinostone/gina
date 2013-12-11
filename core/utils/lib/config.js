/* Geena.Utils.Config
 *
 * This file is part of the geena package.
 * Copyright (c) 2013 Rhinostone <geena@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

var Config;
//Imports.

var fs  = require('fs');
var EventEmitter = require('events').EventEmitter;
//var Extend = require('../extend');


/**
 * Config constructor
 * @contructor
 * */
Config = function() {

    var _this = this, mainConfig;
    //this.value = getContext("utils.config.value");
    try {
        this.paths = getContext("paths");
    } catch (err) {
        this.paths = {};
    }

    var path = new _(__dirname).toUnixStyle();
    this.__dirname =  _( path.substring(0, (path.length - 4)) );


    /**
     * Init Utils config
     *
     * @private
     * */
    var init = function(){

        //getting context path thru path helper.
        console.log("asking for dirname ", __dirname);
        var path = new _(__dirname).toUnixStyle();
        _this.__dirname =  _( path.substring(0, (path.length - 4)) );

        if ( _this.paths.utils == undefined)
            _this.paths.utils = _this.__dirname

        //if (_this.paths == "undefined") {

        //}


        _this.get('geena', 'locals.json', function(err, obj){

            if( !err ) {
                //console.log("LINSTING path ", obj.paths);
                mainConfig = require(obj.paths.geena + '/config')();
            } else {
                //console.log("err :: ", err);
            }

        });
    };

    /**
     * Set config file if !exists
     *
     * @param {string} app - App name
     * @param {string} file - File to save
     * @param {object} content - JSON content to save
     * */
    this.set = function(app, file, content, callback){
        switch (app) {
            case 'geena':
            case 'geena.utils':
                setFile(app, file, content, function(err){
                    callback(err);
                });
                break;
        }
    };

    /**
     * Get config file if exists
     *
     * @param {string} project - Project name
     * @param {strins} key - File name to save + .ext
     *
     * @callback callback
     * @param {string|boolean} err
     * @param {object} config - Bundle Configuration
     * */
    this.get = function(project, file, callback){

        var config = null, err = false;

        switch (project) {
            case 'geena':
            case 'geena.utils':
                try {

                    //You are under geena.utils/lib/...
                    //console.log("getting in this value ?? ", project, file, _this.value);
                    if ( typeof(_this.value) != "undefined" ) {

                        try {
                            config = _this.value;//????
                        } catch (err) {
                            err = 'Utils.Config.get(...) : _this.value['+file+'] : key not found.\n' + err;
                        }

                    } else {
                        //Getting paths.
                        if ( typeof(_this.paths.root) != "undefined" ) {
                            //console.error("requiring :=> ",  _this.paths.root + '/.gna/locals.json');
                            try {
                                config = require(_this.paths.root  + '/.gna/' + file);
                                _this.value = config;
                                _this.paths = config["paths"];

                            } catch (err) {
                                //Means that the file was not found..
                                //Create brand new.

                                err = _this.__dirname  + '/.gna/locals.json: project configuration file not found. \n' + err;
                            }
                        }

                        //console.log("got here so far ", project, file, _this.paths.root, "\n", config);
                    }

                    callback(false, config);

                } catch (err) {
                    var err = '.gna/locals.json: project configuration file not found. \n' + err;
                    logger.error('geena', 'UTILS:CONFIG:ERR:3', err, __stack);
                    callback(err);
                }
                break;

            default :
                callback('Config.get('+project+'): case not found');
        }
    };

    /**
     * Get sync config file if exists
     *
     * @param {string} app - App name
     * @return {object} config - App Configuration
     *
     * @private
     * */
    var getSync = function(project){
        if ( typeof(_this.value) != "undefined" ) {
            return _this.value;
        } else {
            try {
                return require("../.gna/locals.json");
            } catch (err) {
                logger.error('geena', 'UTILS:CONFIG:ERR:6', err, __stack);
                return null;
            }
        }
    };

    /**
     * Create a config file
     *
     * @param {string} app - Targeted application
     * @param {string} file - File save
     * @param {string} content - Content fo the file to save
     *
     *
     * TOTO - Avoid systematics file override.
     * @private
     * */
    var setFile = function(app, file, content, callback){


        var paths = {
            root : content.paths.root,
            utils : content.paths.utils
        };
        console.error("blabla conf..", file, content);
        var gnaFolder = content.paths.root + '/.gna';

        _this.project = content.project;

        _this.paths = paths;

        //Create path.
        try {

            fs.exists(gnaFolder, function(exists){
                //console.log("file exists ? ", gnaFolder, exists);

                if (!exists) {
                    //logger.error('geena', 'UTILS:CONFIG:ERR:1', err, __stack);
                    console.warn("waah ", gnaFolder+ '/' +file, gnaFolder, content);
                    fs.mkdir(gnaFolder, 0777, function(err){
                        if (err) logger.error('geena', 'UTILS:CONFIG:ERR:1', err, __stack);

                        //Creating content.
                        createContent(gnaFolder+ '/' +file, gnaFolder, content, function(err){
                            callback(err);
                        });
                    });

                } else {
                    //Means that folder was found.
                    if ( typeof(callback) != 'undefined') {
                        callback(false);
                    }
                }
//                    //Means that folder was found.
//                    /************************************************************
//                    * Will remove this row once the project generator is ready. *
//                    ************************************************************/
//                    //Remove all: start with symlink. in order to replace it.
//                    var path = _this.paths.utils + '/.gna';
//
//                    removeSymlink(path, function(err){
//                        if (err) logger.error('geena', 'UTILS:CONFIG:ERR:10', err, __stack);
//
//                        Fs.mkdir(gnaFolder, 0777, function(err){
//                            if (err) logger.error('geena', 'UTILS:CONFIG:ERR:1', err, __stack);
//
//                            //Creating content.
//                            createContent(gnaFolder+ '/' +file, gnaFolder, content, function(err){
//                                callback(err);
//                            });
//                        });
//                    });
//                }//EO if (!exists) {
            });



        } catch (err) {
            //log it.
            console.error(err);
        }
    };

    /**
     * Remove symbolic link
     *
     * @param {string} path
     * @callback callback
     *
     * @private
     * */
    var removeSymlink = function(path, callback){

        fs.exists(path, function(exists){
            if (exists) {
                fs.lstat(path, function(err, stats){
                    if (err) logger.error('geena', 'UTILS:CONFIG:ERR:11', err, __stack);

                    if ( stats.isSymbolicLink() ) fs.unlink(path, function(err){
                        if (err) {
                            logger.error('geena', 'UTILS:CONFIG:ERR:7', err, __stack);
                            callback(err);
                        } else {
                            //Trigger.
                            onSymlinkRemoved(_this.paths, function(err){
                                if (err) logger.error('geena', 'UTILS:CONFIG:ERR:9', err, __stack);

                                callback(false);
                            });
                        }
                    });
                });
            } else {
                //log & ignore. This is not a real issue.
                logger.warn('geena', 'UTILS:CONFIG:WARN:1', 'Path not found: ' + path, __stack);

                onSymlinkRemoved(_this.paths, function(err){
                    if (err) logger.error('geena', 'UTILS:CONFIG:ERR:9', err, __stack);

                    callback(false);
                });
            }
        });
    };

    /**
     * Symbolic link remove event
     *
     * @param {string} [err]
     * @callback callback
     *
     * @private
     * */
    var onSymlinkRemoved = function(paths, callback){
        //Remove original.
        var p = new _(paths.root + '/.gna');
        var path = p.toString();

        //Remove folers.
        fs.exists(path, function(exists){
            //delete when exists.
            if (exists) {
                //console.log("yeah about to delete main folder: ", p.toString());
                //Delete ans die here..
                p.rm(function(err, path){
                    //console.log("receives ", err, path);
                    if (err) {
                        logger.error('geena', 'UTILS:CONFIG:ERR:8', err, __stack);
                        callback(err);
                    } else {
                        logger.info('geena', 'UTILS:CONFIG:INFO:1', path +': deleted with success !');
                        callback(false);
                    }
                });
            }
        });
    };

    /**
     * Create content
     *
     * @param {string} filename - Fullpath
     * @content {string} content
     *
     * @private
     * */
    var createContent = function(filename, gnaFolder, content, callback){

        fs.appendFile(
            filename,
            JSON.stringify(content, null, '\t'),
            null,
            function(err){
                if (err) {
                    logger.error('geena', 'UTILS:CONFIG:ERR:2', err, __stack);
                    callback(err);
                } else {
                    callback(false);
                }
//                } else {
//                    /** doesn't work on windows */
//                    var target = content.paths.utils + '/.gna';
//                    //You never know.. could be a manual delete on one side..
//                    fs.exists(target, function(exists){
//                        if (exists) {
//                            fs.unlink(target, function(err){
//                                if (!err) Fs.symlinkSync(gnaFolder, target);
//
//                                callback(err);
//                            });
//                        } else {
//                            //Need administrator credentials on Windows. Like try to start webstorm as Administrator.
//                            try {
//                                fs.symlinkSync(gnaFolder, target);
//
//                            } catch (err) {
//                                logger.error('geena', 'UTILS:CONFIG:ERR:12', err, __stack);
//                            }
//
//                            callback(err);
//                            //process.exit(42);
//                        }
//                    });
//                }
            }//EO function
        );//EO fs.appendFile
    };

    /**
     * Get var value by namespace
     *
     * @param {string} namespace
     * @param {object} [config ] - Config object
     * @return {*} value - Can be String or Array
     *
     * @private
     * */
    var getVar = function(namespace, config) {
        if ( typeof(config) == "undefined" )
            var config = getSync(app);

        if (config != null) {
            var split = namespace.split('.'), k=0;
            while (k<split.length) {
                config = config[split[k++]];
            }
            return config;
        } else {
            return null;
        }
    };

    /**
     * Get path by app & namespance
     *
     * @param {string} app
     * @param {string} namespace
     *
     * @callback callback
     * @param {string} err
     * @param {string} path
     *
     * @private
     * */
    var getPath = function(app, namespace, callback){

        _this.get(app, function(err, config){
            if (err) {
                logger.error('geena', 'UTILS:CONFIG:ERR:4', err, __stack);
                callback(err + 'Utils.Config.get(...)');
            }

            try {
                callback( false, getVar('paths.' + namespace, config) );

            } catch (err) {
                var err = 'Config.getPath(app, cat, callback): cat not found';
                logger.error('geena', 'UTILS:CONFIG:ERR:5', err, __stack);
                callback(err);
            }
        });
    };


    /**
     * Get project name
     *
     * @return {string} projectName
     *
     * */
    this.getProjectName = function(){
        if ( this.paths != undefined && this.paths.root != undefined ) {
            var arr = this.paths.root.split("/");
            return arr[arr.length-1];
        } else {
            return null;
        }
    };


//    var getContext = function(name){
//
//        if ( typeof(name) != 'undefined' ) {
//            try {
//                return conf.content[name];
//            } catch (err) {
//                return undefined;
//            }
//        } else {
//            return conf;
//        }
//    };
//
//    var setContext = function(name, obj){
//        if ( typeof(name) == 'undefined' || name == '' ) {
//            var name = 'global';
//        }
//
//        if ( typeof(conf.content[name]) != "undefined") {
//            Extend(conf.content[name], obj);
//        } else {
//            conf.content[name] = obj;
//        }
//    };

    //init();
};


module.exports = Config;