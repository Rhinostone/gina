// Imports.
var fs              = require('fs');
var util            = require('util');
//var promisify       = require('util').promisify;

var lib             = require('./../../../lib') || require.cache[require.resolve('./../../../lib')];
var inherits        = lib.inherits;
var merge           = lib.merge;
var console         = lib.logger;



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
            delete require.cache[require.resolve(_(filename, true))]; //EntitySuperClass

        EntitySuperClass = require(_(filename, true));


        // first one for the N1QL queries without entity ( check `/lib/n1ql.js` )
        files.unshift('n1ql.js');
        for (var f = 0, len = files.length; f < len; ++f) {

            if ( ! /^\./.test(files[f]) || f == len-1 ) {

                if (cacheless && files[f] != 'n1ql.js') {
                    delete require.cache[require.resolve(_(path + '/' +files[f], true))];//child
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

            if (comments) {
                params = comments[0].match(/\$\w+/g); // param list from comments
                queryString = queryString.replace(comments[0], '');
            }
            
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
                        , i     = null
                        , len   = null
                        , args  = Array.prototype.slice.call(arguments)
                        , _mainCallback = null;

                    if ( params && params.length != args.length && !/function/.test(typeof(args[args.length-1])) ) {
                        throw new Error('[ N1QL:' + entityName+'#'+name+'() ] arguments must match parameters length. Please refer to [ '+ source +' ]\nFound in param list: ('+ params.join(', ') +') !')
                    } else if ( /function/.test( typeof(args[args.length-1]) ) ) {
                        // to hande Nodejs Util.promisify
                        _mainCallback = args[args.length-1]
                    }


                    var queryParams = [];
                    var queryOptions = { // values by default
                        adhoc: false, 
                        consistency: 3 
                    };
                    if (params) {
                        // BO - patch prepared statement case when placeholder is used as a cursor
                        var p                   = []
                            , qStr              = queryString
                            , inl               = inlineParams
                            , re                = null
                            , foundSpecialCase  = /\w+\.(\$|\%)/.test(queryString);
                            
                        // e.g.: c.documentNextId.$2 = $3
                        // e.g.: n.alertedOn.$1 = true
                        if (foundSpecialCase) {
                            i = 0; len = args.length;
                            for (; i < len; ++i) {
                                key = inl.indexOf(params[i]);
                                p[key] = args[key];
                                
                                re = new RegExp('(.*)\\.'+ inl[key].replace(/([$%]+)/, '\\$1'));                                
                                if ( re.test(qStr) ) {
                                    p[key] = args[key];
                                    qStr = qStr.replace( new RegExp('(.*)\\.'+ params[i].replace(/([$%]+)/, '\\$1')), '$1\.'+args[i]);
                                    inl.splice(key, 1);
                                }
                            }

                            queryString = qStr;

                            index = 0; i = 0; len = p.length;
                            for (; i < len; ++i) {                                
                                queryParams[index] = p[i];
                                ++index;
                            }

                        } else { // normal case
                            queryParams = args;
                        }

                        // EO - patch
                    }
                    var sdkVersion = conn.sdk.version || 2;
                    var query = null, execQuery = null, _collection = null;
                    if ( sdkVersion > 2 ) { // starting from SDK v3
                        _collection = queryString.match(/\_collection(\s+\=|=)(.*)(\'|\")/);
                        if (_collection.length > 0) {
                            _collection = _collection[0];
                            if ( /\_collection/.test(_collection) ) {
                                _collection = _collection.replace(/\_collection|\W+/ig, '');
                            } else {
                                _collection = null
                            }
                        }
                        
                        //var bucket = conn._cluster.bucket(conn._name);
                        //var scope = conn.scope(conn._name);
                        //var coll = (_collection) ? scope.collection(_collection) :  scope.defaultCollection();
                        //execQuery = conn._cluster.query;
                        execQuery = inherits(conn, conn._cluster.query);
                        
                        query = queryString;
                        queryOptions.parameters = queryParams;
                        
                    } else { // version 2
                        // prepared statement
                        query = N1qlQuery.fromString(queryString);
                        // query options
                        // @param {object} options
                        // @param {string} options.sample

                        // adhoc option: @param {boolean} options.adhoc [ true | false ]
                        // default is set to false
                        //queryOptions.adhoc = false;

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
                        //queryOptions.consistency = 3;
                                // .adhoc(queryOptions.adhoc)
                                // .consistency(queryOptions.consistency)
                        // merge options
                        for (var qOpt in queryOptions) {
                            if ( typeof(query[ qOpt ]) == 'undefined' ) {
                                console.warn('N1QL:'+entityName.toLowerCase()+ '#'+ name + ': `'+ qOpt +'` is not a valid queryOption. Ignorig...');
                                continue;
                            }
                            query[ qOpt ]( queryOptions[ qOpt ] )
                        }
                    }

                    


                    // trick to set event on the fly
                    var trigger = 'N1QL:'+entityName.toLowerCase()+ '#'+ name;

                    var self = this;

                    if (GINA_ENV_IS_DEV) {
                        var statement = (sdkVersion <= 2) ? query.options.statement : query;
                        console.debug('[ ' + trigger +' ] '+statement);
                    }
                    
                    var onQueryCallback = function(err, data, meta) {
                                                    
                        if (!data || data.length == 0) {
                            data = null
                        }

                        if (!err && meta && typeof(meta.errors) != 'undefined' ) {
                            err = new Error('[ '+source+' ]\n'+meta.errors[0].msg);
                            err.status = 403;
                        } else if (err) {
                            err.status  = 500;
                            err.message = '[ '+source+' ]\n'+ err.message;
                            err.stack   = '[ '+source+' ]\n'+ err.stack;
                        }
                        
                        // handle return type
                        if ( returnType && returnType == 'boolean' ) {
                            
                            data = ( Array.isArray(data) && typeof(data.length) != 'undefined' && data.length > 0 || /string|number/i.test( typeof(data) && /true/i.test(data) ) ) ? true : false;
                            
                        } else if ( returnType && returnType == 'object' ) {

                            data = (data) ? data[0] : data

                        } else if ( returnType && returnType == 'number' && /count\(|count\s+\(/i.test(queryString) ) {

                            var re = /(?:(?:COUNT\(\S+\)|COUNT\s+\(\S+\))\s+AS\s+)(\w+)/i;
                            re.lastIndex = 1; // defining last index
                            returnVariable = queryString.match(re)[re.lastIndex];

                            data = ( typeof(returnVariable) != 'undefined' ) ? data[0][returnVariable] : data[0];
                        }

                        try {
                            if ( _mainCallback != null ) {
                                _mainCallback(err, data, meta)
                            } else {
                                self.emit(trigger, err, data, meta);
                            }
                            
                        } catch (_err) {
                            if ( _mainCallback != null ) {
                                _mainCallback(err, data, meta)
                            } else {
                                throw new Error('[ Couchbase ][ Core Entity Exception] '+ trigger + '\n'+ _err.stack)
                            }                            
                        }
                        

                    };
                    
                    var _proto = {
                        onComplete : function(cb) {
                            self.once(trigger, function onComplete(err, data, meta){
                                try {
                                    cb(err, data, meta)
                                } catch (onCompleteError) {                                        
                                    cb(onCompleteError)
                                }                                    
                            })
                        }
                    };
                    
                    if ( sdkVersion > 2 ) { 
                        var qErr = false, qData = null, qMeta = null;
                        
                        if ( _mainCallback == null ) {   
                            conn._cluster.query.onComplete = _proto;
                        }
                        
                        conn._cluster.query(query, queryOptions)
                            .catch( function onError(err) {
                                qErr = err;
                            })
                            .then( function onResult(data, meta) {
                                qData = data;
                                qMeta = meta;
                            });
                            
                        if ( qErr ) {
                            onQueryCallback(qErr);
                        } else {
                            onQueryCallback(false, qData, qMeta);
                        }                        
                        
                    } else {
                        conn.query(query, queryParams, onQueryCallback);
                        
                        if ( _mainCallback == null ) {                        
                            return _proto
                        }
                    }
                }
                
                

            } catch (err) {
                console.error(err.stack);
            }
        }

    }

    /**
     * bulkInsert
     * 
     * Supported options
     *  - adhoc : [ true | false ]
     *  // scan consistency level - default is 1
     *  - consistency : [ 1 | 2 | 3 ] where 1 = NOT_BOUNDED, 2 = REQUEST_PLUS, 3 = STATEMENT_PLUS
     * 
     * @param {array} rec collection
     * @param {object} [options] e.g: { consistency: 3 }
     * 
     */
    var bulkInsert = function(rec, options) {

        try {
            var sdkVersion = conn.sdk.version || 2;
            var queryOptions = { // by default
                adhoc: false,
                consistency: 3
            };
            
            if ( typeof(options) != 'undefined' ) {
                queryOptions = merge(options, queryOptions)
            }

            var name = 'bulkInsert';

            if ( typeof(rec) == 'undefined' || !rec) {
                throw new Error('[ '+ this._collection +'::'+name+'(rec) ] : `rec` argument cannot be left empty !')
            }


            var queryString = 'INSERT INTO '+ this.database +' (KEY, VALUE)';
            for (var id in rec) {
                if ( typeof(rec[id].values) == 'undefined' )
                    throw new Error('rec["'+ id +'"].values not found ! Please inspect your record root: type must be an Array.');

                if ( typeof(rec[id].values.id) == 'undefined' )
                    rec[id].values.id = id;

                rec[id].values._collection  = this._collection;

                queryString += '\t\nVALUES ("'+ id +'", '+ JSON.stringify(rec[id].values) +'),';
            }

            queryString = queryString.substr(0, queryString.length-1);
            queryString += '\nRETURNING '+ this.database +'.*;';

            var conn = this.getConnection();
            var query = null;
            if ( sdkVersion > 2) { // starting SDK v3
                var scope = conn.scope(conn._name);
                var coll = (_collection) ? scope.collection(_collection) :  scope.defaultCollection();                
                query = merge(queryString, queryOptions);
            } else {
                // prepared statement
                query = N1qlQuery.fromString(queryString);
                // merge options
                for (var qOpt in queryOptions) {
                    if ( typeof(query[ qOpt ]) == 'undefined' ) {
                        console.warn('N1QL:'+entityName.toLowerCase()+ '#'+ name + ': `'+ qOpt +'` is not a valid queryOption. Ignorig...');
                        continue;
                    }
                    query[ qOpt ]( queryOptions[ qOpt ] )
                }
            }
                

            // trick to set event on the fly
            var trigger = 'N1QL:'+ this.name.toLowerCase()+ '#'+ name;
            

            var self = this;
            conn.query(query, rec, function(err, data, meta) {
                if (!data || data.length == 0) {
                    data = null
                }

                if (!err && meta && typeof(meta.errors) != 'undefined' ) {
                    err = new Error('`GenericN1QLError::bulkInsert`\n'+meta.errors[0].msg);
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