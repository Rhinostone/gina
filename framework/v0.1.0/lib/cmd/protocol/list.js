var fs = require('fs');

var CmdHelper = require('./../helper');
var console = lib.logger;

/**
 * List protocols for a given bundle, a given project & a given env
 *
 * e.g.
 *  gina protocol:list
 *  gina protocol:list @<project_name>
 *  gina protocol:list <bundle> @<project_name>
 *
 * */
function List(opt, cmd) {

    // self will be pre filled if you call `new CmdHelper(self, opt.client)`
    var self = {}, local = {};

    var init = function() {

        // import CMD helpers
        new CmdHelper(self, opt.client);

        // check CMD configuration
        if (!isCmdConfigured()) return false;


        if (!self.name && !self.projectName) {
            listAll()
        } else if (self.projectName && isDefined(self.projectName) && !self.name) {
            listProjectOnly()
        } else if (typeof (self.name) != 'undefined' && isValidName(self.name) ) {
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
        var protocols = null
            , schemes = null
            , projects = self.projects
            , list = []
            , p = ''
            , str = ''
            , strArr = []
            , schemeStr = ''
            , protocolStr = '';

        for (p in projects) {
            list.push(p)
        }
        list.sort();

        p = 0;
        for (; p < list.length; ++p) {
                           
            str += '------------------------------------\n\r';
            if (!projects[list[p]].exists) {
                str += '?! '
            }
            str += list[p] + '\n\r';
            str += '------------------------------------\n\r';
            protocols = projects[list[p]].protocols;
            schemes = projects[list[p]].schemes;
            
            if (!protocols) continue;
            
            str += '      Protocol(s)        Scheme(s)\n\r';
            
            
            var indexObj = {}, index = 2;
            for (var i = 0, len = protocols.length; i < len; ++i) {
                protocolStr = '';               
                if (self.defaultProtocol == protocols[i]) {
                    protocolStr += '[ * ] ' + protocols[i]
                } else {
                    protocolStr += '[   ] ' + protocols[i]
                }                
                
                if ( (index % 2) == 0 ){
                    indexObj[index] = protocolStr;
                    index += 2
                }
            }
            
            
            index = 3;
            for (var s = 0, sLen = schemes.length; s < sLen; ++s) {
                schemeStr = '';
                if (self.defaultScheme == schemes[s]) {
                    schemeStr += '           [ * ] ' + schemes[s]
                } else {
                    schemeStr += '           [   ] ' + schemes[s]
                }
                      
                if ( (index % 2) != 0 ){
                    indexObj[index] = schemeStr;
                    index += 2               
                }                   
            }
            
            for (var k in indexObj) {
                str += indexObj[k];
                if ( (~~k % 3) == 0 ){
                    str += '\n\r'
                }
                
            }
            
            //str += strArr.join('');
            
            str += '\n\r'
        }
        console.debug(JSON.stringify(indexObj, null, 4));
        console.log(str)
    }

    var listProjectOnly = function() {
        
        var protocols   = self.protocols//self.projects[self.projectName].protocols
            , str       = '';

        for (var i = 0, len = protocols.length; i < len; ++i) {
            if (self.defaultProtocol == protocols[i]) {
                str += '[ * ] ' + protocols[i]
            } else {
                str += '[   ] ' + protocols[i]
            }
            str += '\n\r'
        }

        console.log(str)
    };

    var listBundleOnly = function() {

        var protocols = self.protocols
            // inherits project's protocol if none is set in /config/settings.json
            , defaultProtocol = self.defaultProtocol 
            , str = '';
        
        var bundleConfig = self.bundlesByProject[self.projectName][self.name];
        var env = bundleConfig.defaultEnv;
        var settingsPath = _(bundleConfig.configPaths.settings, true);
        var settings = {};
        
        if ( fs.existsSync(settingsPath) ) {
            settings = require(settingsPath);
        }
        
        if ( 
            typeof(settings.server) != 'undefined' 
            && typeof(settings.server.protocol) != 'undefined' 
        ) {
            defaultProtocol = settings.server.protocol;
        }
        
        
        for (var i = 0, len = protocols.length; i < len; ++i) {
            if (defaultProtocol == protocols[i]) {
                str += '[ * ] ' + protocols[i];
            } else {
                str += '[   ] ' + protocols[i]
            }
            str += '\n\r'
        }
    

        console.log(str)
    };

    init()
};

module.exports = List