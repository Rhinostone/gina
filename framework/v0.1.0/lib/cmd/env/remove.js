//var fs          = require('fs');
var console = lib.logger;
/**
 * Remove existing environment
 * TODO - Prompt for confirmation: "This will remove [ environment ] for the whole project. Proceed ? Y/n: "
 * */
function Remove() {
    var self = {};

    var init = function() {
        self.target = _(GINA_HOMEDIR + '/projects.json');
        self.projects   = require(self.target);


        if ( typeof(process.argv[4]) != 'undefined') {
            if ( !isValidName(process.argv[4]) ) {
                console.error('[ '+process.argv[4]+' ] is not a valid project name. Please, try something else: @[a-z0-9_.].');
                process.exit(1);
            }
        } else {
            // is current path == project path ?
            var root = process.cwd();
            var name = new _(root).toArray().last();
            if ( isDefined(name) ) {
                self.name = name
            }
        }

        if ( typeof(process.argv[3]) != 'undefined' ) {
            if ( !self.projects[self.name].envs.inArray(process.argv[3]) ) {
                console.error('Environment [ '+process.argv[3]+' ] not found');
                process.exit(1)
            }
        } else {
            console.error('Missing argument in [ gina env:use <environment> ]');
            process.exit(1)
        }

        if ( typeof(self.name) == 'undefined' ) {
            console.error('Project name is required: @<project_name>');
            process.exit(1)
        } else if ( typeof(self.name) != 'undefined' && isDefined(self.name) ) {
            removeEnv(process.argv[3], self.projects, self.target)
        } else {
            console.error('[ '+self.name+' ] is not a valid project name.');
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

    var removeEnv = function(env, projects, target) {
        if(env === projects[self.name]['dev_env']|| env === projects[self.name]['def_env']) {
            if (env === projects[self.name]['def_env']) {
                console.error('Environment [ '+env+' ] is set as "default environment"')
            } else {
                console.error('Environment [ '+env+' ] is protected')
            }
        } else {

            projects[self.name]['envs'].splice(projects[self.name]['envs'].indexOf(env), 1);
            lib.generator.createFileFromDataSync(
                projects,
                target
            );
            // clean ports & reverse ports registered for the project
            var portsPath = _(GINA_HOMEDIR + '/ports.json')
                , portsReversePath = _(GINA_HOMEDIR + '/ports.reverse.json')
                , ports = require(portsPath)
                , portsReverse = require(portsReversePath)
                , envsPath = _(projects[self.name].path +'/env.json')
                , envs = require(envsPath);


            var patt = new RegExp("@"+ self.name +"/"+ env +"$");
            for (var p in ports) {
                if ( patt.test(ports[p]) ) {
                    delete ports[p]
                }
            }
            for (var p in portsReverse) {
                if ( typeof( portsReverse[p][env]) != 'undefined' ) {
                    delete portsReverse[p][env]
                }
            }

            for (var bundle in envs) {
                for (var e in envs[bundle]) {
                    if (e == env) {
                        delete envs[bundle][e]
                    }
                }
            }

            lib.generator.createFileFromDataSync(ports, portsPath);
            lib.generator.createFileFromDataSync(portsReverse, portsReversePath);
            lib.generator.createFileFromDataSync(envs, envsPath);

            console.log('Environment [ '+env+' ] removed with success');
            process.exit(0)
        }
    };

    init()
};

module.exports = Remove