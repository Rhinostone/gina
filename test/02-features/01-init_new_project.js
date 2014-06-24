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
    self.makeProjectDone = false;
    self.testProjectStructureDone = false;
    this.projectName = 'my_project'; // will be shared ib others tests


    var makeProject = function(callback) {
        self.makeProjectDone = true;

        if (isWin32()) {
            makeProjectWin32(callback)
        } else {
            makeProjectDefault(callback)
        }

    }

    var makeProjectDefault = function(callback) {
        var path = _( workspace.toString() );
        process.chdir(path);//CD command like.

        var success = false;
        var init = spawn('./geena', [ '--init', self.projectName ]);

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
    }

    var makeProjectWin32 = function(callback) {
        var path = _( workspace.toString() );
        process.chdir(path);//CD command like.

        var outFile = _(__dirname+'/out.log');
        var errFile = _(__dirname+'/err.log');
        var out = fs.openSync(outFile, 'a');
        var err = fs.openSync(errFile, 'a');

        var success = false;
        var init = spawn('node', [ '.geena', '--init', self.projectName ], {stdio: [ 'ignore', out, err ]});


        init.on('close', function (code) {
//            setTimeout( function closedSpawn () {
            try {
                var str;
                var lines;
                if (fs.existsSync(outFile)) {
                    str = fs.readFileSync(outFile).toString();
                    lines = str.split(/(\r?\n)/g);
                    if (/project \[ my_project \] ready/.test(lines)) {
                        success = true
                    }
                    fs.unlinkSync(outFile)
                }
                if (fs.existsSync(errFile)) {
                    str = fs.readFileSync(errFile).toString();
                    lines = str.split(/(\r?\n)/g);

                    if ( !str.match("Already on") ) {
                        console.log(lines.join(""))
                    }
                    fs.unlinkSync(errFile)
                }
                if (!code && success) {
                    callback(false)
                } else {
                    callback('project init process stopped with error code ' + code)
                }
            } catch (err) {
                callback(err.stack)
            }
//            }, 2000)
        })
    }

    var testProjectStructure = function(callback) {
        try {
            self.testProjectStructureDone = true;
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
    }

    exports['Project Init'] = {

        setUp: function (callback) {
            if (!self.makeProjectDone) {
                makeProject( function(err){
                    if (!err) {
                        fileCreated = true
                    }
                    callback()
                })
            } else if (!self.testProjectStructureDone) {
                testProjectStructure( function(err, isConform) {
                    if (!err) {
                        hasDefaultStructure = isConform
                    }
                    callback()
                });
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