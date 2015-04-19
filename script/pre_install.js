/**
 * This file is part of the gina package.
 * Copyright (c) 2014 Rhinostone <gina@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

var fs      = require('fs');
var os      = require('os');


var lib     = require('./lib');
var console = lib.logger;

/**
 * Pre install constructor
 * @constructor
 * */
function PreInstall() {
    var self = this;

    var init = function() {
        self.isWin32 = getEnvVar('GINA_IS_WIN32');
        self.path = getEnvVar('GINA_FRAMEWORK');
        self.gina = getEnvVar('GINA_DIR');

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