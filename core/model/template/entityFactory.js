/*
 * This file is part of the geena package.
 * Copyright (c) 2013 Rhinostone <geena@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * @class Model.{Model}.{Entity}Entity class
 *
 *
 * @package     Geena
 * @namespace   Geena.Model.{Model}
 * @author      Rhinostone <geena@rhinostone.com>
 * @api         Public
 */

var {Entity}Entity = function(configuration){

    var _this = this;

    this.getConfig = function(){
        console.log("{Entity}Entity super ON !", configuration);
        return configuration;
    };
};

module.exports = {Entity}Entity;