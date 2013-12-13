/*
 * This file is part of the geena package.
 * Copyright (c) 2013 Rhinostone <geena@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */
var PostInstall;

var fs = require("fs"), EventEmitter = require('events').EventEmitter;
var utils = require("geena").utils, util = require('util');

/**
 * Post install constructor
 * @constructor
 * */
PostInstall = function(){

    var _this = this;
    this.path = __dirname.substring(0, (__dirname.length - "script".length));

    /**
     * Initialize post installation scripts
     * */
    var init = function(){

        createGeenaFile();
            //.onComplete();
    };

    /**
     * Creating framework command line file
     * */
    var createGeenaFile = function(){

        var name = require(_this.path + 'package.json').name,
            appPath = _this.path.substring(0, (_this.path.length - ("node_modules/" + name + '/').length)),
            source = _this.path + 'core/template/command/geena.tpl',
            target = appPath + name;
        //Will override.
        utils.generator.createFileFromTemplate(source, target);
    };

    var createGeenaHome = function(){

    };

    init();
};
util.inherits(PostInstall, EventEmitter);

var postInstall = new PostInstall();
//PostInstall.init();
//module.exports = PostInstall;

