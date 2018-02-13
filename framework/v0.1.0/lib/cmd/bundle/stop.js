var fs = require('fs');
var spawn = require('child_process').spawn;
var exec = require('child_process').exec;

var CmdHelper = require('./../helper');
var console = lib.logger;
/**
 * Stop a given bundle or start all bundles at once
 *
 * e.g.
 *  gina bundle:stop <bundle_name> @<project_name>
 *  gina bundle:stop --all
 *
 * */
function Stop(opt, cmd) {
    var self = {}
        , local = {
            bundle: null
        };

    var init = function(opt, cmd) {

        // import CMD helpers
        new CmdHelper(self, opt.client);

        // check CMD configuration
        if (!isCmdConfigured()) return false;


        var bundle = self.bundles[0];

        var msg = null;
        if (!isDefined('bundle', bundle)) {
            var msg = 'Bundle [ ' + bundle + ' ] is not registered inside `@' + self.projectName + '`';
            console.error(msg);
            opt.client.write(msg);
            // CMD exit
            opt.client.emit('end');

        } else {

            isRealApp(bundle, function(err, appPath) {

                if (err) {
                    console.error(err.stack || err.message)
                } else {

                }

                //console.info('Trying to stop bundle [ ' + bundle + '@' + self.projectName + ' ]');
                var error = null;
                exec('ps -Af|grep "gina: ' + bundle + '@' + self.projectName + '"', function(err, data) {

                    if (err) {
                        error = err.toString();
                        opt.write(error);
                        process.exit(1)
                    }

                    var row = data.split(/\n/g)
                        , r = 0
                        , len = row.length
                        , arr = row[0].replace(/(?:\\[rn]|[\r\n])/g, '').split(/\s+/g)
                        , proc = (arr[2] != '') ? arr[2] : arr[3]; // arr[4] is for minions;

                    // matching `grep` CMD PID to be excluded in the next test    
                    var re = new RegExp('(\\bgrep\\W+)(gina: '+ bundle+'@'+ self.projectName+')');
                    
                    if ( !re.test(row[0]) ) {
                        //console.debug('\n'+ row.join('\n'));
                        //console.debug('kill -TERM ', proc, arr);

                        exec('kill -TERM ' + proc, function(err, data) {
                            if (!err) {
                                console.info('Bundle [ ' + bundle + '@' + self.projectName + ' ] with PID [ ' + proc + ' ] stopped !');
                                process.exit(0)
                            } else {
                                console.error( err.toString())
                            }
                        })
                    } else { // not running
                        console.info('Bundle `' + bundle + '@' + self.projectName + '` is not running');
                        process.exit(0)
                    }
                    

                })

                

            })//EO isRealApp
        }
    }



    var isRealApp = function(bundle, callback) {

        var p = null
            , d = null
            , env = self.projects[self.projectName]['def_env']
            , isDev = GINA_ENV_IS_DEV
            , root = self.projects[self.projectName].path
            , bundleDir = null
            , bundlesPath = null
            , bundleInit = null;



        try {
            //This is mostly for dev.
            var pkg = require(_(root + '/project.json')).bundles;

            if (typeof (pkg[bundle].release.version) == 'undefined' && typeof (pkg[bundle].tag) != 'undefined') {
                pkg[bundle].release.version = pkg[bundle].tag
            }
            if (
                pkg[bundle] != 'undefined' && pkg[bundle]['src'] != 'undefined' && isDev
            ) {
                var path = pkg[bundle].src;

                p = _(root + '/' + path);//path.replace('/' + bundle, '')
                d = _(root + '/' + path + '/index.js');

                bundleDir = path.replace('/' + bundle, '');
                setContext('bundle_dir', bundleDir);
                bundlesPath = _(root + '/' + bundleDir);
                bundleInit = d;

            } else {
                //Others releases.
                var path = 'releases/' + bundle + '/' + env + '/' + pkg[bundle].release.version;
                var version = pkg[bundle].release.version;
                p = _(root + '/' + path);//path.replace('/' + bundle, '')
                d = _(root + '/' + path + '/index.js');

                bundleDir = path;
                bundlesPath = _(root + '/' + bundleDir);
                bundleInit = d;
            }

        } catch (err) {
            // default bundlesPath.
            // TODO - log warn ?
            console.warn(err.stack || err.message);
            bundleDir = 'bundles';
            bundlesPath = _(root + '/' + bundleDir);
            p = _(root + '/' + bundleDir + '/' + bundle);
            d = _(root + '/' + bundleDir + '/' + bundle + '/index.js');
            bundleInit = d;
        }


        //Checking root.
        fs.exists(d, function(exists) {
            if (exists) {
                //checking bundle directory.
                fs.stat(p, function(err, stats) {

                    if (err) {
                        callback(err)
                    } else {

                        if (stats.isDirectory()) {
                            callback(false, d)
                        } else {
                            callback(new Error('[ ' + d + ' ] is not a directory'))
                        }
                    }
                })
            } else {
                callback(new Error('[ ' + d + ' ] does not exists'))
            }
        })
    }



    init(opt, cmd)
};

module.exports = Stop