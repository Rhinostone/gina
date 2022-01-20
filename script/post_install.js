/**
 * This file is part of the gina package.
 * Copyright (c) 2017 Rhinostone <gina@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

//Imports
var fs      = require('fs');

var lib         = require('./lib');
var console     = lib.logger;
var generator   = lib.generator;




/**
 * Post install constructor
 * @constructor
 * */
function PostInstall() {

    var self = this;

    //Initialize post installation scripts.
    var init = function() {
        self.isWin32 = GINA_IS_WIN32;
        self.path = GINA_FRAMEWORK;
        self.gina = GINA_DIR;
        var path = new _(process.env.PATH.split(':')[1]).toUnixStyle();
        path = path.split('/');

        var root = null;
        for (var p = 0; p < path.length; ++p) {
            if (path[p] == 'node_modules') {
                root = root.substr(0, root.length-1);
                break
            }
            root += path[p] + '/'
        }
        self.root = root;


        console.log('project ',  self.root, ' VS ', process.cwd());

        console.debug('framework path: ' + GINA_FRAMEWORK);

        if ( self.root === process.cwd() ) { //local install
            createVersionFile(function onFileCreated(err) {
                if (err) {
                    console.error(err.stack)
                }
                createGinaFileForPlatform()
            })
        } else {

        }
    }

    var createVersionFile = function(callback) {
        var version = require( _(self.path + '/package.json') ).version;
        var target = _(self.path + '/VERSION');
        try {
            if ( fs.existsSync(target) ) {
                fs.unlinkSync(target)
            }
            fs.writeFileSync(target, version);
            callback(false)
        } catch(err) {
            callback(err)
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
            generator.createFileFromTemplate(source, target, function onGinaFileCreated(err) {
                callback(err)
            })
        } else {
            generator.createFileFromTemplate(source, target)
        }
    }

    var createGinaFileForPlatform = function() {
        console.info('creating platform file');
        var name = require( _(self.path + '/package.json') ).name;

        var filename = ( (self.isWin32) ? '.' : '' ) + name;

        var keepGoing = function(filename) {

            createGinaFile(filename, function onFileCreated(err) {
                if (err) console.error(err.stack);

                // this is done to allow multiple calls of post_install.js
                var filename = _(self.path + '/SUCCESS');
                var installed = fs.existsSync( filename );
                if (installed && /node_modules\/gina/.test( new _(process.cwd()).toUnixStyle() ) ) {
                    var msg = "Gina's command line tool has been installed.";
                    console.info(msg);
                    process.exit(0)
                } else  {
                    fs.writeFileSync(filename, true );
                }
                // do something that can be called after the first time installation


                // Check if npm install has been done
                if ( !hasNodeModulesSync() ) {
                    npmInstall()
                } else {
                    var target = new _(self.path + '/node_modules');
                    console.debug('replacing: ', target.toString() );
                    target
                        .rm( function(err) {
                            if (err) {
                                console.error(err.stack);
                                process.exit(1)
                            } else {
                                npmInstall()
                            }
                        })
                }

            })
        }

        if (self.isWin32) {
            var appPath = _( self.path.substring(0, (self.path.length - ("node_modules/" + name + '/').length)) );
            var source = _(self.path + '/core/template/command/gina.bat.tpl');
            var target = _(appPath +'/'+ name + '.bat');
            if ( fs.existsSync(target) ) {
                fs.unlinkSync(target);
                // have to wait for windows to complete this
                setTimeout( function(){
                    generator.createFileFromTemplate(source, target);
                    keepGoing(filename)
                }, 1000)
            } else {
                generator.createFileFromTemplate(source, target);
                keepGoing(filename)
            }

        } else {
            keepGoing(filename)
        }



    }

    var hasNodeModulesSync = function() {
        return fs.existsSync( _(self.path + '/node_modules') )
    }



    var npmInstall = function() {
        console.info('now installing modules: please, wait ...');
        var cmd = ( isWin32() ) ? 'npm.cmd install' : 'npm install';

        run(cmd, { cwd: _(self.path), tmp: _(self.root +'/tmp')  })
            .onData(function(data){
                console.info(data)
            })
            .onComplete( function done(err, data){
                if (err) {
                    console.error(err)
                } else {
                    //console.info(data);
                    end()
                }
            })
    }

    var end = function() {
        // Update middleware file
        var filename = _(self.path) + '/MIDDLEWARE';
        var msg = "Gina's command line tool has been installed.";

        var deps = require(_(self.path) + '/package.json').dependecies;


        for (var d in deps) {
            if (d === 'express' && deps[d] != '') {
                var middleware = d +'@'+ deps[d]
            }
        }

        var expressPackage = _(self.path + '/node_modules/express/package.json');
        if ( typeof(middleware) == 'undefined' && fs.existsSync(expressPackage) ) {
            middleware = require(expressPackage).version;
            middleware = 'express@' + middleware;
        } else if (typeof(middleware) == 'undefined') {
            throw new Error('No middleware found !!');
            //process.exit(1)
        }

        if ( fs.existsSync(filename) ) { // update
            var def = fs.readFileSync(filename).toString;
            // TODO - uninstall old if installed ??
            if (def !== middleware) {
                fs.writeFile(filename, middleware, function onWrote(err){
                    if (err) {
                        throw new Error(err.stack||err.message||err);
                        //process.exit(1)
                    } else {
                        console.info(msg)
                    }
                })
            } // else, nothing to do
        } else { // create
            fs.writeFile(filename, middleware, function onWrote(err){
                if (err) {
                    throw new Error(err.stack||err.message||err);
                    //process.exit(1)
                } else {
                    console.info(msg)
                }
            })
        }
    }

    init()
};
new PostInstall()