var fs          = require('fs');
var spawn       = require('child_process').spawn;

var CmdHelper   = require('./../helper');
var console     = lib.logger;
/**
 * Start a given bundle or start all bundles at once
 *
 * e.g.
 *  gina bundle:start [ @<bundle_name> ]
 *  gina bundle:start --all
 *
 * */
function Start(opt, cmd) {
    var self    = {}
    , local     = {
        bundle : null
    };

    var init = function(opt, cmd) {

        // import CMD helpers
        new CmdHelper(self, opt.client);

        // check CMD configuration
        if ( !isCmdConfigured() ) return false;
        

        var bundle = self.bundles[0];

        var msg = null;
        if ( !isDefined('bundle', bundle) ) {
            var msg = 'Bundle [ '+ bundle +' ] is not registered inside `@'+ self.projectName +'`';
            console.error(msg);
            opt.client.write(msg);
            // CMD exit
            opt.client.emit('end');

        } else {

            isRealApp(bundle, function(err, appPath){

                if (err) {
                    console.error(err.stack||err.message)
                } else {

                }

                console.info('starting bundle [ ' + bundle +'@'+ self.projectName +' ]');
                process.list = (process.list == undefined) ? [] : process.list;
                setContext('processList', process.list);
                setContext('ginaProcess', process.pid);

                var params = [
                    // node arguments will be passed by gina
                    appPath,
                    JSON.stringify( getContext() ), //Passing context to child.
                    self.projectName, // project name
                    bundle // bundle name
                ];

                // injecting node arguments
                var index = 0;
                if (self.nodeParams.length > 0) {
                    for (var p = 0, pLen = self.nodeParams.length; p < pLen; ++p) {
                        params.splice(index, 0, self.nodeParams[p]);
                        ++index
                    }
                }



                for (var i=0; i<params.length; ++i) {
                    if (params[i] == '') {
                        params.splice(i,1);
                    }
                }

                var child = spawn(opt.argv[0], params,
                    {
                        detached : true
                    }
                );


                var hasGreeted = false;
                child.stdout.setEncoding('utf8');//Set encoding.
                child.stdout.on('data', function(data) {

                    console.log( data );

                    if ( !opt.client.destroyed && !hasGreeted ) {
                        opt.client.write('bundle [ ' + bundle +'@'+ self.projectName +' ] started !');
                        hasGreeted = true
                    }
                });

                //when an exception is thrown, it is sent to the client
                child.stderr.setEncoding('utf8');
                var error = null;
                child.stderr.on('data', function(err) {

                    error = err.toString();
                    if ( /Debugger listening|Warning/.test(error) ) {
                        console.warn(error);

                        if (!opt.client.destroyed) {
                            opt.client.write(error);
                        }

                    } else {
                        console.error(error);
                    }
                });

                child.on('exit', function (code, signal) {
                    // handles only signals that cannot be cannot be caught or ignored
                    // ref.: `framework/<version>/lib/proc.js`
                    if ( /(SIGKILL|SIGSTOP)/i.test(signal) ) {
                        console.emerg('['+ this.pid +'] exiting with signal: ', signal);
                        cmd.proc.dismiss(this.pid, signal);
                    }

                });

                // CMD exit
                setTimeout(function () {
                    opt.client.emit('end');
                }, 500)


            })//EO isRealApp
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
            , bundleInit    = null;



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

module.exports = Start