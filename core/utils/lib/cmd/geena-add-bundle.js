var AddBundle;

//imports
var fs = require('fs');
var utils = getContext('geena.utils');
var GEENA_PATH = _( getPath('geena.core') );
var Config = require( _( GEENA_PATH + '/config') );
var readline = require('readline');
var rl = readline.createInterface(process.stdin, process.stdout);

AddBundle = function(opt, project, env, bundle) {

    var self = this;
    self.task = 'add';//important for later in config init

    var init = function(opt, project, env, bundle) {
        self.root = getPath('root');
        self.env = process.env.NODE_ENV;
        self.opt = opt;

        if ( typeof(bundle) != 'undefined' ) {
            self.bundle = bundle;
            console.log('adding', bundle);
            makeBundle(project, env, bundle)
        } else {
            console.log('bundle is undefined !')
        }
    }

    /**
     * Save project.json
     *
     * @param {string} projectPath
     * @param {object} content - Project file content to save
     *
     * */
    var saveProjectFile = function(projectPath, content, callback) {
        var data = JSON.stringify(content, null, 4);

        try {
            fs.writeFileSync(projectPath, data);
            callback(false)
        } catch (err) {
            callback(err)
        }
    }

    var saveEnvFile = function(envPath, content, callback) {
        var data = JSON.stringify(content, null, 4);

        try {
            fs.writeFileSync(envPath, data);
            callback(false)
        } catch (err) {
            callback(err)
        }
    }

    var makeBundle = function(project, env, bundle) {
        try {
            //add infos to project.json
            var content = require(project);
            var old = content;

            //erase if exists
            if ( typeof(content.packages[bundle]) != 'undefined' ) {
                delete content.packages[bundle]
            }

            //add new !
            content.packages[bundle] = {
                "comment" : "Your comment goes here.",
                "version" : "001",
                "src" : "src/" + bundle,
                "release" : {
                    "version" : "0.0.1",
                    "target" : "releases/"+ bundle +"/0.0.1",
                    "link" : "bundles/"+ bundle
                }
            };

            saveProjectFile(project, content, function doneSaving(err) {
                if ( err && old != content) {//roolback
                    fs.writeFileSync(project, data)
                } else {
                    //createBundle(content.packages[bundle], bundle)
                    content = require(env);
                    old = content;
                    //saveEnvFile(env, content, bundle)
                }
            });

            var saveEnvFile = function(env, content, bundle) {
                //get last port

                content[bundle] = {
                    "dev" : {
                        "host" : "127.0.0.1",
                        "port" : {
                            "http" : 3130,
                            "https" : 3033
                        }
                    },
                    "stage" : {
                        "host" : "127.0.0.1",
                        "port" : {
                            "http" : 3130,
                            "https" : 3033
                        }
                    },
                    "prod" : {
                        "host" : "127.0.0.1",
                        "port" : {
                            "http" : 3130,
                            "https" : 3033
                        }
                    }
                };
            }

        } catch (err) {
            console.error(err.stack)
        }
//        getSourceInfos(package, bundle, function(err, opt) {
//            if (err) {
//                console.error(err.stack);
//                process.exit(0)
//            }
//
//        })
    }

    /**
     * Create bundle default sources under /src
     * */
    var createBundle = function(conf, bundle) {
        conf.src = self.root +'/'+ conf.src;
        var sample = new _(GEENA_PATH +'/template/samples/bundle/');
        var target = _(conf.src);
        sample.cp(target , function done(err) {
            if (err) {
                console.error(err.stack);
                process.exit(1)
            }

            // Browse, parse and replace keys
            self.source = target;
            browse(self.source, bundle)
        })
    }

    var browse = function(source, bundle) {
        var files = fs.readdirSync(source);

        for (var f=0; f < files.length; ++f) {
            newSource = source +'/'+ files[f];
            if ( fs.statSync(newSource).isDirectory() ) {
                browse(newSource, bundle)
            } else {
                parse(newSource)
            }
        }
        //end
        console.info('Bundle [ '+bundle+' ] has been added to your project with succcess ;)')
    }

    /**
     * Parse file and modify only javascripts - *.js
     *
     * @param {string} file - File to parse
     * @param {}
     * */
    var parse = function(file) {
        console.log('replacing: ', file);
        try {
            var f;
            f =(f=file.split(/\//))[f.length-1];
            var isJS = /\.js/.test(f.substring(f.length-3));

            if ( isJS ) {
                var contentFile = fs.readFileSync(file, 'utf8').toString();
                //var occurrence = contentFile.replace(/{Bundle}/)
                var dic = {
                    "Bundle" : self.bundle.substring(0, 1).toUpperCase() + self.bundle.substring(1),
                    "bundle" : self.bundle
                };

                contentFile = whisper(dic, contentFile);//data
                //rewrite file
                fs.writeFileSync(file, JSON.stringify(contentFile, null, 4))
            }

        } catch(err) {
            console.error(err.stack);
            process.exit(1)
        }
    }

//    var getSourceInfos = function( package, bundle, callback) {
//        var config = new Config({
//            env             : self.env,
//            executionPath   : self.root,
//            startingApp     : bundle,
//            geenaPath       : GEENA_PATH,
//            task            : self.task
//        });
//
//        config.onReady( function onConfigReady(err, obj) {
//            var conf = self.conf = obj.conf[bundle][self.env];
//            try {
//                //will always build from sources by default.
//                if ( typeof(package['src']) != 'undefined' && fs.existsSync( _(self.root + '/' + package['src']) )) {
//                    var sourcePath = _(conf.sources + '/' + bundle);
//                    var version = undefined;//by default.
//                    if ( fs.existsSync( _(sourcePath + '/config/app.json') ) ) {
//                        var appConf = require( _(sourcePath + '/config/app.json'));
//                        if ( typeof(appConf['version']) != 'undefined' ) {
//                            version = appConf['version']
//                        } else {
//                            package.version
//                        }
//                    } else {
//                        version = package.version
//                    }
//
//                    if (version == undefined) {
//                        console.log('You need a version reference to build.');
//                        process.exit(0);
//                    }
//                    var releasePath = _(conf.releases + '/' + bundle + '/' + version);
//                    callback(false, {
//                        src     : sourcePath,
//                        target  : releasePath,
//                        version : version
//                    })
//                } else if ( typeof(package['repo']) != 'undefined' ) {
//                    //relies on configuration.
//                    console.log('build from repo is a feature in progress.');
//                    process.exit(0);
//                } else {
//                    console.log('No source reference found for build. Need to add [src] or [repo]');
//                    process.exit(0);
//                }
//            } catch (err) {
//                callback(err);
//            }
//        })
//    }


    init(opt, project, env, bundle);
//    return {
//        onComplete : function done(err){
//
//            init(project, bundle);
//        }
//    }
};

module.exports = AddBundle;