/**
 * This file is part of the gina package.
 * Copyright (c) 2016 Rhinostone <gina@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */
process.env.IS_SCRIPT_MODE = true;
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
 * Pre install constructor
 * @constructor
 * */
function PreInstall() {
    var self = this;

    var init = function() {
        self.isWin32 = ( os.platform() == 'win32' ) ? true : false;
        self.path = __dirname.substring(0, (__dirname.length - 'script'.length));

        console.debug('paths -> '+ self.path);

        if ( hasNodeModulesSync() ) { // cleaining old
            var target = new _(self.path + '/node_modules');
            console.debug('replacing: ', target.toString() );
            var err = target.rmSync();
            if (err instanceof Error) {
                throw err;
                process.exit(1)
            }

            fs.mkdirSync(_(self.path) + '/node_modules');
        }

    }

    var hasNodeModulesSync = function() {
        return fs.existsSync( _(self.path + '/node_modules') )
    }
    // compare with post_install.js if you want to use this
    //var filename = _(self.path + '/SUCCESS');
    //var installed = fs.existsSync( filename );
    //if (installed && /node_modules\/gina/.test( new _(process.cwd()).toUnixStyle() ) ) {
    //    process.exit(0)
    //} else  {
    //    fs.writeFileSync(filename, true );
    //}
    // ...

    init()
};

new PreInstall()