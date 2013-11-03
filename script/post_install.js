/*
 * This file is part of the geena package.
 * Copyright (c) 2013 Rhinostone <geena@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

var Fs = require("fs"),
    Utils = require("geena.utils"),
    PostInstall = {
    path : __dirname.substring(0, (__dirname.length - "script".length)),
    /**
     * Initialize post installation scripts
     * */
    init : function(){
        this.createGeenaFile();
    },
    /**
     * Creating framework command line file
     * */
    createGeenaFile : function(){

        var name = require(this.path + 'package.json').name,
            appPath = this.path.substring(0, (this.path.length - ("node_modules/" + name + '/').length)),
            source = this.path + 'core/template/command/geena.tpl',
            target = appPath + name;

        Utils.Generator.createFileFromTemplate(source, target);
    }
};
PostInstall.init();
//module.exports = PostInstall;

