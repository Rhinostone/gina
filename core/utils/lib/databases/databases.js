/*
 * This file is part of the geena package.
 * Copyright (c) 2009-2013 Rhinostone <geena@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * Database Class
 *
 * @package    Gna
 * @author     Rhinostone
 */

var cb = require("couchbase"),
    Databases = {
        drvier : {},
        driverStr : "",
        conn : "",
        conf : {},
        cb : {},
        bucket : {},
        supported : ["couchbase2.0"],
        init : function (){
            var _this = this;
            this.driverStr = (typeof(this.driverStr) != 'undefined')
                            ? this.driverStr
                            : 'couchbase2.0';
        },
        onDatabasesReady: function(callback){
            var conn = this.setDriver();
            var c ={
                "cb" : cb,
                "conn" : conn
            };
            callback(c);
        },
        hasSuportedDriver : function(){

            var supported = this.supported.inArray(this.driverStr);
            console.info(typeof(supported), "is driver supported ?", supported);
            if(!supported){
                this.parent.Server.log({
                    "error" : {
                        "code" : "50",
                        "message" : "DATABASES:ERR:50"
                    }
                });
            }
            return supported;
        },

        setDriver : function(){
            var Server = this.parent.Server;
            var env = Server.conf.env,
                driver = "",
                conn = "",
                error = "";

            try{
                driver = Server.conf.databases[Server.appName][env].driver;
                conn = Server.conf.databases[Server.appName][env].connection;
            }catch(err){
                driver = Server.conf.databases[Server.appName]["all"].driver;
                conn = Server.conf.databases[Server.appName]["all"].connection;
            }

            if(driver){
                //console.info(".....oh.... ?", driver.driver, 'app name ...');
                //console.info('found driver ', driver, conn);
                this.driver = driver;
                this.conn = conn;
                this.driverStr = driver.name + driver.version;
                return conn;
            }

            error = "could not set driver";
            return error;

        },
        connect : function(conn, callback){
            return null, "tata";
        }
};

Databases.supported.inArray = function(k){

    for(i in this){
        console.info(this[i], "..vs..", k);
        if(this[i] == k){
            return true;
        }
    }
    return false;
};
module.exports = Databases;