var CmdHelper   = require('./../helper');
var console     = lib.logger;
/**
 * Select the default scope
 * */
function Use(opt, cmd) {
    var self = {};

    console.debug('scope:use called');

    var init = function() {
        self.target = _(GINA_HOMEDIR + '/projects.json');
        self.projects   = require(self.target);
        var err = null;

        // if ( typeof(process.argv[4]) != 'undefined') {
        //     if ( !isValidName(process.argv[4]) ) {
        //         err = new Error('[ '+process.argv[4]+' ] is not a valid project name. Please, try something else: @[a-z0-9_.].');
        //         return end(err, 'log', true);
        //     }
        // } else {
        //     // is current path == project path ?
        //     var root = process.cwd();
        //     var name = new _(root).toArray().last();
        //     if ( isDefined(name) ) {
        //         self.name = name
        //     }
        // }

        // if ( typeof(self.name) == 'undefined' ) {
        //     err = new Error('Project name is required: @<project_name>');
        //     end(err, 'log', true);
        // } else if ( typeof(self.name) != 'undefined' && isDefined(self.name) ) {
        //     if ( typeof(process.argv[3]) != 'undefined' ) {

        //         if ( !self.projects[self.name].scopes.inArray(process.argv[3]) ) {
        //             err = new Error('Scope [ '+process.argv[3]+' ] not found');
        //             return end(err, 'log', true);
        //         }
        //     } else {
        //         err = new Error('Missing argument in [ gina scope:use <scope> ]');
        //         end(err, 'log', true);
        //     }
        //     useScope(process.argv[3], self.projects, self.target)
        // } else {
        //     err = new Error('[ '+self.name+' ] is not a valid project name.');
        //     end(err, 'log', true);
        // }

        // import CMD helpers
        new CmdHelper(self, opt.client, { port: opt.debugPort, brkEnabled: opt.debugBrkEnabled });

        // check CMD configuration
        if ( !isCmdConfigured() ) return false;

        if (!self.scopes) {
            return end( new Error('No scope found for your project `'+ self.projectName +'`') );
        }

        useScope(process.argv[3], self.projects, self.target)
    }

    var updateManifest = function(scope, projects) {
        var projectData    = JSON.clone(self.projectData);
        projectData.scope = scope

        lib.generator.createFileFromDataSync(projectData, self.projectManifestPath);
    }

    var useScope = function(scope, projects, target) {
        console.debug('proj.: ', scope, self.name, projects[self.name]);

        // defining for gina only
        if ( typeof(projects[self.name]) == 'undefined' ) {

            return end('Scope [ '+ scope +' ] defined with success')
        }
        // if (scope !== projects[self.name]['def_scope']) {
        //     projects[self.name]['def_scope'] = scope;
        //     lib.generator.createFileFromDataSync(
        //         projects,
        //         target
        //     )
        // }

        updateManifest(scope, projects);

        end('Scope [ '+ scope +' ] defined with success')
    };

    var end = function (output, type, messageOnly) {
        var err = false;
        if ( typeof(output) != 'undefined') {
            if ( output instanceof Error ) {
                err = output = ( typeof(messageOnly) != 'undefined' && /^true$/i.test(messageOnly) ) ? output.message : (output.stack||output.message);
            }
            if ( typeof(type) != 'undefined' ) {
                console[type](output)
            } else {
                console.log(output);
            }
        }

        process.exit( err ? 1:0 )
    }

    init()
}
module.exports = Use;