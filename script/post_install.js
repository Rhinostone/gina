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
//var utils   = require("./../core/utils");
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
        //createGeenaFileForPlatform();
        createGeenaHome();
        removeSrc();
        log("Geena's command line tool has been installed.");
    };

    var createGeenaHome = function(){
        console.log('creating geena\'s homepath')
    };

    var removeSrc = function(){
        console.log('removing src')
    };

/**

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

    var createGeenaFileForPlatform = function(){
        var name = require( _(self.path + 'package.json') ).name;

        var filename = ( (self.isWin32) ? '.' : '' ) + name;

        createGeenaFile(filename, function onFileCreated(err){
            if (err) console.error(err.stack);

            if (self.isWin32) {
                var appPath = _( self.path.substring(0, (self.path.length - ("node_modules/" + name + '/').length)) );
                var source = _(self.path + 'core/template/command/geena.bat.tpl');
                var target = _(appPath + name + '.bat');
                utils.generator.createFileFromTemplate(source, target)
            }

        })
    };
*/


    init()
};
new PostInstall()