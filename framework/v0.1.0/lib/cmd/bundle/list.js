var fs = require('fs');
var console = lib.logger;
/**
 * List bundles for a given project
 *
 * e.g.
 *  gina bundle:list [ @<project_name> ]
 *  gina bundle:list --all
 *
 * */
function List(opt, cmd) {
    var self = {};

    var init = function() {
        self.projects = require(_(GINA_HOMEDIR + '/projects.json'));

        if ( typeof(process.argv[3]) != 'undefined') {
            if (process.argv[3] === '--all') {
                listAll()
            } else if ( !isValidName(process.argv[3]) ) {
                console.error('[ '+process.argv[3]+' ] is not a valid project name. Please, try something else: @[a-z0-9_.].');
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

        if ( typeof(self.name) == 'undefined' ) {
            listAll()
        } else if ( typeof(self.name) != 'undefined' && isDefined(self.name) ) {
            listProjectOnly()
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


    var listAll = function() {
        var projects = self.projects
            , list = []
            , p = ''
            , path
            , bundles
            , b
            , str = '';

        for (p in projects) {
            list.push(p)
        }
        list.sort();

        p = 0;
        for (; p<list.length; ++p) {
            try {
                path = projects[list[p]].path;
                bundles = require( _(path +'/project.json')).bundles;

                str += '------------------------------------\n\r';
                if ( !fs.existsSync(projects[list[p]].path) ) {
                    str += '?! '
                }
                str += list[p] + '\n\r';
                str += '------------------------------------\n\r';
                for (b in bundles) {
                    if ( fs.existsSync(_(path + '/'+ bundles[b].src)) ) {
                        str += '[ ok ] ' + b
                    } else {
                        str += '[ ?! ] ' + b
                    }
                    str += '\n\r'
                }
                str += '\n\r'
            } catch (err) {
                str += '------------------------------------\n\r';
                if ( !fs.existsSync(projects[list[p]].path) ) {
                    str += '?! '
                }
                str += list[p] + '\n\r';
                str += '------------------------------------\n\r';
            }

        }

        console.log(str)
    }

    var listProjectOnly = function () {
        var path = self.projects[self.name].path
            , bundles = require( _(path +'/project.json')).bundles
            , b
            , str = '';

        for (b in bundles) {
            if ( fs.existsSync(_(path + '/'+ bundles[b].src)) ) {
                str += '[ ok ] ' + b
            } else {
                str += '[ ?! ] ' + b
            }
            str += '\n\r'
        }

        console.log(str)
    };

    init()
};

module.exports = List