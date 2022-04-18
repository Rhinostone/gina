/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2022 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * LoggerHelper
 *
 * @package     Gina.Lib.Logger
 * @namespace   Gina.Lib.Logger.LoggerHelper
 * @author      Rhinostone <contact@gina.io>
 * */

 function LoggerHelper(opt, loggers) {
     
     var self = {};
     
    /**
     * @function format
     * @param {string} content - to be formated
     * */
    self.format = function(group, s, content) {

        if (content != '') {
            var colors = null;
            try {
                colors = loggers[ group ].colors
            } catch(colorsErr) {
                throw new Error('Not able to define colors. Please check logger‘s group: `'+ group +'`\n')
            }
            
            var now = new Date().format('logger');
            var sCount = s.length;            
            if ( sCount < opt._maxLevelLen ) {
                for (; sCount < opt._maxLevelLen; ++sCount ) {
                    s +=' ';
                }
            }
            
            var repl = {
                '%a': group, // application or service name
                '%s': s, // severity or level
                '%d': now, // date
                '%m': content // message
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
            
            // formating output
            for (let p=0; p<patt.length; ++p) {
                content = content.replace(new RegExp(patt[p], 'g'), repl[patt[p]])
            }
        }
        
        // We should be using `\r` instead of `\n`
        // But it is not yet possible because of weird console.*() stdout when we are on the CLI or Framework side
        return content +'\n'
    };
        
    return self
}
module.exports = LoggerHelper;