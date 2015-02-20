var fs = require('fs');
var console = lib.logger;

/**
 * Add new project or register old one to `~/.gina/projects.json`.
 * NB.: If project exists, it won't be replaced. You'll only get warnings.
 * */
function Add() {
    var self = {};

    var init = function() {
        var err = false, folder = {};
        self.projects = require(_(GINA_HOMEDIR + '/projects.json') );

        if (!process.argv[3]) {
            console.error('Missing argument <project_name>');
            process.exit(1)
        }
        self.name = process.argv[3];

        if ( typeof(process.argv[4]) != 'undefined' && /^\-\-path\=/.test(process.argv[4]) ) {
            var p = process.argv[4].split(/=/);
            isDefined(self.name);
            folder = new _(p[1] +'/'+ self.name)
        } else if (typeof(process.argv[4]) != 'undefined') {
            console.error('argument not available for this command: ' + process.argv[4])
        } else {
            folder = new _(process.argv[3]);
            if ( folder.isValidPath() )
                self.name = folder.toArray().last()
        }


        if ( folder.isValidPath() && isValidName() ) {
            try {

                err = folder.mkdirSync();
                if (err instanceof Error) {
                    console.error(err.stack);
                    process.exit(1)
                }
                self.root = folder.toString()
            } catch (err) {
                console.error(err.stack || err.message);
                process.exit(1)
            }
        } else {
            // must be a valid project name then
            if ( !isValidName() ) {
                console.error('[ '+self.name+' ] is not a valid project name. Please, try something else: [a-Z0-9].');
                process.exit(1)
            } else {

                self.root = process.cwd();
                self.root = _(self.root +'/'+ self.name);
                isDefined(self.name);
                folder = new _(self.root).mkdirSync();
                if (folder instanceof Error) {
                    console.error(err.stack || err.message);
                    process.exit(1)
                }
            }
        }


        // creating project file
        var file = new _(self.root + '/project.json');
        if ( !file.existsSync() ) {
            createProjectFile( file.toString() )
        } else {
            console.warn('[ project.json ] already exists in this location: '+ file);
        }

        // creating env file
        var file = new _(self.root + '/env.json');
        if ( !file.existsSync() ) {
            createEnvFile( file.toString() )
        } else {
            console.warn('[ env.json ] already exists in this location: '+ file);
        }

        // creating package file
        file = new _(self.root + '/package.json');
        if ( !file.existsSync() ) {
            createPackageFile( file.toString() )
        } else {
            console.warn('[ package.json ] already exists in this location: '+ file);

            end()
        }
    }

    var isDefined = function(name) {
        if ( typeof(self.projects[name]) != 'undefined' ) {
            console.error('[ '+ name +' ] is an existing project. Please choose another name or remove it first.');
            process.exit(1)
        }
    }

    var isValidName = function() {
        if (self.name == undefined) return false;

        self.name = self.name.replace(/\@/, '');
        var patt = /^[a-z0-9_.]/;
        return patt.test(self.name)
    }

    var createProjectFile = function(target) {
        var conf = _(getPath('gina.core') +'/template/conf/project.json');
        var contentFile = require(conf);
        var dic = {
            "project" : self.name
        };

        contentFile = whisper(dic, contentFile);//data
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
        var conf = _(getPath('gina.core') +'/template/conf/package.json');
        var contentFile = require(conf);
        var dic = {
            "project" : self.name
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
            , projects = self.projects;


        projects[self.name] = {
            "path": self.root,
            "framework": "v" + GINA_VERSION,
            "envs": [ "dev" ],
            "def_env": "dev",
            "dev_env": "dev"
        };
        // writing file
        lib.generator.createFileFromDataSync(
            projects,
            target
        );

        if ( !fs.existsSync(self.projectPath) )

        if (created)
            console.log('project [ '+ self.name +' ] ready');

        process.exit(0)
    }

    init()
};

module.exports = Add