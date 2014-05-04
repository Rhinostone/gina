/*
 * This file is part of the geena package.
 * Copyright (c) 2009-2014 Rhinostone <geena@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * BasicCommand Class
 *
 * @package    Geena.Utils.Cmd
 * @author     Rhinostone <geena@rhinostone.com>
 */
var fs = require('fs'),
    BasicCommand = {
    allowedOptions : [
        '-h',
        '--help',
        '-i',
        '--init',
        '-s',
        '--start',
        '-k',
        '--kill',
        '--stop',
        '-r',
        '--restart',
        '-t',
        '--status',
        '-u',
        '--update',
        '-i',
        '--init',
        '-v',
        '-v',
        '--version'
    ],
    run : function(options, message) {
        this.options = options;
        this.msg = message;
        this.arg = process.argv[2];
        var isAllowed = this.isAllowedOption(this.arg);
    },
    isAllowedOption : function(arg) {
        var found = false;
        for (var i=0; i<this.allowedOptions.length; ++i) {
            if (arg == this.allowedOptions[i]) {
                found = true;
                break;
            }
        }
        if (found) {
            this.map(arg);
        } else {
            log( this.msg.default[0].replace("%command%", "geena " + arg) );
        }

    },
    map : function(arg) {
        switch(arg){
            case '-v':
            case '--version':
                this.getVersion();
                break;

            case '-h':
            case '--help':
                this.getHelp();
                break;

            case '-i':
            case '--init':
                this.initProject();
                break;

//            case '-u':
//            case '--update':
//                this.update();
//                break;
        }
    },
    getHelp : function() {
        log('\n' + fs.readFileSync(__dirname + '/' +this.msg.basic[0]));
    },
    initProject : function() {
        var project = process.argv[3];
        if ( typeof(projet) == 'undefined' ) {
            log('project name is undefiend')
        }
    },
    getVersion : function() {
        var vers = "",
            version = {
            "number"    : this.options.version,
            "platform"  : process.platform,
            "arch"      : process.arch,
            "copyright" : this.options.copyright
        };
        vers = this.msg.basic[4]
                + version.number +' '+ version.platform +' '+ version.arch
                + '\n' + version.copyright;
        if (typeof(this.options.version) != "undefined") {
            log(vers);
        } else {
            log(this.msg.basic[5]);
        }
    },
    update : function() {
        log('Update batch is not ready yet.');
    }
};
module.exports = BasicCommand;