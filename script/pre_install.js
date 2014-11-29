/**
 * This file is part of the gina package.
 * Copyright (c) 2014 Rhinostone <gina@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

var fs      = require('fs');
var os      = require('os');
var utils   = require('./../core/utils');
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

    }
    // this is done to allow multiple calls of post_install.js
    //if ( /node_modules\/gina/.test( new _(process.cwd()).toUnixStyle() ) ) {
    //    process.exit(0)
    //} else {
    //  ...
    //}

    init()
};

new PreInstall()