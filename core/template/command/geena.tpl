#!/usr/bin/env node
/*
 * This file is part of the geena package.
 * Copyright (c) 2013 Rhinostone <geena@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * Add to your ~/.batch_profile the following line
 *
 *  alias geena="/usr/local/bin/node geena $@"
 */


var Fs = require('fs');
//Check for geena context.
if (
    Fs.existsSync('./node_modules/geena') && Fs.existsSync('./node_modules/geena/node_modules/geena.utils')
    && process.argv[2] != "-u"
    && process.argv[2] != "--update"
) {

    require('./node_modules/geena/node_modules/colors');

    var Utils = require("geena").Utils;
    Utils.log('Geena Command Line Tool \r\n'.rainbow);
    Utils.Cmd.load(__dirname, "/node_modules/geena/package.json");
} else {

    console.log('Geena Installer Tool \r\n');


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
     * TODO - $ ./geena --clean
     * TODO - Apply update() source to innstall() so we can have the choice of submodules @ install
     * TODO - Refacto
     *
     **/

    var arg     = process.argv[2];
    var Fs      = require("fs"),
        Spawn   = require('child_process').spawn,
        allowed = ["--clean", "-i","--install", "-u","--update"];

    //By default.
    var defaultSubmodules= {
        //Means node_modules/geena/node_modules/geena.utils
        "geena/geena.utils": {
            "version" : "",
            "repo" : "https://github.com/Rhinostone/geena.utils.git"
        },
        //Order matters.
        "geena" : {
            "version" : "",
            "repo" : "https://github.com/Rhinostone/geena.git"
        }
    };


    var subHandler = {
        cmd : {},
        //Yeah always from the root.
        dir : __dirname,
        //Use package.json with the following key: projectDependencies
        submodules : defaultSubmodules,
        /**
         * Install Geena Project with its dependencies
         *
         * */
        i : function(){ this.install(arguments);},
        install : function(release){
            var release = (typeof(release) != "undefined" && release != "") ? release : "master";

            this.dir = __dirname;
            this.cmd = Spawn('git', [
                'submodule',
                'add',
                '-f',
                'https://github.com/Rhinostone/geena.git',
                'node_modules/geena'
            ]);

            this.cmd.stdout.setEncoding('utf8');

            this.cmd.stdout.on('data', function(data){
                var str = data.toString();
                var lines = str.split(/(\r?\n)/g);
                console.log(lines.join(""));
                //clean.stdout.setEncoding('utf8');
                //clean.stdin.write(data);
            });

            this.cmd.stderr.on('data',function (err) {
                var str = err.toString()
                var lines = str.split(/(\r?\n)/g);
                console.log(lines.join(""));
            });

            this.cmd.on('close', function (code) {
                if (!code) {
                    console.log('init done with success');
                    //Cleaning
                    var clean = Spawn('rm', [
                        '-r',
                        'node_modules/geena/node_modules/geena.utils'
                    ]);

                    clean.stdout.on('data', function(data){
                        var str = data.toString();
                        if(str) console.log("wrting ", str)
                    });
                    clean.stderr.on('data', function(err){
                        var str = err.toString()
                        var lines = str.split(/(\r?\n)/g);
                        console.log(lines.join(""));
                    });

                    clean.on('close', function(err){
                        if (err) {
                            console.log("rm command ignored, about to import geena.utils...")
                        } else {
                            console.log('sub dir removed with success. About to start import');
                        }

                        //Adding geena.utils submodules
                        var utils = Spawn('git', [
                            'submodule',
                            'add',
                            '-f',
                            'https://github.com/Rhinostone/geena.utils.git',
                            'node_modules/geena/node_modules/geena.utils'
                        ]);
                        utils.stdout.on('data', function(data){
                            var str = data.toString();
                            var lines = str.split(/(\r?\n)/g);
                            console.log(lines.join(""));
                        });
                        utils.stderr.on('data', function(err){
                            var str = err.toString();
                            var lines = str.split(/(\r?\n)/g);
                            process.exit(0);//just for this case.

                        });
                        utils.on('close', function(code){
                            if (!code) {
                                console.log('submodule: geena.utils imported with success');
                            } else {
                                console.log('process exit with error code ' + code);
                            }
                        });
                    });
                } else {
                    console.log('process exit with error code ', + code);
                }
            });


        },
        /**
         * Update existing sources for Geena Project with its dependencies
         *
         * @param {string} release - Release number
         * */
        u : function(){ this.update(submodules, list);},
        update : function(submodules, list){
            var _this = this;

            if (typeof(list) != "undefined") {

                m = list.shift(),
                tag = submodules[m].version,
                path = _this.dir + '/node_modules/' + m.replace(/\//g, '/node_modules/');
            } else {
                //First case.
                var list = [];
                for (var m in submodules) list.push(m);

                var m = list.shift(), tag = submodules[m].version;
                var path = _this.dir + '/node_modules/' + m.replace(/\//g, '/node_modules/');
            }

            this.pull(m, path, tag, function(done, module){
                //Get next task in list.
                if (list.length > 0) {
                    _this.update(submodules, list);
                }
            });
        },
        /**
         * Pull command
         *
         * */
        pull : function(module, path, tag, callback){
            if ( Fs.existsSync(path) ) {

                tag = (typeof(tag) != "undefined" && tag != "") ? tag : "master";
                //console.log("about to enter ", path);
                process.chdir(path);//CD command like.

                var cmd = Spawn('git', ['checkout', tag]);

                cmd.stdout.setEncoding('utf8');
                cmd.stdout.on('data', function(data){
                    var str = data.toString();
                    var lines = str.split(/(\r?\n)/g);
                    console.log(lines.join(""));
                });

                cmd.stderr.on('data',function (err) {
                    var str = err.toString();
                    var lines = str.split(/(\r?\n)/g);
                    console.log(lines.join(""));
                });

                cmd.on('close', function (code) {
                    if (!code) {
                        console.log('Checking out: ', tag + "[" + module + "]");
                        //Trigger pull command.
                        gitPull();

                    } else {
                        console.log('process exit with error code ' + code);
                    }
                });

                var gitPull = function() {
                    var git = Spawn('git', ['pull', 'origin', tag]);

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
                        if (code) {
                            console.log('process exit with error code ' + code);
                            callback(false, module);
                        } else {
                            callback(true, module);
                        }


                    });
                };

            } else {
                console.warn("[warn]: path not found ", path);
                console.warn("Geena could not load ", module);
            }
        },
        /**
         * Clean on fails
         *
         * */
        clean : function () {
            //check for git project.
            var path = "./.git/config";
            if ( Fs.existsSync(path) ) {

            } else {
                console.log("Sorry, [./git/config] not found. Geena can not clean().");
            }
            //...TODO
        },

        getProjectConfiguration : function (){
            if (Fs.existsSync("./package.json")) {
                try {
                    var dep = require('./package.json').submodules;
                    for (var d in dep) {
                        //console.log('d' , d, 'dep ', dep[d]);
                        this.submodules[d] = dep[d];
                        return this.submodules;
                    }
                } catch(err) {
                    return this.submodules;
                }

            } else {
                return this.submodules;
            }
        }

    };



    if (process.argv.length < 3) {
        console.log("Command geena must have argument(s) !");
        console.log("Usage: \n $ ./geena -i\n $ ./geena --install <release>\n $ ./geena --clean");
    } else {

        //Get submodules config from.
        var submodules = subHandler.getProjectConfiguration();
        //console.log("About to load submodules ", submodules);
        allowed.forEach(function(i){

            if (arg == i) {
                i = i.replace(/-/g, '');

                try {
                    subHandler[i](submodules);
                } catch(err) {
                    if (err) console.log(err);
                }
            }
        });
    }



}
