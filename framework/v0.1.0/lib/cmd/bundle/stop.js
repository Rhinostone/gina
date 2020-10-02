var fs = require('fs');
var exec = require('child_process').exec;

var CmdHelper = require('./../helper');
var console = lib.logger;
/**
 * Stop a given bundle or start all bundles at once
 *
 * e.g.
 *  gina bundle:stop <bundle_name> @<project_name>
 * 
 *  // stop all bundles within the project
 *  gina bundle:stop @<project_name>
 *
 * */
function Stop(opt, cmd) {
    var self = {}
        , local = {
            bundle: null
        };

    var init = function(opt, cmd) {
        
        // import CMD helpers
        new CmdHelper(self, opt.client, { port: opt.debugPort, brkEnabled: opt.debugBrkEnabled });

        // check CMD configuration
        if (!isCmdConfigured()) return false;
        
        // start all bundles   
        opt.offlineCount = 0;   
        opt.notStopped = [];  
        
        if (!self.name) {
            stop(opt, cmd, 0);
        } else {
            stop(opt, cmd);
        }  
    }
    
    var stop = function(opt, cmd, bundleIndex) {
        
        var isBulkStop = (typeof(bundleIndex) != 'undefined') ? true : false;
        var bundle = (isBulkStop) ? self.bundles[bundleIndex] : self.name;

        var msg = null;
        if (!isDefined('bundle', bundle)) {
            msg = 'Bundle [ ' + bundle + ' ] is not registered inside `@' + self.projectName + '`';
            console.error(msg);
            end(opt, cmd, isBulkStop, bundleIndex, true)

        } else {

            isRealApp(bundle, function(err, appPath) {

                if (err) {
                    console.error(err.stack || err.message)
                }

                //console.info('Trying to stop bundle [ ' + bundle + '@' + self.projectName + ' ]');
                var error = null;
                exec('ps -Af|grep "gina: ' + bundle + '@' + self.projectName + '"', function(err, data) {

                    if (err) {
                        error = err.toString();
                        console.error(error);
                        opt.notStopped.push(bundle + '@' + self.projectName);
                        end(opt, cmd, isBulkStop, bundleIndex, true)
                        //process.exit(1)
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

                        exec('kill -9 ' + proc, function(err, data) {
                            if (!err) {
                                ++opt.offlineCount;
                                console.info('Bundle [ ' + bundle + '@' + self.projectName + ' ] with PID [ ' + proc + ' ] stopped !');
                                end(opt, cmd, isBulkStop, bundleIndex)
                            } else {
                                console.error( err.toString())
                            }
                        })
                    } else { // not running
                        console.info('Bundle `' + bundle + '@' + self.projectName + '` is not running');
                        ++opt.offlineCount;
                        opt.notStopped.push(bundle + '@' + self.projectName);
                        end(opt, cmd, isBulkStop, bundleIndex)
                    }
                    

                })

                

            })//EO isRealApp
        }
    }
    
    var end = function (opt, cmd, isBulkStop, i, error) {
        if (isBulkStop) {            
            ++i;            
            if ( typeof(self.bundles[i]) != 'undefined' ) {
                stop(opt, cmd, i)
            } else {
                opt.client.write('\n\r[ Offline ] '+ opt.offlineCount +'/'+ self.bundles.length);
                var notStoppedMsg = '\nCould not stop: \n - '+ opt.notStopped.join('\n - ') + '\n\r';
                opt.client.write(notStoppedMsg);
                
                if ( typeof(error) != 'undefined') {
                    process.exit(1);
                    return;
                }
                if (!opt.client.destroyed)
                    opt.client.emit('end');
                    
                process.exit(0);
            }
        } else {
            if ( typeof(error) != 'undefined') {
                process.exit(1);
                return;
            }
            
            if (!opt.client.destroyed)
                opt.client.emit('end');        
                
            process.exit(0);
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