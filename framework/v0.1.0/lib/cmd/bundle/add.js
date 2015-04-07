var fs          = require('fs');
var readline    = require('readline');
var rl          = readline.createInterface(process.stdin, process.stdout);

var console = lib.logger;
var scan    = require('../port/inc/scan');


/**
 * Add new bundle to a given project.
 * NB.: If bundle exists, You will be asked if you want to replace.
 * */
function Add() {
    var self = {}, local = {};

    var init = function() {
        self.projects = require( _(GINA_HOMEDIR + '/projects.json') );
        self.portsList = [];
        self.envs = [];
        self.portsPath = _(GINA_HOMEDIR + '/ports.json');
        self.portsData = require( self.portsPath );

        for (var p in self.portsData) {
            self.portsList.push(p)
        }

        var i = 3, bundles = [];
        for (; i<process.argv.length; ++i) {
            if ( /^\@[a-z0-9_.]/.test(process.argv[i]) ) {
                //self.project = process.argv[i].split('@')[0] || null;

                if ( !isValidName(process.argv[i]) ) {
                    console.error('[ '+process.argv[i]+' ] is not a valid project name. Please, try something else: @[a-z0-9_.].');
                    process.exit(1);
                }

            } else if (/^[a-z0-9_.]/.test(process.argv[i])) {
                bundles.push(process.argv[i])
            }
        }

        if ( typeof(self.name) == 'undefined') {
            var folder = new _(process.cwd()).toArray().last();
            if ( isDefined(folder) ) {
                self.name = folder
            }
        }


        if ( isDefined(self.name) && bundles.length > 0) {
            self.bundles = bundles;
            for (var e in self.projects[self.name].envs) {
                self.envs.push(self.projects[self.name].envs[e])
            }
            self.envs.sort();
            // rollback infos
            self.envPath = _(self.projects[self.name].path + '/env.json');
            self.projectPath = _(self.projects[self.name].path + '/project.json', true);
            self.projectData = require(self.projectPath);
            self.portsPath = _(GINA_HOMEDIR + '/ports.json');
            self.portsData = require(self.portsPath);
            self.portsReversePath = _(GINA_HOMEDIR + '/ports.reverse.json');
            self.portsReverseData = require(self.portsReversePath);

            addBundles(0)
        } else {
            //console.error('[ '+ self.name+' ] is not an existing project');
            if ( bundles.length == 0) {
                console.error('Missing argument <bundle_name>');
                process.exit(1)
            }
            console.error('Missing argument @<project_name>');
            process.exit(1)
        }
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

    /**
     * Add bundles
     *
     * @param {number} b - bundle index
     * @param {number} e - env index
     *
     * */
    var addBundles = function(b) {
        if (b > self.bundles.length-1) {// done
            process.exit(0)
        }

        var param = []
            , options = {}
            , bundle = self.bundles[b]
            , project = self.name;


        if ( /^[a-z0-9_.]/.test(bundle) ) {
            var projectData = require(_(self.projects[self.name].path + '/project.json'))
                , bundlePath = _(self.projects[self.name].path + '/src/'+ bundle);

            if ( !fs.existsSync(self.envPath) ) {
                lib.generator.createFileFromDataSync({}, self.envPath);
            }

            local.bundle = bundle;
            local.b = b;

            // find available port
            options = {
                ignore  : self.portsList,
                len   : self.envs.length
            };
            scan(options, function(err, ports){
                if (err) {
                    console.error(err.stack|err.message);
                    process.exit(1)
                }

                for (var p=0; p<ports.length; ++p) {
                    self.portsList.push(ports[p])
                }
                self.portsList.sort();
                self.ports = ports;

                try {
                    check(local.bundle);
                    //makeBundle(true); // ignore checking
                } catch (err) {
                    rollback(err)
                }
            })

        } else {
            console.error('[ '+ bundle+' ] is not a valid bundle name')
            process.exit(1)
        }
    }

    var check = function(bundle) {
        if ( typeof(self.projectData.bundles[bundle]) != 'undefined' ) {

            rl.setPrompt('Bundle [ '+ bundle +' ] already exists. Do you want to override ? (Y/n):');
            rl.prompt();

            rl.on('line', function(line) {
                switch( line.trim().toLowerCase() ) {
                    case 'y':
                    case 'yes':
                        makeBundle(true);
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
                console.log('Exiting bundle installation');
                process.exit(0)
            })

        } else {
            makeBundle(false)
        }
    }

    var makeBundle = function(rewrite) {
        if (rewrite) {
            var portsPath = _(GINA_HOMEDIR + '/ports.json', true)
                , portsReversePath = _(GINA_HOMEDIR + '/ports.reverse.json', true);

            if ( typeof(require.cache[portsPath]) != 'undefined') {
                delete require.cache[portsPath]
            }
            if ( typeof(require.cache[portsReversePath]) != 'undefined') {
                delete require.cache[portsReversePath]
            }

            var ports = require(portsPath);
            var portsReverse = require(portsReversePath);

            var patt = new RegExp(local.bundle + '@' + self.name +'/');
            for (var p in ports) {

                if ( patt.test(ports[p]) ) {
                    delete ports[p];
                    self.portsList.splice(self.portsList.indexOf(p), 1)
                }
            }

            delete portsReverse[local.bundle + '@' + self.name];

            lib.generator.createFileFromDataSync(ports, self.portsPath);
            lib.generator.createFileFromDataSync(portsReverse, self.portsReversePath);
        }

        saveEnvFile(function doneSavingEnv(err){
            if (err) rollback(err);

            saveProjectFile( function doneSavingProject(err, content) {
                if ( err ) {
                    rollback(err)
                }
                if (rewrite) {
                    delete content.bundles[local.bundle]
                }
                createBundle()
            })
        })
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
        data.bundles[local.bundle] = {
            "comment" : "Your comment goes here.",
            "tag" : "001",
            "src" : "src/" + local.bundle,
            "release" : {
                "version" : "0.0.1",
                "link" : "bundles/"+ local.bundle
            }
        };
        try {
            lib.generator.createFileFromDataSync(data, self.projectPath);
            self.projectDataWrote = true;
            callback(false, data)
        } catch (err) {
            callback(err)
        }
    }

    /**
     *
     *
     * */
    var saveEnvFile = function(callback) {
        var portsPath = _(GINA_HOMEDIR + '/ports.json', true)
            , portsReversePath = _(GINA_HOMEDIR + '/ports.reverse.json', true)
            , envDataPath = _(self.projects[self.name].path + '/env.json', true);


        if ( typeof(require.cache[portsPath]) != 'undefined') {
            delete require.cache[portsPath]
        }
        if ( typeof(require.cache[portsReversePath]) != 'undefined') {
            delete require.cache[portsReversePath]
        }
        if ( typeof(require.cache[envDataPath]) != 'undefined') {
            delete require.cache[envDataPath]
        }

        var envData = require(envDataPath)
            , portsData = require(portsPath)
            , portsReverseData = require(portsReversePath);


        var e = 0
            , content = JSON.parse(JSON.stringify(envData))
            , ports = JSON.parse(JSON.stringify(portsData))
            , portsReverse = JSON.parse(JSON.stringify(portsReverseData));

        if ( typeof(content[local.bundle]) != 'undefined' ) {
            delete content[local.bundle]
        }


        for (; e<self.envs.length; ++e) {
            if ( typeof(content[local.bundle]) == 'undefined' ) {
                content[local.bundle] = {}
            }
            content[local.bundle][self.envs[e]] = {
                "host" : "127.0.0.1"
            };
            if ( typeof(content[local.bundle]) == 'undefined') {
                content[local.bundle] = {}
            }

            //if ( typeof(ports[self.portsList[e]]) == 'undefined') {
                ports[self.ports[e]] = local.bundle + '@' + self.name + '/' + self.envs[e]
            //} else {
            //    console.warn('[ '+self.portsList[e]+' ] is already set. Won\'t override.' )
            //}

            if ( typeof(portsReverse[local.bundle + '@' + self.name]) == 'undefined') {
                portsReverse[local.bundle + '@' + self.name] = {}
            }

            //if ( typeof(portsReverse[local.bundle + '@' + self.name][self.envs[e]]) == 'undefined') {
                portsReverse[local.bundle + '@' + self.name][self.envs[e]] = ''+ self.ports[e]
            //}

        }

        try {
            lib.generator.createFileFromDataSync(content, envDataPath);
            self.envDataWrote = true;
            // save to ~/.gina/ports.json & ~/.gina/ports.reverse.json
            lib.generator.createFileFromDataSync(ports, portsPath);
            self.portsDataWrote = true;
            lib.generator.createFileFromDataSync(portsReverse, portsReversePath);
            self.portsReverseDataWrote = true;

            callback(false)
        } catch (err) {
            callback(err)
        }
    }



    /**
     * Create bundle default sources under /src
     *
     * @param {string} bundle
     * @param {object} project
     * */
    var createBundle = function() {
        delete require.cache[_(self.projectPath,true)];
        var projectData = require(_(self.projectPath));
        var target = _( self.projects[self.name].path +'/'+ projectData.bundles[local.bundle].src);
        var sample = new _(getPath('gina.core') +'/template/samples/bundle/');


        sample.cp(target, function done(err) {
            if (err) {
                rollback(err)
            }
            // Browse, parse and replace keys
            local.source = target;
            browse(local.source)
        })
    }

    /**
     * Browse sources
     *
     * @param {string} source
     * @param {string} bundle
     * */
    var browse = function(source, list) {
        var bundle = local.bundle
            , newSource
            , files = fs.readdirSync(source)
            , f = 0;

        if (source == local.source && typeof(list) == 'undefined') {//root
            var list = [];// root list
            for (var l=0; l<files.length; ++l) {
                list[l] = _(local.source +'/'+ files[l])
            }
        }

        if (!files && list.indexOf(source) > -1) {
            list.splice( list.indexOf(source), 1 )
        }

        for (; f < files.length; ++f) {
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
                console.info('Bundle [ '+bundle+' ] has been added to your project with success ;)');
                ++local.b;
                addBundles(local.b)
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
        //console.log('replacing: ', file);
        try {
            var f;
            f =(f=file.split(/\//))[f.length-1];
            var isJS = /\.js/.test(f.substring(f.length-3))
                , isJSON = /\.js/.test(f.substring(f.length-5));

            if ( isJS || isJSON && /config\/app\.json/.test(file) ) {
                var contentFile = fs.readFileSync(file, 'utf8').toString();
                //var contentFile = require(file).toSource();
                var dic = {
                    "Bundle" : local.bundle.substring(0, 1).toUpperCase() + local.bundle.substring(1),
                    "bundle" : local.bundle
                };

                contentFile = whisper(dic, contentFile);
                //rewrite file
                lib.generator.createFileFromDataSync(contentFile, file)
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
        console.error('could not complete bundle creation: ', (err.stack||err.message));
        console.warn('rolling back...');

        var writeFiles = function() {
            //restore env.json
            if ( typeof(self.envDataWrote) != undefined ) {
                lib.generator.createFileFromDataSync(self.envData, self.envPath)
            }
            //restore project.json
            if ( typeof(self.projectDataWrote) != undefined ) {
                if ( typeof(self.projectData.bundles[local.bundle]) != 'undefined') {
                    delete self.projectData.bundles[local.bundle]
                }
                lib.generator.createFileFromDataSync(self.projectData, self.projectPath)
            }

            //restore ports.json
            if ( typeof(self.portsDataWrote) != undefined ) {
                lib.generator.createFileFromDataSync(self.portsData, self.portsPath)
            }

            //restore ports.reverse.json
            if ( typeof(self.portsReverseDataWrote) != undefined ) {
                lib.generator.createFileFromDataSync(self.portsReverseData, self.portsReversePath)
            }


            process.exit(1)
        };

        var bundle = new _(local.source);
        if ( bundle.existsSync() ) {
            bundle.rm( function(err) {//remove folder
                if (err) {
                    throw err
                }
                writeFiles()
            })
        } else {
            writeFiles()
        }
    };

    init()
};

module.exports = Add