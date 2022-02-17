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
if ( typeof(JSON.clone) == 'undefined' ) {
    require(__dirname +'/../../helpers/prototypes')()
}

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

    var self = {loggers: {}};

    var defaultOptions = {
        // Group name by default: it is usually the application or the service PROC.title
        name: 'gina',
        template: '%d [%s][%a] %m',
        
        // Where the events flow will be dispatched - e.g.: event.on('logger#default', function(code, level, message){ ... })
        flow: 'default',
        //containers: [],
        //'format' : '',
        //'pipe' : [],
        
        // Levels are based on Syslog: https://en.wikipedia.org/wiki/Syslog
        levels : {
            // will also kill the process
            emerg: {
                code: 0,
                label: 'Emergency',
                description: 'System is unusable.',
                color: 'magenta'
            },
            // Only used to send email or trigger a push to an alert system
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
            // deprecated
            error : {
                code: 3,
                label: 'Error',
                description: 'Error conditions.',
                color : 'red',
                deprecated: 'Use `console.err` instead'
            },
            err : {
                code: 3,
                label: 'Error',
                description: 'Error conditions.',
                color : 'red'
            },
            // deprecated
            warn : {
                code: 4,
                label: 'Warning',
                description: 'Warning conditions.',
                color: 'yellow',
                deprecated: 'Use `console.warning` instead'
            },
            warning : {
                code: 4,
                label: 'Warning',
                description: 'Warning conditions.',
                color: 'yellow'
            },
            // notice is use in the framework to raise flags that can be picked-up by child processes (CLI, Bundle, Workers)
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
        },
        // logging hierarchy
        // Descriptions from https://sematext.com/blog/logging-levels/
        hierarchy: process.env.LOG_LEVEL || 'info', // by default: fatal
        hierarchies: {
            /**
             * TRACE
             * The most fine-grained information only used in rare cases where you need the full visibility 
             * of what is happening in your application and inside the third-party libraries that you use.
             * Expect the TRACE logging level to be very verbose
             */
            trace: [0,1,2,3,4,5,6,7], // we want it all
            /**
             * DEBUG
             * Should be used for information that may be needed for diagnosing issues and troubleshooting 
             * or when running application in the test environment 
             */
            debug: [0,1,2,3,4,5,6,7],
            /**
             * INFO
             * The standard log level indicating that something happened.
             * Should be purely informative and not looking into them on a regular basis shouldn’t result in 
             * missing any important information.
             */
            info: [0,1,2,3,4,5,6],
            /**
             * WARN
             * Indicates that something unexpected happened in the application, a problem, or a situation that might 
             * disturb one of the processes. But that doesn’t mean that the application failed.
             */
            warn: [0,1,2,3,4,5],
            /**
             * ERROR
             * Should be used when the application hits an issue preventing one or more functionalities from properly 
             * functioning.
             */
            error: [0,1,2,3,5],
            /**
             * FATAL
             * Tells that the application encountered an event or entered a state in which one of the 
             * crucial business functionality is no longer working.
             */
            fatal: [0,1,2,5]
            /**
             * OFF
             * Simple enough. NO LOGGING !!
             */
            //off: [5]
        }
    };

    

    /**
     * init
     * @constructor
     * */
    var init = function(opt) {
        // if ( typeof(Logger.initialized) != 'undefined' ) {
        //     console.log("Logger instance already exists. Loading it.");
        
        //     self = getInstance();
        
        //     return self        
        // }
        
        Logger.initialized              = true;
        Logger.instance                 = self;        
        Logger.instance._eventHandler   = e;
        
        
        
        if (opt) {            
            opt = merge(defaultOptions, opt, true)
        } else {
            //opt = ( typeof(Logger.instance) != 'undefined' && typeof(Logger.instance._options) != 'undefined' ) ? Logger.instance._options : defaultOptions;
            opt = JSON.clone(defaultOptions)
        }
        
        if ( typeof(self.loggers[opt.name]) == 'undefined' ) {
            // defining default prototypes
            self.loggers[opt.name] = {}
        }
        self.loggers[opt.name]._options = opt;        
        Logger.instance.loggers[opt.name]._options = opt;
                
        
        // setup default group, colors
        setupNewGroup(opt.name, opt);        
                     
        for (let l in opt.levels) {
            // don't override here since it is generic
            if ( typeof(self[l]) == 'undefined' ) {
                self[l] = function(){
                    
                    var group = defaultOptions.name; // by default
                    if ( process.title != 'node' && !/(\\|\/)*node$/.test(process.title) ) {
                        group = process.title.replace(/^gina\:\s*/, '');
                    }
                    
                    //self.log('--> '+ group + ' '+ process.env.LOG_GROUP +' '+ process.title);
                    if ( typeof(self.loggers[group]) == 'undefined' ) {
                        setupNewGroup(group)
                    }
                    self.loggers[group][l].apply(self[l], arguments)
                }
            }
        }        
             
        //console.debug('Logger instance ready.');
        
        
        return Logger.instance
    }

    var getInstance = function() {
        return Logger.instance
    }
    
    /**
     * 
     * 
     * @param {string} group
     * @param {object} [opt] 
     */
    var setupNewGroup = function(group, opt) {
        if ( typeof(self.loggers[group]) == 'undefined' ) {
            self.loggers[group] = {};
        }
        
        if (!opt) {
            //opt = ( typeof(Logger.instance) != 'undefined' && typeof(Logger.instance._options) != 'undefined' ) ? Logger.instance._options : defaultOptions;
            opt = JSON.clone(defaultOptions)
        }
        self.loggers[group]._options = opt;
        
        // lock group name
        self.loggers[group]._options.name = group;
        
        // setup colors
        setColors(group);
        
        //setup default levels for the group
        setDefaultLevels(group);
    }
    
    var setColors = function(group) {
        // using colors module, but we can add support for other modules
        if (colors) {
            var _colors = {};
            for (let k in colors.styles) {
                _colors[k] = {};
                for (let i in colors.styles[k]) {
                    _colors[k][i] = colors.styles[k][i]
                }
            }
            self.loggers[group].colors = JSON.clone(_colors);
        }            
    }



    var setDefaultLevels = function(group) {
        
        var opt = self.loggers[group]._options || JSON.clone(defaultOptions);
        var logger = self.loggers[group];
        try {
            
            //console.log('colors ----> ', colors);
            // setting default level string length
            opt._maxLevelLen = opt._maxLevelLen || 0;
            if (!opt._maxLevelLen) {
                for (let l in opt.levels) {
                    if (l.length > opt._maxLevelLen) {
                        opt._maxLevelLen = l.length;
                    }
                }
            }
            logger._previousLevel = 'debug';
            logger._hasChangedLevel = null;
            
            
            for (let l in opt.levels) {
                
                logger._hasChangedLevel = (logger._previousLevel != l) ? true : false;
                // override if existing
                logger[l] = new Function('return '+ write +'('+ JSON.stringify(opt) +', '+ JSON.stringify(logger.colors) +', '+ parse +', "'+ l +'", arguments, "'+ logger._previousLevel +'", "'+ logger._hasChangedLevel +'");');
                
                // logger[l] = new Function('return '+ write +'('+ JSON.stringify(opt) +', '+ parse +', "'+ l +'", arguments);');
            }
            
        } catch (err) {
            process.stdout.write(err.stack + '\n')
        }
    }

    
    
    //var write = function(opt, colors, parse, s, args, e) {
    var write = function(opt, colors, parse, s, args, previousLevel, hasChangedLevel) {
        
        //console.log('previousLevel: ', previousLevel, s, hasChangedLevel);        
        if (hasChangedLevel) {
            previousLevel = s;
        }
        
        
        var content = '', payload = null;
        // Ignore logs not in hierarchy
        if (opt.hierarchies[opt.hierarchy].indexOf( opt.levels[s].code) < 0) {
            return;
        }
        
        //To handle logs with coma separated arguments.
        for (let i = 0, iLen = args.length; i < iLen; ++i) {

            if (args[i] instanceof Function) {                
                content += args[i].toString() + ""
            }
            else if (args[i] instanceof Object) {
                // careful, [ parse ] will be out of the main execution context: passing it for recursive use
                content += parse(parse, args[i], "")
            }
            else {   
                
                if ( /(?:\\[rnt]|[\r\n\t])/.test(args[i]) ) { // special replacement for mixed string
                    args[i] = args[i]
                        .replace(/(?:\\[rn]|[\r\n])/gm, String.fromCharCode('10')) // \r 10, but should be 13, but will be 10 because of the terminal                            
                        .replace(/(?:\\[t]|[\t])/gm, String.fromCharCode('09'))
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

                }
    
                content += args[i] + ' '           
            }
        }


        if (content != '') {
            var now = new Date().format('logger');
            var sCount = s.length;
            // if (sCount > opt._maxLevelLen ) {
            //     opt._maxLevelLen = sCount;                
            // }
            //log(sCount, ' vs ', opt._maxLevelLen);
            if ( sCount < opt._maxLevelLen ) {
                for (; sCount < opt._maxLevelLen; ++sCount ) {
                    s +=' ';
                }
            }
            
            var repl = {
                '%a': opt.name, // application or service name
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
            
            // Comment this part if you want to check raw output
            for (let p=0; p<patt.length; ++p) {
                content = content.replace(new RegExp(patt[p], 'g'), repl[patt[p]])
            }

            
            //process.stdout.write('FLOW: '+ opt.flow + '\n');
            if (opt.flow == 'default') {
                //content = content.replace(/(\\[rn]|[\r\n])$/g, '');
                // if (!hasChangedLevel) {
                //     // if ( /(\\[rn]|[\r\n])$/.test(content) ) {
                //     //     return process.stdout.write(content)
                //     // }
                //     return process.stdout.write( content )
                // }
                
                // if (app == 'gina') {
                    //   return process.stdout.write(content+'\n')
                // }
                
                //process.stdout.write('\r'+content +'\n\r');
                process.stdout.write(content+'\n');                
                // We should be using this one: not possible because of weird console.*() stdout when we are on the CLI or Framework side
                //return process.stdout.write(content+'\r')
                
            } else {
                process.emit('message', opt.flow, opt.levels[s].code, s, content);
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

    // self.switchFlow = function (name) {
    //     opt.flow = name;
    //     Logger.instance._options = self._options = opt;

    //     e.on('logger#' + name, function (flow, code, level, message) {

    //         if ( typeof(message) != 'undefined' && message != '' ) {

    //             console.log('logger['+ flow +'] -> ', code, level + '\n');
    //             console.log(message);
    //         }

    //     });

    //     process.on('message', function (flow, code, level, message) {
    //         // filter logger by flow
    //         if ( /^\[LOGGER\]/.test(message) ) {
    //             e.emit( 'logger#' + flow, flow, code, level, message.replace('[LOGGER]', '') )
    //         }
    //     });

    //     // updating functions options
    //     setDefaultLevels(opt)
    // }
    
    /**
     * setLevel
     * Define a level for a given application
     * 
     * @param {string} level hierarchy
     * @param {string} group - existing application or service
     * @returns 
     */
    self.setLevel = function(level, group) {
        if ( typeof(group) != 'undefined' ) {
            group = 'gina'
        }
        
        var opt = self.loggers[group]._options;        
        level = level.toLowerCase();
        if ( typeof(opt.hierarchies[level]) == 'undefined' ) {
            console.warn('`'+ level +'` is not a valid level: swithcing to `info`');
            level = 'info';
        }
        
        opt.name = group;
        process.env.LOG_GROUP = group;
        opt.hierarchy = level;
        process.env.LOG_LEVEL = level;
        
        setColors(group);
        setDefaultLevels(group);
        
        
        self.debug('Log level set for `'+ group +'`: '+ level);
        
        return
    }

    // self.setLevels = function(levels) {
    //     try {
    //         var opt = self._options;

    //         //remove default.
    //         for (var l in opt.levels) {
    //             delete self[l]
    //         }


    //         for (var l in levels) {
    //             self[l] = new Function('return '+ write +'('+ JSON.stringify(opt) +', '+ JSON.stringify(self.colors) +', ' + parse +', "'+ l +'", arguments);');                
    //         }
    //     } catch(e) {
    //         setDefaultLevels(opt);
    //         //console.error('Cannot set type: ' + e.stack || e.message);
    //         process.stdout.write('Cannot set type: ' + e.stack || e.message + '\n');
    //     }
    // }

    self.getLogger = function(group) {
        console.debug('Getting `'+ group +'` logger');
    }

    self.log = function() {
        var args = arguments, content = '';
        
        //To handle logs with coma separated arguments.
        for (let i=0; i<args.length; ++i) {

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
