#!/usr/bin/env node
/*
 * This file is part of the geena package.
 * Copyright (c) 2014 Rhinostone <geena@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * Add to your ~/.batch_profile the following line
 *
 *  alias geena="/usr/local/bin/node geena $@"
 */


var fs = require('fs'), vers = '0.0.8';

//Check for geena context.
var begin = function(){
    console.log('Geena Installer Tool '+ vers +' \r\n');


    /**
     * Development script
     * Use to init and get last master or release you want
     *
     *  Usage:
     *
     *  Init Geena and its dependencies
     *  -------------------------------
     *
     *  $ ./geena --install
     *
     *
     *  Update Geena and its dependencies
     *  ---------------------------------
     *
     *  $ ./geena --update
     *
     * Issues:
     * ------
     * If init or update fails, before re trying anything,
     * you need to clean .git/config by removing all submodules
     * information. When done, commit the new state or stash your changes
     * and hit this command: $ git reset
     *
     * TODO - $ ./geena --clean  &&   $ ./geena -c
     * TODO - Apply update() source to install() so we can have the choice of submodules @ install
     * TODO - $ ./geena --install specific.module.only
     * TODO - Refacto
     *
     **/

    var arg             = process.argv[2];
    //Config file for submodules.
    var modulesPackage  = './project.json';
    var npmPackage = './package.json';

    var fs              = require("fs"),
        spawn           = require('child_process').spawn,
        allowed         = ["--clean", "-i","--install", "-u","--update", "-h", "--help"];

    //By default.
    var defaultSubmodules= {
        //this mode is only used for installation
        "use_https" : false,
        "bundlesPath" : "bundles",
        "releasesPath" : "releases",
        "packages" : {
            //Wil clone main project with its dependencies along.
            "geena" : {
                //Tag number or Branch. Empty means master.
                "version" : "",
                "repo" : {
                    "ssh" : "git@github.com:Rhinostone/geena.git",
                    "https" : "https://github.com/Rhinostone/geena.git"
                }
            }
        }
    };

    var subHandler = {
        cmd : {},
        //Yeah always from the root.
        dir : __dirname.replace(/\\/g, '\/') + '/',
        //Use submodules.json with the following key: submodules.
        submodules : defaultSubmodules,
        package : {},
        useHttps : false,
        /**
         * Install Geena Project with its dependencies
         *
         * @param {array} list [optional]
         * */
        i : function(){ this.install(null);},
        install : function(list){
            //console.log("your conf \n", JSON.stringify(this.submodules, null, 4));
            var _this = this, submodules = this.submodules.packages;

            if ( typeof(list) != "undefined" && list != null ) {
                //Queue it.
                var m = list.shift();
                //var path = _this.dir + '/node_modules/' + m.replace(/\//g, '/node_modules/');
                if ( typeof(submodules[m]['src']) != 'undefined' && submodules[m]['src'] != "" ) {
                    submodules[m].src =  ( submodules[m].src.substring(0,1) != '\/') ?
                                            '/' + submodules[m].src
                                            : submodules[m].src;
                    var path = this.dir + submodules[m].src;
                } else {
                    var path = this.dir + '/node_modules/' + m.replace(/\//g, '/node_modules/');
                }

            } else {
                //First case.
                var list = [], repo = "";
                for (var m in submodules)
                    list.push(m);


                var m = list.shift();
                //var path = _this.dir + '/node_modules/' + m.replace(/\//g, '/node_modules/');
                if ( typeof(submodules[m]['src']) != 'undefined' && submodules[m]['src'] != "" ) {
                    var path = this.dir + submodules[m].src;
                } else {
                    var path = this.dir + '/node_modules/' + m.replace(/\//g, '/node_modules/');
                }

                //Get dependencies.
                if ( typeof(submodules[m]['dependencies']) != "undefined") {
                    for (var d in submodules[m]['dependencies']) {
                        //console.log("m ", m, "=> ", submodules[m]['dependencies'][d]);
                        submodules[d] = submodules[m]['dependencies'][d];
                        list.push(d);
                    }
                }
            }


            if ( typeof(submodules[m]['version']) != 'undefined' && submodules[m]['version'] != "" ) {
                var tag = submodules[m].version;
            } else {
                var tag = 'master';
            }

            if (
                typeof(submodules[m]['use_https'])!= 'undefined'  && submodules[m]['use_https'] == true
                    || typeof(submodules[m]['use_https']) != 'undefined' && submodules[m]['use_https'] == 'true'
                    || this.useHttps && typeof(submodules[m]['use_https']) == "undefined"
                ){
                var repo = submodules[m].repo.https;
                //console.log("Using HTTPS mode for " + m);
            } else {
                var repo = submodules[m].repo.ssh;
                //console.log("Using SSH mode for " + m);
            }

            try {
                //Support for multiple releases under the same directory.
                if ( fs.existsSync(path) && fs.readdirSync(path).length > 0 && submodules[m]['release'] != undefined && submodules[m]['release']['target'] != undefined && !fs.existsSync(this.dir + submodules[m].release.target) ) {
                    path = _this.dir + submodules[m].release.target;
                    tag = submodules[m].release.version;
                    this.clone( m, path, repo, tag, function(err, module){

                        if (submodules[m]['release']['target']['link'] != undefined) {
                            if (list.length > 0) {
                                _this.install(list);
                            }
                        } else if (list.length > 0) {
                            _this.install(list);
                        }
                    });
                } else if ( fs.existsSync(path) && fs.readdirSync(path).length > 0) {
                    console.warn("Submodule ["+ m +"] already installed. Won't override.");
                    if (list.length > 0) {
                        _this.install(list);
                    } else {
                        this.end();
                    }
                } else {
                    console.info(
                        "module: " + m,
                        "\npath: " + path,
                        "\nrepo: " +repo,
                        "\ntag: " + tag
                    );
                    //console.log("==>", this.useHttps, (typeof(submodules[m]['repo']['use_https']) == "undefined" ));

                    _this.clone( m, path, repo, tag, function(err, module){
                        if (err) {
                            console.error(err, "this.clone( m, path, repo, tag, callback){...}");
                            process.exit(1);
                        }

                        //Unpack if bundle.
                        console.info("checking: ", submodules[m]['release']);
                        //if (submodules[m]['release'] != undefined) {
                        //    console.log(" => ",  submodules[m]['release']['target']);
                        //}
                        if (submodules[m]['release'] != undefined && submodules[m]['release']['target'] != undefined) {
                            console.info("Unpacking: ", m);
                            path = _this.dir + submodules[m].release.target;
                            tag = submodules[m].release.version;
                            _this.clone( m, path, repo, tag, function(err, module){
                                if (submodules[m]['release']['target']['link'] != undefined) {
                                    //console.log(" => ",  submodules[m]['release'].link);
                                    if (list.length > 0) {
                                        _this.install(list);
                                    }
                                } else if (list.length > 0) {
                                    _this.install(list);
                                }
                            });
                        } else if (list.length > 0) {//Get next task in list.
                            _this.install(list);
                        } else {
                            _this.end();
                        }


                    });
                }
            } catch (err) {
                console.error(err, "this.clone() call");
            }


        },
        /**
         * Clone project and dependencies
         *
         * @param {string} module
         * @param {string} path
         * @param {string} repo
         * @param {string} tag
         * @param {function} module
         * */

        clone : function(module, path, repo, tag, callback){
            var cmd = spawn('git', [
                'clone',
                '-b',
                tag,
                repo,
                path
            ]);

            cmd.stdout.setEncoding('utf8');
            cmd.stdout.on('data', function(data){
                var str = data.toString();
                var lines = str.split(/(\r?\n)/g);

                console.log("clone... ", module);
                console.log(lines.join(""));
            });

            cmd.stderr.on('data',function (err) {
                var str = err.toString();
                var lines = str.split(/(\r?\n)/g);

                console.error('[info] ');
                console.error(str);
            });

            cmd.on('close', function (code) {
                if (!code) {
                    console.log(module, ' submodule done with success');
                    callback(false, module);
                } else {
                    callback('[error] '+ code);
                }
            });
        },

        /**
         * Update existing sources for Geena Project with its dependencies
         *
         * @param {string} release - Release number
         * */
        u : function(){ this.update(null);},
        update : function(list){
            var _this = this, submodules = this.submodules.packages;


            if ( typeof(list) != "undefined" && list != null ) {
                //Queue it.
                m = list.shift(),
                tag = submodules[m].version;
                //path = _this.dir + '/node_modules/' + m.replace(/\//g, '/node_modules/');

                if ( typeof(submodules[m]['src']) != 'undefined' && submodules[m]['src'] != "" ) {
                    submodules[m].src =  ( submodules[m].src.substring(0,1) != '\/') ?
                        '/' + submodules[m].src
                        : submodules[m].src;
                    var path = this.dir + submodules[m].src;
                } else {
                    var path = this.dir + '/node_modules/' + m.replace(/\//g, '/node_modules/');
                }
            } else {
                //First case.
                var list = [];
                for (var m in submodules)
                    list.push(m);

                var m = list.shift();


                //Get dependencies.
                if ( typeof(submodules[m]['dependencies']) != "undefined") {
                    for (var d in submodules[m]['dependencies']) {
                        //console.log("m ", m, "=> ", submodules[m]['dependencies'][d]);
                        submodules[d] = submodules[m]['dependencies'][d];
                        list.push(d);
                    }
                }


                var tag = submodules[m].version;
                //var path = _this.dir + '/node_modules/' + m.replace(/\//g, '/node_modules/');
                if ( typeof(submodules[m]['src']) != 'undefined' && submodules[m]['src'] != "" ) {
                    submodules[m].src =  ( submodules[m].src.substring(0,1) != '\/') ?
                        '/' + submodules[m].src
                        : submodules[m].src;
                    var path = this.dir + submodules[m].src;
                } else {
                    var path = this.dir + '/node_modules/' + m.replace(/\//g, '/node_modules/');
                }
            }

            _this.pull(m, path, tag, function(done, module){
                //Get next task in list.
                if (list.length > 0) {
                    _this.update(list);
                } else {
                    this.end('update');
                }
            });
        },
        /**
         * Pull command
         *
         * */
        pull : function(module, path, tag, callback){
            if ( fs.existsSync(path) ) {

                tag = (typeof(tag) != "undefined" && tag != "") ? tag : "master";

                //console.log("about to enter ", path);
                process.chdir(path);//CD command like.

                var gitFetch = function(){
                    var git = spawn('git', ['fetch']);

                    git.stdout.setEncoding('utf8');
                    git.stdout.on('data', function(data){
                        var str = data.toString();
                        var lines = str.split(/(\r?\n)/g);
                        console.log(lines.join(""));
                    });

                    git.stderr.on('data',function (err) {
                        var str = err.toString();
                        var lines = str.split(/(\r?\n)/g);
                        console.log(lines.join(""));
                    });

                    git.on('close', function (code) {
                        if (!code) {
                            console.log('Fetch command done.');
                            //Trigger checkout command.
                            gitCheckout();

                        } else {
                            console.log('process exit with error code ' + code);
                        }
                    });
                };

                var gitCheckout = function(){

                    var git = spawn('git', ['checkout', tag]);

                    git.stdout.setEncoding('utf8');
                    git.stdout.on('data', function(data){
                        var str = data.toString();
                        var lines = str.split(/(\r?\n)/g);
                        console.log(lines.join(""));
                    });

                    git.stderr.on('data',function (err) {
                        var str = err.toString();
                        var lines = str.split(/(\r?\n)/g);

                        if ( !str.match("Already on") ) {
                            console.log(lines.join(""));
                        }

                    });

                    git.on('close', function (code) {
                        if (!code) {
                            console.log('Checking out: ', "[" + module + "] " + tag);
                            //Trigger pull command.
                            gitPull();

                        } else {
                            console.log('process exit with error code ' + code);
                        }
                    });
                };


                var gitPull = function() {
                    var git = spawn('git', ['pull', 'origin', tag]);

                    git.stdout.setEncoding('utf8');
                    git.stdout.on('data', function(data){
                        var str = data.toString();
                        var lines = str.split(/(\r?\n)/g);
                        console.log(lines.join(""));
                    });

                    git.stderr.on('data',function (err) {
                        var str = err.toString();
                        var lines = str.split(/(\r?\n)/g);
                        if ( str.match("errno=Operation timed out") ) {

                            console.log("\n[error] Could not connect to GitHub" +
                                "\n 1) PLease check your firewall configuration and make sure Git ports are open" +
                                "\n 2) Check if you are not behind a proxy");

                            console.log(
                                "If you are behind a proxy, you might have to contact your system administrator.");

                            process.exit(1);
                        } else {
                            console.log(lines.join(""));
                        }
                    });

                    git.on('close', function (code) {
                        if (code) {
                            console.log('process exit with error code ' + code);
                            callback(false, module);
                        } else {
                            callback(true, module);
                        }
                    });
                };

                //Starting update.
                gitFetch();

            } else {
                console.warn("[warn]: path not found ", path);
                console.warn("Geena could not load ", module);
            }
        },
        h : function(){ this.help();},
        help : function(){
            console.log(
                "usage:\n" +
                "\nInstalling Geena" +
                "\n     $ geena -i" +
                "\n or" +
                "\n     $ geena --install" +
                "\n" +
                "\nUpdating or downgrading Geena" +
                "\n     $ geena -u <version>" +
                "\n or" +
                "\n     $ geena --update <version>" +
                "\n\nNB.: leave <version> empty if you are looking for the latest.\n"
            );
        },

        npmInstall : function(i, callback){
            var _this = this;
            var module = this.package[i];

            var path = this.dir;
            process.chdir(path);//CD command like.

            var npmInstall = function(i, callback){
                var npmCmd = (process.platform === "win32" ? "npm.cmd" : "npm");
                var npm = spawn(npmCmd, ['install', module]);

                npm.stdout.setEncoding('utf8');
                npm.stdout.on('data', function(data){
                    var str = data.toString();
                    var lines = str.split(/(\r?\n)/g);
                    console.log(lines.join(""));
                });

                npm.stderr.on('data',function (err) {

                    var str = err.toString();
                    var lines = str.split(/(\r?\n)/g);

                    if ( !str.match("Already on") ) {
                        console.log(lines.join(""));
                    }
                });

                npm.on('close', function (code) {
                    if (!code) {
                        console.log('NPM install done');
                        //... log transaction ??? maybe later..
                    } else {
                        console.log('process exit with error code ' + code);
                    }
                    _this.npmInstall(i+1, callback);
                });
            };

            //end.
            if ( typeof(module) == 'undefined' ) {
                callback(false);
            } else {
                npmInstall(i, callback);
            }

        },
        createPath : function(path, callback) {
            var t = path.replace(/\\/g, '\/').split('/');
            var path = '';
            //creating folders
            try {
                for (var p=0; p<t.length; ++p) {
                    if (process.platform == 'win32' && p === 0) {
                         path += t[p];
                    } else {
                        path += '/' + t[p];
                    }
                    if ( !fs.existsSync(path) ) {
                        fs.mkdirSync(path);
                    }
                }
                callback(false);
            } catch (err) {
                callback(err);
            }
        },
        createPaths : function(paths, p, callback){
            var _this = this;
            if (p == paths.length-1) {
                //end.
                callback(false);
            }

            paths[p] = paths[p].replace(/\\/g, '\/');
            paths[p] = paths[p].replace(/\/\//g, '/');
            //console.log("about to create ", p, paths[p]);
            this.createPath(paths[p], function(err){
                if (err)
                    callback(err)
                else
                    _this.createPaths(paths, p+1, callback);
            });
        },
        end : function(task){
//            if (task == undefined) {
//                var task = 'install';
//            }

//            if (task == 'install' && this.submodules['npm'] != undefined &&  this.submodules['npm'] ) {
//                this.npmInstall(function(err){
//                    console.log("nothing to do ", task, " done.")
//                });
//            }

        },
        /**
         * Clean on fails
         *
         * */
        clean : function () {
            //check for git project.
            var path = "./.git/config";
            if ( fs.existsSync(path) ) {

            } else {
                console.error("Sorry, [./git/config] not found. Geena can not clean().");
            }
            //...TODO
        },
        /**
         * Get project conf from project.json
         *
         *
         * @param {function} callback
         * @return {object} data - Result conf object
         * */
        getProjectConfiguration : function (callback){
            var _this = this;

            //Merging with existing;
            if ( fs.existsSync(modulesPackage) ) {
                try {
                    var dep = require(modulesPackage);

                    if (
                        typeof(dep.use_https) != "undefined" && dep.use_https == true
                        || typeof(dep.use_https) != "undefined" && dep.use_https == "true"
                ) {
                        _this.useHttps = true;
                    }

                    if ( typeof(dep['packages']) == "undefined") {
                        dep['packages'] = {};
                    }

                    if (
                        typeof(dep['packages']) != "undefined"
                        && typeof(_this.submodules['packages']) != "undefined"
                    ) {

                        for (var d in dep) {

                            if (d == 'packages')
                                for (var p in dep[d]) _this.submodules['packages'][p] = dep['packages'][p];
                            else
                                _this.submodules[d] = dep[d];

                        }
                    } else {
                        _this.submodules = dep;
                    }

                    callback(false);
                } catch (err) {
                    callback(err);
                }

            } else {
                callback(false);
            }
        },
        getNpmPackage : function(callback){
            var i=0;

            if ( fs.existsSync(npmPackage) ) {
                try {
                    var dep = require(npmPackage).dependencies;

                    for (var d in dep) {
                        console.error("check ", d, i);
                        if ( typeof(dep[d]) != 'undefined' && dep[d] != '' ){
                            this.package[i] = d+'@'+dep[d];
                        } else {
                            this.package[i] = d;
                        }
                        ++i;
                    }

                    this.npmInstall(0, function(err) {
                        callback(err);
                    });
                } catch (err) {
                    callback(err);
                }
            } else {
                callback(false);
            }
        }
    };



    if (process.argv.length < 3) {
        console.log("Command geena must have argument(s) !");
        console.log("usage: \n $ ./geena -i\n $ ./geena --install <version>\n $ ./geena --clean");
    } else {

        //Get submodules config.
        subHandler.getProjectConfiguration( function(err){
            if (err) console.error(err + ' getProjectConfiguration => callback');

            subHandler.createPaths(
                [
                    subHandler.dir + '/tmp',
                    subHandler.dir + '/logs',
                    subHandler.dir + '/' + subHandler.submodules.bundlesPath,
                    subHandler.dir + '/' + subHandler.submodules.releasesPath
                ],
                0,
                function(err){
                    //console.log("About to load submodules ", JSON.stringify(subHandler.submodules, null, 4)); process.exit(42);
                    if (!err) {

                        allowed.forEach( function(i){
                            if (arg == i) {
                                i = i.replace(/-/g, '');
                                var task = undefined;
                                switch (i) {
                                    case 'i':
                                    case 'install':
                                        task = 'install';
                                    break;

                                    case 'u':
                                    case 'update':
                                        task = 'update';
                                    break;
                                }
                                try {

                                    if ( task == 'install' && subHandler.submodules['npm'] != undefined &&  subHandler.submodules['npm'] ) {
                                        subHandler.getNpmPackage( function(err){
                                            subHandler[i]();
                                        });

                                    } else {
                                        subHandler[i]();
                                    }
                                } catch(err) {
                                    if (err) console.error(err,  subHandler[i]);
                                }
                            }
                        });
                    }
            });


        });

    }
};

if (
    process.argv[2] != "-u"
    && process.argv[2] != "--update"
    && process.argv[2] != "-i"
    && process.argv[2] != "--install"
) {

    try {

        require('./node_modules/geena/node_modules/colors');

        var utils = require("./node_modules/geena/core/utils");
        utils.log('Geena Command Line Tool \r\n'.rainbow);
        utils.cmd.load(__dirname, "/node_modules/geena/package.json");
    } catch (err) {
        console.error(err);
        console.error(err.stack);
    }

} else {
    begin();
};