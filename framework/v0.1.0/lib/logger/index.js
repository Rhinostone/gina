'use strict';
/**
 * This file is part of the gina package.
 * Copyright (c) 2009-2022 Rhinostone <gina@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */
// Imports
var util            = require('util');
var EventEmitter    = require('events').EventEmitter;
var colors          = require('colors');  

var e = new EventEmitter();

var merge           = require('../merge');
var helpers         = require('../../helpers');

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
        flow: 'default', // event where the flow will be dispatched - e.g.: event.on('logger#default', function(code, level, message){ ... })
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
                color : 'red'
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
                color: 'cyan'
            },
            debug : {
                code: 7,
                label: 'Debug',
                description: 'Debug-level messages.',
                color: 'gray'
            }

        }
    };

    if (opt) {
        opt = merge(defaultOptions, opt, true)
    } else {
        opt = ( typeof(Logger.instance) != 'undefined' && typeof(Logger.instance._options) != 'undefined' ) ? Logger.instance._options : defaultOptions;
    }

    /**
     * init
     * @constructor
     * */
    var init = function(opt) {        
        // if ( typeof(Logger.initialized) != 'undefined' ) {
        //     console.debug("Logger instance already exists. Loading it.");
        //
        //     self = getInstance();
        //
        //     return self
        //
        // } else {
            Logger.initialized              = true;
            Logger.instance                 = self;
            Logger.instance._options        = self._options = opt;
            Logger.instance._eventHandler   = e;
            
            if (colors) {
                var _colors = {};
                for (let k in colors.styles) {
                    _colors[k] = {};
                    for (let i in colors.styles[k]) {
                        _colors[k][i] = colors.styles[k][i]
                    }
                }
                self.colors = _colors;
            }
            
            setDefaultLevels(opt);

            return Logger.instance
        //}
    }

    var getInstance = function() {
        return Logger.instance
    }



    var setDefaultLevels = function(options) {

        var opt = options || self._options;
        
        
        try {
            
            //console.log('colors ----> ', colors);
            
            opt._maxLevelLen = 0;            
            for (var l in opt.levels) {
                if (l.length > opt._maxLevelLen) {
                    opt._maxLevelLen = l.length;
                }
                                
                
                if ( typeof(self[l]) == 'undefined' ) {
                    self[l] = new Function('return '+ write +'('+ JSON.stringify(opt) +', '+ JSON.stringify(self.colors) +', '+ parse +', "'+ l +'", arguments);');
                }                
                
                // if ( typeof(self[l]) != 'undefined' )
                //     delete self[l];
                    
                
                // self[l] = new Function('return '+ write +'('+ JSON.stringify(opt) +', '+ parse +', "'+ l +'", arguments);');
            }
        } catch (err) {
            process.stdout.write(err.stack + '\n')
        }
    }

    var write = function(opt, colors, parse, s, args, e) {

        var content = '', payload = null;
        //To handle logs with coma separated arguments.
        for (var i = 0, iLen = args.length; i < iLen; ++i) {

            if (args[i] instanceof Function) {
                content += args[i].toString() + ""
            } else if (args[i] instanceof Object) {
                // careful, [ parse ] will be out of the main execution context: passing it for recursive use
                content += parse(parse, args[i], "")
            } else {   

                if ( /(?:\\[rnt]|[\r\n\t])/.test(args[i]) ) { // special replacement for mixed string
                    args[i] = args[i]
                        .replace(/(?:\\[rn]|[\r\n])/g, String.fromCharCode('10')) // \r should be 13, but will be 10 because of the terminal                            
                        .replace(/(?:\\[t]|[\t])/g, String.fromCharCode('09'))
                    ;
                    /** 
                     *  Oct   Dec   Hex   Char
                    *  ─────────────────────────────────────────────
                    *  000   0     00    NUL '\0'
                    *  001   1     01    SOH (start of heading)
                    *  002   2     02    STX (start of text)
                    *  003   3     03    ETX (end of text)
                    *  004   4     04    EOT (end of transmission)
                    *  005   5     05    ENQ (enquiry)
                    *  006   6     06    ACK (acknowledge)
                    *  007   7     07    BEL '\a' (bell)
                    *  010   8     08    BS  '\b' (backspace)
                    *  011   9     09    HT  '\t' (horizontal tab)
                    *  012   10    0A    LF  '\n' (new line)
                    *  013   11    0B    VT  '\v' (vertical tab)
                    *  014   12    0C    FF  '\f' (form feed)
                    *  015   13    0D    CR  '\r' (carriage ret)
                    */

                    content += args[i] + ' '
                } else {
                    content += args[i] + ' '
                }                
            }
        }


        if (content != '') {
            var now = new Date().format('logger');
            var sCount = s.length;
            if (sCount > opt._maxLevelLen ) {
                opt._maxLevelLen = sCount;
            }
            
            if ( sCount < opt._maxLevelLen ) {
                for (; sCount < opt._maxLevelLen; ++sCount ) {
                    s +=' ';
                }
            }
            
            var repl = {
                '%s': s, // severity
                '%d': now, // date
                '%m': content // message
                //'%container', //container
            };

            var patt = opt.template.match(/\%[a-z A-Z]/g);
            
            
            var colorCode = opt.levels[s.replace(/\s+/, '')].color;
            var _color = colors[colorCode];
            //process.stdout.write('colors code '+ colorCode  +'\n');
            //process.stdout.write('colors '+ JSON.stringify(colors[colorCode], null, 2)  +'\n');
            
            if ( typeof(_color) != 'undefined' && _color) {
                //process.stdout.write('colors code '+ JSON.stringify(colors, null, 2)  +'\n');
                content = _color.open + opt.template + _color.close;
            } else { // system styles
                content = opt.template;
            }
                        
            for (let p=0; p<patt.length; ++p) {
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

        var l           = 0
            , len       = obj.count()
            , isArray   = (obj instanceof Array) ? true : false
        ;
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
        return str + ' ';
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
                self[l] = new Function('return '+ write +'('+ JSON.stringify(opt) +', '+ JSON.stringify(self.colors) +', ' + parse +', "'+ l +'", arguments);');                
            }
        } catch(e) {
            setDefaultLevels(opt);
            //console.error('Cannot set type: ' + e.stack || e.message);
            process.stdout.write('Cannot set type: ' + e.stack || e.message + '\n');
        }
    }

    self.getLogger = function(details) {
        console.debug('getting logger');
    }

    self.log = function() {
        var args = arguments, content = '';
        
        //To handle logs with coma separated arguments.
        for (var i=0; i<args.length; ++i) {

            if (args[i] instanceof Object) {
                //console.log("\n...", args[i], args[i].toString());
                content += JSON.stringify(args[i], null, '\t');
            } else {
                content += args[i]
            }
        }
       
        if (content != '')
            process.stdout.write(content + '\n');
    };


    return init(opt);
}

module.exports = Logger();
// if ( ( typeof(module) !== 'undefined' ) && module.exports ) {
//     // Publish as node.js module
//     module.exports = Logger();
// } else if ( typeof(define) === 'function' && define.amd) {
//     // Publish as AMD module
//     define( function() { return Logger() });
// }
