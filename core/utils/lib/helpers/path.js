/*
 * This file is part of the geena package.
 * Copyright (c) 2013 Rhinostone <geena@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * PathHelper
 *
 * @package     Geena.Utils.Helpers
 * @author      Rhinostone <geena@rhinostone.com>
 * @api public
 *
 * TODO - Put debug logs
 * */
var PathHelper;

var fs = require('fs');
var Events = require('events');
var Path = require('path');
//var Util = require('util');
var extend = require('./../extend');
var ContextHelper = require('./context');
var e =  new Events.EventEmitter();
var logger = require('./../logger');
//Reminder: let listeners be removed by the V8 garbage collector.
e.setMaxListeners(100);

/**
 * PathHelper Constructor
 * @constructor
 * */
PathHelper = function(){

    this.paths = [];
    this.userPaths = {} ;
    var _this = this;

    _ = function(path){

        path = Path.normalize(path);
        var isConstructor = false;
        if (this instanceof _ // <- You could use arguments.callee instead of _ here,
            // except in in EcmaScript 5 strict mode.
            && !this.previouslyConstructedBy_) {
            isConstructor = true;
            this.previouslyConstructedBy_ = true;
        }

        if ( typeof(path) != 'undefined' && path != '' ) {

            if (isConstructor) {
                var self = _;

                //console.log("creating path record: ", path, isConstructor );
                this.path = path;
                if (process.platform == "win32") {
                    //In case of mixed slashes.
                    //this.value = path.replace(/\//g, "\\");
                    this.value = path.replace(/\\/g, "/");// Make it unix like.
                    var p = this.value;

                    this.isWindowsStyle = true;
                    this.key = path;
                    if (_this.paths.indexOf(path) < 0 ) {
                        _this.paths.push(p);
                    }
                } else {
                    //console.log("linux style");
                    //we don't want empty spaces..
                    this.value = path.replace(/\\/g, "/");
                    var p = this.value;
                    //console.log("path ", p);
                    this.key = path;
                    if (_this.paths.indexOf(path) < 0 ) {
                        _this.paths.push(p);
                    }
                }
                return this;

            } else {
                //Means that we are not in an object context.
                if (process.platform == "win32") {
                    //path = path.replace(/\//g, "\\");
                    path = path.replace(/\\/g, "/");// Make it unix like.
                    if ( _this.paths.indexOf(path) < 0) {
                        _this.paths.push(path);
                    }


                } else {
                    path = path.replace(/\\/g, "/");
                    if (_this.paths.indexOf(path) < 0) {
                        _this.paths.push(path);
                    }
                }
                return path;
            }
        }
        return null;
    };

    _.prototype.sep = Path.sep;
    _.prototype.start = (process.platform != "win32") ? "/" : "";

    /**
     * _.toString() Convert path object to string
     * @return {String} path
     *
     * Usage:
     * var myPathObj = new _("my/path/string");
     *
     * Then
     * myPathObj.toString()
     * */
    _.prototype.toString = function(){
        var self = this;
        var path = self.value;
        var i = _this.paths.indexOf(path);
        //var i = self.key;
        //console.log("path *******", path, i , self.value);
        return ( i > -1 ) ? _this.paths[i] : path;
    };

    /**
     * _.toArray() Convert path object to array
     * @return {Array} path
     *
     * Usage:
     * var myPathObj = new _("my/path/string");
     *
     * Then
     * myPathObj.toArray()
     * */
    _.prototype.toArray = function(){
        var self = this;
        var arr = toArray(self);

        arr.first = function(){
            return arr[0];
        };

        arr.index = function(i){
            if ( typeof(arr[i]) != 'undefiend')
                return arr[i];
            else
                return undefined;
        };

        arr.last = function(){
            return arr[arr.length-1];
        };

        return arr;
    };

    var toArray = function(self){
        var reg = new RegExp(/[,;/]/g);
        //Last replace just in case. I hate Windows.
        //The first element will be the letter of the drive. Windows only.
        return (typeof(self.isWindowsStyle) != "undefined" && self.isWindowsStyle == true)
            ? self.value.replace(/\\/g, "/").split(reg)
            : self.value.replace(/\\/g, "/").split(reg).splice(1);
    };

    var stringPathToArray = function(path){
        if ( typeof(path) == 'undefined' || typeof(path) != 'string') {
            logger.warn(
                'geena',
                'UTILS:PATH:WARN:2',
                'Path.stringPathToArray(path): path is empty or wrong type.',
                __stack
            );
            return undefined;
        }
        var reg = new RegExp(/[,;/]/g);
        var isWindowsStyle = (process.platform == "win32") ? true : false;

        var arr = (isWindowsStyle)
            ? path.replace(/\\/g, "/").split(reg)
            : path.replace(/\\/g, "/").split(reg).splice(1);

        arr.first = function(){
            return arr[0];
        };

        arr.index = function(i){
            if ( typeof(arr[i]) != 'undefiend')
                return arr[i];
            else
                return undefined;
        };

        arr.last = function(){
            return arr[arr.length-1];
        };

        return arr;
    };

    var cleanSlashes = function(self){
        var path = self.value;
        var a = toArray(self);
        if (a[a.length-1] == '') {
            a.splice(a.length-1, 1);
            self.value = self.start + a.join(Path.sep);
            //console.log("new val !! ", self.value);
        }
        return self;
    };

    /**
     * _.mkdir() Create a folder if doesn't exists, else return path
     *
     * @param {string} permission Folder permission
     * @callback callback
     * */
    _.prototype.mkdir = function(permission, callback){
        if ( typeof(permission) == "function") {
            var callback = permission;
            var permission = 0777;
        }
        var self = this;
        self = cleanSlashes(self);

        //Enter dir & start rm.
        //console.log("enter path: ", self.value);
        fs.exists(self.value, function(exists){
            console.log('about to create folder: ', self.value, exists);
            if (exists) {
                callback(false, self.value);
            } else {
                var p = self.value;

                mkdir(self)
                    .onComplete( function(err, path){
                        //Avoid collisions.
                        if (err) {
                            console.error("Debug needed mkdir on existing folder !! ", err);
                           // console.warn("MKDIR ERR: silently ignored.. ", path);
                           //callback("MKDIR ERR: silently ignored.. ");
                            process.exit(1);
                        } else {
                            //console.log("Woo ", "["+p+"]", " VS ","["+path+"]", (typeof(callback) != 'undefined'), ( typeof(self.created) ),(p == path  && typeof(callback) != 'undefined' && typeof(self.created) == 'undefined' ));
                            if (p == path  && typeof(callback) != 'undefined' && typeof(self.created) == 'undefined' ) {
                                //console.log("Daa");
                                if (typeof(callback) != 'undefined') {
                                    //console.log("what's wrong with mkdir ?? " + "[" + self.value +"]" + err);
                                    //self.created = true;
                                    callback(err, path);
                                } else {
                                    console.warn("no callback defined for mkdir ", path);
                                }
                            }
                        }

                    });
            }//EO exists.
        });
    };

    var mkdirEnd = function(self, err, path){
        if (!err) {
            e.emit('mkdir#complete#'+self.value, false, path);
        } else {
            e.emit('mkdir#complete#'+self.value, err, path);
        }
    };
    var mkdir = function(self, permission, pathArr, i, path){

        var addFolder = function(self, permission, pathArr, i, path) {
            //path = _(path);
            fs.mkdir(path,  function(err){
                if (!err) {
                    mkdir(self, permission, pathArr, i, path);
                } else {
                    mkdirEnd(self, err);
                }
            });
        };

        //by default.
        if ( typeof(permission) == 'undefined' ) {
            var permission = 0777;
        }

        if ( typeof(pathArr) == 'undefined' ) {
            var pathArr = toArray(self);
        }

        if ( typeof(i) == 'undefined' ) {
            var i = 0;
        }

        if (i+1 < pathArr.length) {

            if ( typeof(path) == 'undefined') {
                var path =   self.start + pathArr[0];
            } else {
            ++i;
            path += '/' + pathArr[i];
        }
            //path = _(path);
            //console.log("path is ", path, " <==> ", _(path) );
            //console.log("arr ", pathArr);
            fs.exists(path, function(exists){
                if (!exists) {
                    addFolder(self, permission, pathArr, i, path);
                } else {
                    mkdir(self, permission, pathArr, i, path);
                }
            });
        } else {
            //console.log("calling end on ", self.value);
            mkdirEnd(self, false, path);
        }
        return {
            /**
             * Complete event
             * @event mkdir#onComplete
             * */
            onComplete : function(callback){
                //console.log("listeners ", e.listeners('mkdir#complete') );
                //We want it once for the object path.
                e.on('mkdir#complete#'+self.value, function(err, path){

                    if (err) {
                        logger.error(
                            'geena',
                            'UTILS:PATH:ERROR:8',
                            ''+err,
                            __stack
                        );
                    }
                    callback(err, path);
                });
            }
        };
    };


    /**
     * copy, file or entire folder
     *
     * Usage:
     * Need object context
     *
     *  var sourceToCopy = new _(stringPath);
     *  var target = _(stringPath);
     *
     *  sourceToCopy.cp(target, function(err){
     *
     *  })
     *
     * @param {string} target
     *
     * @callback callback
     * @param {string} errResponse
     * @param {string} [pathResponse]
     * */

    _.prototype.cp = function(target, cb){
        //var self = _;
        var self = this;
        //Enter dir & start rm.
        var p = self.value;
        //console.log("starting copying ", p, " => ", target);
        cp(p, target)
            .onComplete( function(err){
                cb(err);
            });
    };

    var cp = function(source, destination){

        /**
         * BO Targeting folder content..
         * This only matters when copy is done Folder To Folder.
         *
         * TODO - Need to br [optimized] by not having to create new path object.
         * */
        var childElementsOnly = [], find;
        // ending char : / or \
        var s = new _(source).toUnixStyle();
        find = s.substr(s.length-1, 1);
        if ( find == '\/') {
            source = s.substr(0, s.length-1);
            childElementsOnly['source'] = true;
        } else {
            source = s;
            childElementsOnly['source'] = false;
        }

        // ending char : / or \
        var d = new _(destination).toUnixStyle();
        find = d.substr(d.length-1, 1);
        if ( find == '\/') {
            destination = d.substr(0, d.length-1);
            childElementsOnly['destination'] = true;
        } else {
            destination = d;
            childElementsOnly['destination'] = false;
        }
        /**
         * EO Targeting folder content..
         * */

            //Define strategy.
        fs.lstat(source, function(err, stats){
            // 1) File => Dir (add if exist else, throw error).
            // 2) File => File (create or replace if exists).
            // 3) Dir => Dir (create or replace if exists).

            if ( !stats.isDirectory() ) {
                // 1) & 2) File => Dir (add if exist else, throw error).
                copyFileToFile(source, destination, function(err){
                    e.emit("cp#complete", err);
                });
            } else {
                /**
                 * 3) Dir => Dir (create or replace if exists).
                 *
                 *  [3.A] from dir/* to dir/* || dir/* to dir
                 *      - Using this method, you have to make sure
                 *        both source & destination exist
                 *      - If not, errors will be thrown.
                 *  [3.B] form from dir to dir/*
                 *  [3.C] from  dir to dir (override if exists) equals to mv()
                 *        when creating
                 */
                //console.log("man..", childElementsOnly);
                var method = "3C", createDir;
                if (
                    childElementsOnly['source'] && childElementsOnly['destination'] ||
                        childElementsOnly['source'] && !childElementsOnly['destination']
                    ) {
                    method = "3A";
                    console.log("....calling method ", method);

                    browseCopy(source, destination, function(err){
                        console.log("copy Dir/ to Dir/ && Dir/ to Dir done");
                        e.emit("cp#complete", err);
                    });

                } else if (!childElementsOnly["source"] && childElementsOnly["destination"]) {
                    method = "3B";
                    console.log("....calling method ", method);
                    //Getting folder name.
                    var folder = new _(source).toArray().last();
                    destination += '/' + folder;

                    //console.log("MKDIR createDir");
                    var target = new _(destination).mkdir(function(err, path){
                        browseCopy(source, path, function(err){
                            //console.log("copy Dir to Dir/ done");
                            e.emit("cp#complete", err);
                        });
                    });
                } else {
                    //3C.
                    console.log("....calling method ", method);
                    var onRemoved = function(err, target){
                        // err: 99% means that it doesn't exist. Well, we don't care do we ?.
                        console.log("someshit has been triggered ! ", target);
                        //if (!err) console.log(" rm done, using same object ";
                        if (!err) {
//                            console.log(" rm done, using same object ");
//                            console.log(" about to create path ", destination);
//                            console.log("MKDIR createDir ");

                            var target = new _(destination).mkdir(function(err, path){
                                    browseCopy(source, path, function(err){
                                        //console.log("copy Dir to Dir done");
                                        //removed = true;
                                        destination = null;
                                        e.emit("cp#complete", err);
                                    });
                            });
                            //});
                        } else {
                            console.error("onRemoved error: som'was wrong ");
                            process.exit(1);
                        }
                    };

                    var d = _(destination);
                    fs.exists(d, function(exists){
                        console.log("about to remove !! ", d, exists);
                        if (exists) {
                            rm(d).onComplete( onRemoved );
                        } else {
                            onRemoved(false, d);
                        }
                    });



                }
//               console.error("Copy strategy 3C: Could not create directory for copy");
            }

        });//EO fs.lstat(source


        return {
            /**
             * Complete event
             * @event cp#onComplete
             * */
            onComplete : function(callback){
                //We want it once for the object path.
                e.on('cp#complete', function(err){
                    if (err) {
                        logger.error(
                            'geena',
                            'UTILS:PATH:ERROR:7',
                            err,
                            __stack
                        );
                    }
                    console.log('cp() complete');
                    callback(err);
                });
            }
        };

    };

    var readContent = function(source, target, callback){
        fs.readdir(source, function(err, files){
            var list = [], listTo = [];
            for (var i=0; i<files.length; ++i) {
                list[i]     = _(source +'/'+ files[i]);
                listTo[i]   = _(target +'/'+ files[i]);
            }
            callback(list, listTo);
        });
    };

    /**
     * browse & copy
     *
     * @param {string} method
     * @param {string} sourceDir
     * @param {string} destinationDir
     *
     * @callback callback
     *
     * @param {array} [list]
     * @param {array} [listTo]
     * @param {number} [i]
     * @param {number} [c]
     * @param {array} [paths]
     *
     * @private
     * */

    var end = function(callback, err) {
        //console.log("it's over !!");
        callback(err);
    };

    var browseCopy = function(sourceDir, destinationDir, callback, list, listTo, i){
        var list = ( typeof(list) != 'undefined' ) ? list : [];
        var listTo = ( typeof(listTo) != 'undefined' ) ? listTo : [];
        var i = ( typeof(i) != 'undefined' ) ? i : 0;


        if (sourceDir == undefined || destinationDir == undefined) {
            end(callback, false);
        } else {
            //console.log("browsing ", sourceDir, " => ", destinationDir, " ["+i+"]");
            fs.stat(sourceDir, function(err, stats){

                if ( stats.isDirectory() ) {
                    if ( typeof(list[i]) == 'undefined' ) {
                        list[i] = sourceDir;
                        listTo[i] = destinationDir;
                    }
                    var createDir = new _(destinationDir);

                    createDir.mkdir( function(err, path){
                        if (!err) {
                            readContent(sourceDir, destinationDir, function(_list, _listTo){

                                for (var p=0; p<_list.length; ++p) {
                                    list.push(_list[p]);
                                    listTo.push(_listTo[p]);
                                }
                                ++i;
                                browseCopy(list[i], listTo[i], callback, list, listTo, i);
                            });
                        } else {
                            console.error(err);
                        }
                    });

                } else {
                    //console.log("copy in progress: ", sourceDir, destinationDir);
                    copyFileToFile(sourceDir, destinationDir, i, function(err, file, i){
                        ++i;
                        //console.log("browsing ", i, " of ", listTo);
                        browseCopy(list[i], listTo[i], callback, list, listTo, i);
                    });
                }
            });
        }
    };

    /**
     * Copy file to  file
     *
     * @param {string} source
     * @param {string} destination
     * @param {number} [i]
     * @param {number} [fileCount]
     *
     * @callback callback
     * @param {bool|string} err
     *
     * */
    var copyFileToFile = function(source, destination, i, callback){

        fs.lstat(destination, function(err, stats){

            //Means that nothing exists. Needs create.
            if (err) {
                startCopy(source, destination, i, function(err, i){
                    //TODO - log error.
                    callback(err, source, i);
                });
            } else {

                if ( stats.isDirectory() ) {
                    var str;
                    var path = '/'+ (str = source.split(/\//g))[str.length-1];
                    destination += path
                }

                fs.exists(destination, function(replaceFlag){
                    if (replaceFlag) {
                        fs.unlink(destination, function(err){
                            //TODO - log error.
                            startCopy(source, destination, i, function(err, i){

                                callback(err, source, i);
                            });
                        });
                    } else {
                        startCopy(source, destination, i, function(err, i){
                            //TODO - log error.
                            callback(err, source, i);
                        });
                    }
                });
            }//EO if (err)
        });

        var startCopy = function(source, destination, i, callback){

            copyFile(source, destination, i, function(err, i){
                if (err) {
                    logger.error(
                        'geena',
                        'UTILS:PATH:ERROR:4',
                        err,
                        __stack
                    );
                }
                callback(err, i);
            });
        };
    };

    var copyFile = function(source, destination, i, callback){
        var sourceStream = fs.createReadStream(source);
        var destinationStream = fs.createWriteStream(destination);

        sourceStream
            .pipe(destinationStream)
            .on('error', function(){
                var err = 'Error on Path.cp(...): Not found ' + source +' or ' + destination;
                callback(err, i);
            })
            .on('close', function(){
                callback(false, i);
            });
    };


    /**
     * move or rename, file or folder
     *
     * @param {string} target
     *
     * @callback callback
     * @param {string} errResponse
     * @param {string} [pathResponse]
     * */

    _.prototype.mv = function(target, callback){

        var self = this;
        //Enter dir & start rm.
        var p = self.value;
        //console.log("mouving from ", p, " to ", target);
        mv(self, target)
            .onComplete( function(err, path){
                if (p == path && typeof(callback) != 'undefined') {
                    callback(err);
                }
            });
    };



    var mv = function(self, target){
        //console.log("starting mv/copy from ", self.value, " to ", target);
        var task = new _(self.value);
        task.cp(target, function(err){
            if (err) console.error(err);

            console.log("cp done... now unlinking source ", self.value);
            rm(self.value).onComplete( function(err, path){
                console.log('fuckn rm() complete');
                e.emit('mv#complete', err, path);
            });
        });/**.onComplete( function(err){
            e.emit('mv#complete', err, path);
        });*/
        return {
            /**
             * Complete event
             * @event mv#onComplete
             * */
            onComplete : function(callback){
                //We want it once for the object path.
                e.on('mv#complete', function(err, path){
                    if (err) {
                        logger.error(
                            'geena',
                            'UTILS:PATH:ERROR:10',
                            err,
                            __stack
                        );
                    }
                    callback(err, path);
                });
            }
        };
    };


    /**
     * rm
     *
     * @callback callback
     * @param {string} errResponse
     * @param {string} [pathResponse]
     * */
    _.prototype.rm = function(callback){
        var self = this;
        //Enter dir & start rm.
        self = cleanSlashes(self);
        var p = self.value;
        fs.exists(p, function(exists){
            console.log(" does it exists ? ", p, exists );
            if (!exists) {
                console.log("done removing ", err, path);
                callback(false, p);
            } else {
                rm(p).onComplete( function(err, path){
                    console.log("done removing... ", err);
                    //if (p == path  && typeof(callback) != 'undefined' && typeof(self.created) == 'undefined' ) {
                    //    self.created = true;
                    callback(err, path);
                    //}
                });
            }
        });



    };

    var rm = function(source){

        browseRemove(source,  function(err, path){
            console.log('rm done...', err, path, " VS ", source);
            e.emit('rm#complete', err, path);
        });

        return {
            /**
             * Complete event
             * @event rm#onComplete
             * */
            onComplete : function(callback){
                e.on('rm#complete', function(err, path){
                    if (err) {
                        logger.error(
                            'geena',
                            'UTILS:PATH:ERROR:6',
                            err,
                            __stack
                        );
                    }
                    //console.log('calling back now...', err, path);
                    //This one is listened by several rm().
                    callback(err, path);
                });
            }
        };
    };

    /**
     * Remove file, symlinks or folders recursively
     *
     * @param {string} path - Path to delete
     *
     * @callback callback
     * @param {string} errResponse
     * @param {string} [pathResponse]
     *
     * @param {array} [list] - Paths list regardless of type
     * @param {number} [i] - Path iterator
     * @param {string} [root] - Path to delete last
     * @param {array} [rootList] - List of files & folder for the path to delete
     *
     * @fires rm#onComplete
     * @fires rm#onError
     * @fires rm#onSuccess
     *
     * @private
     * */

    var removeFolders = function(list, l, i, callback) {

        if ( typeof(list[l]) == "undefined") {
            //console.log("done for good ", list[l-1][list[l-1].length -1], list);
            callback(false, list[l-1][list[l-1].length -1]);
        } else {
            //console.log(i, list[l].length-1, (i === list[l].length-1));
            if (i === list[l].length-1 ) {
                i = 0;
                //console.log("huers", i, l, list[l][i]);
                fs.rmdir(list[l][i], function(err){
                    if (err) callback(err);

                    ++l;
                    removeFolders(list, l, i, callback);
                });

            } else {
                ++i;
                //console.log("huers", i, l, list[l][i]);
                fs.rmdir(list[l][i], function(err){
                    if (err) callback(err);

                    removeFolders(list, l, i, callback);
                });
            }
        }
    };


    var readContentToRemove = function(source, list, cb){
        fs.readdir(source, function(err, files){
            if (!err) {
                if ( typeof(files) != 'undefined') {
                    for (var f=0; f<files.length; ++f) {
                        list.push( _(source +'/'+ files[f]) );
                    }
                }
                cb(list);
            } else {
                console.error(err);
            }
        });
    };

    var browseRemove = function(source, callback, list, folders, i){
        var list = ( typeof(list) != 'undefined' ) ? list : [];
        var folders = ( typeof(folders) != 'undefined' ) ? folders : [];
        var i = ( typeof(i) != 'undefined' ) ? i : 0;
        if (list.length === 0) {
            list.push(source);
        }

        if (source == undefined) {
            removeFolders( folders.reverse(), 0, 0, callback );
        } else {
            //console.log("stat: ", source, " ["+i+"]");
            fs.stat(source, function(err, stats){
                if (!err) {
                    if ( stats.isDirectory() ) {

                        if (folders.length == 0) {
                            folders[0] = [];
                            folders[0].push(source);
                        } else {
                            //console.log("want it !! ", source, " VS ", folders[0][0], folders[0][0].length );
                            var l =  source.substring( (folders[0][0].length) ).match(/\//g);
                            if (l == null) {
                                l = 0;
                            } else {
                                l = l.length;
                            }
                            if ( typeof(folders[l]) == 'undefined') {
                                folders[l] = [];
                            }
                            //console.error("le beau ", source, " vs ", folders[0][0].toString().length, " & ", source.length, ':', l);
                            folders[l].push(source);
                        }
                        //console.log("about to read dir: ", i, source);
                        readContentToRemove(source, list, function(_list){
                            ++i;
                            //console.log("now browsing next source: ", list[i]);
                            browseRemove(_list[i], callback, _list, folders, i);
                        });

                    } else {
                        //console.log("about to read file: ", i, source);
                        removeFile(source, function(err){
                            //console.log("done reading file: ", i, source);
                            ++i;
                            //console.log("now browsing next source: ", list[i]);
                            browseRemove(list[i], callback, list, folders, i);
                        });
                    }
                } else {
                    console.error(err);
                }

            });
        }
    };

    /**
     * Remove file
     *
     * @param {string} filename
     *
     * @callback callback
     * @param {string|boolean} error
     * @param {string} filename
     *
     *
     *
     * @private
     * */

    var removeFile = function(filename, callback) {
        //console.log("removing ", i, filename);
        //callback(false);
        fs.unlink(filename, function(err){
            if (err) {
                logger.emerg(
                    'geena',
                    'UTILS:PATH:EMERG:1',
                    'Locked file error: ' + filename,
                    __stack
                );
                callback(err);
            } else {
                callback(false);
            }
        });
    };



    _.prototype.toUnixStyle = function(){
        //var self = _;
        var self = this;
        var i = _this.paths.indexOf(self.value);
        return ( i > -1 ) ? _this.paths[i].replace(/\\/g, "/") : self.value;
    };

    _.prototype.toWin32Style = function(){
        //var self = _;
        var self = this;
        var i = _this.paths.indexOf(self.value);
        //var i = self.key;
        return ( i > -1 ) ? _this.paths[i].replace(/\//g, "\\") : self.value;
    };

    /**
     * Set path by name
     * @param {String} name Path name
     * @return {String}
     * */
    setPath = function(name, path){

        if ( typeof(_this.userPaths) == "undefined" || typeof(_this.userPaths[name]) == "undefined" )  {
            _this.userPaths[name] = _(path);
            //PathHelper.userPaths = _this.userPaths;
            //console.log("what is this ", Helpers, " VS ", _this.userPaths);
            var paths = getContext('paths');
            logger.info("geena", "INFO:42", " 1) got config paths " +  paths+ " VS "+ _this.userPaths, __stack);

            extend(true, paths, _this.userPaths);
            //console.log("what is this ", paths);
            setContext("paths", paths);
        }
    };

    /**
     * Get path by name
     * @param {String} name Path name
     * @return {String} path
     * */
    getPath = function(name){

        var paths = getContext('paths');
        //console.log("2) tryng to get path for ", name + ' : ' + paths[name]);
        if ( typeof(paths[name]) != "undefined" ) {
            return paths[name];
        } else {
            return undefined;
        }
    };

    getPaths = function(){
        return 'âths: ' + JSON.stringify(_this.paths, null, 4);
    };



};//EO PathHelper.

module.exports = PathHelper;