#!/usr/bin/env node
/*
 * This file is part of the geena package.
 * Copyright (c) 2013 Rhinostone <geena@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * Add to your ~/.batch_profile the following line
 *
 *  alias geena="/usr/local/bin/node geena $@"
 */

require('./node_modules/geena/node_modules/colors');

var Utils = require("geena").Utils;
Utils.log('Geena Command Line Tool \r\n'.rainbow);
Utils.Cmd.load(__dirname, "/node_modules/geena/package.json");