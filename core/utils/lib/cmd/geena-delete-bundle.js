var DeleteBundle;

//imports
var fs = require('fs');
var utils = getContext('geena.utils');

DeleteBundle = function(project, env, bundle) {

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

            deleteBundle()
        } catch (err) {
            console.error(err.stack);
            process.exit(1)
        }
    }

    var deleteBundle = function() {
        removeFromLogs( function logsRemoved (err) {
            if (err) {
                console.error(err.stack);
            }
            cleanFile( function logsRemoved (err) {
                if (err) {
                    console.error(err.stack);
                }
                if (fs.existsSync(_(self.root+'/src/'+self.bundle))) {
                    var bundlePath = new _(self.root+'/src/'+self.bundle);
                    bundlePath.rm( function bundleRemoved (err) {
                        if (err) {
                            console.log(err.stack)
                        }
                        console.log('Bundle [ '+bundle+' ] has been removed to your project with success.');
                        self.emit('delete#complete', err)
                    })
                } else {
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