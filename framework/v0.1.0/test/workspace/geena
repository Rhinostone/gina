#!/usr/bin/env node
/*
 * This file is part of the geena package.
 * Copyright (c) 2014 Rhinostone <geena@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * Add to your ~/.batch_profile the following line
 *
 *  alias geena="/usr/local/bin/node geena $@"
 */

var fs = require('fs');

try {
    require('./node_modules/geena/node_modules/colors');
    var utils = require("./node_modules/geena/core/utils");
    var console = utils.logger;
    console.log('Geena Command Line Tool \r\n'.rainbow);
    utils.cmd.load(__dirname, "/node_modules/geena/package.json")
} catch (err) {
    console.error(err.stack)
}