var DeleteBundle;

//imports
var fs = require('fs');
var utils = getContext('geena.utils');
var GEENA_PATH = _( getPath('geena.core') );
var Config = require( _( GEENA_PATH + '/config') );
var readline = require('readline');
var rl = readline.createInterface(process.stdin, process.stdout);

DeleteBundle = function(opt, project, env, bundle) {

    var self = this;
    var reserved = [ 'framework' ];
    self.task = 'delete';//important for later in config init

    var init = function(opt, project, env, bundle) {

        if ( reserved.indexOf(bundle) > -1 ) {
            console.log('[ '+bundle+' ] is a reserved name. Please, try something else.');
            process.exit(1)
        }
        self.root = getPath('root');
        self.opt = opt;

        try {
            self.project = project;
            self.projectData = require(project);
            self.env = env;
            if ( !fs.existsSync(env) ) {
                fs.writeFileSync(env, '{}')
            }
            self.envData = require(env);

            if ( typeof(self.projectData.bundles[bundle]) != 'undefined' ) {
                self.bundle = bundle;
                console.log('removing', bundle);

                if ( fs.existsSync(_(self.root+'/src/'+self.bundle+'/script/delete.js')) ) {
                    try {
                        var script = require(_(self.root+'/src/'+self.bundle+'/script/delete.js'))( function postDeleteFinished () {
                            deleteBundle()
                        })
                    } catch (err) {
                        console.log(err.stack)
                    }
                } else {
                    deleteBundle()
                }

            } else {
                console.error('Bundle [ '+bundle+' ] does not exist !');
                process.exit(0);
            }
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
                        console.log('Bundle ['+bundle+'] has been removed to your project with success.');
                        process.exit(0)
                    })
                } else {
                    process.exit(0)
                }
            })
        })
    }

    var cleanFile = function (callback) {
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
        console.log('!!!!!!!!!!!!!!!!!!!',logsPath,fs.existsSync(logsPath))
        if ( fs.existsSync(logsPath) ) {
            logsPath = new _(self.root+'/logs/'+self.bundle);
            logsPath.rm( function logsRemoved (err) {
                callback(err)
            })
        } else {
            callback()
        }
    }

    init(opt, project, env, bundle);
};

module.exports = DeleteBundle;