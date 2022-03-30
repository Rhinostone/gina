/**
 * This file is part of the gina package.
 * Copyright (c) 2017 Rhinostone <gina@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

var fs          = require('fs');
var util        = require('util');
var promisify   = util.promisify;
const { execSync } = require('child_process');

var lib         = require('./lib');
var console     = lib.logger;
//var generator   = lib.generator;

/**
 * Pre install constructor
 * 
 * if you need to test, go to gina main folder
 * $ node --inspect-brk=5858 ./script/pre_install.js -g
 * 
 * @constructor
 * */
function PreInstall() {
    var self = this;

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
        
        setupPermissions()
        // TODO check old framework version to be archived
    }
    
    
    /**
     * setup permissions
     * https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally
     */
    var setupPermissions = async function() {
        if ( /true/i.test(self.isWin32) ) {
            return;
        }
        // create a directory for global installations
        var npmGlobalPath = getUserHome() + '/.npm-global';
        
        console.info('Setting npm global path : '+ npmGlobalPath +' '+ new _(npmGlobalPath).existsSync() );
        var npmGlobalPathObj = new _(npmGlobalPath);
        if ( !npmGlobalPathObj.existsSync() ) {
            npmGlobalPathObj.mkdirSync()
        }
        // from `/usr/local` -> `~/.npm-global`
        var cmd = 'npm config set prefix '+ getUserHome() +'/.npm-global';
        await promisify(run)(cmd, { cwd: _(self.path), tmp: _(self.root +'/tmp'), outToProcessSTD: true })
            .catch(function done(err){
                if (err) {
                    console.error(err);
                    console.warn('try to run : sudo ' + cmd);
                    return;
                }
            });
        
        var profilePath = getUserHome() + '/.profile';
        var profilePathObj = new _(profilePath);
        if ( !profilePathObj.existsSync() ) {
            cmd = 'touch '+ profilePath;
            await promisify(run)(cmd, { cwd: _(self.path), tmp: _(self.root +'/tmp'), outToProcessSTD: true })
                .catch(function done(err){
                    if (err) {
                        console.error(err);
                        console.warn('try to run : sudo ' + cmd);
                        return;
                    }
                });
        }
                
        var inFile = null;
        try {
            inFile = execSync("cat ~/.profile | grep .npm-global/bin").toString();
        } catch (err) {
            // nothing to do
        }
        
        if (!inFile) {
            inFile = "\n# set PATH so it includes user‘s private npm bin if exists"
            inFile += '\nif [ -d "$HOME/.npm-global/bin" ]; then';
            inFile += '\n    PATH="$HOME/.npm-global/bin:$PATH"';
            inFile += '\nfi\n';
            try {
                fs.appendFileSync( getUserHome()+'/.profile', inFile );
            } catch (err) {
                console.error(err.stack||err.message||err);
                return;
            }
            inFile = null;
            
            // we need to source/update ~/.profile
            try {
                execSync("source "+ profilePath);
            } catch (err) {
                console.error(err.stack||err.message||err);
            }            
        }
    }

    init()
};

new PreInstall()