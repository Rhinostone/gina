/*
 * This file is part of the geena package.
 * Copyright (c) 2009-2013 Rhinostone <geena@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * Database.Couchbase Class
 *
 * @package    Gna
 * @author     Rhinostone
 */

var events = require('events'),
    utils = require('geena').utils,
    cb = require("couchbase"),
    Couchbase = {
        bucket : {},
        err : {},
        init : function(){
            
        },
        connect : function(){
            var _this = this;
            console.info("connecting......", Gna.Databases.conn);
            
            cb.connect(Gna.Databases.conn, function(err, bucket){
                _this.bucket = bucket;
                console.info("buuuuuuuket la kekette... ", _this.bucket);
                _this.err = err;
            });
        }
}
module.exports = Couchbase;