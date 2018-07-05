var fs          = require('fs');

var CmdHelper   = require('./../helper');
var Shell       = lib.Shell;
var console     = lib.logger;

/**
 * Add new project or register old one to `~/.gina/projects.json`.
 * NB.: If project exists, it won't be replaced. You'll only get warnings.
 * */
function Add(opt, cmd) {

    var self    = {}
        , local = {}
    ;

    var init = function() {

        // import CMD helpers
        new CmdHelper(self, opt.client);

        // check CMD configuration
        if ( !isCmdConfigured() ) return false;

        checkImportMode();

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
                                console.log('project [ '+ self.projectName +' ] imported');
                            })

                    } else {
                        console.log('project [ '+ self.projectName +' ] imported');
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
            "def_protocol": self.defaultProtocol
        };

        // writing file
        lib.generator.createFileFromDataSync(
            projects,
            target
        );

        var onSuccess = function () {
            console.log('project [ '+ self.projectName +' ] is ready');
            process.exit(0)
        }

        var onError = function (err) {
            console.error('could not finalize [ '+ self.projectName +' ] install\n'+ err.stack);
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