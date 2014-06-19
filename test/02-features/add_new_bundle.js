var AddBundle;

//imports
var fs = require('fs');
var spawn = require('child_process').spawn;
var helpers = require('helpers');

AddBundle = function(conf, exports) {
    var self = this;
    var root = conf.root;
    var tmp = conf.tmp;
    var workspace = new _(conf.target);

    var fileCreated = false;
    var hasDefaultStructure = false;
    var projectFilesUpdated = false;

    this.bundleName = 'my_bundle'; // will be shared ib others tests


    var addBundle = function(callback) {
        var path = _( workspace.toString() );
        process.chdir(path);//CD command like.
        var init = spawn('./geena', [ '--add', self.bundleName ]);
        var success = false;

        init.stdout.setEncoding('utf8');
        init.stdout.on('data', function(data) {
            var str = data.toString();
            var lines = str.split(/(\r?\n)/g);
            //console.log(lines.join(""));
            if (/Bundle \[ my_bundle \] has been added to your project with success/.test(lines)) {
                success = true;
            }
        });

        init.stderr.on('data',function (err) {

            var str = err.toString();
            var lines = str.split(/(\r?\n)/g);

            if ( !str.match("Already on") ) {
                console.log(lines.join(""))
            }
        });

        init.on('close', function (code) {
            if (!code && success) {
                callback(false)
            } else {
                callback('bundle add process stopped with error code ' + code)
            }
        })
    };

    var testBundleStructure = function(callback) {
        try {
            var project = require(_(workspace.toString() + '/project.json') );
            var isConform = true;
            if (
                typeof(project['name']) == 'undefined' ||
                typeof(project['name']) != 'undefined' && project['name'] != self.bundleName
                ) {
                isConform = false
            }
            callback(false, isConform)
        } catch(err) {
            callback(err)
        }
    };

    var testProjectFiles = function(callback) {
        try {
            var project = require(_(workspace.toString() + '/project.json') );
            var env = require(_(workspace.toString() + '/env.json') );
            var isConform = false;
            if (
                typeof(project['bundles']) != 'undefined' &&
                typeof(project['bundles'][self.bundleName]) != 'undefined' &&
                typeof(env) != 'undefined' &&
                typeof(env[self.bundleName]) != 'undefined'
                ) {
                isConform = true
            }
            callback(false, isConform)
        } catch(err) {
            callback(err)
        }
    };

    exports['Bundle Add'] = {

        setUp: function (callback) {
            if (!fileCreated) {
                addBundle( function(err){
                    if (!err) {
                        fileCreated = true
                    }
                    callback()
                })
            } else if (!hasDefaultStructure) {
                testBundleStructure( function(err, isConform) {
                    if (!err) {
                        hasDefaultStructure = isConform
                    }
                });
                callback()
            } else if (!projectFilesUpdated) {
                testProjectFiles( function(err, isConform) {
                    if (!err) {
                        projectFilesUpdated = isConform
                    }
                });
                callback()
            } else {
                callback()
            }
        },

//        tearDown: function (callback) {
//            // clean up
//            callback();
//        },

        'Had created bundle file' : function(test) {
            test.equal(fileCreated, true);
            test.done()
        },

        'Bundle has default structure' : function(test) {
            test.equal(hasDefaultStructure, true);
            test.done()
        },

        'Project file has been updated' : function(test) {
            test.equal(hasDefaultStructure, true);
            test.done()
        }
    }
};

module.exports = AddBundle