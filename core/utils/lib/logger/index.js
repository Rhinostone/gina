/**
 * This file is part of the geena package.
 * Copyright (c) 2014 Rhinostone <geena@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */
//'use strict';

// Imports
var util = require('util');
var merge = require('../merge');

/**
 * @class Logger
 *
 * @package geena.utils
 * @namesame geena.utils.logger
 * @author Rhinostone <geena@rhinostone.com>
 *
 * @api Public
 * */
function Logger(opt) {
    var self = this;
    var defaultOptions = {
        name: 'geena', // by default
        template: '%d [ %s ] %m',
        //containers: [],
        levels : { // based on Sylog Severity Levels
            emerg: {
                code: 0,
                label: 'Emergency',
                desciption: 'System is unusable.',
                color: 'magenta'
            },
            alert: {
                code: 1,
                label: 'Alert',
                desciption: 'Action must be taken immediately.',
                color:'red'
            },

            crit: {
                code: 2,
                label: '',
                desciption: 'Critical conditions.',
                color: 'magenta'
            },
            error : {
                code: 3,
                label: '',
                desciption: '',
                color : 'orange'
            },
            warn : {
                code: 4,
                label: '',
                desciption: '',
                color: 'yellow'
            },
            notice: {
                code: 5,
                label: '',
                desciption: '',
                color: 'black'
            },
            info : {
                code: 6,
                label: '',
                desciption: '',
                color: 'blue'
            },
            debug : {
                code: 7,
                label: '',
                desciption: '',
                color: 'cyan'
                //'format' : '',
                //'pipe' : []
            }
        }
    };
    opt = merge(true, defaultOptions, opt);



    /**
     * init
     * @constructor
     * */
    var init = function() {
        if ( typeof(Logger.initialized) != "undefined" ) {
            console.log("....Logger instance already exists...");
            return getInstance()
        } else {
            Logger.initialized = true;
            Logger.instance = self;
            setDefaultLevels()
        }

        console.info('Logger ready');
    }

    var getInstance = function() {
        return Logger.instance
    }

    var setDefaultLevels = function() {

        for (var l in opt.levels) {
            if ( typeof(self[l]) != 'undefined' )
                delete self[l];

            self[l] = new Function('return '+write+'('+JSON.stringify(opt)+', '+parse+', "'+l+'", arguments);');
        }
    }

    var write = function(opt, parse, s, args) {
        var content = '';
        //To handle logs with coma speparated arguments.
        for (var i=0; i<args.length; ++i) {
            if (args[i] instanceof Function) {
                content += args[i].toString() + ""
            } else if (args[i] instanceof Object) {
                // careful, [ parse ] will be out of the main execution context: passing it for recursive use
                content += parse(parse, args[i], "")
            } else {
                content += args[i] + ' '
            }
        }

        if (content != '') {
            var now = new Date();
            var repl = {
                '%s': s, //severity
                '%d': now, // timestamp
                '%m': content // message
                //'%container', //container
            };

            var patt = opt.template.match(/\%[a-z A-Z]/g);
            content = opt.template;
            for(var p=0; p<patt.length; ++p) {
                content = content.replace(new RegExp(patt[p], 'g'), repl[patt[p]])
            }

            return process.stdout.write(content + '\n')
        }
    }

    var parse = function(parse, obj, str) {
        var l = 0, len = obj.count(), isArray = (obj instanceof Array) ? true : false;
        str += (isArray) ? '[ ' : '{';

        for (var attr in obj) {
            ++l;
            if (obj[attr] instanceof Function) {
                str += attr +': [Function]';
                // if you want ot have it all replace by the fllowing line
                //str += attr +':'+ obj[attr].toString();
                str += (l<len) ? ', ' : ''
            } else if (obj[attr] instanceof Object && !isArray) {
                str += '"'+attr+'": ';
                str = parse(parse, obj[attr], str);
                str += (l<len) ? ', ' : '';
            } else {
                if (!isArray && typeof(obj[attr]) == 'string') {
                    str += '"'+attr+'": "' + obj[attr]
                            .replace(/\'/g, "\\'")
                            .replace(/\"/g, '\\"') +'"';
                } else if (isArray) {
                    str += ( typeof(obj[attr]) != 'string' ) ? obj[attr] : '"'+ obj[attr] +'"'
                } else {
                    str += '"'+attr+'": ' + obj[attr]
                }
                str += (l<len) ? ', ' : ''
            }
        }

        str += (isArray) ? ' ]' : '}';
        return str + ' '
    }

//    /**
//     * Add or override existing level(s)
//     * @param {object} levels
//     * */
//    this.addLevel = function(levels) {
//        for (var l in levels) {
//            self[l] = new Function('return '+write+'('+JSON.stringify(opt)+', "'+l+'", arguments);');
//        }
//    }

    this.setLevels = function(levels) {
        try {
            //remove default.
            for (var l in opt.levels) {
                delete self[l]
            }


            for (var l in levels) {
                self[l] = new Function('return '+write+'('+JSON.stringify(opt)+', '+parse+', "'+l+'", arguments);');
            }
        } catch(e) {
            setDefaultLevels();
            self.error('Cannot set type: ', e.stack|| e.message)
        }
    }

    this.getLogger = function(details) {
        console.debug('getting logger ')

    }


    init();
    return this
};


module.exports = Logger()
