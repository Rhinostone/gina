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
        self.opt = opt;

        self.project = project;
        self.projectData = require(project);
        self.env = env;
        if ( !fs.existsSync(env) ) {
            fs.writeFileSync(env, '{}')
        }
        self.envData = require(env);

        if ( typeof(bundle) != 'undefined' ) {
            self.bundle = bundle;
            console.log('adding', bundle);
            makeBundle()
        } else {
            console.log('bundle is undefined !')
        }
    }

    var makeBundle = function() {

        try {
            saveEnvFile(function doneSavingEnv(err){
                if (err) {
                    rollback(err)
                }

                saveProjectFile( function doneSavingProject(err, content) {
                    if ( err ) {
                        rollback(err)
                    }
                    self.conf = content.bundles[self.bundle];
                    createBundle();
//                    self.conf = content.bundles[self.bundle];

                    //erase if exists
//                    if ( typeof(content.bundles[self.bundle]) != 'undefined' ) {
//
//                        rl.setPrompt('Bundle [ '+ self.bundle +' ] already exists. Should I erase ? (yes|no) > ');
//                        rl.prompt();
//
//                        rl.on('line', function(line) {
//                            switch( line.trim().toLowerCase() ) {
//                                case 'y':
//                                case 'yes':
//                                    delete content.bundles[bundle];
//                                    createBundle();
//                                    break;
//                                case 'n':
//                                case 'no':
//                                    process.exit(0);
//                                    break;
//                                default:
//                                    console.log('Please, write "yes" to proceed or "no" to cancel. ');
//                                    rl.prompt();
//                                    break;
//                            }
//                        }).on('close', function() {
//                            console.log('exiting bundle installation');
//                            process.exit(0)
//                        })
//
//                    } else {
//                        createBundle()
//                    }
                })
            })
        } catch (err) {
            rollback(err)
        }
    }

    /**
     * Save project.json
     *
     * @param {string} projectPath
     * @param {object} content - Project file content to save
     *
     * */
    var saveProjectFile = function(callback) {
        var data = JSON.parse(JSON.stringify(self.projectData, null, 4));
        data.bundles[self.bundle] = {
            "comment" : "Your comment goes here.",
            "tag" : "001",
            "src" : "src/" + bundle,
            "release" : {
                "version" : "0.0.1",
                "target" : "releases/"+ bundle +"/0.0.1",
                "link" : "bundles/"+ bundle
            }
        };
        try {
            fs.writeFileSync(self.project, JSON.stringify(data, null, 4));
            callback(false, data)
        } catch (err) {
            callback(err, undefined)
        }
    }

    var addEnvInfo = function(callback) {
        var content = self.envData;

        if ( typeof(content[bundle]) != 'undefined' ) {
            delete content[bundle]
        }

        // TODO - set ports range


        //get last port
        var last = 3100;
        for (var b in content) {
            for (var e in content[b]) { //env
                for (p in content[b][e]['port']) {//protocol
                    if (last < ~~content[b][e]['port'][p]) {
                        last = ~~content[b][e]['port'][p]+1
                    }
                }
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
            self.envDataWrote = true;
            callback(false)
        } catch (err) {
            callback(err)
        }
    }

    var saveEnvFile = function(callback) {
        var bundle = self.bundle;
        var content = self.envData;

        if ( typeof(content) != 'undefined' && typeof(content[bundle]) != 'undefined' ) {

            rl.setPrompt('Bundle [ '+ bundle +' ] already exists. Should I erase ? (yes|no) > ');
            rl.prompt();

            rl.on('line', function(line) {
                switch( line.trim().toLowerCase() ) {
                    case 'y':
                    case 'yes':
                        delete content[bundle];
                        addEnvInfo(callback);
                        break;
                    case 'n':
                    case 'no':
                        process.exit(0);
                        break;
                    default:
                        console.log('Please, write "yes" to proceed or "no" to cancel. ');
                        rl.prompt();
                        break;
                }
            }).on('close', function() {
                console.log('exiting bundle installation');
                process.exit(0)
            })

        } else {
            addEnvInfo(callback)
        }
    }

    /**
     * Create bundle default sources under /src
     *
     * @param {string} bundle
     * @param {object} project
     * */
    var createBundle = function() {
        var conf = self.conf
        var src = self.root +'/'+ conf.src;
        var sample = new _(GEENA_PATH +'/template/samples/bundle/');
        var target = _(src);
        sample.cp(target, function done(err) {
            if (err) {
                rollback(err)
            }
            // Browse, parse and replace keys
            self.source = _(target);
            browse(self.source)
        })
    }

    /**
     * Browse sources
     *
     * @param {string} source
     * @param {string} bundle
     * */
    var browse = function(source, list) {
        var bundle = self.bundle;
        var files = fs.readdirSync(source);

        if (source == self.source && typeof(list) == 'undefined') {//root
            var list = [];// root list
            for (var l=0; l<files.length; ++l) {
                list[l] = _(self.source +'/'+ files[l])
            }
        }

        if (!files && list.indexOf(source) > -1) {
            list.splice( list.indexOf(source), 1 )
        }

        for (var f=0; f < files.length; ++f) {
            newSource = _(source +'/'+ files[f]);
            if ( fs.statSync(newSource).isDirectory() ) {
                browse(newSource, list)
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

            if (f == files.length-1 && list.length == 0) { //end of all
                console.info('Bundle [ '+bundle+' ] has been added to your project with succcess ;)');
                process.exit(0)
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
            var isJSON = /\.js/.test(f.substring(f.length-5));

            if ( isJS || isJSON && /config\/app\.json/.test(file) ) {
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

            if ( list != undefined && list.indexOf(file) > -1 ) { //end of current dir
                list.splice( list.indexOf(file), 1 )
            }
            return list

        } catch(err) {
            console.error(err.stack);
            process.exit(1)
        }
    }

    var rollback = function(err) {
        console.log('could not complete bundle creation: ', err.stack);
        console.log('rolling back...');
        var writeFiles = function() {
            //write back env
            if ( typeof(self.envDataWrote) != undefined ) {
                fs.writeFileSync(self.env, JSON.stringify(self.envData, null, 4));
            }
            //write back project
            if ( typeof(self.projectDataWrote) != undefined ) {
                fs.writeFileSync(self.project, JSON.stringify(self.projectData, null, 4))
            }

            process.exit(1)
        };

        var bundle = new _(self.bundle);
        if ( bundle.existsSync() ) {
            bundle.rm( function(err, path) {//remove folder
                if (err) {
                    throw err
                }
                writeFiles()
            })
        } else {
            writeFiles()
        }
    }

    init(opt, project, env, bundle);
//    return {
//        onComplete : function done(err){
//
//            init(project, bundle);
//        }
//    }
};

module.exports = AddBundle;