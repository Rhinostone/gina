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
        && process.argv[3] != "-u"
        && process.argv[3] != "--update"
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
     *  $ ./geena init
     *
     *
     *  Update Geena and its dependencies
     *  ---------------------------------
     *
     *  $ ./geena update
     *
     * Issues:
     * ------
     * If init or update fails, before re trying anything,
     * you need to clean .git/config by removing all submodules
     * information. When done, commit the new state or stash your changes
     * and hit this command: $ git reset
     *
     * TODO - $ ./geena clean
     * TODO - $ ./geena init v1.5-245
     * TODO - $ ./geena update v1.6
     * TODO - Refacto
     *
     **/

    var arg     = process.argv[2];
    var Fs      = require("fs"),
        Spawn   = require('child_process').spawn,
        allowed = ["--clean", "-i","--install", "-u","--update"];


    var subHandler = {
        cmd : {},
        dir : "",
        /**
         * Init Geena Project with its dependencies
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
                                console.log('sub module geena.utils imported with success');
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
         * @param {string} release - Release nummber
         * */
        u : function(){ this.update(arguments);},
        update : function(release){

            //check first if module exists
            this.dir = __dirname;
            var path = this.dir + '/node_modules/geena';
            var release = (typeof(release) != "undefined" && release != "") ? release : "master";

            Fs.exists(path, function(exists){
                if (!exists) {
                    console.error("path not found");
                    return false;
                }
                process.chdir(path + '/node_modules/geena.utils');//CD command like.
                this.cmd = Spawn('git', ['pull', 'origin', 'master']);

                this.cmd.stdout.setEncoding('utf8');
                this.cmd.stdout.on('data', function(data){
                    var str = data.toString();
                    var lines = str.split(/(\r?\n)/g);
                    console.log(lines.join(""));
                });

                this.cmd.stderr.on('data',function (err) {
                    var str = err.toString();
                    var lines = str.split(/(\r?\n)/g);
                    console.log(lines.join(""));
                });

                this.cmd.on('close', function (code) {
                    if (!code) {
                        process.chdir(path);
                        this.cmd = Spawn('git', ['pull', 'origin', release]);
                        console.log('update finished with success');
                    } else {
                        console.log('process exit with error code ' + code);
                    }
                });
            });
        },
        /**
         * Clean on fails
         *
         * */
        clean : function () {
            ///...TODO
        }
    };



    if (process.argv.length < 3) {
        console.log("Command geena must have argument(s) !");
        console.log("Usage: \n $ ./geena -i\n $ ./geena --install <release>\n $ ./geena --clean");
    } else {

        allowed.forEach(function(i){

            if (arg == i) {
                i = i.replace(/-/g, '');
                try {
                    if (typeof(process.argv[3]) != "undefined") {
                        //release.
                        var tag     = process.argv[3];
                        subHandler[i](tag);
                    } else {
                        subHandler[i]();
                    }
                } catch(err) {
                    if (err) console.log(err);
                }
            }
        });
    }

}