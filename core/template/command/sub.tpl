#!/usr/bin/env node

/**
 * Development script
 * Use to init and get last master or release you want
 *
 *  Usage:
 *
 *  Init Geena and its dependencies
 *  -------------------------------
 *
 *  $ ./sub init
 *
 *
 *  Update Geena and its dependencies
 *  ---------------------------------
 *
 *  $ ./sub update
 *
 * Issues:
 * ------
 * If init or update fails, before re trying anything,
 * you need to clean .git/config by removing all submodules
 * information. When done, commit the new state
 *
 * TODO - $ ./sub clean
 * TODO - $ ./sub init v1.5-245
 * TODO - $ ./sub update v1.6
 * TODO - Refacto
 *
 **/

var arg     = process.argv[2];
var Fs      = require("fs"),
    Spawn   = require('child_process').spawn,
    allowed = ["clean","init", "update"];


var subHandler = {
    cmd : {},
    dir : "",
    /**
     * Init Geena Project with its dependencies
     *
     * */
    init : function(release){
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

allowed.forEach(function(i){
    if (arg == i) {
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