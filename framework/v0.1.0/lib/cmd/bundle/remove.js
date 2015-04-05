var fs          = require('fs');
var readline    = require('readline');
var rl          = readline.createInterface(process.stdin, process.stdout);

var console = lib.logger;
var scan    = require('../env/inc/scan');

/**
 * Add new bundle to a given project.
 * NB.: If bundle exists, it won't be replaced. You'll only get warnings.
 * */
function Remove() {
    var self = {};

    var init = function() {
        self.projects = require( _(GINA_HOMEDIR + '/projects.json') );
        self.envs = [];
        self.portsPath = _(GINA_HOMEDIR + '/ports.json');
        self.portsData = require( self.portsPath );
        self.portsReversePath = _(GINA_HOMEDIR + '/ports.reverse.json');
        self.portsReverseData = require( self.portsReversePath );

        var force   = false
            , param = [];

        if (!process.argv[3]) {
            console.error('Missing argument <bundle_name>@<project_name>');
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

        isInProject(); // check if command is running from within the project folder
        if ( /^[a-zA-Z0-9_.]+\@[a-zA-Z0-9_.]+/.test(process.argv[3]) ) {
            param = process.argv[3].split('@');
            self.bundle = param[0];
            self.project = param[1];
            if ( !isDefined(self.project) ) {
                console.error('[ '+ self.project+' ] is not an existing project');
                process.exit(1)
            }
            self.projectPath = _(self.projects[self.project].path + '/project.json');
            self.envPath = _(self.projects[self.project].path + '/env.json');

            for (var e in self.projects[self.project].envs) {
                self.envs.push(self.projects[self.project].envs[e])
            }

        } else {
            console.error('gina bundle:remove <bundle>@<project> did not match naming rules. Did you forget project name ?');
            process.exit(1)
        }

        if ( isValidName('bundle', self.bundle) && isValidName('project', self.project) ) {


            prompt(force, function(force){
                self.projectData = require(self.projectPath);
                self.envData = require(self.envPath);
                var folder = new _(self.projects[self.project].path + '/' + self.projectData.bundles[self.bundle].src);

                if ( folder.isValidPath()  && force ) {


                    if ( !folder.existsSync() ) {
                        console.warn('bundle path not found at: ', folder.toString() );
                        end()
                    }
                    folder = folder.rmSync();
                    if (folder instanceof Error) {
                        console.error(folder.stack);
                        process.exit(1)
                    }

                    // removing ports
                    var ports = JSON.parse(JSON.stringify(self.portsData, null, 4))
                        , portsReverse = JSON.parse(JSON.stringify(self.portsReverseData, null, 4))
                        , t = null // protocols
                        , p = null // port
                        , e = null // env
                        , re = {}
                        , start = 0
                        , bundle = null
                        , bundles = [];

                    for(p in ports) {
                        re = new RegExp(self.bundle+"\@"+self.project+"\/");
                        if ( re.test(ports[p]) ) {
                            start = ports[p].indexOf(':')+1;
                            bundle = ports[p].substr(start, ports[p].indexOf('/')-start);
                            bundles.push(bundle);
                            delete ports[p]
                        }
                    }

                    for(t in portsReverse) {
                        for(p in portsReverse[t]) {
                            if ( bundles.indexOf(p) > -1 ) {
                                delete portsReverse[t][p]
                            }
                        }
                    }

                    // now writing
                    lib.generator.createFileFromDataSync(ports, self.portsPath);
                    lib.generator.createFileFromDataSync(portsReverse, self.portsReversePath);

                    //self.root = folder.toString()
                }

                end(true)
            })

        } else {
            console.error('[ '+ self.bundle+' ] is not a valid bundle name')
            process.exit(1)
        }
    }

    var isInProject = function() {
        var path    = process.cwd()
            , p     = null
            , found = false;

        for (p in self.projects) {
            if ( self.projects[p].path === path ) {
                found = true;
                if ( !(/^[a-zA-Z0-9_.]+\@[a-zA-Z0-9_.]+/.test(process.argv[3])) ) {
                    process.argv[3] += '@'+p
                }
                break
            }
        }
    }

    var isDefined = function(name, value) {
        if ( typeof(self.projects[name]) != 'undefined' ) {
            return true
        }
        return false
    }

    var isValidName = function(name, value) {
        self[name] = value;
        if (self[name] == undefined) return false;

        self[name] = self[name].replace(/\@/, '');
        var patt = /^[a-z0-9_.]/;
        return patt.test(self[name])
    }

    var prompt = function(force, cb) {
        if (!force) {
            rl.setPrompt('Also remove bundle files ? (Y/n):');
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

        if ( typeof(self.envData[self.bundle]) != 'undefined' ) {
            delete self.envData[self.bundle];

            lib.generator.createFileFromDataSync(
                self.envData,
                self.envPath
            )
        }

        if ( typeof(self.projectData.bundles[self.bundle]) != 'undefined' ) {
            delete self.projectData.bundles[self.bundle];

            lib.generator.createFileFromDataSync(
                self.projectData,
                self.projectPath
            )
        }

        if (removed)
            console.log('bundle [ '+ self.bundle+'@'+self.project+' ] removed');

        process.exit(0)
    };

    init()
};

module.exports = Remove