var fs          = require('fs');
var readline    = require('readline');
var rl          = readline.createInterface(process.stdin, process.stdout);

var CmdHelper   = require('./../helper');
var console     = lib.logger;

/**
 * Remove existing bundle from a given project.
 * NB.: If bundle exists, it won't be replaced. You'll only get warnings.
 *
 * TODO - Remove multiple bundles at once - ref. bundle/add
 * */
function Remove(opt, cmd) {

    var self    = {}
        , local = {
            b : 0,
            bundle : null,
            force : false
        }
    ;

    var init = function(opt) {

        // import CMD helpers
        new CmdHelper(self, opt.client, { port: opt.debugPort, brkEnabled: opt.debugBrkEnabled });

        // check CMD configuration
        if ( !isCmdConfigured() ) return false;


        if ( typeof(self.projects[self.projectName].path) == 'undefined' ) {
            console.error('project path not defined in ~/.gina/projects.json for [ '+ self.projectName + ' ]');
            process.exit(1)
        }
        
        if (isDefined('project', self.projectName)) {
            removeBundle(0)
        } else {
            //console.error('[ '+ self.projectName+' ] is not an existing project');
            if ( self.bundles.length == 0) {
                console.error('Missing argument <bundle_name>');
            } else if  (!isDefined('project', self.projectName) ) {
                console.error('[' + self.projectName +'] is not an existing project.');
            } else {
                console.error('Missing argument @<project_name>');
            }

            process.exit(1)
        }

        //var Proc = require( getPath('gina').lib + '/proc');

        
        
    }

    var removeBundle = function (b) {

        if (b > self.bundles.length-1) { // exits when done
            end()
        }

        local.b             = b;
        local.bundle        = self.bundles[b];
        local.envFileSaved  = false;
        local.force         = ( typeof(self.params['force']) != 'undefined' ) ? self.params['force'] : false;


        if (local.force) {
            // remove without checking            
            remove()
        } else {
            check()
        }

    }

    var check = function() {


        rl.setPrompt('['+ local.bundle +'] Also remove bundle files ? (Y/n):');

        rl.prompt();

        rl
            .on('line', function(line) {
                switch( line.trim().toLowerCase() ) {
                    case 'y':
                    case 'yes':
                        rl.clearLine();
                        remove();

                    break;
                    case 'n':
                    case 'no':
                        rl.clearLine();
                        // continue to next bundle
                        ++local.b;
                        removeBundle(local.b);
                    break;

                    default:
                        console.log('Please, write "yes" or "no" to proceed.');
                        rl.prompt();
                        break;
                }
            })
            .on('close', function() {
                rl.clearLine();
                console.log('Action cancelled !');
                process.exit(0)
            })
    }
    
    var remove = function () {

        var folder = new _(self.projects[self.projectName].path + '/' + self.projectData.bundles[local.bundle].src);

        if ( !folder.isValidPath() ) {
            console.warn('`'+ folder.toString() +'` is not a valid path')
        } else {

            // removing mounting point: just in case
            var coreEnv = getCoreEnv(local.bundle);
            new _(coreEnv.mountPath +'/'+ local.bundle, true).rmSync();
            
            // removing folder
            folder = folder.rmSync();
            if (folder instanceof Error) {
                console.error(folder.stack);
                process.exit(1)
            }
            
                       

            // updating project env
            if ( typeof(self.envData) != 'undefined' && typeof(self.envData[local.bundle]) != 'undefined' ) (
                delete self.envData[local.bundle]
            )

            // updating project bundles
            if ( typeof(self.projectData.bundles) != 'undefined' && typeof(self.projectData.bundles[local.bundle]) != 'undefined' ) (
                delete self.projectData.bundles[local.bundle]
            )

            // removing ports
            var ports               = JSON.clone(self.portsData)
                , portsReverse      = JSON.clone(self.portsReverseData)
                , reversePortValue  = null
                , re                = null
            ;

            for (var protocol in ports) {
                
                for (var scheme in ports[protocol]) {
                    
                    for (var port in ports[protocol][scheme]) {

                        re = new RegExp(local.bundle +"\@"+ self.projectName +"\/");

                        if ( re.test(ports[protocol][scheme][port]) ) {

                            reversePortValue = ports[protocol][scheme][port].split('/')[0];

                            delete portsReverse[reversePortValue];
                            delete ports[protocol][scheme][port];
                        }
                    }
                }
            }

            // now writing
            lib.generator.createFileFromDataSync(ports, self.portsPath);
            lib.generator.createFileFromDataSync(portsReverse, self.portsReversePath);

            console.log('bundle [ '+ local.bundle+'@'+self.projectName+' ] removed');
        }

        ++local.b;
        removeBundle(local.b);
    }


    var end = function() {
        
        // last check just in case
        
        

        lib.generator.createFileFromDataSync(
            self.envData,
            self.envPath
        );

        lib.generator.createFileFromDataSync(
            self.projectData,
            self.projectPath
        );

        process.exit(0)
    };

    init(opt)
};

module.exports = Remove