/**
 * This file is part of the gina package.
 * Copyright (c) 2017 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

//Imports
var fs      = require('fs');
var util        = require('util');
var promisify   = util.promisify;
const { execSync } = require('child_process');

var lib         = require('./lib');
var console     = lib.logger;




/**
 * Post install constructor
 * @constructor
 * */
function PostInstall() {

    var self = {}, _this = this;

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
        
        console.debug('Is this for Windows ? ' +  self.isWin32);

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
        
        begin(0);         
    }
    
    /**
     * Bebin - Will run checking tasks in order of declaration
     * */
     var begin = async function(i) {
        //console.debug('i is ', i);
        var n = 0, funct = null, functName = null;
        for (let t in self) {            
            if ( typeof(self[t]) == 'function') {
                if (n == i){
                    //let func = 'self.' + t + '()';
                    let func = 'self.' + t;
                    console.debug('Running [ ' + func + '() ]');
                    funct       = func;
                    functName   = t;
                    break;
                }                
                n++;
            }
        }
        
        // to handle sync vs async to allow execution in order of declaration
        if (funct) {
            eval('async function on'+functName+'(){ await promisify('+ funct + ')().catch(function(e){ console.error(e); process.exit(-1);}).then(function(){ begin('+(i+1)+')});}; on'+functName+'();');            
        }          
    }    
    

    self.createVersionFile = function(done) {        
        var version = require( _(self.gina + '/package.json') ).version;
        console.debug('writting version number: '+ version);
        
        var target = _(self.path + '/VERSION');
        try {
            if ( fs.existsSync(target) ) {
                fs.unlinkSync(target)
            }
            fs.writeFileSync(target, version);
        } catch(err) {
            return done(err)
        }
        
        done();
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
                .onComplete( function onDone(err, data){
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
                .onComplete( function onDone(err, data){
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
                lib.generator.createFileFromTemplate(source, target, function onGinaFileCreated(err) {
                    callback(err)
                    
                })
            } else {
                
                configureGina();
                callback(false)
            }
        } else {
            if ( !self.isGlobalInstall ) {
                lib.generator.createFileFromTemplate(source, target)
            } else {
                
                configureGina();       
            }
        }
    }

    self.createGinaFileForPlatform = async function(done) {
        console.info('Creating platform file');
        var name = require( _(self.path + '/package.json') ).name;

        var filename = ( (self.isWin32) ? '.' : '' ) + name;

        var keepGoing = function(filename) {

            createGinaFile(filename, function onFileCreated(err) {
                if (err) {
                    return done(err)
                }

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
                    return npmInstall(done)
                } else {
                    var target = new _(self.path + '/node_modules');
                    console.debug('replacing: ', target.toString() );
                    return target
                        .rm( function onRemove(err) {
                            if (err) {
                                return done(err);
                            } else {
                                return npmInstall(done)
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
                setTimeout( async function(){
                    lib.generator.createFileFromTemplate(source, target);
                    await keepGoing(filename)
                }, 1000)
            } else {
                lib.generator.createFileFromTemplate(source, target);
                await keepGoing(filename)
            }

        } else {
            await keepGoing(filename)
        }
    }

    var hasNodeModulesSync = function() {
        return fs.existsSync( _(self.path + '/node_modules') )
    }



    var npmInstall = function(done) {
        console.info('now installing modules: please, wait ...');
        var cmd = ( isWin32() ) ? 'npm.cmd install' : 'npm install';

        run(cmd, { cwd: _(self.path), tmp: _(self.root +'/tmp'), outToProcessSTD: true })
            .onData(function onData(data){
                console.info(data)
            })
            .onComplete( function onDone(err, data){                
                if (!err) {
                    return done()
                }
                done(err)
            })
    }
    
    self.cleanupIfNeeded = function(done) {
        
        var frameworkPath = self.gina;
        console.debug('Framework path is: ' + frameworkPath);
        
        // Let's cleanup `colors` from `GINA_DIR`
        if ( new _(frameworkPath +'/node_modules/colors', true).existsSync() ) {
            var initialDir = process.cwd();    
            process.chdir(frameworkPath);
            var cmd = ( isWin32() ) ? 'npm.cmd rm colors' : 'npm rm colors';
            try {
                execSync(cmd);
                console.debug('Removed default `colors` module from `GINA_DIR`... This is normal ;)');
            } catch (npmErr) {
                return done(npmErr);
            }
            
             
            process.chdir(initialDir);
        }
        
        done()
    }

    self.end = function(done) {
        // Update middleware file
        var filename = _(self.path) + '/MIDDLEWARE';
        var msg = "Gina's command line tool has been installed.";

        var deps = require(_(self.path) + '/package.json').dependecies;
        
        var version = require( _(self.gina + '/package.json') ).version;
        var middleware = 'isaac@'+version; // by default

        for (let d in deps) {
            if (d === 'express' && deps[d] != '') {
                middleware = d +'@'+ deps[d]
            }
        }

        var expressPackage = _(self.path + '/node_modules/express/package.json');
        if ( typeof(middleware) == 'undefined' && fs.existsSync(expressPackage) ) {
            middleware = require(expressPackage).version;
            middleware = 'express@' + middleware;
        } else if (typeof(middleware) == 'undefined') {
            return done( new Error('No middleware found !!') );
        }

        if ( fs.existsSync(filename) ) { // update
            var def = fs.readFileSync(filename).toString;
            // TODO - uninstall old if installed ??
            if (def !== middleware) {
                fs.writeFile(filename, middleware, function onWrote(err){
                    if (err) {
                        return done(err)
                    }
                    console.info(msg);
                    done()
                })
            } // else, nothing to do
        } else { // create
            fs.writeFile(filename, middleware, function onWrote(err){
                if (err) {
                    return done(err)
                }
                console.info(msg);
                done()
            })
        }
    }

    init()
}
new PostInstall()