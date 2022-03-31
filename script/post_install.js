/**
 * This file is part of the gina package.
 * Copyright (c) 2017 Rhinostone <contact@gina.io>
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
        self.isWin32 = isWin32();//getEnvVar('GINA_IS_WIN32');
        self.path = getEnvVar('GINA_FRAMEWORK');
        self.gina = getEnvVar('GINA_DIR');
        self.root = self.gina; // by default        
        self.isGlobalInstall = false;
        
        var args = process.argv, i = 0, len = args.length;
        for (; i < len; ++i) {
            if (args[i] == '-g' ) {
                self.isGlobalInstall = true;
                break;
            }
        }
        
        // var path = new _(process.env.PATH.split(':')[1]).toUnixStyle();
        // path = path.split('/');
        // var root = '';
        // for (var p = 0; p < path.length; ++p) {
        //     if (path[p] == 'node_modules') {
        //         root = root.substr(0, root.length-1);
        //         break
        //     }
        //     root += path[p] + '/'
        // }
        // self.root = root;
        
        

        
        console.debug('is this for Windows ? ' +  self.isWin32);
             
        

        if ( !self.isGlobalInstall ) { //global install
            self.root = process.cwd(); // project path
            console.error('local installation is not supported for this version at the moment.');
            console.info('please use `npm install -g gina`');
            process.exit(1);
        }
        
        
        console.debug('framework path: ' + self.gina);
        console.debug('framework version path: ' + self.path);
        console.debug('cwd path: ' + self.root );
        console.debug('this is a global install ...');
        
        createVersionFile(function onFileCreated(err) {
            if (err) {
                console.error(err.stack);
                process.exit(1);
            }
            createGinaFileForPlatform()
        })
         
    }

    var createVersionFile = function(callback) {
        //var location = (self.gina === process.cwd() ) ? self.gina : self.root;
        var version = require( _(self.gina + '/package.json') ).version;
        console.debug('writting version number: '+ version);
        
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
    
    var configureGina = function(callback) {
        // link to ./bin/cli to binaries dir
        // link to ./bin/cli-debug to binaries dir      
        if (!self.isWin32) {
            var binPath     = _('/usr/local/bin');
            var cli         = _(binPath +'/gina');
            var cliDebug    = _(binPath +'/gina-debug');
            
            if ( fs.existsSync(cli) ) {
                fs.unlinkSync(cli)
            }
            if ( fs.existsSync(cliDebug) ) {
                fs.unlinkSync(cliDebug)
            }
            
            var cmd = 'ln -s '+ self.gina +'/bin/cli '+ binPath +'/gina';
            console.debug('running: '+ cmd);
            run(cmd, { cwd: _(self.path), tmp: _(self.root +'/tmp'), outToProcessSTD: true })
                .onData(function(data){
                    console.info(data)
                })
                .onComplete( function done(err, data){
                    if (err) {
                        console.error(err);
                        console.warn('try to run : sudo ' + cmd);
                    }
                });
            
            cmd = 'ln -s '+ self.gina +'/bin/cli-debug '+ binPath +'/gina-debug';   
            run(cmd, { cwd: _(self.path), tmp: _(self.root +'/tmp'), outToProcessSTD: true })
                .onData(function(data){
                    console.info(data)
                })
                .onComplete( function done(err, data){
                    if (err) {
                        console.error(err);
                        console.warn('try to run : sudo ' + cmd);
                    }
                });
            
        } else {
            console.warn('linking gina binary is not supported yet for Windows.');
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
        console.info('linking to binaries dir ... ');
        if ( typeof(callback) != 'undefined') {
            if ( !self.isGlobalInstall ) { // local install only
                generator.createFileFromTemplate(source, target, function onGinaFileCreated(err) {
                    callback(err)
                    
                })
            } else {
                
                configureGina();
                callback(false)
            }
        } else {
            if ( !self.isGlobalInstall ) {
                generator.createFileFromTemplate(source, target)
            } else {
                
                configureGina();       
            }
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
                if (installed) {
                    fs.unlinkSync( filename );
                }
                
                // if ( /node_modules\/gina/.test( new _(process.cwd()).toUnixStyle() ) ) {
                //     var msg = "Gina's command line tool has been installed.";
                //     console.info(msg);
                //     process.exit(0)
                // } 
                
                console.debug('Writting '+ filename);
                fs.writeFileSync(filename, 'true' );
                
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

        run(cmd, { cwd: _(self.path), tmp: _(self.root +'/tmp'), outToProcessSTD: true })
            .onData(function onData(data){
                console.info(data)
            })
            .onComplete( function done(err, data){
                
                if (!err) {
                //    console.error(err)
                //} else {
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
        
        var version = require( _(self.gina + '/package.json') ).version;
        var middleware = 'isaac@'+version; // by default

        for (var d in deps) {
            if (d === 'express' && deps[d] != '') {
                middleware = d +'@'+ deps[d]
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
                    } else {
                        console.info(msg)
                    }
                })
            } // else, nothing to do
        } else { // create
            fs.writeFile(filename, middleware, function onWrote(err){
                if (err) {
                    throw new Error(err.stack||err.message||err);
                } else {
                    console.info(msg)
                }
            })
        }
    }

    init()
};
new PostInstall()