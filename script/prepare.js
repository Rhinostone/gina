/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2022 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

//Imports.
var fs          = require('fs');
var util        = require('util');
var promisify   = util.promisify;
const { execSync } = require('child_process');
const { spawn } = require('child_process');

var lib         = require('./lib');
var console     = lib.logger;


function Prepare() {
    var self = this;
    this.path = getEnvVar('GINA_DIR');
    //this.projectPath = _( __dirname.substring(0, (__dirname.length - "node_modules/gina/script".length)) );

    var init = function() {
        
        var args = process.argv, i = 0, len = args.length;
        for (; i < len; ++i) {
            if (args[i] == '-g' ) {
                self.isGlobalInstall = true;
                break;
            }
        }
        
        if ( !self.isGlobalInstall ) { //global install
            self.root = process.cwd(); // project path
            console.error('local installation is not supported for this version at the moment.');
            console.info('please use `npm install -g gina`');
            process.exit(1);
        }
        
        self.tasksCount = 0;
        i = 0;
        var list = [];
        for(var t in self) {
            if( typeof(self[t]) == 'function') {
                list[i] = {
                    func: self[t],
                    cb: hasCallback(self[t])
                }
                ++i
            }
        }
        runTask(list)
    },
    count = function() {
        return self.tasksCount;
    },
    /**
     * Run tasks - Will run in order of declaration
     * */
     runTask = function(list) {

        var i = self.tasksCount;

        if (i > list.length-1) {
            process.exit(0)
        }

        var err = false;
        var cb = ( typeof(list[i].cb) != 'undefined' ) ? list[i].cb : false;

        if (cb) {
            list[i].func( function done(err, data) {
                if (err) {
                    console.error(err.stack||err.message);
                    process.exit(1)
                } else {
                    if (data) {
                        //var str = data.toString();
                        console.info(data);
                    }
                    ++self.tasksCount;
                    runTask(list)
                }

            })
        } else {
            try {
                list[i].func();
                ++self.tasksCount;
                runTask(list)
            } catch (err) {
                console.error(err.stack);
                process.exit(1)
            }
        }
    },
    hasCallback = function(func) {
        var found = false;
        var funcString = func.toString();
        var args = funcString.match(/^\s*function\s+(?:\w*\s*)?\((.*?)\)/);
        args = args ? (args[1] ? args[1].trim().split(/\s*,\s*/) : []) : null;

        if (args.length > 0) {
//            var cb;
//            for (var a = 0; a < args.length; ++a) {
//                console.log('......checking ', args[a]);
//                cb = funcString.match(/(callback|cb)\s*\(/g);
//                if (cb) {
//                    //console.log('.......??? ', cb);
//                    return args[a]
//                }
//            }
            return args
        }

        return found
    };
    

    // this.runTests = function(cb) {
    //     if ( fs.existsSync(self.path+'/test') ) {
    //         exec(['nodeunit', self.path+'/test'], function done(err, data) {
    //             if ( /FAILURES\:/.test(data) || !/OK\:/.test(data) ) {
    //                 console.info(data);
    //                 cb(new Error('Tests failed !! See message above.'));
    //                 return;
    //             }
    //             cb(err, data)
    //         })
    //         //exec('npm '++'test')
    //         //cb(false)
    //     } else {
    //         cb(false)
    //     }
    // }

    this.removeComments = function() { console.log('removin comments ...')};
    this.removeConsoleLog = function() {

    };
    /**
     * Write version number in the VERSION file
     * */
    this.setVersion = function() {
        console.log('setting version number ...');
        try {
            var version = require( _(self.path + 'package.json') ).version;
            var path = _(self.path + 'VERSION');
            fs.writeFileSync(path, version)
        } catch (err) {
            console.error(err.stack)
        }
    };
    /**
     //Publish to git hub when everything is done
     this.onReady(function(taskCount){
        if(this.count() == 0){
            _this.postToGitHub();
        }
    });*/

    init()
};

new Prepare()