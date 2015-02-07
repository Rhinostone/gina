/*
 * This file is part of the geena package.
 * Copyright (c) 2014 Rhinostone <geena@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * Lib Class
 *
 * @package    gina.framework
 * @namespace  lib
 * @author     Rhinostone <geena@rhinostone.com>
 */

var merge = require('./merge');

function Lib() {

    var self = this;

    /**
     * Clean files on directory read
     * Mac os Hack
     * NB.: use once in the server.js
     * TODO - remove it...
     **/
    this.cleanFiles = function(files){
        for(var f=0; f< files.length; f++){
            if(files[f].substring(0,1) == '.')
                files.splice(0,1);
        }
        return files;
    };

    var _require = function(path) {
        var cacheless = (process.env.IS_CACHELESS == 'false') ? false : true;
        if (cacheless) {
            delete require.cache[require.resolve(path)];
            return require(path)
        } else {
            return require(path)
        }
    }


    return {
        Config      : _require('./config'),
        //dev     : require('./lib/dev'),//must be at the same level than gina.utils => gina.dev
        inherits    : _require('./inherits'),
        helpers     : _require('./helpers'),
        //this one must move to Dev since it's dev related
        Model       : _require('./model'),
        merge       : _require('./merge'),
        generator   : _require('./generator'),//move to gina.dev
        Proc        : _require('./proc'),
        Shell       : _require('./shell'),
        logger      : _require('./logger'),
        math        : _require('./math'),
        url         : _require('./url'),
        cmd         : _require('./cmd'),
        Validator   : _require('./validator')
    }
};
// Making it global
lib = new Lib();
lib.cmd.load = function(opt){
    //ginaPath, pack, argv, client

    process.argv = JSON.parse(opt.argv);

    //Set gina paths.
    setPath('gina', _(opt.ginaPath));
    setPath('framework', _(opt.frameworkPath));
    setPath('gina.core', _(opt.frameworkPath +'/core'));
    setPath('gina.lib', _(opt.frameworkPath +'/lib'));

    //Getting package.
    var p = opt.pack;

    //Setting default options.
    lib.cmd.setOption([
        {
            'name' : 'version',
            'content' : p.version
        },
        {
            'name' : 'copyright',
            'content' : p.copyright
        },
        {
            'name' : 'task',
            'content' : opt.task
        },
        {
            'name' : 'homedir',
            'content' : opt.homedir
        },
    ]);

    var isFromFramework = ( typeof(opt.isFromFramework) != 'undefined') ? true : false;
    lib.cmd.onExec(opt.client, isFromFramework, opt)
};

module.exports = lib