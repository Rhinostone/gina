/*
 * This file is part of the geena package.
 * Copyright (c) 2014 Rhinostone <geena@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * @class Model.{Model}.Entity class
 *
 *
 * @package     Geena
 * @namespace   Geena.Model.{Model}
 * @author      Rhinostone <geena@rhinostone.com>
 * @api         Public
 */

var Entity = function(configuration){

    var _this = this;

    this.getConfig = function(){
        console.log("{Entity}Entity super ON !", configuration);
        return configuration;
    };

    this.getConnection = function(){
        return ( typeof(_this.conn) != 'undefined' ) ? _this.conn : null;
    }
};

module.exports = Entity;