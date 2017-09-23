/**
 * This file is part of the gina package.
 * Copyright (c) 2017 Rhinostone <gina@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */
var PostInstall;

//Imports
var fs      = require("fs");
//var utils   = require("./../core/utils");
var os      = require("os");


/**
 * Post install constructor
 * @constructor
 * */
PostInstall = function(){

    var self = this;

    //Initialize post installation scripts.
    var init = function() {};

    init()
};
new PostInstall()