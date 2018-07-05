var fs = require('fs');
var readline = require('readline');
var rl = readline.createInterface({ input: process.stdin, output: process.stdout });

var CmdHelper = require('./../helper');
var console = lib.logger;
var scan = require('../port/inc/scan');

/**
 * Set a protocol to your project
 *
 * e.g.
 *  gina protocol:set
 *  gina protocol:set @<project_name>
 *  gina protocol:set <bundle> @<project_name>
 *
 * */
function Set(opt, cmd) {

    // self will be pre filled if you call `new CmdHelper(self, opt.client)`
    var self = {}, local = { portsAvailable: [] };

    var init = function() {

        // import CMD helpers
        new CmdHelper(self, opt.client);

        // check CMD configuration
        if (!isCmdConfigured()) return false;
        
        // backup in case of rolllover
        local.ports         = require(_(self.portsPath));
        local.portsReverse  = require(_(self.portsReversePath));        
        local.mainConfig    = JSON.parse(JSON.stringify(self.mainConfig));


        // find available port
        var options = {
            ignore  : self.portsGlobalList,
            len   : ( self.envs.length * self.bundles.length )
        };
        
        scan(options, function(err, ports){

            if (err) {
                console.error(err.stack|err.message);
                process.exit(1)
            }


            for (var p = 0; p < ports.length; ++p) {
                local.portsAvailable.push(ports[p])
            }

            local.portsAvailable.sort();
            

            if (!self.name && !self.projectName) {
                // this case is allways catched excepted for `LIST` command
            } else if (self.projectName && isDefined(self.projectName) && !self.name) {
                local.projectConfig = JSON.parse(JSON.stringify(self.projects));
                check('project')
            } else if (typeof (self.name) != 'undefined' && isValidName(self.name)) {
                local.projectConfig = JSON.parse(JSON.stringify(self.projects));
                check('bunlde')
            } else {
                console.error('[ ' + self.name + ' ] is not a valid project name.');
                process.exit(1)
            }
        })        
    }

    //  check if bundle is defined
    var isDefined = function(name) {
        if (typeof (self.projects[name]) != 'undefined') {
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

    var check = function(actionType) {
        
        self.actionType = actionType;
        
        var phrase = null
            , list = ''
            , choices = {}
            , opt = JSON.parse(JSON.stringify(self.protocolsAvailable));
        
        opt.push('cancel');
        
        for (var p = 0, len = opt.length; p < len; ++p) {
            
            if (p < len-1) {
                choices[p+1] = opt[p];
                choices[opt[p]] = opt[p];
            }
            
            if (p == len-1) {
                list += '\n';
            }
            
            if ( self.defaultProtocol == opt[p]) {
                list += '\n ('+ (p+1) +') '+ opt[p] + ' - default';    
            } else {
                list += '\n ('+ ( (p == len-1) ? 'c' : (p+1) ) +') '+ opt[p];
            }            
        }
        var name = (actionType == 'project') ? self.projectName : self.name;
        phrase = 'Choose among the following protocols the new default setting for your ' + actionType +' ('+ name +').\n'+ list +'\r\n> ';
                        
        rl.setPrompt(phrase);
                
        var choice = null;
        rl
            .on('line', function(line) {
                
                choice = line.trim().toLowerCase();
                
                if ( typeof(choices[choice]) != 'undefined') {
                    rl.clearLine();
                    if (/project/.test(actionType))
                        setProjectOnly(choices[choice]);
                    else
                        setBundleOnly(choices[choice]);
                        
                } else {
                    
                    if ( /^(c|cancel)$/.test(choice) ) {
                        rl.clearLine();
                        rl.close();
                    } else {
                        console.log('Please, write '+ self.protocolsAvailable.join(', ') +' or "c" (cancel) to proceed.');
                        rl.prompt();    
                    }
                }                
                
            })            
            .on('close', function() {
                rl.clearLine();
                console.log('Exiting protocol setup');
                rl.close();
            });       
            
            rl.prompt();
            // to debug, comment the line above & uncomment one of the 2 lines below
            //setProjectOnly('http/2')
            //setBundleOnly('http/2')
            
            
    }


    var setProjectOnly = function(protocol) {
        
        // get user protocol list
        var protocols = JSON.parse(JSON.stringify(self.protocols));
        // is existing ?
        var found = protocols.indexOf(protocol);
        
        var project = self.projectData;
        var re      = new RegExp('\@'+ self.projectName +'$', '');
        var bundles = self.bundles;
        var envs    = self.envs;
        
        var ports           = JSON.parse(JSON.stringify(local.ports));
        var portsReverse    = JSON.parse(JSON.stringify(local.portsReverse));
        var projectConfig   = JSON.parse(JSON.stringify(local.projectConfig));
        
       
        if ( found > -1 ) { // udpdate default protocol
            
            if ( self.defaultProtocol != protocols[found] ) {
                // update default protocol
                self.defaultProtocol = protocols[found];
                projectConfig[self.projectName].def_protocol = self.defaultProtocol;
                
                // save to ~/.gina/main.json
                lib.generator.createFileFromDataSync(projectConfig, self.projectConfigPath);
                
                self.mainConfigUpdated = true;
                
                // updating reverse ports 
                var arr = [], key = null;
                var env = null, b = 0;                       
                for (var i in ports) { // each protocol     
                    if (i != protocol) continue;
                    
                    for (var port in ports[protocol])  { // for each port
                        
                        key = ports[protocol][port];
                        
                        arr = key.split(/\//g);
                        env = arr.pop();
                        b = arr.join(); //bundle
                        if ( typeof(portsReverse[b][env]) == 'undefined' )
                                portsReverse[b][ env ] = {};
                                
                        if ( re.test(b)) {
                            //console.log(b, ' [ ' + protocol + ' ] -> ', ~~port);
                            portsReverse[b][ env ][protocol] = ~~port;
                            
                        }                    
                    }                   
                }
                // save to ~/.gina/ports.reverse.json
                lib.generator.createFileFromDataSync(portsReverse, self.portsReversePath);
            } 
            
            end();
            
        } else { // setup new for the whole project
            
            var port                = null
                , portsAvailable    = local.portsAvailable
                , b                 = 0
                , bLen              = bundles.length
                , e                 = 0
                , eLen              = envs.length
            ;
            
            ports[protocol] = {};
            // ports
            for (; b < bLen; ++b ) { // for each bundle                
                e = 0;
                for (; e < eLen; ++e)  { // for each env                    
                    port = portsAvailable.splice(0, 1)[0];
                    ports[protocol][port] = bundles[b] +'@'+ self.projectName +'/'+ envs[e];
                }                
            }
            
            // updating reverse ports 
            var arr = [], key = null;
            var env = null, b = 0;                       
            for (var i in ports) { // each protocol     
                if (i != protocol) continue;
                
                for (var port in ports[protocol])  { // for each port
                    
                    key = ports[protocol][port];
                    
                    arr = key.split(/\//g);
                    env = arr.pop();
                    b = arr.join(); //bundle
                    if ( typeof(portsReverse[b][env]) == 'undefined' )
                            portsReverse[b][ env ] = {};
                            
                    if ( re.test(b)) {
                        //console.log(b, ' [ ' + protocol + ' ] -> ', ~~port);
                        portsReverse[b][ env ][protocol] = ~~port;
                        
                    }                    
                }                   
            }
            
            // update default protocol
            self.defaultProtocol = protocol;
            projectConfig[self.projectName].def_protocol = self.defaultProtocol;
            
            // save to ~/.gina/projects.json
            lib.generator.createFileFromDataSync(projectConfig, self.projectConfigPath);
            // save to ~/.gina/ports.json
            lib.generator.createFileFromDataSync(ports, self.portsPath);
            // save to ~/.gina/ports.reverse.json
            lib.generator.createFileFromDataSync(portsReverse, self.portsReversePath);
            
            self.mainConfigUpdated = true;
            end()
        }
        
    };

    var setBundleOnly = function(protocol) {
        console.log('set bundle only');
        // get user protocol list
        var protocols = JSON.parse(JSON.stringify(self.protocols));
        // is existing ?
        var found = protocols.indexOf(protocol);
        if ( found < 0 ) exit(); // not possible in theory 
                     
        var bundles = self.bundles;
        var envs    = self.envs;

        var bundleConfig = self.bundlesByProject[self.projectName][self.name];
        var env = bundleConfig.defaultEnv;
        var settingsPath = _(bundleConfig.configPaths.settings, true);
        //var envSettingsPath = _(settingsPath.replace(/\.json/, '.'+ env +'.json'), true);
        
        var settings = {};
        
        if ( fs.existsSync(settingsPath) ) {
            settings = require(settingsPath);
        }
    
        if ( typeof(settings.server) == 'undefined' ) {
            settings.server = {}
        }
                    
        settings.server.protocol = protocol;
        // save to bundle's /config/settings.json
        lib.generator.createFileFromDataSync(settings, settingsPath);
        
        self.bundleConfigUpdated = true;
                   
        end()
    };
    
    var end = function () {
        
        console.log('Protocol updated with success ;)');
        if ( self.mainConfigUpdated || self.portsUpdated || self.portsReverseUpdated || self.bundleConfigUpdated )
            console.log('You need to restart your ' + self.actionType);
            
        exit()
    }
    
    var rollback = function(err) {
        console.error('[ CLI ] could not complete protocol creation: ', (err.stack||err.message));
        console.info('[ CLI ] rolling back...');

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
                lib.generator.createFileFromDataSync(self.projectData, self.projectConfigPath)
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

        // var bundle = new _(local.source);
        // if ( bundle.existsSync() ) {
        //     bundle.rm( function(err) {//remove folder
        //         if (err) {
        //             throw err
        //         }
        //         writeFiles()
        //     })
        // } else {
        //     writeFiles()
        // }
    };

    init()
};

module.exports = Set