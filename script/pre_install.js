/**
 * This file is part of the gina package.
 * Copyright (c) 2014 Rhinostone <gina@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

var fs      = require('fs');
var os      = require("os");
/**
 * Pre install constructor
 * @constructor
 * */
function PreInstall() {
    var self = this;

    var init = function() {
        self.isWin32 = ( os.platform() == 'win32' ) ? true : false;
        self.path = __dirname.substring(0, (__dirname.length - 'script'.length));

        setDefaultMiddleware()
    }

    var setDefaultMiddleware = function() {
        var key = '--middleware=', file = 'MIDDLEWARE';
        // default middleware;
        var middleware = 'express@3.x';

        var arg = process.argv;
        //getting option
        for (var i=0; i<arg.length; ++i) {
            if (arg[i].indexOf(key) > -1) {
                middleware = (arg[i].split(/=/)[1])
            }
        }

        var filename = self.path +'/'+ file;
        //default middleware from file
        if ( fs.existsSync(filename) ) { // update
            var def = fs.readFileSync(filename).toString;
            // TODO - uninstall it if installed ??
            if (def !== middleware) {
                fs.writeFile(filename, middleware, function onWrote(err){
                    if (err) {
                        throw new Error(err.stack||err.message||err);
                        process.exit(1)
                    }
                    //updade package.json too !
                    updatePackage(middleware)
                });
            } // else, nothing to do
        } else { // create
            fs.writeFile(filename, middleware, function onWrote(err){
                if (err) {
                    throw new Error(err.stack||err.message||err);
                    process.exit(1)
                }
                //updade package.json too !
                updatePackage(middleware)
            });
        }
    }

    var updatePackage = function(middleware) {
        var m = middleware.split(/\@/);
        var dep = m[0], val = m[1];
        var filename = self.path +'/package.json';

        try {
            var content = require(filename);
            //TODO - remove all other supported middlewares lsitied in package.json
            content.dependencies[dep] = val;
            fs.writeFileSync(filename, JSON.stringify(content, null, 2) );
        } catch(err) {
            throw new Error(err.stack||err.message||err);
            process.exit(1)
        }

        return true
    }

    init()
};

new PreInstall()