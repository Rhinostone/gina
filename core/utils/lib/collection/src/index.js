/**
 * Collection cLass
 * Allows you to handle your own collections as you would normaly with mongodb
 * Dependencies :
 *  - utils/merge
 *  - uuid
 *
 *
 * @param {array} collection
 * @param {object} [options]
 *
 * @return {object} instance
 *
 * Collection::find
 *  @param {object} filter
 *      eg.: { uid: "someUID" }
 *      eg.: { type: "not null" }
 *
 *  @return {array} result
 *
 * Collection::findOne
 *  @param {object} filter
 *  @return {object|array|string} result
 *
 * Collection::update
 *  @param {object} filter
 *  @param {object} set
 *
 *  @return {array} result
 *
 * */
function Collection(content, option) {

    var instance    = this
        , merge     = merge || require('utils/merge')
        , uuid      = uuid || require('vendor/uuid');

    var defaultOptions = {
        'useLocalStorage': false,
        'locale': 'en' // get settigs.region, or user.region
    };

    var content     = JSON.parse(JSON.stringify(content)) || [] // original content -> not to be touched
        , options   = (typeof(options) == 'object') ? merge(options, defaultOptions) : defaultOptions
        , keywords  = ['not null'] // TODO - null, exists (`true` if property is defined)
        ;
    ;

    if ( content.length > 0 && typeof(content[0]._uid) == 'undefined' ) {
        this['uuids'] = {};
        for (var i = 0, len = content.length; i<len; ++i) {
            content[i]._uuid = uuid.v4();
            this['uuids'][ content[i]._uuid ] = content[i]
        }
    } else {
        this['uuids'] = []
    }

    //this.find = function(filter, withOrClause) {
    this['find'] = function() {

        var withOrClause = false;
        if ( typeof(arguments[arguments.length-1]) == 'boolean' ) {
            withOrClause = arguments[arguments.length-1];
            delete arguments[arguments.length-1];
            arguments.length -= 1;
        }

        var filters = JSON.parse(JSON.stringify(arguments));

        if ( typeof(filters) != 'undefined' && typeof(filters) !== 'object' ) {
            throw new Error('filter must be an object');
        } else if ( typeof(filters) != 'undefined' ) {

            var filter              = null
                , condition         = null
                , i                 = 0
                , tmpContent        = Array.isArray(this) ? this : JSON.parse(JSON.stringify(content))
                , resultObj         = {}
                , result            = []
                , localeLowerCase   = ''
                , re                = null
                , field             = null
                , value             = null
                ;

            for (var o in tmpContent) {
                tmpContent[o].matched = {};
                for (var l = 0, lLen = filters.count(); l<lLen; ++l) {
                    filter = filters[l];
                    condition = filter.count();

                    for (var f in filter) {
                        localeLowerCase = ( typeof(filter[f]) != 'boolean' ) ? filter[f].toLocaleLowerCase() : filter[f];
                        // cases with tmpContent.prop
                        if ( /\./.test(f) ) {
                            //JSON.stringify(tmpContent[o]).match(/("gross":\w+)/)[1].split(/:/)[1]
                            field = f.split(/\./g);
                            field = field[field.length-1];
                            re = new RegExp('("'+ field +'":\\w+)' );
                            if ( !/undefined|function/.test( typeof(tmpContent[o]) ) ) {
                                value = JSON.stringify(tmpContent[o]).match(re);
                                if ( value.length > 0) {
                                    value = value[1].split(/:/)[1];
                                    if ( /(<|>|=)/.test(filter[f]) ) {
                                        if ( eval( value + filter[f] ) ) {
                                            //result[i] = tmpContent[o];
                                            //++i
                                            tmpContent[o].matched[f] = true;
                                            resultObj[ tmpContent[o]._uuid ] = tmpContent[o]
                                        }
                                    } else {
                                        if (value == filter[f]) {
                                            //result[i] = tmpContent[o];
                                            //++i
                                            tmpContent[o].matched[f] = true;
                                            resultObj[ tmpContent[o]._uuid ] = tmpContent[o]
                                        }
                                    }
                                } else {
                                    value = null
                                }
                            }


                        } else {
                            // normal case
                            if ( filter[f] && keywords.indexOf(localeLowerCase) > -1 && localeLowerCase == 'not null' && typeof(tmpContent[o][f]) != 'undefined' && typeof(tmpContent[o][f]) !== 'object' && tmpContent[o][f] != 'null' && tmpContent[o][f] != 'undefined' ) {
                                if (result.indexOf(tmpContent[o][f]) < 0 ) {
                                    //result[i] = tmpContent[o][f];
                                    //++i
                                    tmpContent[o].matched[f] = true;
                                    if (typeof(tmpContent[o][f]) == 'object' ) {
                                        resultObj[ tmpContent[o][f]._uuid ] = tmpContent[o][f]
                                    } else {
                                        if ( !resultObj[o] ) {
                                            resultObj[o] = {}
                                        }

                                        resultObj[tmpContent[o]._uuid] = tmpContent[o];
                                    }
                                }

                            } else if ( typeof(tmpContent[o][f]) != 'undefined' && typeof(tmpContent[o][f]) !== 'object' && /(<|>|=)/.test(filter[f]) && !/undefined|function/.test( typeof(tmpContent[o][f]) ) ) { // with operations
                                if ( eval( tmpContent[o][f] + filter[f] ) ) {
                                    //result[i] = tmpContent[o];
                                    //++i
                                    tmpContent[o].matched[f] = true;
                                    resultObj[ tmpContent[o]._uuid ] = tmpContent[o]
                                }
                            } else if ( typeof(tmpContent[o][f]) != 'undefined' && typeof(tmpContent[o][f]) !== 'object' && tmpContent[o][f] === filter[f] ) {

                                //result[i] = tmpContent[o];
                                //++i
                                tmpContent[o].matched[f] = true;
                                resultObj[ tmpContent[o]._uuid ] = tmpContent[o]
                            }
                        }

                    }

                }
            }
        } else {
            result = content
        }

        if (withOrClause) {
            for (var obj in resultObj) {
                delete resultObj[obj].matched;
                result[i] = resultObj[obj];
                ++i
            }
        } else {
            var matched = 0;
            for (var obj in resultObj) {
                if ( typeof(resultObj[obj].matched) != 'undefined' && resultObj[obj].matched.count() == condition ) {
                    delete resultObj[obj].matched;
                    result[i] = resultObj[obj];
                    ++i
                }
            }
        }



        // chaining
        result.notIn    = instance.notIn;
        result.findOne  = instance.findOne;
        result.limit    = instance.limit;
        result.orderBy  = instance.orderBy;

        return result
    }

    this['or'] = function () {
        arguments[arguments.length] = true;
        arguments.length += 1;

        return instance.find.apply(this, arguments);
    }

    this['limit'] = function(resultLimit) {
        if ( typeof(resultLimit) == 'undefined' || typeof(resultLimit) != 'number' ) {
            throw new Error('[Collection::result->limit(resultLimit)] : `resultLimit` parametter must by a `number`')
        }

        var result = Array.isArray(this) ? this : JSON.parse(JSON.stringify(content));

        //resultLimit
        result = result.splice(0, resultLimit);

        // chaining
        result.notIn    = instance.notIn;
        result.findOne  = instance.findOne;
        result.orderBy  = instance.orderBy;

        return result
    }

    this['findOne'] = function(filter) {
        if ( typeof(filter) !== 'object' ) {
            throw new Error('filter must be an object');
        } else {
            var condition = filter.count()
                , i                 = 0
                , tmpContent        = Array.isArray(this) ? this : JSON.parse(JSON.stringify(content))
                , result            = []
                , localeLowerCase   = '';

            if (condition == 0) return null;

            for (var o in tmpContent) {
                for (var f in filter) {
                    localeLowerCase = ( typeof(filter[f]) != 'boolean' ) ? filter[f].toLocaleLowerCase() : filter[f];
                    if ( filter[f] && keywords.indexOf(localeLowerCase) > -1 && localeLowerCase == 'not null' && typeof(tmpContent[o][f]) != 'undefined' && typeof(tmpContent[o][f]) !== 'object' && tmpContent[o][f] === filter[f] && tmpContent[o][f] != 'null' && tmpContent[o][f] != 'undefined' ) {
                        if (result.indexOf(tmpContent[o][f]) < 0 ) {
                            ++i;
                            if (i === condition) result = tmpContent[o]
                        }

                    } else if ( typeof(tmpContent[o][f]) != 'undefined' && typeof(tmpContent[o][f]) !== 'object' && tmpContent[o][f] === filter[f] ) {
                        ++i;
                        if (i === condition) result = tmpContent[o]
                    }
                }
            }
        }


        return result
    }



    this['notIn'] =  function(collection){

        if ( typeof(collection) == 'undefined' )
            return Array.isArray(this) ? this : content;

        var result          = []
            , r             = 0
            , tmpUuids      = JSON.parse(JSON.stringify(instance.uuids))
            , tmpContent    = Array.isArray(this) ? this : content;


        for (var i = 0, len = collection.length; i < len; ++i) {
            if ( typeof(tmpUuids[ collection[i]._uuid ]) != 'undefined' )  {
                delete tmpUuids[ collection[i]._uuid ]
            }
        }
        for (var uuid in tmpUuids) {
            result[r] = tmpUuids[uuid];
            ++r;
        }

        result.limit    = instance.limit;
        result.find     = instance.find;
        result.findOne  = instance.findOne;
        result.orderBy  = instance.orderBy;

        return result
    }

    this['update'] = function(filter, set) {
        if ( typeof(filter) !== 'object' ) {
            throw new Error('filter must be an object');
        } else {
            var condition           = filter.count()
                , localeLowerCase   = ''
                , result            = Array.isArray(this) ? this : JSON.parse(JSON.stringify(content));

            for (var o in content) {
                for (var f in filter) {
                    localeLowerCase = ( typeof(filter[f]) != 'boolean' ) ? filter[f].toLocaleLowerCase() : filter[f];
                    if ( filter[f] && keywords.indexOf(localeLowerCase) > -1 && localeLowerCase == 'not null' && typeof(content[o][f]) != 'undefined' && typeof(content[o][f]) !== 'object' && content[o][f] != 'null' && content[o][f] != 'undefined' ) {
                        result[o][f] = set;

                    } else if ( typeof(content[o][f]) != 'undefined' && typeof(content[o][f]) !== 'object' && content[o][f] === filter[f] ) {
                        result[o] = set;
                    }
                }
            }
        }

        // chaining
        result.find     = instance.find;
        result.findOne  = instance.findOne;
        result.orderBy  = instance.orderBy;
        result.notIn    = instance.notIn;

        return result
    }

    this['delete'] = function(filter) {
        if ( typeof(filter) !== 'object' ) {
            throw new Error('filter must be an object');
        } else {
            var condition           = filter.count()
                , localeLowerCase   = ''
                , result            = Array.isArray(this) ? JSON.parse(JSON.stringify(this)) : JSON.parse(JSON.stringify(content));

            for (var o in content) {
                for (var f in filter) {
                    localeLowerCase = ( typeof(filter[f]) != 'boolean' ) ? filter[f].toLocaleLowerCase() : filter[f];
                    if ( filter[f] && keywords.indexOf(localeLowerCase) > -1 && localeLowerCase == 'not null' && typeof(content[o][f]) != 'undefined' && typeof(content[o][f]) !== 'object' && content[o][f] != 'null' && content[o][f] != 'undefined' ) {
                        //delete result[o][f];
                        result.splice(o, 1)
                    } else if ( typeof(content[o][f]) != 'undefined' && typeof(content[o][f]) !== 'object' && content[o][f] === filter[f] ) {
                        result.splice(o, 1)
                    }
                }
            }
        }

        return result
    }


    var sortKeywords = [ 'asc', 'desc' ];
    /**
     * sort
     *
     * @param {object|array} filter
     * */
    this['orderBy'] = function (filter) {

        if ( typeof(filter) == 'undefined' )
            throw new Error('[ Collection->sort(filter) ] where `filter` must not be empty or null' );


        var variableContent = (Array.isArray(this)) ? this : JSON.parse(JSON.stringify(content));
        return sortResult(filter, variableContent)
    }

    /**
     * sortResult
     * ref.:
     *  https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort
     *  https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/localeCompare#Browser_compatibility
     *
     * e.g.:
     *  .orderBy({ name: 'asc' })
     *
     *  // overriding filters -> last filter is always right
     *  .orderBy([ { updatedAt : 'desc'}, { name: 'asc' } ])
     *
     *  // combining filters -> the first one is always right
     *  .orderBy({ updatedAt : 'desc'}, { name: 'asc' })
     *
     * @param {object|array} filter
     * */
    var sortResult = function (filter, content) {
        if ( typeof(filter) != 'object') {
            throw new Error('`filter` parametter must be an object or an array')
        }

        var condition           = filter.count()
            , sortOp            = {}
            , key               = null
            , prop              = null
            , result            = []
            ;

        if (condition == 0) return null;


        // asc
        sortOp['asc'] = function (prop, content) {
            return content.sort(function onAscSort(a, b) {

                if ( typeof(a) == 'string' && a != '') {
                    // var fieldA = a.toUpperCase(); // ignore upper and lowercase
                    // var fieldB = b.toUpperCase(); // ignore upper and lowercase
                    //
                    // if (fieldA < fieldB) {
                    //     return -1;
                    // }
                    //
                    // if (fieldA > fieldB) {
                    //     return 1;
                    // }
                    //
                    // // fields must be equal
                    // return 0;

                    return a.localeCompare(b)

                } else if ( typeof(a) == 'object' ) {
                    try {
                        return a[prop].localeCompare(b[prop])
                    } catch (err) {
                        return -1
                    }

                } else {
                    if (a > b) {
                        return 1;
                    }
                    if (a < b) {
                        return -1;
                    }
                    // a must be equal to b
                    return 0;
                }
            })
        }

        // desc
        sortOp['desc'] = function (prop, content) {
            return sortOp['asc'](prop, content).reverse()
        }

        if ( Array.isArray(filter) ) {

            for (var f = 0, len = filter.length; f < len; ++f) {

                prop    = Object.keys(filter[f])[0];
                key     = filter[f][prop];

                result  = sortOp[key](prop, content);
            }
        } else {

            if (filter.count() > 1) {

                for (var f in filter) {
                    prop    = Object.keys(filter)[0];
                    key     = filter[prop];

                    result  = sortOp[key](prop, content);
                }

            } else {
                prop    = Object.keys(filter)[0];
                key     = filter[prop];

                result  = sortOp[key](prop, content);
            }
        }



        // chaining
        result.findOne  = instance.findOne;
        result.limit    = instance.limit;
        result.notIn    = instance.notIn;

        return result
    };

};

if ( ( typeof(module) !== 'undefined' ) && module.exports ) {
    // Publish as node.js module
    var merge   = require('../merge');
    var uuid    = require('uuid');

    module.exports = Collection
} else if ( typeof(define) === 'function' && define.amd) {
    // Publish as AMD module
    define(function() { return Collection })
}