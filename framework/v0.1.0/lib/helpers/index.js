/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2014 Rhinostone <gina@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * @module Helpers
 *
 * Gina Utils Helpers
 *
 * @package     Gina.Utils
 * @namespace   Gina.Utils.Helpers
 * @author      Rhinostone <gina@rhinostone.com>
 */

var Helpers = {
        //DateTime    : require('./time')(),
        //Form        : require('./form')(),
        //I18n        : require('./i18n')(),
        path        : require('./path')(),
        context     : require('./context')(),
        text        : require('./text')(),
        task        : require('./task')()
};

die = function(){
    process.exit(42);
};
module.exports = Helpers;