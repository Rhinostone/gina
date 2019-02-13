var fs          = require('fs');

var CmdHelper   = require('./../helper');
var Shell       = lib.Shell;
var console     = lib.logger;
var scan        = require('../port/inc/scan');

/**
 * Add new project or register old one to `~/.gina/projects.json`.
 * NB.: If project exists, it won't be replaced. You'll only get warnings.
 * */
function Add(opt, cmd) {

    var self        = {}
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

        if ( checkImportMode() ) {
            return;
        }

        var err         = false
            , folder    = null
        ;

        folder = new _(self.projectLocation);

        if ( folder.isValidPath() && isValidName(self.projectName) ) {

            err = folder.mkdirSync();

            if (err instanceof Error) {
                console.error(err.stack);
                process.exit(1)
            }

        }


        // creating project file
        var file = new _(self.projectLocation + '/project.json', true);
        if ( !file.existsSync() ) {
            createProjectFile( file.toString() )
        } else {
            console.warn('[ project.json ] already exists in this location: '+ file);
        }

        // creating env file
        var file = new _(self.projectLocation + '/env.json', true);
        if ( !file.existsSync() ) {
            createEnvFile( file.toString() )
        } else {
            console.warn('[ env.json ] already exists in this location: '+ file);
        }

        // creating package file
        file = new _(self.projectLocation + '/package.json', true);
        if ( !file.existsSync() ) {
            createPackageFile( file.toString() )
        } else {
            console.warn('[ package.json ] already exists in this location: '+ file);

            end()
        }
    }

    var checkImportMode = function() {
        
        if ( self.task != 'project:import')
            return;
        
        console.debug('Starting import mode @'+ self.projectName );
        if (!self.projects[self.projectName ]) {
            console.error('[ '+ self.projectName  +' ] is not an existing project. Instead, use gina projet:add @'+ self.projectName +' --path=/your/project_location');
            process.exit(1)
        }
        
        if ( typeof(self.projects[self.projectName ]) != 'undefined' ) {
            // import if exists but path just changed
            if ( typeof(self.projects[self.projectName ].path) != 'undefined') {
                var old = new _(self.projects[self.projectName ].path, true).toArray().last();
                var current = new _(self.projectLocation, true).toArray().last();

                if (old === self.projectName) {
                    self.projects[self.projectName ].path = self.projectLocation;

                    var target = _(GINA_HOMEDIR + '/projects.json')
                        , projects = self.projects;

                    lib.generator.createFileFromDataSync(
                        projects,
                        target
                    );
                   

                    var ginaModule = _( self.projectLocation +'/node_modules/gina',true );

                    if ( !fs.existsSync(ginaModule) ) {
                        linkGina(
                            function onError(err) {
                                console.error(err.stack);
                                process.exit(1)
                            },
                            function onSuccess() {
                                end();
                                return true;
                            })

                    } else {
                        end()
                        return true;
                    }
                }
            } else {
                console.error('[ '+ self.projectLocation  +' ] is an existing project. Please choose another name for your project or remove this one.');
                process.exit(1)
            }
        }
    }

    var createProjectFile = function(target) {

        loadAssets();

        var conf        = _(getPath('gina').core +'/template/conf/project.json', true);
        var contentFile = require(conf);
        var dic = {
            "project" : self.projectName
        };

        contentFile = whisper(dic, contentFile); //data
        lib.generator.createFileFromDataSync(
            contentFile,
            target
        )
    }

    var createEnvFile = function(target) {
        lib.generator.createFileFromDataSync(
            {},
            target
        )
    }


    var createPackageFile = function(target) {

        loadAssets();

        var conf = _(getPath('gina').core +'/template/conf/package.json', true);
        var contentFile = require(conf);
        var dic = {
            'project' : self.projectName,
            'node_version' : GINA_NODE_VERSION.match(/\d+/g).join('.')
        };

        contentFile = whisper(dic, contentFile);//data
        lib.generator.createFileFromDataSync(
            contentFile,
            target
        );

        end(true)
    }

    var end = function(created) {


        var target = _(GINA_HOMEDIR + '/projects.json')
            , projects = self.projects
            , error = false;


        projects[self.projectName] = {
            "path": self.projectLocation,
            "framework": "v" + GINA_VERSION,
            "envs": self.envs,
            "def_env": self.defaultEnv,
            "dev_env": self.devEnv,
            "protocols": self.protocols,
            "def_protocol": self.defaultProtocol,
            "schemes": self.schemes,
            "def_scheme": self.defaultScheme
        };
        
        // crearte/update ports, protocols & schemes
        addBundlePorts(0);

        // writing file
        lib.generator.createFileFromDataSync(
            projects,
            target
        );

        var onSuccess = function () {
            if ( self.task == 'project:add' ) {
                console.log('Project [ '+ self.projectName +' ] has been added');
            } else {
                console.log('Project [ '+ self.projectName +' ] has been imported');
            }
                        
            process.exit(0)
        }

        var onError = function (err) {
            console.error('Could not finalize [ '+ self.projectName +' ] install\n'+ err.stack);
            process.exit(1)
        }
        
        


        var ginaModule = new _( self.projectLocation +'/node_modules/gina',true );

        if ( !ginaModule.existsSync() ) {
            linkGina(onError, onSuccess)
        } else {

            error = ginaModule.rmSync();

            if (error instanceof Error) {
                console.error(err.stack);
                process.exit(1);
            } else {
                linkGina(onError, onSuccess)
            }

        }
    }
    
    var hasPastProtocolAndSchemeCheck = function (protocol, scheme, exitOnError) {
        loadAssets();
        
        // are selected protocol & scheme allowed ?        
        if ( self.protocolsAvailable.indexOf(protocol) < 0 ) {
            console.error('Protocol [ '+scheme+' ] is not an allowed protocol: check your framework configuration (~/main.json)');
            if ( typeof(exitOnError) != 'undefined' && exitOnError)
                process.exit(1)
        }
        if ( self.schemesAvailable.indexOf(scheme) < 0 ) {
            console.error('Scheme [ '+scheme+' ] is not an allowed scheme: check your framework configuration (~/main.json)');
            if ( typeof(exitOnError) != 'undefined' && exitOnError)
                process.exit(1)
        }
    }
    
    /**
     * Add / update project default protocol, scheme & ports
     * 
     * @param {number} b - Bundle index
     */
    var addBundlePorts = function(b) {
        loadAssets();
        
        if (b > self.bundles.length-1) { // writing to files on complete
            
            hasPastProtocolAndSchemeCheck(self.defaultProtocol, self.defaultScheme, true);              
            
            // get user protocols list
            var protocols = JSON.parse(JSON.stringify(self.protocols));
            // get user schemes list
            var schemes = JSON.parse(JSON.stringify(self.schemes));
                        
            var projectConfig   = JSON.parse(JSON.stringify(self.projects)); 
                            
            // if ( protocols.indexOf(protocol) < 0 ) {
            //     protocols.push(protocol);
            //     self.protocols = protocols;   
            //     projectConfig[self.projectName].protocols = protocols;         
            // }
            // if ( schemes.indexOf(scheme) < 0 ) {
            //     schemes.push(scheme);
            //     self.schemes = schemes;   
            //     projectConfig[self.projectName].schemes = schemes;      
            // }
                        
            //console.debug('about to update project ports conf\n\rBundles: '+ JSON.stringify(self.projectData, null, 4));
            var ports               = JSON.parse(JSON.stringify(self.portsData)) // cloning
                , portsReverse      = JSON.parse(JSON.stringify(self.portsReverseData)) // cloning
                , portsList         = local.ports
                , isPortUsed        = false
                , envs              = self.envs
                , i                 = 0
                , defaultProtocol   = self.defaultProtocol
                , defaultScheme     = self.defaultScheme
            ;
            
            if ( typeof(ports[defaultProtocol]) == 'undefined' ) {
                ports[defaultProtocol] = {}
            }
            
            if ( typeof(ports[defaultProtocol][defaultScheme]) == 'undefined' ) {
                ports[defaultProtocol][defaultScheme] = {}
            }
    
            // to fixe bundle settings inconsistency
            var bundleConfig    = null;        
            var settingsPath    = null;
            var bundleSettingsUpdate = false;
    
            var portValue = null, portReverseValue = null;
            var re = null, portsListStr = JSON.stringify(self.portsData);
    
            for (;i < portsList.length; ++i) {
    
                if ( !ports.count() ) {
                    ports[defaultProtocol] = {};
                    ports[defaultProtocol][defaultScheme] = {};
                    ports[defaultProtocol][defaultScheme][ portsList[i] ] = null;
                }
    
                
                for ( var protocol in ports ) {
                    // ignore unmatched protocol : in case of the framework update
                    if ( self.protocolsAvailable.indexOf(protocol) < 0) {
                        delete ports[protocol];
                        if ( self.protocols.indexOf(protocol) < 0) {
                            delete self.protocols[self.protocols.indexOf(protocol)]; 
                        }                                               
                        continue; 
                    }
                        
                    for (var scheme in ports[protocol]) {
                        
                        // ignore unmatched scheme : in case of the framework update
                        // if ( self.schemesAvailable.indexOf(scheme) < 0) {
                        //     delete ports[protocol][scheme];
                        //     if ( self.schemes.indexOf(scheme) < 0) {
                        //         delete self.schemes[self.schemes.indexOf(scheme)]; 
                        //     }                                               
                        //     continue; 
                        // } 
                        
                        if ( !ports[protocol][scheme].count() ) {
                            ports[protocol][scheme][ portsList[i] ] = null;
                        }
                        
                        for (var b = 0, bLen = self.bundles.length; b < bLen; ++b) {
                            
                            local.bundle = self.bundles[b];                            
                            
                            // bundle settings inconsistency check @ fix
                            bundleName              = local.bundle;                              
                            bundleConfig            = self.bundlesByProject[self.projectName][bundleName];        
                            settingsPath            = _(bundleConfig.configPaths.settings, true);   
                            bundleSettingsUpdate    = false;
                            
                            if ( fs.existsSync(settingsPath) ) {
                                                                                            
                                bundleSettings  = require(settingsPath);  
                                //console.debug('found [ '+ bundleName +' ] settings ');                             
                                if ( typeof(bundleSettings.server) != 'undefined' ) {           
                                    // update only if given bundle protocol setting not in project protocols list  
                                    // use project def_protocol by default in that case                          
                                    if ( 
                                        typeof(bundleSettings.server.protocol) != 'undefined' 
                                        && protocols.indexOf(bundleSettings.server.protocol) < 0
                                    ) {
                                        bundleSettings.server.protocol = self.defaultProtocol;
                                        bundleSettingsUpdate = true
                                    }
                                    
                                    // update only if given bundle scheme setting not in project schemes list  
                                    // use project def_scheme by default in that case                          
                                    if ( 
                                        typeof(bundleSettings.server.scheme) != 'undefined' 
                                        && schemes.indexOf(bundleSettings.server.scheme) < 0
                                    ) {
                                        bundleSettings.server.scheme = self.defaultScheme;
                                        bundleSettingsUpdate = true
                                    }
                                    
                                    if (bundleSettingsUpdate) {                                        
                                        lib.generator.createFileFromDataSync(bundleSettings, settingsPath);
                                        console.debug('updated [ '+ bundleName +' ] settings');
                                    }
                                }                            
                            }                           
                            
                            // updating ports
                            for (var port in ports[protocol][scheme]) {    
                                
                                    
                                    for (var e = 0, envsLen = envs.length; e < envsLen; ++e ) {
        
                                        if (!portsList[i]) break;
                                        
                                        // ports
                                        portValue = local.bundle +'@'+ self.projectName +'/'+ envs[e];
                                        re = new RegExp(portValue);
                                        
                                        
                                        if ( !re.test(portsListStr) ) { 
                                            
                                            // ports - add only if not existing
                                            isPortUsed = false;
                                            
                                            for (var portNum in ports[protocol][scheme]) {
                                                if ( ports[protocol][scheme][portNum] == portValue ) {
                                                    isPortUsed = true;
                                                    break;
                                                }                                                
                                            }
                                            //console.debug('portValue -> ', portValue+ ': '+ portsList[i] +' ? ' +isPortUsed);
                                            if (!isPortUsed) {
                                                //console.debug(local.bundle, ': ',portsList[i], ' => ', portValue);
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
                                                portsReverse[ local.bundle +'@'+ self.projectName ][ envs[e] ][ protocol ][ scheme ] = ~~portsList[i];
                                                
                                            
                                            }
            
                                            ++i;
                                        }
                                    }
                                        
                                }
                        }
                    }  
                }
            }
            
            // save to ~/.gina/projects.json
            lib.generator.createFileFromDataSync(projectConfig, self.projectConfigPath);
    
            // save to ~/.gina/ports.json
            //console.debug('data \n'+ JSON.stringify(self.portsData, null, 4) +'\n\rcurrent \n'+ JSON.stringify(ports, null, 4));
            lib.generator.createFileFromDataSync( merge(self.portsData, ports), self.portsPath);
    
            // save to ~/.gina/ports.reverse.json
            lib.generator.createFileFromDataSync( merge(self.portsReverseData, portsReverse), self.portsReversePath);

            
            return;
        }

        //console.debug('Bundles list on project import [ '+ b +' ]', self.bundles.length, self.bundles);       
        var options     = {}
            , bundle    = self.bundles[b]
        ;
        
        if ( /^[a-z0-9_.]/.test(bundle) ) {

            local.b             = b;
            local.bundle        = bundle;

            // find available port
            options = {
                ignore  : merge(self.portsGlobalList, local.ports),
                // get for each bundle ports for available protocol, scheme & env
                len   : ( self.protocolsAvailable.length * self.schemesAvailable.length * self.envs.length * self.bundles.length )
            };
            
            
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

                ++local.b;
                addBundlePorts(local.b);
                
            });
            
            


        } else {
            console.error('[ '+ bundle+' ] is not a valid bundle name')
            process.exit(1)
        }
    }

    var linkGina = function ( onError, onSuccess ) {

        var npm = new Shell();

        npm.setOptions({ chdir: self.projectLocation });
        npm
            .run('npm link gina', true)
            .onComplete(function (err, data) {
                if (err) {
                    if ( typeof(onSuccess) != 'undefined' ) {
                        onSuccess(err);
                    } else {
                        console.error(err.stack);
                    }

                } else {
                    if ( typeof(onSuccess) != 'undefined' )
                        onSuccess()
                }
            })
    }

    init()
};

module.exports = Add