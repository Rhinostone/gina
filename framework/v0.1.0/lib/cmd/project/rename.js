var fs = require('fs');
var console = lib.logger;

/**
 * Rename existing project.
 * */
function Rename() {
    var self = {};

    var init = function() {

        self.projects = require(_(GINA_HOMEDIR + '/projects.json') );
        self.portsPath = _(GINA_HOMEDIR + '/ports.json');
        self.portsData = require( self.portsPath );
        self.portsReversePath = _(GINA_HOMEDIR + '/ports.reverse.json');
        self.portsReverseData = require( self.portsReversePath );

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

            // update ports
            var ports = JSON.parse(JSON.stringify(self.portsData, null, 4))
                , portsReverse = JSON.parse(JSON.stringify(self.portsReverseData, null, 4))
                , t = null // protocols
                , p = null
                , re = {}
                , start = 0
                , bundle = null
                , newBundle = null
                , bundles = [];

            for(p in ports) {
                re = new RegExp("\@"+self.source+"\/");
                if ( re.test(ports[p]) ) {
                    start = ports[p].indexOf(':')+1;
                    bundle = ports[p].substr(start, ports[p].indexOf('/')-start);
                    newBundle = bundle.substr(0, bundle.indexOf('@')) +'@'+ self.target;
                    ports[p] = ports[p].replace(bundle, newBundle);
                }
            }

            var re = new RegExp('\@'+self.source+'$');
            for(t in portsReverse) {
                for(p in portsReverse[t]) {
                    //if ( bundles.indexOf(p) > -1 ) {
                    if ( re.test(p) ) {
                        portsReverse[t][p.replace(self.source, self.target)] = JSON.parse(JSON.stringify(portsReverse[t][p], null, 4));
                        delete portsReverse[t][p]
                    }
                }
            }

            // now writing
            lib.generator.createFileFromDataSync(ports, self.portsPath);
            lib.generator.createFileFromDataSync(portsReverse, self.portsReversePath);

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