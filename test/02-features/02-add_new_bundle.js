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

    self.addBundleDone = false;
    self.testBundleStructureDone = false;
    self.testJSONFilesDone = false;
    var bundleCreated = false;
    var hasDefaultStructure = false;
    var projectFilesUpdated = false;

    this.bundleName = 'my_bundle'; // will be shared ib others tests

    var addBundle = function(callback) {
        self.addBundleDone = true;

        if (isWin32()) {
            addBundleWin32(callback)
        } else {
            addBundleDefault(callback)
        }

    }

    var addBundleDefault = function(callback) {
        var path = _( workspace.toString() );
        process.chdir(path);//CD command like.

        var success = false;
        var init = spawn('./geena', [ '--add', self.bundleName ]);

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
    }

    var addBundleWin32 = function(callback) {
        var path = _( workspace.toString() );
        process.chdir(path);//CD command like.

        var outFile = _(__dirname+'/out.log');
        var errFile = _(__dirname+'/err.log');
        var out = fs.openSync(outFile, 'a');
        var err = fs.openSync(errFile, 'a');

        var success = false;
        var init = spawn('node', [ '.geena', '--add', self.bundleName ], {stdio: [ 'ignore', out, err ]});


        init.on('close', function (code) {
//            setTimeout( function closedSpawn () {
            try {
                var str;
                var lines;
                if (fs.existsSync(outFile)) {
                    str = fs.readFileSync(outFile).toString();
                    lines = str.split(/(\r?\n)/g);
                    if (/Bundle \[ my_bundle \] has been added to your project with success/.test(lines)) {
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
                    callback('bundle add process stopped with error code ' + code)
                }
            } catch (err) {
                callback(err.stack)
            }
//            }, 2000)
        })
    }

    var testBundleStructure = function(callback) {
        self.testBundleStructureDone = true;
        try {
            var srcPath = conf.geena +'/core/template/samples/bundle';
            var src = new _( srcPath);
            var dstPath = workspace.toString() +'/src/'+ self.bundleName;
            var dst = new _( dstPath);

            src.exists( function(srcExists) {
                if (srcExists) {
                    dst.exists( function(dstExists) {
                        if (dstExists) {
                            var isConform = compareFilesBundle(srcPath, dstPath, '');
                            if (typeof(isConform) == 'boolean') {
                                callback(false, isConform)
                            } else {
                                callback(isConform)
                            }
                        } else {
                            callback(false, false)
                        }
                    })
                } else {
                    callback(false, false)
                }
            })
        } catch(err) {
            callback(err)
        }
    };

    var compareFilesBundle = function (srcRoot, dstRoot, element) {
        try {
            var srcPath = srcRoot;
            var dstPath = dstRoot;
            if (element != '') {
                srcPath = srcPath+'/'+element;
                dstPath = dstRoot+'/'+element;
            }
            var srcStats = fs.statSync( _(srcPath));
            var dstStats = fs.statSync( _(dstPath));
            var srcData;
            var dstData;
            var isConform = true;
            var i;

            if (srcStats.isDirectory() && dstStats.isDirectory()) {
                srcData = fs.readdirSync(_(srcPath));
                dstData = fs.readdirSync(_(dstPath));
                if (srcData.length == dstData.length) {
                    i = srcData.length-1;
                    for ( ; i >= 0 && isConform; --i) {
                        if (dstData.indexOf(srcData[i]) == -1) {
                            isConform = false
                        }
                    }
                    i = dstData.length-1;
                    for ( ; i >= 0 && isConform; --i) {
                        if (srcData.indexOf(dstData[i]) == -1) {
                            isConform = false
                        }
                    }
                    i = srcData.length-1;
                    for ( ; i >= 0 && isConform; --i) {
                        isConform = isConform && compareFilesBundle(srcPath, dstPath, srcData[i])
                    }
                    return isConform
                } else {
                    return false
                }

            } else if (srcStats.isFile() && dstStats.isFile()) {
                srcData = fs.readFileSync(_(srcPath));
                dstData = fs.readFileSync(_(dstPath));
                srcData = (srcData.toString()).split(/(\r?\n)/g);
                dstData = (dstData.toString()).split(/(\r?\n)/g);

                if (srcData.length==dstData.length) {

                    i = srcData.length-1;
                    for ( ; i >= 0 && isConform; --i) {
                        if (dstData[i] != srcData[i]) {
                            isConform = false
                        }
                    }
                    return isConform
                } else {
                    return false
                }
            } else {
                return false
            }
        } catch(err) {
            return err
        }
    };

    var testJSONFiles = function(callback) {
        self.testJSONFilesDone = true;
        try {
            var project = require(_(workspace + '/project.json') );
            var env = require(_(workspace + '/env.json') );
            var isConform = true;

            var projectDataCmp = {
                "comment": "Your comment goes here.",
                "tag": "001",
                "src": "src/" + self.bundleName,
                "release": {
                    "version": "0.0.1",
                    "link": "bundles/" + self.bundleName
                }
            }
            var envDataCmp = {
                "dev" : {
                    "host" : "127.0.0.1",
                    "port" : {
                        "http" : 3100
                    }
                },
                "stage" : {
                    "host" : "127.0.0.1",
                    "port" : {
                        "http" : 3100
                    }
                },
                "prod" : {
                    "host" : "127.0.0.1",
                    "port" : {
                        "http" : 3100
                    }
                }
            }

            if (typeof(project['bundles']) != 'undefined' && typeof(project['bundles'][self.bundleName]) != 'undefined') {
                isConform = isConform && compareObjectJson(project['bundles'][self.bundleName], projectDataCmp);
                isConform = isConform && compareObjectJson(projectDataCmp, project['bundles'][self.bundleName])
            } else {
                isConform = false
            }
            if (typeof(env[self.bundleName]) != 'undefined') {
                isConform = isConform && compareObjectJson(env[self.bundleName], envDataCmp);
                isConform = isConform && compareObjectJson(envDataCmp, env[self.bundleName])
            } else {
                isConform = false
            }

            callback(false, isConform)
        } catch(err) {
            callback(err)
        }
    };

    var compareObjectJson = function(element1, element2) {
        if (typeof(element1) == 'object' && typeof(element2) == 'object') {
            var index;
            var cmp = true;
            for (index in element1) {
                if (typeof(element2[index] != 'undefined')) {
                    cmp = cmp && compareObjectJson(element1[index], element2[index])
                } else {
                    cmp = false;
                    break
                }
            }
            return cmp
        } else {
            return (element1 == element2)
        }
    };

    exports['Bundle Add'] = {

        setUp: function (callback) {
            if (!self.addBundleDone) {
                addBundle( function(err){
                    if (!err) {
                        bundleCreated = true
                    }
                    callback()
                })
            } else if (!self.testBundleStructureDone) {
                testBundleStructure( function(err, isConform) {
                    if (!err) {
                        hasDefaultStructure = isConform
                    }
                    callback()
                });
            } else if (!self.testJSONFilesDone) {
                testJSONFiles( function(err, isConform) {
                    if (!err) {
                        projectFilesUpdated = isConform
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

        'Had created bundle file' : function(test) {
            test.equal(bundleCreated, true);
            test.done()
        },

        'Bundle has default structure' : function(test) {
            test.equal(hasDefaultStructure, true);
            test.done()
        },

        'Project file has been updated' : function(test) {
            test.equal(projectFilesUpdated, true);
            test.done()
        }
    }
};

module.exports = AddBundle