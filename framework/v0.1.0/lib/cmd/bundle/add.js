var fs          = require('fs');
var readline    = require('readline');
var rl          = readline.createInterface({ input: process.stdin, output: process.stdout });

var CmdHelper   = require('./../helper');
var console     = lib.logger;
var scan        = require('../port/inc/scan');


/**
 * Add new bundle to a given project.
 * NB.: If bundle exists, You will be asked if you want to replace.
 *
 * Usage:
 * $ gina bundle:add <bundle_name> @<project_name>
 * */
function Add(opt, cmd) {

    var self    = {}
    , local     = {
            // bundle index while searching or browsing
            b : 0,
            bundle : null,
            bundlePath : null,
            ports : []
        }
    ;

    var init = function() {

        // import CMD helpers
        new CmdHelper(self, opt.client, { port: opt.debugPort, brkEnabled: opt.debugBrkEnabled });

        // check CMD configuration
        if ( !isCmdConfigured() ) return false;


        if ( isDefined('project', self.projectName) && self.bundles.length > 0) {

            addBundles(0)

        } else {
            //console.error('[ '+ self.projectName+' ] is not an existing project');
            if ( self.bundles.length == 0) {
                console.error('Missing argument <bundle_name>');
            } else if  (!isDefined('project', self.projectName) ) {
                console.error('`@' + self.projectName +'` is not an existing project.');
            } else {
                console.error('Missing argument @<project_name>');
            }

            process.exit(1)
        }
    }

    /**
     * Add bundles
     *
     * @param {number} b - bundle index
     * @param {number} e - env index
     *
     * */
    var addBundles = function(b) {

        if (b > self.bundles.length-1) { // exits when done
            process.exit(0)
        }

        var options     = {}
            , bundle    = self.bundles[b]
        ;


        if ( /^[a-z0-9_.]/.test(bundle) ) {

            if ( !fs.existsSync(self.envPath) ) {
                lib.generator.createFileFromDataSync({}, self.envPath);
            }

            local.b             = b;
            local.bundle        = bundle;
            local.envFileSaved  = false;

            // find available port
            options = {
                ignore  : self.portsList,
                len   : ( self.protocolsAvailable.length * self.envs.length * self.bundles.length )
            };

            if (b == 0) {
                // scanning for available ports ...
                scan(options, function(err, ports){

                    if (err) {
                        console.error(err.stack|err.message);
                        process.exit(1)
                    }


                    for (var p = 0; p < ports.length; ++p) {
                        local.ports.push(ports[p])
                    }

                    local.ports.sort();

                    try {
                        check();
                    } catch (err) {
                        rollback(err)
                    }
                })
            } else {
                // skip scan
                try {
                    check();
                } catch (err) {
                    rollback(err)
                }
            }


        } else {
            console.error('[ '+ bundle+' ] is not a valid bundle name')
            process.exit(1)
        }
    }

    var check = function() {

        if ( typeof(self.projectData.bundles[local.bundle]) != 'undefined' ) {

            rl.setPrompt('Bundle [ '+ local.bundle +' ] already exists !\n(r) Replace - All existing files will be lost !\n(c) Cancel\n(i) Import\n> ');

            rl.prompt();

            rl
                .on('line', function(line) {

                    switch( line.trim().toLowerCase() ) {

                        case 'r':
                        case 'replace':
                            rl.clearLine();
                            makeBundle(local.bundle, true);
                        break;

                        case 'c':
                        case 'cancel':

                            if (local.b < self.bundles.length) {

                                rl.clearLine();
                                // continue to next bundle
                                ++local.b;
                                addBundles(local.b)

                            } else {

                                console.log('Aborting bundle installation');
                                rl.clearLine();
                                process.exit(0);
                            }

                        break;

                        case 'i':
                        case 'import':

                            rl.clearLine();
                            local.envFileSaved = true;
                            makeBundle(local.bundle, false);

                        break;

                        default:
                            console.log('Please, write "r" to proceed or "c" to cancel.');
                            rl.prompt();
                    }
                })
                .on('close', function() {
                    rl.clearLine();
                    console.log('Exiting bundle installation');
                    process.exit(0)

                });
        } else {
            makeBundle(local.bundle, false)
        }
    }

    var makeBundle = function(bundle, rewrite) {

        loadAssets();

        var ports               = JSON.parse(JSON.stringify(self.portsData)) // cloning
            , portsReverse      = JSON.parse(JSON.stringify(self.portsReverseData)) // cloning
            , portsList         = local.ports
            , envs              = self.envs
            , i                 = 0
            , assigned          = []
            , defaultProtocol   = self.defaultProtocol
            , defaultScheme     = self.defaultScheme
        ;

        if ( typeof(ports[defaultProtocol]) == 'undefined' ) {
            ports[defaultProtocol] = {}
        }
        
        if ( typeof(ports[defaultProtocol][defaultScheme]) == 'undefined' ) {
            ports[defaultProtocol][defaultScheme] = {}
        }


        var portValue = null, portReverseValue = null;
        var re = null, portsListStr = JSON.stringify(self.portsData);

        console.debug('portsList ', portsList);
        for (;i < portsList.length; ++i) {

            if ( !ports.count() ) {
                ports[defaultProtocol] = {};
                ports[defaultProtocol][defaultScheme] = {};
                ports[defaultProtocol][defaultScheme][ portsList[i] ] = null;
            }

            for ( var protocol in ports ) {
                for (var scheme in ports[protocol]) {
                    if ( !ports[protocol][scheme].count() ) {
                        ports[protocol][scheme][ portsList[i] ] = null;
                    }

                    // updating
                    for (var port in ports[protocol][scheme]) {


                        for (var e = 0, envsLen = envs.length; e < envsLen; ++e ) {

                            if (!portsList[i]) break;
                            // ports
                            portValue = local.bundle +'@'+ self.projectName +'/'+ envs[e];
                            re = new RegExp(portValue);

                            if ( !re.test(portsListStr) ) {
                                ports[protocol][scheme][ portsList[i] ] = portValue;

                                // reverse ports
                                portReverseValue = portsList[i];
                                if ( typeof(portsReverse[ local.bundle +'@'+ self.projectName ]) == 'undefined' )
                                    portsReverse[ local.bundle +'@'+ self.projectName ] = {};

                                if ( typeof(portsReverse[ local.bundle +'@'+ self.projectName ][ envs[e] ]) == 'undefined' )
                                    portsReverse[ local.bundle +'@'+ self.projectName ][ envs[e] ] = {};
                                    
                                if ( typeof(portsReverse[ local.bundle +'@'+ self.projectName ][ envs[e] ][ protocol ]) == 'undefined' )
                                    portsReverse[ local.bundle +'@'+ self.projectName ][ envs[e] ][ protocol ] = {};

                                // erasing in order to keep consistency
                                portsReverse[ local.bundle +'@'+ self.projectName ][ envs[e] ][ protocol ][ scheme ] = portsList[i];

                                ++i;
                            }
                        }
                    }
                }  
            }
        }

        // save to ~/.gina/ports.json
        lib.generator.createFileFromDataSync(ports, self.portsPath);
        local.portsDataWrote = true;

        // save to ~/.gina/ports.reverse.json
        lib.generator.createFileFromDataSync(portsReverse, self.portsReversePath);
        local.portsReverseDataWrote = true;


        if (!local.envFileSaved) {
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

        } else { // importing
            console.log('Bundle [ '+ local.bundle +' ] has been imported to your project with success ;)');
            rl.clearLine();
            ++local.b;
            addBundles(local.b)
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

        var version = '0.0.1';
        data.bundles[local.bundle] = {
            "_comment" : "Your comment goes here.",
            "tag" : ( version.split('.') ).join(''),
            "src" : "src/" + local.bundle,
            "release" : {
                "version" : version,
                "link" : "bundles/"+ local.bundle,
                "release": {
                    "version": version,
                    "link": "bundles/"+ local.bundle,
                    "target": "releases/"+ local.bundle +"/prod/" + version
                }
            }
        };

        try {

            lib.generator.createFileFromDataSync(data, self.projectPath);
            local.projectDataWrote = true;

            callback(false, data)

        } catch (err) {
            callback(err)
        }
    }

    /**
     * Save env path
     *
     * */
    var saveEnvFile = function(callback) {

        loadAssets();

        var e               = 0
            // working with copies in case of rollback
            , content       = JSON.parse(JSON.stringify(self.envData))
        ;


        if ( typeof(content[local.bundle]) != 'undefined' ) {
            delete content[local.bundle]
        }

        for (; e < self.envs.length; ++e) {

            if ( typeof(content[local.bundle]) == 'undefined' ) {
                content[local.bundle] = {}
            }
            content[local.bundle][ self.envs[e] ] = {
                "host" : "localhost"
            };

        }

        try {

            // save to ~/.gina/envs.json
            lib.generator.createFileFromDataSync(content, self.envPath);
            local.envDataWrote = true;

            local.envFileSaved = true;

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

        loadAssets();

        var projectData = require(self.projectPath)
            , target    = _( self.projects[self.projectName].path +'/'+ projectData.bundles[local.bundle].src, true )
            , sample    = new _( getPath('gina').core + '/template/samples/bundle/' );


        sample.cp(target, function done(err) {

            if (err) {

                rollback(err)

            } else {
                // Browse, parse and replace keys
                local.source        = target;
                local.isInstalled   = false;

                browse(local.source);

                if (local.isInstalled) {
                    console.log('Bundle [ '+ local.bundle +' ] has been added to your project with success ;)');
                    rl.clearLine();
                    ++local.b;
                    addBundles(local.b)
                }
            }
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

                local.isInstalled = true;

                break
            }
        }

    }

    /**
     * Parse file and modify only javascripts - *.js
     *
     * @param {string} file - File to parse
     * @param {array} list
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
            if ( typeof(local.envDataWrote) == 'undefined' ) {
                lib.generator.createFileFromDataSync(self.envData, self.envPath)
            }
            //restore project.json
            if ( typeof(local.projectDataWrote) == 'undefined' ) {
                if ( typeof(self.projectData.bundles[local.bundle]) != 'undefined') {
                    delete self.projectData.bundles[local.bundle]
                }
                lib.generator.createFileFromDataSync(self.projectData, self.projectPath)
            }

            //restore ports.json
            if ( typeof(local.portsDataWrote) == 'undefined' ) {
                lib.generator.createFileFromDataSync(self.portsData, self.portsPath)
            }

            //restore ports.reverse.json
            if ( typeof(local.portsReverseDataWrote) == 'undefined' ) {
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