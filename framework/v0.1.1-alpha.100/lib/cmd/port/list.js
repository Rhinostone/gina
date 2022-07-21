var fs = require('fs');

var CmdHelper = require('./../helper');
var console = lib.logger;

/**
 * List ports for a given bundle, a given project & a given env
 *
 * e.g.
 *  gina port:list
 *  gina port:list @<project_name>
 *  gina port:list <bundle> @<project_name>
 *
 * */
function List(opt, cmd) {

    // self will be pre filled if you call `new CmdHelper(self, opt.client, { port: opt.debugPort, brkEnabled: opt.debugBrkEnabled })`
    var self = {}, local = {};

    var init = function() {

        // import CMD helpers
        new CmdHelper(self, opt.client, { port: opt.debugPort, brkEnabled: opt.debugBrkEnabled });

        // check CMD configuration
        if (!isCmdConfigured()) return false;


        if (!self.name && !self.projectName) {
            listAll()
        } else if (self.projectName && isDefined(self.projectName) && !self.name) {
            listProjectOnly()
        } else if (typeof (self.name) != 'undefined' && isValidName(self.name)) {
            listBundleOnly()
        } else {
            console.error('[ ' + self.name + ' ] is not a valid project name.');
            process.exit(1)
        }
    }

    //  check if bundle is defined
    var isDefined = function(name) {
        if (typeof (self.projects[name]) != 'undefined') {
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
        
        var protocols   = self.protocols
            , schemes   = self.schemes
            , projects  = self.projects
            , list      = []
            , p         = ''
            , re        = null
            , found     = false
            , strTmp    = ''
            , str       = '';

        for (p in projects) {
            list.push(p)
        }
        list.sort();

        p = 0;
        for (; p < list.length; ++p) {
            
            re = new RegExp('\@' + list[p] + '\/', '');// searching by projectName
            str += '------------------------------------\n\r';
            if (!projects[list[p]].exists || projects[list[p]].exists && protocols.length == 0) {
                str += '?! '
            }
            str += list[p] + '\n\r';
            str += '------------------------------------\n\r';
            strTmp = '';
            found = false;
            for (var i = 0, len = protocols.length; i < len; ++i) {
                
                strTmp += '[ '+ protocols[i]+' ]\n\r';
                for (var s = 0, sLen = schemes.length; s < sLen; ++s) {
                    strTmp += '  [ '+ schemes[s]+' ]\n\r';
                    
                    for (var port in self.portsData[ protocols[i] ][ schemes[s] ]) {
                        if (re.test(self.portsData[protocols[i]][schemes[s]][port]) ) {
                            found = true;
                            strTmp += '\n\r    - ' + port + '  ' + self.portsData[protocols[i]][schemes[s]][port].replace(re, ' (') + ')'
                        }
                    }                    
                    strTmp += '\n\r'
                }                
                strTmp += '\n\r'
            }
            
            if (found) {
                str += strTmp
            } 
            
            str += '\n\r'
        }

        console.log(str)
    }

    var listProjectOnly = function() {

        var protocols = self.protocols
            , schemes = self.schemes
            , str = ''
            , re = null;

        for (var i = 0, len = protocols.length; i < len; ++i) {
            str += '[ ' + protocols[i] + ' ]\n\r';
            for (var s = 0, sLen = schemes.length; s < sLen; ++s) {
                str += '  [ ' + schemes[s] + ' ]\n\r';
                
                re = new RegExp('\@' + self.projectName + '\/', '');// searching by projectName
                for (var port in self.portsData[protocols[i]][schemes[s]]) {
                    if (re.test(self.portsData[protocols[i]][schemes[s]][port])) {
                        str += '\n\r    - ' + port + '  ' + self.portsData[protocols[i]][schemes[s]][port].replace(re, ' (') + ')'
                    }
                }
                str += '\n\r'
            }            
            str += '\n\r'
        }

        console.log(str)
    };

    var listBundleOnly = function() {

        var protocols   = self.protocols
            , schemes   = self.schemes
            , scheme    = null
            , found     = false
            , str       = ''
            , re        = null;

        for (var i = 0, len = protocols.length; i < len; ++i) {
            str += '[ '+ protocols[i] +' ]\n\r';
            for (var s = 0, sLen = schemes.length; s < sLen; ++s) {
                found = false;
                re = new RegExp('^' + self.name + '\@', '');// searching by bundle name
                for (var port in self.portsData[protocols[i]][schemes[s]]) {
                    if (re.test(self.portsData[protocols[i]][schemes[s]][port])) {
                        str +=  '    ' +schemes[s]+ ' ' + port + '  ' + self.name + ' ' + self.portsData[protocols[i]][schemes[s]][port].replace(re, '').replace(/[-_a-z 0-9]+\//i, '(') + ')';
                        found = true;
                        break;
                    }
                }
                
                if (found) {
                    str += '\n\r'
                }
                    
            }            
        }


        console.log(str)
    };

    init()
};

module.exports = List