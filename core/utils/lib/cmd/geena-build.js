var fs              = require('fs');
var EventEmitter    = require('events').EventEmitter;
var helpers         = require('../helpers');
var inherits        = require('../inherits');
var console         = require('../logger');
var GEENA_PATH      = _( getPath('geena.core') );
var Config          = require( _( GEENA_PATH + '/config') );

function BuildBundle(project, bundle) {

    var self = this;
    // define all default
    this.task = 'build';//important for later in config init
    this.excluded = [
        /^\./, //all but files starting with "."
        /\.dev\.json$/ //not all ending with ".dev.json"
    ];
    this.project = project;


    this.init = this.onInitialize = function(cb) {

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
        console.log('init once !!');
        self.root = getPath('root');
        self.env = process.env.NODE_ENV;
        var path = ( project.bundles[bundle].release.target.substr(0,1) != '/') ? '/'+project.bundles[bundle].release.target : project.bundles[bundle].release.target;
        self['release_path'] = _(self.root + path);


        if ( typeof(bundle) != 'undefined' ) {
            console.log('building', bundle, '[ '+ self.env +' ]');
            // TODO add origin of the build.
            buildBundleFromSources(project, bundle);
        } else {
            console.log('building whole project: [ '+ self.env +' ]');
            //buildProjectFromSources(project);
        }
    }

    var getSourceInfos = function( package, bundle, callback) {
        var config = new Config({
            env             : self.env,
            executionPath   : self.root,
            startingApp     : bundle,
            geenaPath       : GEENA_PATH,
            task            : self.task
        });

        config.onReady( function onConfigReady(err, obj) {
            var conf = self.conf = obj.conf[bundle][self.env];
            var match = _(self.root +'/' +project.bundles[bundle].src);
            self['views_path'] = self.conf.content.views.default.views.replace(match, self['release_path']);

            try {
                //will always build from sources by default.
                if ( typeof(package['src']) != 'undefined' && fs.existsSync( _(self.root + '/' + package['src']) )) {
                    var sourcePath = _(conf.sources + '/' + bundle);

                    if ( typeof(package.release.version) == 'undefined' && typeof(package.tag) != 'undefined') {
                        package.release.version = package.tag
                    }
                    var version = package.release.version;//by default.
                    if ( fs.existsSync( _(sourcePath + '/config/app.json') ) ) {
                        var appConf = require( _(sourcePath + '/config/app.json'));
                        if ( typeof(appConf['version']) != 'undefined' ) {
                            version = appConf['version']
                        }
                    }

                    if (version == undefined) {
                        console.log('You need a version reference to build.');
                        process.exit(1);
                    }

                    var releasePath = _(conf.releases + '/'+ bundle +'/' + self.env +'/'+ version);
                    callback(false, {
                        src     : sourcePath,
                        target  : releasePath,
                        version : version
                    })
                } else if ( typeof(package['repo']) != 'undefined' ) {
                    //relies on configuration.
                    console.log('build from repo is a feature in progress.');
                    process.exit(0);
                } else {
                    console.log('No source reference found for build. Need to add [src] or [repo]');
                    process.exit(0);
                }
            } catch (err) {
                callback(err);
            }
        })
    };

    var buildBundleFromSources = function(project, bundle) {

        //build(bundle, releasePath, version);
        try {
            var package = project.bundles[bundle];

            getSourceInfos(package, bundle, function(err, opt) {
                if (err) {
                    console.error(err.stack);
                    process.exit(0);
                }

                var source  = opt.src;
                var target  = opt.target;
                var version = opt.version;

                var excluded = self.excluded;

                var targetObj = new _(target);
                targetObj.rm( function(err) {
                    var sourceObj = new _(source)
                        .cp(target, excluded, function(err) {
                            self.emit('build#complete', err, version)
                        })
                })
            })
        } catch (err) {
            console.error(err.stack);
            process.exit(0);
        }

    };

//    var buildProjectFromSources = function(project) {
//
//    };
//
//    var buildBundleFromRepo = function(project, bundle) {
//
//    };
//
//    var buildProjectFromRepo = function(project) {
//
//    };

    this.onComplete = function(callback) {
        self.once('build#complete', function(err, version) {
            if (!err) console.log("Build "+version+" ready.");

            callback(err)
        });

        return self
    };

};

BuildBundle = inherits(BuildBundle, EventEmitter);
module.exports = BuildBundle