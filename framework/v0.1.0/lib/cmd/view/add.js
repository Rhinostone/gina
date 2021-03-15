var fs          = require('fs');
var readline    = require('readline');
var rl          = readline.createInterface(process.stdin, process.stdout);

var Config  = require( _(getPath('gina').core + '/config') );
var console = lib.logger;

/**
 * Add new view to a given project bundle.
 * NB.: If bundle exists, You will be asked if you want to replace.
 *
 * Usage:
 * $ gina bundle:add <bundle_name> @<project_name>
 * */
function Add(opt, cmd) {
    var self = { task: 'add-views' }
        , local = {}
        , config = null
    ;

    var init = function() {

        self.projects   = require( _(GINA_HOMEDIR + '/projects.json') );

        self.envs       = [];


        var i = 3, bundles = [];
        for (; i<process.argv.length; ++i) {
            if ( /^\@[a-z0-9_.]/.test(process.argv[i]) ) {

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
            self.envPath            = _(self.projects[self.name].path + '/env.json');
            self.envData            = requireJSON(self.envPath);
            self.projectPath        = _(self.projects[self.name].path + '/project.json', true);
            self.projectData        = require(self.projectPath);

            addViews(0)
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
    var addViews = function(b) {
        if (b > self.bundles.length-1) {// done
            process.exit(0)
        }

        var options         = {}
            , bundle        = self.bundles[b]
        ;


        if ( /^[a-z0-9_.]/.test(bundle) ) {

            if ( !fs.existsSync(self.envPath) ) {
                lib.generator.createFileFromDataSync({}, self.envPath);
            }

            local.bundle    = bundle;
            local.b         = b;
            local.env       = self.projects[self.name]['def_env'];
            local.root      = self.projects[self.name].path;

            console.log('adding views for: '+ local.bundle +'@'+ self.name);

            config = new Config({
                env             : local.env,
                executionPath   : local.root,
                projectName     : self.name,
                startingApp     : local.bundle,
                ginaPath        : getPath('gina').core,
                task            : self.task
            });

            config.onReady( function onConfigReady(err, config) {
                if (err) {
                    console.warn(err.stack);
                }

                local.src = config.conf[local.bundle][local.env].bundlePath;
                addConfFile()
            })



        } else {
            console.error('[ '+ bundle+' ] is not a valid bundle name')
            process.exit(1)
        }
    }



    /**
     * Adding view configuration
     *
     * */
    var addConfFile = function() {

        var file    = new _( getPath('gina').core + '/template/conf/views.json');
        var target  = _(local.src + '/config/views.json');
        var folder  = _(local.src + '/views');

        if ( fs.existsSync(target) || fs.existsSync(folder) ) {
            rl.setPrompt('Found views for [ '+ local.bundle +'@'+ self.name +' ]. Do you want to override ? (yes|no) > ');
            rl.prompt();

            rl.on('line', function(line) {
                switch( line.trim().toLowerCase() ) {
                    case 'y':
                    case 'yes':
                        createFile(file, target)
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
                console.log('exiting ['+ local.bundle +'@'+ self.name +'] views installation');

                ++local.b;
                addViews(local.b)
            })

        } else {
            createFile(file, target)
        }

    }


    /**
     * Create file
     *
     * @param {string} file
     * @param {string} target
     * */
    var createFile = function(file, target) {
        file.cp(target, function(err) {
            if (err) {
                console.log(err.stack);
                process.exit(1)
            }
            copyFolder()
        })
    }

    var copyFolder = function() {
        var folder = new _( getPath('gina').core +'/template/views' );
        var target = _(local.src + '/views');

        folder.cp(target, function(err){
            if (err) {
                console.log(err.stack);
                process.exit(1)
            }
            console.log('['+ local.bundle +'@'+ self.name +'] views installed with success !');

            ++local.b;
            addViews(local.b)
        });
    }


    var rollback = function(err) {
        console.error('could not complete view creation: ', (err.stack||err.message));
        console.warn('rolling back...');

        var writeFiles = function() {
            //restore env.json
            if ( typeof(self.envDataWrote) == 'undefined' ) {
                lib.generator.createFileFromDataSync(self.envData, self.envPath)
            }
            //restore project.json
            if ( typeof(self.projectDataWrote) == 'undefined' ) {
                if ( typeof(self.projectData.bundles[local.bundle]) != 'undefined') {
                    delete self.projectData.bundles[local.bundle]
                }
                lib.generator.createFileFromDataSync(self.projectData, self.projectPath)
            }

            //restore ports.json
            if ( typeof(self.portsDataWrote) == 'undefined' ) {
                lib.generator.createFileFromDataSync(self.portsData, self.portsPath)
            }

            //restore ports.reverse.json
            if ( typeof(self.portsReverseDataWrote) == 'undefined' ) {
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