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
            var srcPath = getPath('geena.core') +'/template/samples/bundle';
            var src = new _( srcPath);
            var dstPath = self.root +'/'+ conf.src +'/'+ self.bundleName;
            var dst = new _( dstPath);

            src.exists( function(srcExists) {
                if (srcExists) {
                    dst.exists( function(dstExists) {
                        if (dstExists) {
                            var isConform = compareFilesBundle(srcPath, dstPath, '');
                            if (isConform == true && isConform == false) {
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
            var srcStats = fs.statSync( _(srcRoot+'/'+element));
            var dstStats = fs.statSync( _(dstRoot+'/'+element));
            var srcData;
            var dstData;
            var isConform = true;
            var i;

            if (srcStats.isDirectory() && dstStats.isDirectory()) {
                srcData = fs.readdirSync(_(srcRoot+'/'+element));
                dstData = fs.readdirSync(_(dstRoot+'/'+element));
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
                        isConform = isConform && compareFilesBundle(srcRoot+'/'+element, dstRoot+'/'+element, srcData[i])
                    }
                    return isConform
                } else {
                    return false
                }

            } else if (srcStats.isFile() && dstStats.isFile()) {
                srcData = fs.readFileSync(_(srcRoot+'/'+element));
                dstData = fs.readFileSync(_(dstRoot+'/'+element));
                return (srcData==dstData)
            } else {
                return false
            }
        } catch(err) {
            return err
        }
    };

    var testJSONFiles = function(callback) {
        try {
            var project = require(_(root + '/project.json') );
            var env = require(_(root + '/env.json') );
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
                testJSONFiles( function(err, isConform) {
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