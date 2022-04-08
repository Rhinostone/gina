/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2022 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

//Imports.
var fs          = require('fs');
var util        = require('util');
var promisify   = util.promisify;
const { execSync } = require('child_process');

var scriptPath = __dirname;
var ginaPath = (scriptPath.replace(/\\/g, '/')).replace('/script', '');
var help        = require(ginaPath + '/utils/helper.js');
var pack        = ginaPath + '/package.json';
pack =  (isWin32()) ? pack.replace(/\//g, '\\') : pack;

var helpers     = null;
var lib         = null;
/**
 * PrepareVersion constructor
 * 
 * NB.: this script can only be executed on Mac OS X or on Linux distributions
 * 
 * if you need to test, go to gina main folder
 * $ node --inspect-brk=5858 ./script/prepare_version.js -g
 *  or if you are calling `npm publish` or `npm publish --dry-run`
 * $ node --inspect-brk=5858 /usr/local/bin/npm publish --dry-run
 * 
 * @constructor
 * */
function PrepareVersion() {
    var self    = {};
    var lib     = null;

    
    /**
     * Bebin Checking - Will run checking tasks in order of declaration
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
        
        // to handle sync vs async to allow execution in order of declarations
        if (funct) {
            eval('async function on'+functName+'(){ await promisify('+ funct + ')().catch(function(e){ console.error(e)}).then(function(){ begin('+(i+1)+')});}; on'+functName+'();');            
        }          
    }

    var init = function() {
        self.isWin32 = isWin32();
        begin(0);
    };
    
    
    self.getSelectedVersion = async function(done) {
        var homeDir = getUserHome() || null;
        // try {
        //     homeDir = execSync('echo $HOME').toString();
        // } catch(err) {}
        
        if (!homeDir) {
            console.error('No $HOME path found !');
            process.exit(-1);
        }
        
        var ginaHomeDir = homeDir.replace(/\n/g, '') + '/.gina';
        setEnvVar('GINA_HOMEDIR', ginaHomeDir);
        
        console.debug('GINA_HOMEDIR: ', ginaHomeDir);
        console.debug('isWin32: ', isWin32());
        
        var mainConfigPath = ginaHomeDir +'/main.json';
        var mainConfig = require(mainConfigPath);
        var package = require(pack);
        var selectedVersion = mainConfig.def_framework;
        self.selectedVersion = selectedVersion;
        var targetedVersion = package.version;
        self. targetedVersion = targetedVersion;
        
        console.debug('selected version : ', selectedVersion);
        console.debug('targeted version : ', targetedVersion);
        if ( 
            selectedVersion !== targetedVersion
            //&& selectedVersion < targetedVersion 
        ) {
            
            
            // update selected version
            var shortVersion = targetedVersion.split('.');
            shortVersion.splice(2);
            shortVersion = shortVersion.join('.');
            if ( typeof(mainConfig.frameworks[shortVersion]) == 'undefined' ) {
                mainConfig.frameworks[shortVersion] = [];
                // create settings.json for the new version
                
            }
            if ( mainConfig.frameworks[shortVersion].indexOf(targetedVersion) < 0 ) {
                mainConfig.frameworks[shortVersion].push(targetedVersion)
            }
            
            
            var settingsConfigPath  = ginaHomeDir+'/'+shortVersion+'/settings.json';
            var settingsConfig      = require(settingsConfigPath);
            
            // setting def_framework
            mainConfig.def_framework    = targetedVersion;            
            settingsConfig.version      = targetedVersion;
            
                       
            
            var ginaPath            = settingsConfig.dir;            
            // backup of folder version to archives
            var frameworkPath       =  ginaPath +'/framework/v'+selectedVersion;
            
            // setting up requirements 
            helpers     = require(frameworkPath +'/helpers');
            lib         = require(frameworkPath +'/lib');
            
            
            // console.debug('mainConfig: ', JSON.stringify(mainConfig, null, 2));
            // console.debug('settingsConfig: ', JSON.stringify(settingsConfig, null, 2));
            
            // saving local config
            lib.generator.createFileFromDataSync(JSON.stringify(mainConfig, null, 2), mainConfigPath);
            lib.generator.createFileFromDataSync(JSON.stringify(settingsConfig, null, 2), settingsConfigPath);
            
            
            var frameworkPathObj    =  new _(frameworkPath, true);
            console.debug('source path is: '+ frameworkPath);
            
            var destination = _(ginaHomeDir +'/archives/framework/v'+selectedVersion, true);
            if ( new _(destination).existsSync() ) {
                new _(destination).rmSync();
            }
            var err = false;
            
            // since we cannot yet promissify directly PathObject.cp()
            var f = function(destination, cb) {
                frameworkPathObj.cp(destination, cb);
            };            
            await promisify(f)(destination)  
                .catch( function onCopyError(_err) {
                    err = _err;
                })
                .then( function onCopy(_destination) {
                    console.debug('Copy to '+ _destination +': done');
                });
            
            if (err) {
                throw err;
            }
            
            // rename folder version
            destination = _(ginaPath +'/framework/v'+targetedVersion, true);
            frameworkPathObj.renameSync(destination);
            
            
            // updating requirements
            self.selectedVersion = targetedVersion;
            self.frameworkPath = frameworkPath = ginaPath +'/framework/v'+targetedVersion;
            helpers             = require(frameworkPath +'/helpers');
            lib                 = require(frameworkPath +'/lib');            
        }
        
        done()
    };
    
    self.updateVersionIfNeeded = function(done) {
        
        var version = self.selectedVersion.replace(/^[a-z]+/ig, '');
        var versionFilePath = _(self.frameworkPath +'/VERSION', true);
        var versionFilePathObj = new _(versionFilePath);
        if ( versionFilePathObj.existsSync() ) {
            // read & compare version
            var inFileVersion = fs.readFileSync(versionFilePath).toString();
            if ( inFileVersion == version ) {
                // nothing to do then
                return done();
            }
            versionFilePathObj.rmSync()
        }
        
        console.debug('updating version ...');              
        lib.generator.createFileFromDataSync(version, versionFilePath);
        
        done();
    }
    
    self.updateMiddlewareIfNeeded = function(done) {
        var version = self.selectedVersion.replace(/^[a-z]+/ig, '');
        var middleware = 'isaac@'+version; // by default
        var deps = require(_(self.frameworkPath, true) + '/package.json').dependecies;
        for (let d in deps) {
            if (d === 'express' && deps[d] != '') {
                middleware = d +'@'+ deps[d]
            }
        }
        var expressPackage = _(self.path + '/node_modules/express/package.json', true);
        if ( typeof(middleware) == 'undefined' && new _(expressPackage).existsSync() ) {
            middleware = require(expressPackage).version;
            middleware = 'express@' + middleware;
        } else if (typeof(middleware) == 'undefined') {
            throw new Error('No middleware found !!');
        }
        
        var middlewareFilePath = _(self.frameworkPath +'/MIDDLEWARE', true);
        var middlewareFilePathObj = new _(middlewareFilePath);
        if ( middlewareFilePathObj.existsSync() ) {
            // read & compare middleware
            var inFileMiddleware = fs.readFileSync(middlewareFilePath).toString();
            if ( inFileMiddleware == middleware ) {
                // nothing to do then
                return done();
            }
            middlewareFilePathObj.rmSync()
        }
        
        console.debug('updating middleware ...');        
        lib.generator.createFileFromDataSync(middleware, middlewareFilePath);
        
        done();
    };
    
    
    // self.pushingToGit = function(done) {
    //     var version = self.selectedVersion.replace(/^[a-z]+/ig, '');
        
    //     // git add --all
    //     // git commit -m'Packaging version v'+ version
        
        
    //     // create new branch if needed
    //     // e.g: 0.1.0-alpha.1 -> 010-alpha1
    //     var branch = version.replace(/\./g, '');
        
        
    //     // push to branh        
    //     console.debug('pushing to git');
        
    //     done()
    // }
    
    /**
     * Write version number in the VERSION file
     * */
    // self.setVersion = function() {
    //     console.info('setting version number ...');
    //     try {
    //         var version = require( _(self.path + 'package.json') ).version;
    //         var path = _(self.path + 'VERSION');
    //         fs.writeFileSync(path, version)
    //     } catch (err) {
    //         console.error(err.stack)
    //     }
    //     done();
    // };

    init()
};

new PrepareVersion()