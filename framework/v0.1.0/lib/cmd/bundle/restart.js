var fs          = require('fs');
var exec        = require('child_process').exec;

var CmdHelper   = require('./../helper');
var console     = lib.logger;
/**
 * Restart a given bundle or Restart all running bundles at once
 *
 * e.g.
 *  gina bundle:restart <bundle_name> @<project_name>
 *  gina bundle:restart @<project_name>
 *  gina bundle:restart --online
 *
 * */
function Restart(opt, cmd) {
    
    var self    = {}
    , local     = {
        bundle      : null        
    };
    
    var init = function(opt, cmd) {
        // import CMD helpers
        new CmdHelper(self, opt.client, { port: opt.debugPort, brkEnabled: opt.debugBrkEnabled });
        
        // check CMD configuration
        if (!isCmdConfigured()) return false;
        
        self.cmdStr = process.argv.splice(0, 2).join(' ');
              
        // start all bundles   
        opt.onlineCount = 0;   
        opt.notStarted = [];  
        if (!self.name) {
            restart(opt, cmd, 0);
        } else {
            restart(opt, cmd);
        }        
    }
    
    var restart = function(opt, cmd, bundleIndex) {
        
        var isBulkRestart = (typeof(bundleIndex) != 'undefined') ? true : false;
        var bundle = (isBulkRestart) ? self.bundles[bundleIndex] : self.name;
        
        var msg = null;
        if (!isDefined('bundle', bundle)) {
            
            msg = 'Bundle [ ' + bundle + ' ] is not registered inside `@' + self.projectName + '`';
            console.error(msg);
            opt.client.write(msg);
            end(opt, cmd, isBulkRestart, bundleIndex, true)

        } else {
            isRealApp(bundle, function(err, appPath) {
                if (err) {
                    console.error(err.stack || err.message)
                }

                var error = null;
                
                //console.info('running: gina bundle:restart '+ bundle + '@' + self.projectName);
                cmd = '$gina bundle:stop ' + bundle + ' @' + self.projectName + ' && $gina bundle:start ' + bundle + ' @' + self.projectName;
                cmd = cmd.replace(/\$gina/g, self.cmdStr);
                console.debug(cmd);
                
                exec(cmd, function(err, data) {

                    if (err) {
                        error = err.toString();
                        console.error(error);
                        //opt.notStopped.push(bundle + '@' + self.projectName);
                        end(opt, cmd, isBulkRestart, bundleIndex, true)
                    } else {
                        end(opt, cmd, isBulkRestart, bundleIndex)
                    }

                })
            })//EO isRealApp
        }
    }
    
    var end = function (opt, cmd, isBulkRestart, i, error) {
        if (isBulkRestart) {            
            ++i;            
            if ( typeof(self.bundles[i]) != 'undefined' ) {
                restart(opt, cmd, i)
            } else {
                //opt.client.write('\n\r[ Offline ] '+ opt.offlineCount +'/'+ self.bundles.length);
                //var notStoppedMsg = '\nCould not stop: \n - '+ opt.notStopped.join('\n - ') + '\n\r';
                //opt.client.write(notStoppedMsg);
                
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

        var p               = null
            , d             = null
            , env           = self.projects[self.projectName]['def_env']
            , isDev         = GINA_ENV_IS_DEV
            , root          = self.projects[self.projectName].path
            , bundleDir     = null
            , bundlesPath   = null
            , bundleInit    = null
        ;

        try {
            //This is mostly for dev.
            var pkg = require( _(root + '/project.json') ).bundles;

            if ( typeof(pkg[bundle].release.version) == 'undefined' && typeof(pkg[bundle].tag) != 'undefined') {
                pkg[bundle].release.version = pkg[bundle].tag
            }
            if (
                pkg[bundle] != 'undefined' && pkg[bundle]['src'] != 'undefined' && isDev
            ) {
                var path = pkg[bundle].src;

                p = _( root +'/'+ path );//path.replace('/' + bundle, '')
                d = _( root +'/'+ path + '/index.js' );

                bundleDir   = path.replace('/' + bundle, '');
                setContext('bundle_dir', bundleDir);
                bundlesPath =  _( root +'/'+ bundleDir );
                bundleInit  = d;

            } else {
                //Others releases.
                var path    = 'releases/'+ bundle +'/' + env +'/'+ pkg[bundle].release.version;
                var version = pkg[bundle].release.version;
                p = _( root +'/'+ path );//path.replace('/' + bundle, '')
                d = _( root +'/'+ path + '/index.js' );

                bundleDir   = path;
                bundlesPath = _(root + '/'+ bundleDir);
                bundleInit  = d;
            }

        } catch (err) {
            // default bundlesPath.
            // TODO - log warn ?
            console.warn(err.stack||err.message);
            bundleDir   = 'bundles';
            bundlesPath = _(root +'/'+ bundleDir);
            p = _(root +'/'+ bundleDir +'/'+ bundle);
            d = _(root + '/'+ bundleDir +'/'+ bundle + '/index.js');
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

                        if ( stats.isDirectory() ) {
                            callback(false, d)
                        } else {
                            callback(new Error('[ '+ d +' ] is not a directory'))
                        }
                    }
                })
            } else {
                callback(new Error('[ '+ d +' ] does not exists'))
            }
        })
    }
    
    init(opt, cmd)
};

module.exports = Restart