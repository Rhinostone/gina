/**
 * This file is part of the gina package.
 * Copyright (c) 2017 Rhinostone <gina@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */
//'use strict';

// Imports
var util            = require('util');
var EventEmitter    = require('events').EventEmitter;
var e = new EventEmitter();
var merge           = require('../merge');


/**
 * @class Logger
 *
 * @package gina.lib
 * @namesame gina.lib.logger
 * @author Rhinostone <gina@rhinostone.com>
 *
 * @api Public
 * */
function Logger(opt) {

    var self = {};

    var defaultOptions = {
        name: 'gina', // group name by default: it is usually the bundle or the service name
        template: '%d [ %s ] %m',
        flow: 'default', // event where the flow will be display - e.g.: event.on('logger#default', function(code, level, message){ ... })
        //containers: [],
        //'format' : '',
        //'pipe' : [],
        levels : { // based on Sylog Severity Levels
            emerg: {
                code: 0,
                label: 'Emergency',
                description: 'System is unusable.',
                color: 'magenta'
            },
            alert: {
                code: 1,
                label: 'Alert',
                description: 'Action must be taken immediately.',
                color:'red'
            },

            crit: {
                code: 2,
                label: 'Critical',
                description: 'Critical conditions.',
                color: 'magenta'
            },
            error : {
                code: 3,
                label: 'Error',
                description: 'Error conditions.',
                color : 'orange'
            },
            warn : {
                code: 4,
                label: 'Warning',
                description: 'Warning conditions.',
                color: 'yellow'
            },
            notice: {
                code: 5,
                label: 'Notice',
                description: 'Normal but significant condition.',
                color: 'black'
            },
            info : {
                code: 6,
                label: 'Informational',
                description: 'Informational messages.',
                color: 'blue'
            },
            debug : {
                code: 7,
                label: 'Debug',
                description: 'Debug-level messages.',
                color: 'cyan'
            }

        }
    };

    if (opt) {
        opt = merge(true, defaultOptions, opt)
    } else {
        opt = ( typeof(Logger.instance) != 'undefined' && typeof(Logger.instance._options) != 'undefined' ) ? Logger.instance._options : defaultOptions;
    }


    /**
     * init
     * @constructor
     * */
    var init = function(opt) {

        if ( typeof(Logger.initialized) != 'undefined' ) {
            console.debug("Logger instance already exists. Loading it.");

            self = getInstance();

            return self

        } else {
            Logger.initialized              = true;
            Logger.instance                 = self;
            Logger.instance._options        = self._options = opt;
            Logger.instance._eventHandler   = e;

            setDefaultLevels(opt);

            return Logger.instance
        }
    }

    var getInstance = function() {
        return Logger.instance
    }



    var setDefaultLevels = function(options) {

        var opt = options || self._options;

        try {
            for (var l in opt.levels) {
                if ( typeof(self[l]) != 'undefined' )
                    delete self[l];

                self[l] = new Function('return '+ write +'('+ JSON.stringify(opt) +', '+ parse +', "'+ l +'", arguments);');
            }
        } catch (err) {
            process.stdout.write(err.stack + '\n')
        }

    }

    var write = function(opt, parse, s, args, e) {

        var content = '', payload = null;
        //To handle logs with coma separated arguments.
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


            //process.stdout.write('FLOW: '+ opt.flow + '\n');

            if (opt.flow == 'default') {
                return process.stdout.write(content + '\n')
            } else {
                process.emit('message', opt.flow, opt.levels[s].code, s, '[LOGGER]' + content);
            }
        }
    }

    var parse = function(parse, obj, str) {
        var l = 0, len = obj.count(), isArray = (obj instanceof Array) ? true : false;
        str += (isArray) ? '[ ' : '{';

        for (var attr in obj) {
            ++l;
            if (obj[attr] instanceof Function) {
                str += attr +': [Function]';
                // if you want ot have it all replace by the following line
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

    self.switchFlow = function (name) {
        opt.flow = name;
        Logger.instance._options = self._options = opt;

        e.on('logger#' + name, function (flow, code, level, message) {

            if ( typeof(message) != 'undefined' && message != '' ) {

                console.log('logger['+ flow +'] -> ', code, level + '\n');
                console.log(message);
            }

        });

        process.on('message', function (flow, code, level, message) {
            // filter logger by flow
            if ( /^\[LOGGER\]/.test(message) ) {
                e.emit( 'logger#' + flow, flow, code, level, message.replace('[LOGGER]', '') )
            }
        });

        // updating functions options
        setDefaultLevels(opt)
    }

    self.setLevels = function(levels) {
        try {
            var opt = self._options;

            //remove default.
            for (var l in opt.levels) {
                delete self[l]
            }


            for (var l in levels) {
                self[l] = new Function('return '+ write +'('+ JSON.stringify(opt) +', '+ parse +', "'+ l +'", arguments);');
            }
        } catch(e) {
            setDefaultLevels(opt);
            self.error('Cannot set type: ', e.stack|| e.message)
        }
    }

    self.getLogger = function(details) {
        console.debug('getting logger')
    }

    self.log = function() {
        var args = arguments, content = '';
        //console.log("arg: ", args);
        //To handle logs with coma separated arguments.
        for (var i=0; i<args.length; ++i) {

            if (args[i] instanceof Object) {
                //console.log("\n...", args[i], args[i].toString());
                content += JSON.stringify(args[i], null, '\t')
            } else {
                content += args[i]
            }
        }
        //console.log("hum ? ", content);
        if (content != '')
            process.stdout.write(content + '\n')
    }


    return init(opt);
};

module.exports = Logger()
