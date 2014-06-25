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

    var deleteBundleDone = false;
    var testBundleStructureDone = false;
    var testJSONFilesDone = false;

    self.bundleRemoved = false;
    self.bundleStructureRemoved = false;
    self.projectFilesBundleRemoved = false;

    this.bundleName = 'my_bundle'; // will be shared ib others tests

    var deleteBundle = function(callback) {
        deleteBundleDone = true;

        var path = _( workspace.toString() );
        process.chdir(path);//CD command like.

        var outFile = _(__dirname+'/out.log');
        var errFile = _(__dirname+'/err.log');
        var out = fs.openSync(outFile, 'a');
        var err = fs.openSync(errFile, 'a');
        var cmd = (isWin32()) ? '.geena' : './geena';
        var init = spawn('node', [ cmd, '--delete', self.bundleName ], {stdio: [ 'ignore', out, err ]});

        //init.stdout.setEncoding('utf8');
        init.on('stdout', function(code, data) {
            var str = data.toString();
            var lines = str.split(/(\r?\n)/g);
            if (/Bundle \[ my_bundle \] has been removed to your project with success/.test(lines) && !code) {
                callback(false)
            } else {
                callback('bundle remove process stopped with error code ' + code)
            }
        });

        init.on('stderr',function (err) {
            var str = err.toString();
            var lines = str.split(/(\r?\n)/g);
            if (!str.match("Already on") ) {
                console.log(lines.join(""))
            }
        });

        init.on('close', function (code) {
            try {
                if (fs.existsSync(errFile)) {
                    init.emit('stderr', fs.readFileSync(errFile));
                    fs.closeSync(err);
                    fs.unlinkSync(errFile)
                }
                if (fs.existsSync(outFile)) {
                    init.emit('stdout', code, fs.readFileSync(outFile));
                    fs.closeSync(out);
                    fs.unlinkSync(outFile)
                }
            } catch (err) {
                callback(err.stack)
            }
        })
    }

    var testBundleStructure = function(callback) {
        testBundleStructureDone = true;
        try {
            var target = new _(workspace.toString() +'/src/'+ self.bundleName);
            target.exists( function(srcExists) {
                callback(false, !srcExists)
            })
        } catch(err) {
            callback(err)
        }
    };

    var testJSONFiles = function(callback) {
        testJSONFilesDone = true;
        try {
            delete require.cache[_(workspace + '/project.json', true)];
            var project = require(_(workspace + '/project.json') );
            delete require.cache[_(workspace + '/env.json', true)];
            var env = require(_(workspace + '/env.json') );
            var isConform = true;

            if (typeof(project['bundles']) != 'undefined' && typeof(project['bundles'][self.bundleName]) != 'undefined') {
                isConform = false
            }
            if (typeof(env[self.bundleName]) != 'undefined') {
                isConform = false
            }

            callback(false, isConform)
        } catch(err) {
            callback(err)
        }
    };

    exports['Bundle Delete'] = {

        setUp: function (callback) {
            if (!deleteBundleDone) {
                deleteBundle( function(err){
                    if (!err) {
                        self.bundleRemoved = true
                    }
                    callback()
                })
            } else if (!testBundleStructureDone) {
                testBundleStructure( function(err, isConform) {
                    if (!err) {
                        self.bundleStructureRemoved = isConform
                    }
                    callback()
                })
            } else if (!testJSONFilesDone) {
                testJSONFiles( function(err, isConform) {
                    if (!err) {
                        self.projectFilesBundleRemoved = isConform
                    }
                    callback()
                })
            } else {
                callback()
            }
        },

//        tearDown: function (callback) {
//            // clean up
//            callback();
//        },

        'Had removed bundle files' : function(test) {
            test.equal(self.bundleRemoved, true);
            test.done()
        },

        'Bundle structure was removed' : function(test) {
            test.equal(self.bundleStructureRemoved, true);
            test.done()
        },

        'Project file has been updated' : function(test) {
            test.equal(self.projectFilesBundleRemoved, true);
            test.done()
        }
    }
};

module.exports = AddBundle