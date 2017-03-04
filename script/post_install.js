/**
 * This file is part of the gina package.
 * Copyright (c) 2016 Rhinostone <gina@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */
process.env.IS_SCRIPT_MODE = true;
//Imports
var fs      = require('fs');
var os      = require('os');

// var helpers = require('./../core/utils/helpers');
// var utils   = {
//     logger      : require('./../core/utils/lib/logger'),
//     generator   : require('./../core/utils/lib/generator')
// };

var utils = require('./../core/utils');
var console = utils.logger;



/**
 * Post install constructor
 * @constructor
 * */
function PostInstall() {

    var self = this;

    //Initialize post installation scripts.
    var init = function() {
        self.isWin32 = ( os.platform() == 'win32' ) ? true : false;
        self.path = _( __dirname.substring(0, (__dirname.length - "script".length)-1 ) );
        self.root = process.cwd().toString();


        createVersionFile();
        //console.log('[ debug ] createVersionFile()');
        createGinaFileForPlatform();
        //console.log('[ debug ] createGinaFileForPlatform()');
    }

    var createVersionFile = function(callback) {
        var version = require( _(self.path + '/package.json') ).version;
        var target = _(self.path + '/VERSION');
        try {
            if ( fs.existsSync(target) ) {
                fs.unlinkSync(target);
                setTimeout(function(){
                    if (callback) {



                            fs.writeFileSync(target, version);
                            callback()

                    } else {
                        fs.writeFileSync(target, version);
                    }
                }, 1000)

            } else {
                fs.writeFileSync(target, version);
            }

        } catch(err) {
            throw err;
            process.exit(0)
        }
    }

    //Creating framework command line file for nix.
    var createGinaFile = function(win32Name, callback) {
        var name = require( _(self.path + '/package.json') ).name;
        var appPath = _( self.path.substring(0, (self.path.length - ("node_modules/" + name + '/').length)) );
        var source = _(self.path + '/core/template/command/gina.tpl');
        var target = _(appPath +'/'+ name);
        if ( typeof(win32Name) != 'undefined') {
            target = _(appPath +'/'+ win32Name)
        }

        //Will override.
        if ( typeof(callback) != 'undefined') {

            try {
                utils.generator.createFileFromTemplateSync(source, target);
                setTimeout(function () {
                    callback(false)
                }, 1000)
            } catch (err) {
                callback(err)
            }
        } else {
            utils.generator.createFileFromTemplateSync(source, target)
        }
    }

    var createGinaFileForPlatform = function() {
        console.log('creating platform file');
        //console.log('[ debug ] about to open ' + _(self.path + '/package.json'));
        var name = require( _(self.path + '/package.json') ).name;

        var filename = ( (self.isWin32) ? '.' : '' ) + name;

        var keepGoing = function(filename) {



            createGinaFile(filename, function onGinaFileCreated(err){

                if (err) {
                    throw err;
                    return false
                }
                // this is done to allow multiple calls of post_install.js
                var filename = _(self.path + '/SUCCESS');
                var installed = fs.existsSync( filename );
                if (!installed /**&& /node_modules\/gina/.test( new _(process.cwd()).toUnixStyle() ) */ ) {
                    fs.writeFileSync(filename, true )
                }

                // old NPM : < 3 & compatible 3+
                console.log('> now installing dependencies, please wait ...\n\r');
                var dependencies = require( _(self.path + '/package.json') ).ginaDependencies;

                // starting from NodeJS v5.x, it is done automatically
                npmInstall(dependencies);

            });
        }

        if (self.isWin32) {
            var appPath = _( self.path.substring(0, (self.path.length - ("node_modules/" + name + '/').length)) );
            var source = _(self.path + '/core/template/command/gina.bat.tpl');
            var target = _(appPath +'/'+ name + '.bat');
            if ( fs.existsSync(target) ) {
                fs.unlinkSync(target);
                // have to wait for windows to complete this
                setTimeout( function(){
                    utils.generator.createFileFromTemplateSync(source, target);
                    keepGoing(filename)
                }, 1000)
            } else {
                utils.generator.createFileFromTemplateSync(source, target);
                keepGoing(filename)
            }
        } else {
            filename += '.sh';// patch for latest npm release
            keepGoing(filename)
        }
    }


    var npmInstall = function(modules) {
        if ( modules.count() == 0 ) {
            console.log("\nGina's command line tool has been installed !\n");
            process.exit(0)
        }

        var cmd = ( isWin32() ) ? 'npm.cmd install' : 'npm install';
        var key = null;
        for (var m in modules) {
            key = m;
            if ( modules[m] != '') {
                cmd += ' '+ m +'@'+ modules[m];
                console.log('installing [ '+ m +'@'+ modules[m] +' ]');
            } else {
                cmd += ' '+ m + '@latest';
                console.log('installing [ '+ m + '@latest ]');
            }

            break
        }

        delete modules[key];

        if ( !fs.existsSync(self.path) ) {
            fs.mkdirSync(self.path)
        }

        if ( !fs.existsSync(self.path +'/node_modules') ) {
            fs.mkdirSync(self.path +'/node_modules')
        }

        if ( !fs.existsSync(self.path +'/tmp') ) {
            fs.mkdirSync(self.path +'/tmp')
        }

        //console.debug('cwd: ' + _(self.path));
        //console.debug('tmp: ' +  _(self.root +'/tmp'));

        run(cmd, { cwd: _(self.path), tmp: _(self.root +'/tmp')  })
            .onData(function(data){
                //console.info(data)
            })
            .onComplete( function done(err, data){
                if (err && err != 'false') {
                    console.error(err);
                    //console.debug('\nCommand was: \n'+ cmd)
                } //else {
                    //console.info(data);
                    //end()
                //}

                npmInstall(modules)
            })
    }

    var end = function() {
        // Update middleware file
        var filename = _(self.path) + '/MIDDLEWARE';
        var msg = "Gina's command line tool has been installed.\n\r";

        var deps = require(_(self.path) + '/package.json').dependecies;


        for (var d in deps) {
            if (d === 'express' && deps[d] != '') {
                var middleware = d +'@'+ deps[d]
            }
        }

        var expressPackage = _(self.path + '/node_modules/express/package.json');
        if ( typeof(middleware) == 'undefined' && fs.existsSync(expressPackage) ) {
            var middleware = require(expressPackage).version;
            middleware = 'express@' + middleware;
        } else if (typeof(middleware) == 'undefined') {
            throw new Error('No middleware found !!');
            process.exit(0)
        }

        if ( fs.existsSync(filename) ) { // update
            var def = fs.readFileSync(filename).toString;
            // TODO - uninstall old if installed ??
            if (def !== middleware) {

                try {

                    fs.writeFileSync(filename, middleware);
                    console.log(msg)
                } catch (err) {
                    throw new Error(err.stack||err.message||err);
                    process.exit(0)
                }

                // fs.writeFile(filename, middleware, function onWrote(err){
                //     if (err) {
                //         throw new Error(err.stack||err.message||err);
                //         process.exit(1)
                //     } else {
                //         console.log(msg)
                //     }
                // })
            } // else, nothing to do
        } else { // create

            try {

                fs.writeFileSync(filename, middleware);
                console.log(msg)
            } catch (err) {
                throw new Error(err.stack||err.message||err);
                process.exit(0)
            }

            // fs.writeFile(filename, middleware, function onWrote(err){
            //     if (err) {
            //         throw new Error(err.stack||err.message||err);
            //         process.exit(1)
            //     } else {
            //         console.log(msg)
            //     }
            // })
        }
    }

    //var createGinaHome = function() { };


    init()
};
new PostInstall()