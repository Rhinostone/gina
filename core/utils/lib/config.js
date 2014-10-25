/* Gina.Utils.Config
 *
 * This file is part of the gina package.
 * Copyright (c) 2014 Rhinostone <gina@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */


//Imports.
var fs      = require('fs');
var console = require('./logger');


/**
 * Config constructor
 * @contructor
 * */
function ConfigUtil() {

    var self = this; //, mainConfig

    /**
     * Init
     * @contructor
     * */
    var init = function() {

        if ( !ConfigUtil.instance ) {
            try {
                self.paths = getContext("paths")
            } catch (err) {
                self.paths = {}
            }

            var path = new _(__dirname).toUnixStyle();
            self.__dirname =  _( path.substring(0, (path.length - 4)) );

            ConfigUtil.instance = self;
            return self
        } else {
            self = ConfigUtil.instance;
            return ConfigUtil.instance
        }
    }


    ///**
    // * Init Utils config
    // *
    // * @private
    // * */
    //var init = function(){
    //
    //    //getting context path thru path helper.
    //    console.log("asking for dirname ", __dirname);
    //    var path = new _(__dirname).toUnixStyle();
    //    self.__dirname =  _( path.substring(0, (path.length - 4)) );
    //
    //    if ( self.paths.utils == undefined) {
    //        self.paths.utils = self.__dirname
    //    }
    //
    //    self.get('gina', 'locals.json', function(err, obj){
    //        if( !err ) {
    //            mainConfig = require(obj.paths.gina + '/config')()
    //        } else {
    //            console.log(err.stack)
    //        }
    //    })
    //}

    /**
     * Set config file if !exists
     *
     * @param {string} app - App name
     * @param {string} file - File to save
     * @param {object} content - JSON content to save
     * */
    this.set = function(app, file, content, callback){
        switch (app) {
            case 'gina':
            case 'gina.utils':
                setFile(app, file, content, function(err){
                    callback(err);
                });
                break;
        }
    }

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
            case 'gina':
            case 'gina.utils':
                try {
                    //You are under gina.utils/lib/...
                    if ( typeof(self.value) != "undefined" ) {

                        try {
                            config = self.value;//????
                        } catch (err) {
                            err = 'Utils.Config.get(...) : self.value['+file+'] : key not found.\n' + err;
                        }

                    } else {
                        //Getting paths.
                        if ( typeof(self.paths.root) != "undefined" ) {
                            //console.error("requiring :=> ",  self.paths.root + '/.gna/locals.json');
                            try {
                                config = require(self.paths.root  + '/.gna/' + file);
                                self.value = config;
                                self.paths = config["paths"];

                            } catch (err) {
                                //Means that the file was not found..
                                err = self.__dirname  + '/.gna/locals.json: project configuration file not found. \n' + err;
                            }
                        }
                    }
                    callback(false, config)

                } catch (err) {
                    var err = new Error('.gna/locals.json: project configuration file not found. \n' + (err.stack||err.message));
                    //logger.error('gina', 'UTILS:CONFIG:ERR:3', err, __stack);
                    callback(err);
                }
                break;

            default :
                callback('Config.get('+project+'): case not found');
        }
    }

    /**
     * Get sync config file if exists
     *
     * @param {string} app - App name
     * @return {object} config - App Configuration
     *
     * @private
     * */
    this.getSync = function(project, file){
        if (typeof(file) == 'undefined') {
            var file = 'locals.json'
        }

        if ( typeof(self.value) != "undefined" ) {
            return self.value;
        } else {
            var filename = self.paths.root +'/.gna/'+ file;
            try {
                if ( fs.existsSync(filename) ) {
                    return require(filename)
                } else {
                    var err = new Error(filename+ ' not found');
                    console.emerg(err.stack||err.message);
                    return undefined
                }
            } catch (err) {
                console.error(err.stack);
                throw new Error(err.message);

            }
        }
    }

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
    var setFile = function(app, file, content, callback) {

        var paths = {
            root : content.paths.root,
            utils : content.paths.utils
        };
        console.error("blabla conf..", file, content);
        var gnaFolder = content.paths.root + '/.gna';

        self.project = content.project;

        self.paths = paths;

        //Create path.
        try {

            var createFolder = function(){
                if ( fs.existsSync(gnaFolder) ) {
                    callback(false);
                } else {
                    fs.mkdir(gnaFolder, 0777, function(err){
                        if (err) {
                            console.error(err.stack);
                            callback(err)
                        } else {
                            //Creating content.
                            createContent(gnaFolder+ '/' +file, gnaFolder, content, function(err){
                                callback(err)
                            })
                        }
                    })
                }

            };

            fs.exists(gnaFolder, function(exists){
                //console.log("file exists ? ", gnaFolder, exists);
                if (exists) {
                    var folder = new _(gnaFolder).rm( function(err){
                        if (!err) {
                            createFolder()
                        } else {
                            callback(err)
                        }
                    })
                } else {
                    createFolder()
                }
            //logger.error('gina', 'UTILS:CONFIG:ERR:1', err, __stack);
//                    console.warn("waah ", gnaFolder+ '/' +file, gnaFolder, content);
//                    fs.mkdir(gnaFolder, 0777, function(err){
//                        if (err) logger.error('gina', 'UTILS:CONFIG:ERR:1', err, __stack);
//
//                        //Creating content.
//                        createContent(gnaFolder+ '/' +file, gnaFolder, content, function(err){
//                            callback(err);
//                        });
//                    });

//                } else {
//                    //Means that folder was found.
//                    if ( typeof(callback) != 'undefined') {
//                        callback(false);
//                    }
//                }

//                    //Means that folder was found.
//                    /************************************************************
//                    * Will remove this row once the project generator is ready. *
//                    ************************************************************/
//                    //Remove all: start with symlink. in order to replace it.
//                    var path = self.paths.utils + '/.gna';
//
//                    removeSymlink(path, function(err){
//                        if (err) logger.error('gina', 'UTILS:CONFIG:ERR:10', err, __stack);
//
//                        Fs.mkdir(gnaFolder, 0777, function(err){
//                            if (err) logger.error('gina', 'UTILS:CONFIG:ERR:1', err, __stack);
//
//                            //Creating content.
//                            createContent(gnaFolder+ '/' +file, gnaFolder, content, function(err){
//                                callback(err);
//                            });
//                        });
//                    });
//                }//EO if (!exists) {
            })
        } catch (err) {
            //log it.
            console.error(err)
        }
    }

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
                    if (err) console.error(err.stack);

                    if ( stats.isSymbolicLink() ) fs.unlink(path, function(err){
                        if (err) {
                            console.error(err.stack);
                            callback(err)
                        } else {
                            //Trigger.
                            onSymlinkRemoved(self.paths, function(err){
                                if (err) console.error(err.stack);

                                callback(false)
                            })
                        }
                    })
                })
            } else {
                //log & ignore. This is not a real issue.
                //logger.warn('gina', 'UTILS:CONFIG:WARN:1', 'Path not found: ' + path, __stack);
                console.warn( 'Path not found: ' + path, __stack);
                onSymlinkRemoved(self.paths, function(err){
                    //if (err) logger.error('gina', 'UTILS:CONFIG:ERR:9', err, __stack);
                    if (err) console.error(err.stack||err.message);

                    callback(false)
                })
            }
        })
    }

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
                        //logger.error('gina', 'UTILS:CONFIG:ERR:8', err, __stack);
                        console.error(err.stack||err.message);
                        callback(err)
                    } else {
                        //logger.info('gina', 'UTILS:CONFIG:INFO:1', path +': deleted with success !');
                        console.info( path +': deleted with success !');
                        callback(false)
                    }
                })
            }
        })
    }

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
                    //logger.error('gina', 'UTILS:CONFIG:ERR:2', err, __stack);
                    console.error(err.stack||err.message);
                    callback(err)
                } else {
                    callback(false)
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
//                                logger.error('gina', 'UTILS:CONFIG:ERR:12', err, __stack);
//                            }
//
//                            callback(err);
//                            //process.exit(42);
//                        }
//                    });
//                }
            }//EO function
        )//EO fs.appendFile
    }

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
            var config = self.getSync(app);

        if (config != null) {
            var split = namespace.split('.'), k=0;
            while (k<split.length) {
                config = config[split[k++]]
            }
            return config
        } else {
            return null
        }
    }

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

        self.get(app, function(err, config){
            if (err) {
                //logger.error('gina', 'UTILS:CONFIG:ERR:4', err, __stack);
                console.error(err.stack||err.message);
                callback(err + 'Utils.Config.get(...)');
            }

            try {
                callback( false, getVar('paths.' + namespace, config) );

            } catch (err) {
                var err = new Error('Config.getPath(app, cat, callback): cat not found');
                callback(err)
            }
        })
    }


    /**
     * Get project name
     *
     * @return {string} projectName
     *
     * */
    this.getProjectName = function(){
        if ( this.paths != undefined && this.paths.root != undefined ) {
            var arr = this.paths.root.split("/");
            return arr[arr.length-1]
        } else {
            return null
        }
    }

    return init()
};

module.exports = ConfigUtil