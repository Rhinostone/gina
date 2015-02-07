var fs = require('fs');
var console = lib.logger;

/**
 * Rename existing project.
 * */
function Rename() {
    var self = {};

    var init = function() {

        self.projects = require(_(GINA_HOMEDIR + '/projects.json') );

        if (!process.argv[3]) {
            console.error('Missing argument <source_name>');
            process.exit(1)
        } else if ( !isValidName(process.argv[3], 'source') ) {
            console.error('Invalid <source_name>');
            process.exit(1)
        }

        if (!process.argv[4]) {
            console.error('Missing argument <target_name>');
            process.exit(1)
        } else if (!isValidName(process.argv[4], 'target')) {
            console.error('Invalid <target_name>');
            process.exit(1)
        }



        if ( !isDefined(self.target) ) {
            rename()
        } else {
            console.error('Target project name [ '+self.target+' ] is already taken !');
            process.exit(1)
        }




        //
        //
        //
        //if ( folder.isValidPath() ) {
        //    try {
        //        err = folder.mkdirSync();
        //        if (err instanceof Error) {
        //            console.error(err.stack);
        //            process.exit(1)
        //        }
        //        self.root = folder.toString()
        //    } catch (err) {
        //        console.error(err.stack || err.message);
        //        process.exit(1)
        //    }
        //} else {
        //    // must be a valid project name then
        //    if ( !isValidName() ) {
        //        console.error('[ '+self.name+' ] is not a valid project name. Please, try something else: [a-Z0-9].');
        //        process.exit(1)
        //    } else {
        //
        //        self.root = process.cwd();
        //        self.name = process.argv[3];
        //        self.root = _(self.root +'/'+ self.name);
        //        isDefined(self.name);
        //        folder = new _(self.root).mkdirSync();
        //        if (folder instanceof Error) {
        //            console.error(err.stack || err.message);
        //            process.exit(1)
        //        }
        //    }
        //}
        //
        //
        //// creating project file
        //var file = new _(self.root + '/project.json');
        //if ( !file.existsSync() ) {
        //    createProjectFile( file.toString() )
        //} else {
        //    console.warn('[ project.json ] already exists in this location: '+ file);
        //}
        //
        //// creating package file
        //file = new _(self.root + '/package.json');
        //if ( !file.existsSync() ) {
        //    createPackageFile( file.toString() )
        //} else {
        //    console.warn('[ package.json ] already exists in this location: '+ file);
        //
        //    end()
        //}
    }

    var isDefined = function(name) {
        if ( typeof(self.projects[name]) != 'undefined' ) {
            console.error('[ '+ name +' ] is an existing project. Please choose another name or remove it first.');
            process.exit(1)
        }
        return false
    }

    var isValidName = function(value, name) {
        self[name] = value;
        if (self[name] == undefined) return false;

        self[name] = self[name].replace(/\@/, '');
        var patt = /^[a-z0-9_.]/;
        return patt.test(self[name])
    }

    var rename = function() {

        self.projects[self.target] = self.projects[self.source];

        // renaming folder !
        if (!self.projects[self.source].path || self.projects[self.source].path == '') {
            console.error('It seems like this project does not have a path :(');
            process.exit(1)
        }

        var folder = new _(self.projects[self.source].path)
            , re = new RegExp("\/"+folder.toArray().last()+"$")
            , target = folder.toUnixStyle().replace(re, '/'+ self.target)
            , project = {}// local project.json
            , pack = {};// local pakage.json


        folder.mv(target, function(err){
            if (err) {
                console.error(err.stack);
                process.exit(1)
            }

            // renaming project in config files
            self.projects[self.target].path = target;

            if ( fs.existsSync( _(target +'/project.json') )) {
                project = require(_(target +'/project.json'));
                project['name'] = self.target;
                lib.generator.createFileFromDataSync(
                    project,
                    _(target +'/project.json')
                )
            }

            if ( fs.existsSync( _(target +'/package.json') )) {
                pack = require(_(target +'/package.json'));
                if ( typeof(pack['name']) != 'undefined' ) {
                    pack.name = self.target;
                    lib.generator.createFileFromDataSync(
                        pack,
                        _(target +'/package.json')
                    )
                }
            }

            delete self.projects[self.source];
            end(true)
        })
    }

    var end = function(renamed) {
        var target = _(GINA_HOMEDIR + '/projects.json')
            , projects = self.projects;


        // writing file
        lib.generator.createFileFromDataSync(
            projects,
            target
        )

        if (renamed)
            console.log('project [ '+ self.source +' ] renamed to [ ' + self.target + ' ]');

        process.exit(0)
    }

    init()
};

module.exports = Rename