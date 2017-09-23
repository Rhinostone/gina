var fs          = require('fs');

var CmdHelper   = require('./../helper');
var console     = lib.logger;

/**
 * Rename existing project.
 * */
function Rename() {

    var self    = {}
        , local = {
            source: null,
            target: null
        }
    ;

    var init = function() {

        // import CMD helpers
        new CmdHelper(self);

        // configure
        configure();

        if ( self.projectArgvList.length != 2 ) {
            console.error('This command line is expecting 2 arguments: @<old_project> and @<new_project>');
            process.exit(1)
        }

        local.source = self.projectName;
        local.target = self.projectArgvList[1];


        if ( !isDefined('project', local.target) ) {
            rename()
        } else {
            console.error('New project name [ '+local.target+' ] is already taken !');
            process.exit(1)
        }
    }


    var rename = function() {

        self.projects[local.target] = self.projects[local.source];

        // renaming folder !
        if (!self.projects[local.source].path || self.projects[local.source].path == '') {
            console.error("It seems like this project does not have a path :'(");
            process.exit(1)
        }

        var folder = new _(self.projects[local.source].path)
            , re = new RegExp("\/"+folder.toArray().last()+"$")
            , target = folder.toUnixStyle().replace(re, '/'+ local.target)
            , project = {}// local project.json
            , pack = {};// local pakage.json


        folder.mv(target, function(err){
            if (err) {
                console.error(err.stack);
                process.exit(1)
            }

            // renaming project in config files
            self.projects[local.target].path = target;

            if ( fs.existsSync( _(target +'/project.json') )) {
                project = require(_(target +'/project.json'));
                project['name'] = local.target;
                lib.generator.createFileFromDataSync(
                    project,
                    _(target +'/project.json')
                )
            }

            if ( fs.existsSync( _(target +'/package.json') )) {
                pack = require(_(target +'/package.json'));
                if ( typeof(pack['name']) != 'undefined' ) {
                    pack.name = local.target;
                    lib.generator.createFileFromDataSync(
                        pack,
                        _(target +'/package.json')
                    )
                }
            }

            // updating projects
            delete self.projects[local.source];

            // renaming & update ports
            var ports               = JSON.parse(JSON.stringify(self.portsData))
                , portsReverse      = JSON.parse(JSON.stringify(self.portsReverseData))
                , re                = null
                , projectValue      = null
                , portsReverseStr   = null
            ;

            portsReverseStr = JSON.stringify(portsReverse);
            for(var protocol in ports) {

                for (var port in ports[protocol]) {

                    re = new RegExp("\@"+ local.source +"\/");

                    if ( re.test(ports[protocol][port]) ) {

                        projectValue = ( ports[protocol][port].split('/')[0] ).split('@')[1];

                        ports[protocol][port] = ports[protocol][port].replace(re, "@"+ local.target +"/");


                        portsReverseStr = portsReverseStr.replace( new RegExp('\@'+ projectValue, 'g'), '@'+ local.target );

                    }
                }
            }
            portsReverse = JSON.parse(portsReverseStr);


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
            console.log('project [ '+ local.source +' ] renamed to [ ' + local.target + ' ]');

        process.exit(0)
    }

    init()
};

module.exports = Rename