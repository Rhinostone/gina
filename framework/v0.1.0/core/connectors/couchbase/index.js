// Imports.
var fs              = require('fs');
var lib             = require('./../../../lib') || require.cache[require.resolve('./../../../lib')];
var inherits        = lib.inherits;
var merge           = lib.merge;
var console         = lib.logger;
//var helpers         = require('./../../../helpers') || require.cache[require.resolve('./../../../helpers')];
//var modelUtil       = new utils.Model();
// var bundle      = getContext().bundle;
// var config      = getContext('gina').config;
// var env         = config.env;
// var conf        = config.Env.getConf( bundle, env);

/**
 * Couchbase Class
 *
 * @package     Freelancer.CoreAPI
 * @author      Rhinostone
 */

function Couchbase(conn, infos) {
    var EntitySuperClass = null, EntityN1qlClass = null;
    /**
     * Init
     * @constructor
     * */
    var init = function(conn, infos) {
        // load on startup
        var cacheless           = (process.env.IS_CACHELESS == 'false') ? false : true;
        var path                = getPath('bundle') + '/models/'+ infos.database +'/entities'
            , n1qlDefault       = __dirname + '/lib'
            , files             = fs.readdirSync(path)
            , entities          = {}
            , entityName        = ''
            , Entity            = null
            , className         = null
            , filename          = null
        ;


        // superEntity
        filename = getPath('gina').core + '/model/entity.js';
        if (cacheless)
            delete require.cache[_(filename, true)]; //EntitySuperClass

        EntitySuperClass = require(_(filename, true));


        // first one for the N1QL queries without entity ( check `/lib/n1ql.js` )
        files.unshift('n1ql.js');
        for (var f = 0, len = files.length; f < len; ++f) {

            if ( ! /^\./.test(files[f]) || f == len-1 ) {

                if (cacheless && files[f] != 'n1ql.js') {
                    delete require.cache[_(path + '/' +files[f], true)];//child
                }

                entityName      = files[f].replace(/.js/, '');
                className       = entityName.substr(0,1).toUpperCase() + entityName.substr(1);

                if ( files[f] == 'n1ql.js' ) {
                    Entity = require(_(n1qlDefault + '/' +files[f], true));
                    EntityN1qlClass = Entity
                } else {
                    Entity = require(_(path + '/' +files[f], true));

                    Entity = inherits(Entity, EntitySuperClass);

                    Entity.prototype.name           = className;
                    Entity.prototype.model          = infos.model;
                    Entity.prototype.bundle         = infos.bundle;
                    Entity.prototype.database       = infos.database;
                    Entity.prototype._collection    = entityName;
                    Entity.prototype._filename      = _(path + '/' +files[f], true);

                    // extra CRUD methods
                    Entity.prototype.bulkInsert     = bulkInsert;


                    entities[className] = Entity
                }
            }
        }


        // loading N1QL
        var dir = _( getPath('bundle') + '/models/'+ infos.database +'/n1ql' );
        if ( fs.existsSync(dir) ) {
            f           = 0;
            files       = fs.readdirSync(dir);
            filename    = null;
            len         = files.length;


            for(; f<files.length; ++f) {
                filename    = _(dir +'/'+ files[f]);
                loadN1QL(entities, filename)
            }
        }
        
        return entities
    };

    var loadN1QL = function(entities, filename) {

        if ( fs.statSync(filename).isDirectory() ) {
            var files           = fs.readdirSync(filename)
                , f             = 0
                , arr           = filename.split(/\//g)
                , entityName    = arr[arr.length-1];

            entityName = entityName.charAt(0).toUpperCase() + entityName.slice(1);

            for (; f < files.length; ++f) {
                readSource(entities, entityName, filename + '/' + files[f])
            }

        } else {
            var arr             = filename.split(/\//g)
                , entityName    =  arr[arr.length-1].replace(/\.sql/, '').split(/\_/)[0];

            entityName = entityName.charAt(0).toUpperCase() + entityName.slice(1);

            readSource(entities, entityName, filename)
        }
    }

    var readSource = function (entities, entityName, source) {
        var arr             = source.split(/\//g)
            , name          = arr[arr.length-1].replace(/\.sql/, '') || null
            , comments      = ''
            , queryString   = null
            , params        = []
            , inlineParams  = [] // order of use inside the query
            , returnType    = null // Array or Object : Array by default
            , returnVariable= null // return variable
        ;


        if (! /^\./.test(source) && name && typeof(conn[name]) == 'undefined' ) {

            queryString = fs.readFileSync( source ).toString().replace(/\n/g, ' ');
            // extract comments
            comments    = queryString.match(/(\/\*([^*]|[\r\n]|(\*+([^*\/]|[\r\n])))*\*+\/)|(\/\/.*)/g);
            // extract return type
            returnType  = queryString.match(/\@return\s+\{(.*)\}/);
            if ( Array.isArray(returnType) ) {
                returnType = returnType[1]
            }/** else {
                returnType = null
            }*/

            params          = comments[0].match(/\$\w+/g); // param list from comments
            queryString     = queryString.replace(comments[0], '');
            inlineParams    = queryString.match(/\$\w+/g);
            // getting rid of duplicated
            if ( typeof(Set) == 'function' ) { // ES6
                inlineParams = Array.from(new Set(inlineParams))
            } else { // ES5 + gina
                inlineParams = Array.from(inlineParams)
            }

            try {

                if ( typeof(entities[entityName]) == 'undefined' ) {

                    entities[entityName] = inherits(EntityN1qlClass, EntitySuperClass);

                    entities[entityName].prototype.name           = entityName.substr(0,1).toUpperCase() + entityName.substr(1);
                    entities[entityName].prototype.model          = infos.model;
                    entities[entityName].prototype.bundle         = infos.bundle;
                    entities[entityName].prototype._collection    = entityName;
                    entities[entityName].prototype._filename      = _( __dirname + '/lib/n1ql.js', true );
                }

                entities[entityName].prototype[name] = function() {
                    var key     = null
                        , index = null
                        , args  = Array.prototype.slice.call(arguments);

                    if (params && params.length != args.length) {
                        throw new Error('[ '+name+'() ] arguments must match parameters length. Please refer to: '+ source +'.\nFound in param list: ('+ params.join(', ') +') !')
                    }


                    var queryParams = [];
                    if (params) {
                        // BO - patch prepared statement case when placeholder is used as a cursor
                        var p                   = []
                            , qStr              = queryString
                            , inl               = inlineParams
                            , re                = null
                            , foundSpecialCase  = /\w+\.(\$|\%)/.test(queryString);

                        if (foundSpecialCase) {
                            for (var i = 0, len = args.length; i < len; ++i) {
                                key = inl.indexOf(params[i]);

                                re = new RegExp('(.*)\\.'+ inl[key].replace(/([$%]+)/, '\\$1'));
                                if ( re.test(qStr) ) {
                                    qStr = qStr.replace( new RegExp('(.*)\\.'+ params[i].replace(/([$%]+)/, '\\$1')), '$1\.'+args[i]);
                                    inl.splice(key, 1);
                                } else {
                                    p[key] = args[key];
                                }
                            }

                            queryString = qStr;

                            var index = 0;
                            for (var i = 0, len = p.length; i < len; ++i) {
                                if ( typeof(p[i]) != 'undefined' ) {
                                    queryParams[index] = p[i];
                                    ++index;
                                }
                            }

                        } else { // normal case
                            queryParams = args;
                        }

                        // EO - patch
                    }


                    // prepared statement
                    var query = N1qlQuery.fromString(queryString);

                    if ( GINA_ENV_IS_DEV ) {
                        console.debug(queryString)
                    }

                    // query options
                    // @param {object} options
                    // @param {string} options.sample

                    // adhoc option: @param {boolean} options.adhoc [ true | false ]
                    // default is set to false
                    query.adhoc(false);

                    // scan consistency level: @param {number} options.consistency [ 1 | 2 | 3 ]
                    // Default is set to 1
                    //
                    // Default
                    //  code        : NOT_BOUNDED
                    //  number      : 1
                    //  description : This is the default (for single-statement requests).
                    //
                    // Request plus
                    //  code        : REQUEST_PLUS
                    //  number      : 2
                    //  description : This implements strong consistency per request.
                    //
                    // Statement plus
                    //  code        : STATEMENT_PLUS
                    //  number      : 3
                    //  description : This implements strong consistency per statement.
                    //
                    //
                    // For more, visit :
                    // - https://blog.couchbase.com/high-performance-consistency/
                    // - https://developer.couchbase.com/documentation/server/current/architecture/querying-data-with-n1ql.html
                    //query.consistency(3);


                    // trick to set event on the fly
                    var trigger = 'N1QL:'+entityName.toLowerCase()+ '#'+ name;

                    var self = this;


                    conn.query(query, queryParams, function(err, data, meta) {
                        if (!data || data.length == 0) {
                            data = null
                        }

                        if (!err && meta && typeof(meta.errors) != 'undefined' ) {
                            var err = new Error('`'+source+'`\n'+meta.errors[0].msg);
                            err.status = 403;
                        } else if (err) {
                            err.status  = 500;
                            err.message = '`'+source+'`\n'+ err.message;
                            err.stack   = '`'+source+'`\n'+ err.stack;
                        }

                        if ( returnType && returnType == 'object' ) {

                            data = (data) ? data[0] : data

                        } else if ( returnType && returnType == 'number' && /count\(|count\s+\(/i.test(queryString) ) {

                            var re = /(?:(?:COUNT\(\S+\)|COUNT\s+\(\S+\))\s+AS\s+)(\w+)/i;
                            re.lastIndex = 1; // defining last index
                            returnVariable = queryString.match(re)[re.lastIndex];

                            data = ( typeof(returnVariable) != 'undefined' ) ? data[0][returnVariable] : data[0];

                        }

                        self.emit(trigger, err, data, meta);

                    });

                    return {
                        onComplete : function(cb) {
                            self.once(trigger, function(err, data, meta){
                                cb(err, data, meta)
                            })
                        }
                    }

                }

            } catch (err) {
                console.error(err.stack);
            }
        }

    }

    var bulkInsert = function(rec) {

        try {

            var name = 'bulkInsert';

            if ( typeof(rec) == 'undefined' || !rec) {
                throw new Error('[ '+ this._collection +'::'+name+'(rec) ] : `rec` argument cannot be left empty !')
            }


            var queryString = 'INSERT INTO '+ this.database +' (KEY, VALUE)';
            for (var id in rec) {
                if ( typeof(rec[id].values) == 'undefined' )
                    throw new Error('rec["'+ id +'"].values not found !');

                if ( typeof(rec[id].values.id) == 'undefined' )
                    rec[id].values.id = id;

                rec[id].values._collection  = this._collection;

                queryString += '\t\nVALUES ("'+ id +'", '+ JSON.stringify(rec[id].values) +'),';
            }

            queryString = queryString.substr(0, queryString.length-1);
            queryString += '\nRETURNING '+ this.database +'.*;';

            // prepared statement
            var query = N1qlQuery.fromString(queryString).adhoc(false);

            // trick to set event on the fly
            var trigger = 'N1QL:'+ this.name.toLowerCase()+ '#'+ name;
            var conn = this.getConnection();

            var self = this;
            conn.query(query, rec, function(err, data, meta) {
                if (!data || data.length == 0) {
                    data = null
                }

                if (!err && meta && typeof(meta.errors) != 'undefined' ) {
                    var err = new Error('`GenericN1QLError::bulkInsert`\n'+meta.errors[0].msg);
                    err.status = 403;
                } else if (err) {
                    err.status  = 500;
                    err.message = '`GenericN1QLError::bulkInsert`\n'+ err.message;
                    err.stack   = '`GenericN1QLError::bulkInsert`\n'+ err.stack;
                }

                self.emit(trigger, err, data, meta);
            });

            return {
                onComplete : function(cb) {
                    self.once(trigger, function(err, data, meta){
                        cb(err, data, meta)
                    })
                }
            }

        } catch (err) {
            console.error(err.stack);
        }
    }

    return init(conn, infos)
};

module.exports = Couchbase