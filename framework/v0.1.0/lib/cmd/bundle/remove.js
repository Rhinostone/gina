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
function Remove(opt) {

    var self    = {}
        , local = {
            b : 0,
            bundle : null,
            force : false
        }
    ;

    var init = function(opt) {

        // import CMD helpers
        new CmdHelper(self);

        // configure
        configure();


        if ( typeof(self.projects[self.projectName].path) == 'undefined' ) {
            console.error('project path not defined in ~/.gina/projects.json for [ '+ self.projectName + ' ]');
            process.exit(1)
        }

        //var Proc = require( getPath('gina').lib + '/proc');

        //process.exit(0);
        removeBundle(0)
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


        rl.setPrompt('Also remove bundle files ? (Y/n):');

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
            var ports               = JSON.parse(JSON.stringify(self.portsData))
                , portsReverse      = JSON.parse(JSON.stringify(self.portsReverseData))
                , reversePortValue  = null
                , re                = null
            ;

            for(var protocol in ports) {

                for (var port in ports[protocol]) {

                    re = new RegExp(local.bundle +"\@"+ self.projectName +"\/");

                    if ( re.test(ports[protocol][port]) ) {

                        reversePortValue = ports[protocol][port].split('/')[0];

                        delete portsReverse[reversePortValue];
                        delete ports[protocol][port];
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