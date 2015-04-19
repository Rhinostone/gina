var fs      = require('fs');
var spawn   = require('child_process').spawn;
var console = lib.logger;
/**
 * Start a given bundle or start all bundles at once
 *
 * e.g.
 *  gina bundle:start [ @<bundle_name> ]
 *  gina bundle:start --all
 *
 * */
function Start(opt, cmd) {
    var self = {};

    var init = function(opt, cmd) {
        self.projects = require( _(GINA_HOMEDIR + '/projects.json') );

        if ( /^\@[a-z0-9_.]/.test(process.argv[4]) ) {

            if ( !isValidName(process.argv[4]) ) {
                console.error('[ '+process.argv[4]+' ] is not a valid project name. Please, try something else: @[a-z0-9_.].');
                process.exit(1);
            }

        }

        if ( typeof(self.name) == 'undefined') {
            var folder = new _(process.cwd()).toArray().last();
            if ( isDefined(folder) ) {
                self.name = folder
            }
        }
        var bundle = process.argv[3];
        isRealApp(bundle, function(err, appPath){

            if (err) {
                console.error(err.stack||err.message)
            } else {

            }

            console.log('starting bundle [ ' + bundle +' ]');
            process.list = (process.list == undefined) ? [] : process.list;
            setContext('processList', process.list);
            setContext('ginaProcess', process.pid);

            var params = [
                '--debug-brk=5656',
                appPath,
                JSON.stringify( getContext() )//Passing context to child.
            ];

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

            cmd.proc.register(bundle, child.pid);
            //opt.client.write('bundle [ ' + bundle +' ] started !!!');

            child.stdout.setEncoding('utf8');//Set encoding.
            child.stdout.on('data', function(data){
                opt.client.write( '[ data ]' + data.toString() )
            });

            //when an exception is thrown, it is sent to the client
            child.stderr.setEncoding('utf8');
            child.stderr.on('data', function(err){
                opt.client.write( err.toString() );
                //opt.client.write('[ quit ]')
            });
        })//EO isRealApp
    }

    var isDefined = function(name) {
        if ( typeof(self.projects[name]) != 'undefined' ) {
            return true
        }
        return false
    }

    var isValidName = function(name) {
        if (name == undefined) return false;

        self.name = name.replace(/\@/, '');
        var patt = /^[a-z0-9_.]/;
        return patt.test(self.name)
    }

    var isRealApp = function(bundle, callback) {

        var p
            , d
            , env = self.projects[self.name]['dev_env']
            , isDev = (self.projects[self.name]['dev_env'] === self.projects[self.name]['def_env']) ? true: false
            , root = self.projects[self.name].path
            , bundleDir = null
            , bundlesPath = null
            , bundleInit = null;



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
                bundleDir = path.replace('/' + bundle, '');
                setContext('bundle_dir', bundleDir);
                bundlesPath =  _( root +'/'+ bundleDir );
                bundleInit = d;

            } else {
                //Others releases.
                var path = 'releases/'+ bundle +'/' + env +'/'+ pkg[bundle].release.version;
                var version = pkg[bundle].release.version;
                p = _( root +'/'+ path );//path.replace('/' + bundle, '')
                d = _( root +'/'+ path + '/index.js' );

                bundleDir = path;
                bundlesPath = _(root + '/'+ bundleDir);
                bundleInit = d;
            }

        } catch (err) {
            // default bundlesPath.
            // TODO - log warn ?
            console.warn(err.stack||err.message);
            bundleDir = 'bundles';
            bundlesPath = _(root +'/'+ bundleDir);
            p = _(root +'/'+ bundleDir +'/'+ bundle);
            d = _(root + '/'+ bundleDir +'/'+ bundle + '/index.js');
            bundleInit = d;
        }



        //p = _(this.options.root + '/' + this.bundle + '.js'),
        console.debug("checking... ", p, " && ", d, " => ", bundleDir);
        //process.exit(42);
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

    var run = function() {

    };

    init(opt, cmd)
};

module.exports = Start