var fs          = require('fs');
var CmdHelper   = require('./../helper');
var readline    = require('readline');
var rl          = readline.createInterface(process.stdin, process.stdout);

var console = lib.logger;

/**
 * Remove project or unregister existing one from `~/.gina/projects.json`.
 * */
function Remove() {
    var self = {};

    var init = function() {

        // import CMD helpers
        new CmdHelper(self);

        // configure
        configure();

        var err         = false
            , folder    = new _(self.projectLocation)
            , force     = ( typeof(self.params['force']) != 'undefined' ) ? self.params['force'] : false;


        if ( !folder.existsSync() ) {
            console.error('project [ '+ self.projectName+' ] was not found at this location: ' + folder.toString() );
            process.exit(1)
        }

        if ( typeof(self.projects[self.projectName].path) == 'undefined' ) {
            console.error('project path not defined in ~/.gina/projects.json for [ '+ self.projectName + ' ]');
            process.exit(1)
        }


        prompt(force, function(force){


            if ( folder.isValidPath() && force ) {

                if ( !folder.existsSync() ) {
                    console.warn('project path not found at: ', folder.toString() );
                    end()
                }

                folder = folder.rmSync();
                if (folder instanceof Error) {
                    console.error(folder.stack);
                    process.exit(1)
                }

                // removing ports
                var ports               = JSON.parse(JSON.stringify(self.portsData))
                    , portsReverse      = JSON.parse(JSON.stringify(self.portsReverseData))
                    , reversePortValue  = null
                    , re                = null
                ;

                for(var protocol in ports) {

                    for (var port in ports[protocol]) {

                        re = new RegExp("\@"+ self.projectName +"\/");

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
            }

            end(true)
        })
    }
    

    var prompt = function(force, cb) {
        if (!force) {
            rl.setPrompt('Also remove project sources ? (Y/n):');
            rl.prompt();
        } else {
            cb(true)
        }

        rl.on('line', function(line) {
            switch( line.trim().toLowerCase() ) {
                case 'y':
                case 'yes':
                    cb(true);
                    break;
                case 'n':
                case 'no':
                    cb(false);
                    break;
                default:
                    console.log('Please, write "yes" or "no" to proceed.');
                    rl.prompt();
                    break;
            }
        }).on('close', function() {
            console.log('\nCommand cancelled !');
            process.exit(0)
        })
    }


    var end = function(removed) {
        var target = _(GINA_HOMEDIR + '/projects.json');


        if ( typeof(self.projects[self.projectName]) != 'undefined' ) {
            delete self.projects[self.projectName];

            lib.generator.createFileFromDataSync(
                self.projects,
                target
            )
        }

        if (removed)
            console.log('project [ '+ self.projectName +' ] removed');

        process.exit(0)
    };

    init()
};

module.exports = Remove