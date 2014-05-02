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
            callback(false, data)
        } catch (err) {
            callback(err, undefined)
        }
    }

    var saveEnvFile = function(env, content, bundle, project) {
        if ( typeof(content[bundle]) != 'undefined' ) {
            delete content[bundle]
        }
        //get last port
        var last = 0;
        var list = [];
        for (var b in content) {
            for (var e in content[b]) { //env
                if ( typeof(content[b][self.env]['port']['http']) != 'undefined' ) {
                    last = ~~content[b][self.env]['port']['http'];
                    list.push(last)
                }
            }
        }

        for (var i=0; i<1000; ++i) {
            if ( list.indexOf(last) <0 ) {
                last = last+1;
                break;
            }
        }

        //TODO - Check if port is not in use before
        content[bundle] = {
            "dev" : {
                "host" : "127.0.0.1",
                "port" : {
                    "http" : last
                }
            },
            "stage" : {
                "host" : "127.0.0.1",
                "port" : {
                    "http" : last
                }
            },
            "prod" : {
                "host" : "127.0.0.1",
                "port" : {
                    "http" : last
                }
            }
        };

        var data = JSON.stringify(content, null, 4);

        try {
            fs.writeFileSync(env, data);
            createBundle(bundle, require(project).packages[bundle])
        } catch (err) {
            conole.log(err.stack);
            process.exit(1)
        }
    }

    /**
     * Create bundle default sources under /src
     *
     * @param {string} bundle
     * @param {object} project
     * */
    var createBundle = function(bundle, project) {
        project.src = self.root +'/'+ project.src;
        var sample = new _(GEENA_PATH +'/template/samples/bundle/');
        var target = _(project.src);
        sample.cp(target, function done(err) {
            if (err) {
                console.error(err.stack);
                process.exit(1)
            }

            // Browse, parse and replace keys
            self.source = _(target);
            browse(self.source, bundle)
        })
    }

    var makeBundle = function(project, env, bundle) {

        var proceed = function() {
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

            saveProjectFile(project, content, function doneSaving(e) {
                if ( e && old != content) {//roolback
                    fs.writeFileSync(project, data)
                } else {
                    //createBundle(content.packages[bundle], bundle);
                    content = require(env);
                    old = content;
                    try {
                        saveEnvFile(env, content, bundle, project)
                    } catch (err) {
                        fs.writeFileSync( env, JSON.stringify(old, null, 4) );
                    }

                }
            });


        };

        try {
            //add infos to project.json
            var content = require(project);
            var old = content;

            //erase if exists
            if ( typeof(content.packages[bundle]) != 'undefined' ) {
                delete content.packages[bundle];
                proceed()
                /**
                rl.setPrompt('Bundle [ '+bundle+' ] already exists. Should I erase ? (yes|no) > ');
                rl.prompt();

                rl.on('line', function(line) {
                    switch( line.trim().toLowerCase() ) {
                        case 'y':
                        case 'yes':
                            delete content.packages[bundle];
                            proceed()
                            break;
                        case 'n':
                        case 'no':
                            process.exit(0);
                            break;
                        default:
                            console.log('Please, write "yes" to proceed or "no" to cancel. ');
                            break;
                    }
                    rl.prompt();
                }).on('close', function() {
                    console.log('Have a great day!');
                    process.exit(0);
                });*/

            } else {
                proceed()
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
     * Browse sources
     *
     * @param {string} source
     * @param {string} bundle
     * */
    var browse = function(source, bundle, list) {
        var files = fs.readdirSync(source);

        if (source == self.source && typeof(list) == 'undefined') {//root
            var list = [];// root list
            for (var l=0; l<files.length-1; ++l) {
                list[l] = _(self.source +'/'+ files[l])
            }
        }

        if (!files && list.indexOf(source) > -1) {
            list.splice( list.indexOf(source), 1 )
        }

        for (var f=0; f < files.length; ++f) {
            newSource = _(source +'/'+ files[f]);
            if ( fs.statSync(newSource).isDirectory() ) {
                browse(newSource, bundle, list)
            } else {
                list = parse(newSource, list)
            }

            if ( f == files.length-1) { //end of current dir
                var p = newSource.split('/');
                p.splice(p.length -1);
                newSource = p.join('/');
                if (list != undefined && list.indexOf(newSource) > -1) {
                    list.splice( list.indexOf(newSource), 1 )
                }
            }

            if (f == files.length-1 && list.length == 0) {
                console.info('Bundle [ '+bundle+' ] has been added to your project with succcess ;)');
                process.exit(0);
            }
        }
    }

    /**
     * Parse file and modify only javascripts - *.js
     *
     * @param {string} file - File to parse
     * @param {}
     * */
    var parse = function(file, list) {
        console.log('replacing: ', file);
        try {
            var f;
            f =(f=file.split(/\//))[f.length-1];
            var isJS = /\.js/.test(f.substring(f.length-3));

            if ( isJS ) {
                var contentFile = fs.readFileSync(file, 'utf8').toString();
                //var contentFile = require(file).toSource();
                var dic = {
                    "Bundle" : self.bundle.substring(0, 1).toUpperCase() + self.bundle.substring(1),
                    "bundle" : self.bundle
                };

                contentFile = whisper(dic, contentFile);//data
                //rewrite file
                fs.writeFileSync(file, contentFile)
            }

            if ( list != undefined && list.indexOf(file) > -1) { //end of current dir
                list.splice( list.indexOf(file), 1 )
            }
            return list

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