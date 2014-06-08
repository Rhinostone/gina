/*
 * This file is part of the geena package.
 * Copyright (c) 2009-2014 Rhinostone <geena@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */
var PrePublish;

//Imports.
var fs      = require('fs');
var utils   = require('./../core/utils');
//Don't use events here.

PrePublish = function() {
    var self = this;
    this.path = _( __dirname.substring(0, (__dirname.length - "script".length)) );
    //this.projectPath = _( __dirname.substring(0, (__dirname.length - "node_modules/geena/script".length)) );

    var init = function() {
        self.tasksCount = 0;
        run()
    },
    count = function() {
        return self.tasksCount;
    },
    /**
     * Run tasks - Will run in order of declaration
     * */
    run = function() {
        var i = 0;
        var err = false;
        var errors = [];
        var funcs = [];
        for(var t in self){
            if( typeof(self[t]) == 'function') {
                console.log('Running: ', 'self.' + t + '()');
                //getting arguments

                console.log('Arguments: ', hasCallback(self[t]));
                self[t]()

//                try {
//                    var func = 'self.' + t + '()';
//                    console.log('Running: ', func);
//                    eval(func);
//                    ++self.taskCount
//                } catch (err) {
//                    //console.error(err.stack)
//                    errors.push(err)
//                }
            }
            ++i;
            if (i == self.length) {
                err = (errors.length > 0) ? errors : false;
            }
        }
        if (err) {
            console.log('Pre Publish done with ('+err.length +') error(s).');
            //TODO display details.
        }
    },
    hasCallback = function(func) {
        var found = false;
        var funcString = func.toString();
        var args = funcString.match(/^\s*function\s+(?:\w*\s*)?\((.*?)\)/);
        args = args ? (args[1] ? args[1].trim().split(/\s*,\s*/) : []) : null;

        if (args.length > 0) {
            var cb;
            for (var a = 0; a < args.length; ++a) {
                console.log('......checking ', args[a]);
                cb = funcString.match(/callback\s*\(/g);
                if (cb) {
                    console.log('.......??? ', cb)
                    return args[a]
                }
            }
        }

        return found
    };


    this.runTests = function(callback) {
        console.log('running tests');
        //callback(false)
    }

    this.removeComments = function() { console.log('removin comments...')};
    this.removeConsoleLog = function() {

    };
    /**
     * Write version number in the VERSION file
     * */
    this.setVersion = function() {
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

new PrePublish()