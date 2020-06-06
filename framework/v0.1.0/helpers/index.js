/*
 * This file is part of the gina package.
 * Copyright (c) 2016 Rhinostone <gina@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

var fs = require('fs');
/**
 * @module Helpers
 *
 * Gina Utils Helpers
 *
 * @package     Gina.Utils
 * @namespace   Gina.Utils.Helpers
 * @author      Rhinostone <gina@rhinostone.com>
 */
var _require = function(path) {
    var cacheless = (process.env.IS_CACHELESS == 'false') ? false : true;
    if ( cacheless && !/context/.test(path) ) { // all but the context
        try {
            delete require.cache[require.resolve(path)];
            return require(path)
        } catch (err) {
            throw err;
        }

    } else {
        return require(path)
    }
};


var helpers         = {}
    , path          = __dirname
    , files         = fs.readdirSync(path)
    , f             = 0
    , len           = files.length
    , helper        = ''
    , amdDefined    = []
;

var PrototypesHelper = null;
for (; f < len; ++f) {            
    if ( ! /^\./.test(files[f]) && files[f] != 'index.js') {
        helper          = files[f].replace(/.js/, '');
        if (helper == 'prototypes') {
            PrototypesHelper = _require('./' + helper);
            continue;
        }
        helpers[helper] = _require('./' + helper)();
    }
}

new PrototypesHelper({
    dateFormat: helpers.dateFormat
});

// Publish as node.js module
module.exports = helpers;
