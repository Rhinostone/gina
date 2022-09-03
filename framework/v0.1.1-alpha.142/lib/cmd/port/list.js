var fs = require('fs');

var CmdHelper = require('./../helper');
var console = lib.logger;
var Collection = lib.Collection;

/**
 * List ports for a given bundle, a given project & a given env
 *
 * e.g.
 *  gina port:list
 *  gina port:list @<project_name>
 *  gina port:list <bundle> @<project_name>
 *
 * You can also filter
 *  gina port:list @<project_name> --format=json,null,2 --protocol=http/2.0 --scheme=https --bundle=frontend,backend
 *
 * */
function List(opt, cmd) {

    // self will be pre filled if you call `new CmdHelper(self, opt.client, { port: opt.debugPort, brkEnabled: opt.debugBrkEnabled })`
    var self    = {
            format: null
            , formatOutReplacement: null
            , formatOutSpacing: 0
            , selectedProtocoles: null // array if assigned
            , selectedSchemes: null // array if assigned
            , selectedBundles: null // array if assigned
        }
        , local = {}
    ;

    var init = function() {

        // import CMD helpers
        new CmdHelper(self, opt.client, { port: opt.debugPort, brkEnabled: opt.debugBrkEnabled });

        // check CMD configuration
        if (!isCmdConfigured()) return false;

        var isListingAll = false;

        for (let i=3, len=process.argv.length; i<len; i++) {
            if ( /^\-\-format\=/.test(process.argv[i]) ) {
                // e.g:
                // --format=json
                // --format=json,null,2
                let format  = process.argv[i].split(/\=/);
                self.format = format[1]; // by default;
                if ( /\,/.test(format[1]) ) {
                    let formating = format[1].split(/\,/g);
                    self.format = formating[0];
                    self.formatOutReplacement = /^null$/i.test(formating[1]) ? null : formating[1] || null;
                    self.formatOutSpacing = ~~formating[2] || 0;
                }

            }

            if ( /^\-\-protocol\=/.test(process.argv[i]) ) {
                // e.g:
                // --protocol=http/2.0,ftp
                self.selectedProtocoles = process.argv[i].split(/\=/)[1].split(/\,/);
            }

            if ( /^\-\-scheme\=/.test(process.argv[i]) ) {
                // e.g:
                // --scheme=https
                self.selectedSchemes = process.argv[i].split(/\=/)[1].split(/\,/);
            }

            if ( /^\-\-bundle\=/.test(process.argv[i]) ) {
                // e.g:
                // --bundle=frontend,backend
                self.selectedBundles = process.argv[i].split(/\=/)[1].split(/\,/);
            }

            if ( /^\-\-all\=/.test(process.argv[i]) || !self.projectName ) {
                isListingAll = true;
            }
        }


        if (!self.name && !self.projectName || isListingAll) {
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

        var projects  = self.projects
            , list      = []
            , p         = null
            , re        = null
            , found     = false
            , strTmp    = ''
            , str       = ''
            , json      = []
        ;

        for (p in projects) {
            list.push(p)
        }
        list.sort();

        var jsonCollection =  new Collection(json);
        p = 0;
        for (; p < list.length; ++p) {
            let projectName = list[p];
            let project     = projects[projectName];
            let protocols   = project.protocols;
            let schemes     = project.schemes;

            re = new RegExp('\@' + projectName + '\/', '');// searching by projectName
            str += '------------------------------------\n\r';
            if (!project.exists || project.exists && protocols.length == 0) {
                str += '?! '
            }
            str += projectName + '\n\r';
            str += '------------------------------------\n\r';
            strTmp = '';
            found = false;
            for (let i = 0, len = protocols.length; i < len; ++i) {
                let protocol = protocols[i];
                if (
                    self.selectedProtocoles
                    && self.selectedProtocoles.indexOf(protocol) < 0
                ) {
                    continue;
                }

                strTmp += '[ '+ protocol +' ]\n\r';
                for (let s = 0, sLen = schemes.length; s < sLen; ++s) {
                    let scheme = schemes[s];
                    if (
                        self.selectedSchemes
                        && self.selectedSchemes.indexOf(scheme) < 0
                    ) {
                        continue;
                    }
                    strTmp += '  [ '+ scheme +' ]\n\r';

                    for (let port in self.portsData[ protocol ][ scheme ]) {
                        let bundleEnv = self.portsData[protocols[i]][scheme][port].replace(re, ':').split(/\:/);
                        let _bundle = bundleEnv[0];
                        let _env = bundleEnv[1];
                        if (_bundle && self.selectedBundles && self.selectedBundles.indexOf(_bundle.split(/\@/)[0]) < 0) {
                            continue;
                        }

                        let re2 = new RegExp(_bundle +'\@' + projectName + '\/'+ _env, '');// searching by projectName
                        // if (re.test(self.portsData[protocol][scheme][port]) ) {
                        if (re2.test(self.portsData[protocol][scheme][port])) {
                            found = true;
                            strTmp += '\n\r    - ' + port + '  ' + self.portsData[protocol][scheme][port].replace(re, ' (') + ')';

                            let jsonPort  = {protocol: protocol, project: projectName};
                            jsonPort.scheme = scheme;
                            jsonPort.port = ~~port;
                            jsonPort.bundle = _bundle;
                            jsonPort.env = _env;
                            if ( !jsonCollection.findOne({ "port": ~~port }) ) {
                                jsonCollection = jsonCollection.insert(jsonPort);
                            }
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

        json = jsonCollection.toRaw();
        if ( /^json?/.test(self.format) ) {
            return process.stdout.write(JSON.stringify(json, self.formatOutReplacement, self.formatOutSpacing));
        }

        console.log(str)
    }

    var listProjectOnly = function() {

        var protocols   = self.protocols
            , schemes   = self.schemes
            , str       = ''
            , json      = []
            , re        = null
        ;

        var jsonCollection =  new Collection(json);
        for (let i = 0, len = protocols.length; i < len; ++i) {
            let protocol = protocols[i];
            if (
                self.selectedProtocoles
                && self.selectedProtocoles.indexOf(protocol) < 0
            ) {
                continue;
            }
            str += '[ ' + protocol + ' ]\n\r';
            for (let s = 0, sLen = schemes.length; s < sLen; ++s) {
                let scheme = schemes[s];
                if (
                    self.selectedSchemes
                    && self.selectedSchemes.indexOf(scheme) < 0
                ) {
                    continue;
                }
                str += '  [ ' + scheme + ' ]\n\r';
                re = new RegExp('\@' + self.projectName + '\/', '');// searching by projectName
                for (let port in self.portsData[protocol][scheme]) {
                    let bundleEnv = self.portsData[protocol][scheme][port].replace(re, ':').split(/\:/);
                    let _bundle = bundleEnv[0];
                    let _env = bundleEnv[1];
                    let re2 = new RegExp(_bundle +'\@' + self.projectName + '\/'+ _env, '');// searching by projectName
                    if (_bundle && self.selectedBundles && self.selectedBundles.indexOf(_bundle.split(/\@/)[0]) < 0) {
                        continue;
                    }
                    if (re2.test(self.portsData[protocol][scheme][port])) {

                        str += '\n\r    - ' + port + '  ' + self.portsData[protocol][scheme][port].replace(re, ' (') + ')';

                        let jsonPort  = {protocol: protocol, project: self.projectName};
                        jsonPort.scheme = scheme;
                        jsonPort.port = ~~port;
                        jsonPort.bundle = _bundle;
                        jsonPort.env = _env;
                        if ( !jsonCollection.findOne({ "port": ~~port }) ) {
                            jsonCollection = jsonCollection.insert(jsonPort);
                        }
                    }
                }
                str += '\n\r';
            }
            str += '\n\r';

        }
        json = jsonCollection.toRaw();

        if ( /^json?/.test(self.format) ) {
            return process.stdout.write(JSON.stringify(json, self.formatOutReplacement, self.formatOutSpacing));
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

        for (let i = 0, len = protocols.length; i < len; ++i) {
            str += '[ '+ protocols[i] +' ]\n\r';
            for (let s = 0, sLen = schemes.length; s < sLen; ++s) {
                found = false;
                re = new RegExp('^' + self.name + '\@', '');// searching by bundle name
                for (let port in self.portsData[protocols[i]][schemes[s]]) {
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