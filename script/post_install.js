/**
 * This file is part of the geena package.
 * Copyright (c) 2014 Rhinostone <geena@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */
var PostInstall;

var fs = require("fs");
var utils = require("./../core/utils");


/**
 * Post install constructor
 * @constructor
 * */
PostInstall = function(){

    var _this = this;
    this.path = _( __dirname.substring(0, (__dirname.length - "script".length)) );


    //Initialize post installation scripts.

    var init = function(){
        createGeenaFile();
        //.onComplete();
    };


    //Creating framework command line file.     
    var createGeenaFile = function(){
        console.log('..', _(_this.path + 'package.json') );
        var name = require( _(_this.path + 'package.json') ).name;
        var appPath = _( _this.path.substring(0, (_this.path.length - ("node_modules/" + name + '/').length)) );
        var source = _(_this.path + 'core/template/command/geena.tpl');
        var target = _(appPath + name);
        //Will override.
        utils.generator.createFileFromTemplate(source, target);
    };

    var createGeenaHome = function(){

    };

    init();
};
//util.inherits(PostInstall, EventEmitter);
var postInstall = new PostInstall();