//imports
var fs = require('fs');
//var utils = getContext('geena.utils');

function DeleteBundle(project, env, bundle) {

    var self = this;
    var reserved = [ 'framework' ];
    self.task = 'delete';//important for later in config init

    this.init = this.onInitialize = function (cb) {
        if (self.initialized == undefined) {
            self.initialized = true;
            if (typeof(cb) != 'undefined' && typeof(cb) == 'function') {
                cb(init)
            } else {
                init()
            }
        }

        return self
    }

    var init = function() {
        if ( reserved.indexOf(bundle) > -1 ) {
            console.log('[ '+bundle+' ] is a reserved name. Please, try something else.');
            process.exit(1)
        }
        self.root = getPath('root');

        try {
            self.project = project;
            self.projectData = require(project);
            self.env = env;
            if ( !fs.existsSync(env) ) {
                fs.writeFileSync(env, '{}')
            }
            self.envData = require(env);

            self.bundle = bundle;

            console.log('removing', bundle);

            // TODO - Prompt if user want to erase related releases if exist
            var projectObj = require(self.project);
            var releasePath = new _(projectObj.bundles[self.bundle].release.link);
            //if ( fs.existsSync(releasePath.toString()) ) {
                //releasePath.rm(function onReleaseDeleted(err) {
                    if (err) {
                        console.error(err.stack||err.message);
                        process.exit(1)
                    } else {
                        deleteBundle()
                    }
                //})
            //} else {
            //    deleteBundle()
            //}

        } catch (err) {
            console.error(err.stack);
            process.exit(1)
        }
    }

    var deleteBundle = function() {


        removeFromLogs( function logsRemoved (err) {
            if (err) {
                console.error(err.stack);
                process.exit(1)
            }
            cleanFile( function logsRemoved (err) {
                if (err) {
                    console.error(err.stack);
                    process.exit(1)
                }



                if (fs.existsSync(_(self.root+'/src/'+self.bundle))) {

                    var bundlePath = new _(self.root+'/src/'+self.bundle);
                    bundlePath.rm( function bundleRemoved (err) {
                        if (err) {
                            console.log(err.stack);
                            process.exit(1)
                        }
                        console.log('Bundle [ '+bundle+' ] has been removed from your project with success.');
                        self.emit('delete#complete', err)
                    })
                } else {
                    console.log('Bundle [ '+bundle+' ] has been removed from your project with success.');
                    self.emit('delete#complete', err)
                }
            })
        })
    }

    var cleanFile = function(callback) {
        try {
            if ( typeof(self.envData[self.bundle]) != 'undefined' ) {
                delete(self.envData[self.bundle]);
                fs.writeFileSync(self.env, JSON.stringify(self.envData, null, 4))
            }
            if ( typeof(self.projectData.bundles[self.bundle]) != 'undefined' ) {
                delete(self.projectData.bundles[self.bundle]);
                fs.writeFileSync(self.project, JSON.stringify(self.projectData, null, 4))
            }
            callback()
        } catch (err) {
            callback(err)
        }
    }

    var removeFromLogs = function(callback) {
        var logsPath = _(self.root+'/logs/'+self.bundle);

        if ( fs.existsSync(logsPath) ) {
            logsPath = new _(self.root+'/logs/'+self.bundle);
            logsPath.rm( function logsRemoved (err) {
                callback(err)
            })
        } else {
            callback()
        }
    }

    this.onComplete = function(callback) {
        self.once('delete#complete', function(err) {
            callback(err)
        })
        return self
    }
};

module.exports = DeleteBundle;