var fs = require('fs');
var readline = require('readline');
var rl = readline.createInterface(process.stdin, process.stdout);

var console = lib.logger;

/**
 * Remove project or unregister existing one from `~/.gina/projects.json`.
 * */
function Remove() {
    var self = {};

    var init = function() {
        var err = false
            , folder = {}
            , projecPath = ''
            , force = false;

        self.projects = require( _(GINA_HOMEDIR + '/projects.json') );
        self.name = process.argv[3];
        isValidName();

        if ( typeof(self.projects[self.name]) == 'undefined' ) {
            console.error('[ '+ self.name + ' ] is not a registered project');
            process.exit(1)
        }

        if ( typeof(process.argv[4]) != 'undefined'
            && /^\-f$/.test(process.argv[4])
        ) {
            force = true
        } else if ( typeof(process.argv[4]) != 'undefined' ) {
            console.error('argument error, expecting -f to disable prompt')
            process.exit(1)
        }



        if ( typeof(self.projects[self.name].path) == 'undefined' ) {
            console.error('project path not defined in ~/.gina/projects.json for [ '+ self.name + ' ]');
            process.exit(1)
        }

        projecPath = self.projects[self.name].path;

        prompt(force, function(force){

            if ( new _(projecPath).isValidPath() && force ) {
                folder = new _(projecPath);
                if ( !folder.existsSync() ) {
                    console.warn('project path not found at: ', folder.toString() );
                    end()
                }
                folder = folder.rmSync();
                if (folder instanceof Error) {
                    console.error(folder.stack);
                    process.exit(1)
                }
                self.root = folder.toString()

            }

            end(true)
        })
    }

    var isValidName = function() {
        if (self.name == undefined) return false;

        self.name = self.name.replace(/\@/, '');
        var patt = /^[a-z0-9_.]/;
        return patt.test(self.name)
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
            console.log('\nAction cancelled !');
            process.exit(0)
        })
    }


    var end = function(removed) {
        var target = _(GINA_HOMEDIR + '/projects.json');


        if ( typeof(self.projects[self.name]) != 'undefined' ) {
            delete self.projects[self.name];

            lib.generator.createFileFromDataSync(
                self.projects,
                target
            )
        }

        if (removed)
            console.log('project [ '+ self.name +' ] removed');

        process.exit(0)
    }

    init()
};

module.exports = Remove