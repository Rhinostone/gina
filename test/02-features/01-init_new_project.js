var InitProject;

//imports
var fs = require('fs');
var spawn = require('child_process').spawn;
var helpers = require('helpers');

InitProject = function(conf, exports) {
    var self = this;
    var root = conf.root;
    var tmp = conf.tmp;
    var workspace = new _(conf.target);

    var fileCreated = false;
    var hasDefaultStructure = false;

    this.projectName = 'my_project'; // will be shared ib others tests


    var makeProject = function(callback) {
        var path = _( workspace.toString() );
        process.chdir(path);//CD command like.
        var init = spawn('./geena', [ '--init', self.projectName ]);
        var success = false;

        init.stdout.setEncoding('utf8');
        init.stdout.on('data', function(data) {
            var str = data.toString();
            var lines = str.split(/(\r?\n)/g);
            //console.log(lines.join(""));
            if (/project \[ my_project \] ready/.test(lines)) {
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
                callback('project init process stopped with error code ' + code)
            }
        })
    };

    var testProjectStructure = function(callback) {
        try {
            var project = require(_(workspace.toString() + '/project.json') );
            var isConform = true;
            if (
                typeof(project['name']) == 'undefined' ||
                typeof(project['name']) != 'undefined' && project['name'] != self.projectName
            ) {
                isConform = false
            }
            callback(false, isConform)
        } catch(err) {
            callback(err)
        }
    };

    exports['Project Init'] = {

        setUp: function (callback) {
            if (!fileCreated) {
                makeProject( function(err){
                    if (!err) {
                        fileCreated = true
                    }
                    callback()
                })
            } else if (!hasDefaultStructure) {
                testProjectStructure( function(err, isConform) {
                    if (!err) {
                        hasDefaultStructure = isConform
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

        'Had created project file' : function(test) {
            test.equal(fileCreated, true);
            test.done()
        },

        'Project has default structure' : function(test) {
            test.equal(hasDefaultStructure, true);
            test.done()
        }
    }
};

module.exports = InitProject