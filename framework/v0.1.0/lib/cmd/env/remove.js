//var fs          = require('fs');
var CmdHelper   = require('./../helper');
var console = lib.logger;
/**
 * Remove existing environment
 * TODO - Prompt for confirmation: "This will remove [ environment ] for the whole project. Proceed ? Y/n: "
 * */
function Remove(opt, cmd) {
    var self = {};

    var init = function() {
        // import CMD helpers
        new CmdHelper(self, opt.client, { port: opt.debugPort, brkEnabled: opt.debugBrkEnabled });

        // check CMD configuration
        if ( !isCmdConfigured() ) return false;
        
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
            if ( isDefined('project', name) ) {
                self.projectName = name
            }
        }

        if ( typeof(process.argv[3]) != 'undefined' ) {
            if ( !self.projects[self.projectName].envs.inArray(process.argv[3]) ) {                
                console.error('Environment [ '+process.argv[3]+' ] not found');
                process.exit(1)
            }
        } else {
            console.error('Missing argument in [ gina env:use <environment> ]');
            process.exit(1)
        }

        if ( typeof(self.projectName) == 'undefined' ) {
            console.error('Project name is required: @<project_name>');
            process.exit(1)
        } else if ( typeof(self.projectName) != 'undefined' && isDefined('project', self.projectName) ) {
            removeEnv(process.argv[3], self.projects, self.target)
        } else {
            console.error('[ '+self.projectName+' ] is not a valid project name.');
            process.exit(1)
        }
    }

    // var isDefined = function(name) {
    //     if ( typeof(self.projects[name]) != 'undefined' ) {
    //         return true
    //     }
    //     return false
    // }

    // var isValidName = function(name) {
    //     if (name == undefined) return false;

    //     self.projectName = name.replace(/\@/, '');
    //     var patt = /^[a-z0-9_.]/;
    //     return patt.test(self.projectName)
    // }

    var removeEnv = function(env, projects, target) {
        if(env === projects[self.projectName]['dev_env']|| env === projects[self.projectName]['def_env']) {
            if (env === projects[self.projectName]['def_env']) {
                console.error('Environment [ '+env+' ] is set as "default environment"')
            } else {
                console.error('Environment [ '+env+' ] is protected')
            }
        } else {

            projects[self.projectName]['envs'].splice(projects[self.projectName]['envs'].indexOf(env), 1);
            lib.generator.createFileFromDataSync(
                projects,
                target
            );
            // clean ports & reverse ports registered for the project
            var portsPath = _(GINA_HOMEDIR + '/ports.json')
                , portsReversePath = _(GINA_HOMEDIR + '/ports.reverse.json')
                , ports = require(portsPath)
                , portsReverse = require(portsReversePath)
                , envsPath = _(projects[self.projectName].path +'/env.json')
                , envs = requireJSON(envsPath);


            var patt = new RegExp("@"+ self.projectName +"/"+ env +"$");
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