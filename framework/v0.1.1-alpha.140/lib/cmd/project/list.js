var fs = require('fs');

var CmdHelper   = require('./../helper');
var console     = lib.logger;
/**
 * List all registerd projects
 * Available options:
 *  --more (to display more infos)
 *
 * TODO : check if path exists and add in front of each a green check or a red cross
 * TODO : --help
 * TODO : switch options for `$ gina project:list [ [ —-more ] | [-b | —-with-bundles] | [-e | -—with-envs] ]`
 * */
function List(opt, cmd){

    var self = {};

    var init = function(){

        // import CMD helpers
        new CmdHelper(self, opt.client, { port: opt.debugPort, brkEnabled: opt.debugBrkEnabled });

        // check CMD configuration
        if ( !isCmdConfigured() ) return false;

        var projects = self.projects
            , list = []
            , str = ''
            , more = (process.argv[3] && /^(?:\-\-more$)/.test(process.argv[3])) ? true : false ;

        for (var p in projects) {
            list.push(p)
        }
        list.sort();

        for(var l=0; l<list.length; ++l) {
            if ( fs.existsSync(projects[ list[l]].path) ) {
                str += '[ ok ] '+ list[l];
                if (more)
                    str += '\n\r\t'+ projects[ list[l] ].path;
                str += '\n\r';
            } else {
                str += '[ ?! ] '+ list[l];
                if (more)
                    str += '\n\r\t'+projects[ list[l] ].path + ' <- where is it ?';
                str += '\n\r';
            }
        }
        console.log(str.substr(0, str.length-2))
    }

    init()
};

module.exports = List