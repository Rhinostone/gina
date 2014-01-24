/**
 * This file is part of the geena package.
 * Copyright (c) 2014 Rhinostone <geena@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */
var PostInstall;

//Imports
var fs      = require("fs");
//var util    = require("util");
var utils   = require("./../core/utils");
var os      = require("os");


/**
 * Post install constructor
 * @constructor
 * */
PostInstall = function(){

    var self = this;

    //Initialize post installation scripts.

    var init = function(){
        self.isWin32 = ( os.platform() == 'win32' ) ? true : false;
        self.path = _( __dirname.substring(0, (__dirname.length - "script".length)) );

        if (self.isWin32)
            createGeenaFileForWin32()
        else
            createGeenaFile()

        log("Geena's command line tool has been installed.");
    };


    //Creating framework command line file for nix.
    var createGeenaFile = function(win32Name, callback){
        var name = require( _(self.path + 'package.json') ).name;
        var appPath = _( self.path.substring(0, (self.path.length - ("node_modules/" + name + '/').length)) );
        var source = _(self.path + 'core/template/command/geena.tpl');
        var target = _(appPath + name);
        if ( typeof(win32Name) != 'undefined') {
            target = _(appPath + win32Name)
        }
        //Will override.
        if ( typeof(callback) != 'udnefined')
            utils.generator.createFileFromTemplate(source, target, function onGeenaFileCreated(err){
                callback(err)
            })
        else
            utils.generator.createFileFromTemplate(source, target);
    };

    var createGeenaFileForWin32 = function(){
        var name = require( _(self.path + 'package.json') ).name;

        createGeenaFile('.' + name, function onFileCreated(err){
            if (err) console.error(err.stack);

            var appPath = _( self.path.substring(0, (self.path.length - ("node_modules/" + name + '/').length)) );
            var source = _(self.path + 'core/template/command/geena.bat.tpl');
            var target = _(appPath + name + '.bat');
            utils.generator.createFileFromTemplate(source, target)
        })
    };

    var createGeenaHome = function(){

    };

    init()
};
new PostInstall()