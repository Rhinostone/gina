/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2021 Rhinostone <gina@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * Routing
 *
 * @package     Gina.Lib
 * @namespace   Gina.Lib.Routing
 * @author      Rhinostone <gina@rhinostone.com>
 * */

function Routing() {

    var isGFFCtx    = ((typeof (module) !== 'undefined') && module.exports) ? false :  true;
    var self        = {
        allowedMethods: ['get', 'post', 'put', 'delete'],
        reservedParams: ['controle', 'file','title', 'namespace', 'path'],
        notFound: {}
    };    
        
    self.allowedMethodsString   = self.allowedMethods.join(',');
    
    // loading plugins
    var plugins = null, Validator = null;
    if (!isGFFCtx) {
        plugins = require(__dirname+'/../../../core/plugins') || getContext('gina').plugins;
        Validator = plugins.Validator;
    }
    
    /**
     * Get url props
     * Used to retrieve additional properties for routes with redirect flag for example
     * 
     * @param {string} [bundle]
     * @param {string} [env] 
     * 
     * @return {object} urlProps - { .host, .hostname, .webroot }
     */
    self.getUrlProps = function(bundle, env) {
        var config = null, urlProps = {}, _route = null;
        if (isGFFCtx) {
            // TODO - add support to get from env
            config = window.gina.config;
            // by default
            urlProps.hostname = config.hostname;
            if ( typeof(bundle) != 'undefined' ) {
                // get from webroot
                _route = routing.getRoute('webroot@'+ bundle);
                urlProps.hostname   = _route.hostname;
                urlProps.host       = _route.host;
                urlProps.webroot    = _route.webroot;
            }            
        } else {
            config = getContext('gina').config;
            if ( typeof(getContext('argvFilename')) != 'undefined' ) {
                config.getRouting = getContext('gina').Config.instance.getRouting
            }
            if ( typeof(bundle) == 'undefined' ) {
                bundle      = config.bundle;
            }
            if ( typeof(env) == 'undefined' ) {
                env      = config.env;
            }
            
            urlProps.hostname   = config.envConf[bundle][env].hostname;
            urlProps.host       = config.envConf[bundle][env].host;
            urlProps.webroot    = config.envConf[bundle][env].server.webroot;
        }
        
        return urlProps;
    }
    
    /**
     * Load bundle routing configuration
     * 
     * @param {object} options
     *  {
     *      isStadalone: false,
     *      bundle: 'default',   // bundle's name
     *      wroot: '/',          // by default
     *      
     *  }
     * 
     */
    // self.loadBundleRoutingConfiguration = function(options, filename) {
        
    // }
    
    /**
     * Get routing
     * 
     * @param {string} [bundle]
     */
    // self.getRouting = function(bundle) {
        
    // }
    
    /**
     * Get reversed routing
     * 
     * @param {string} [bundle]
     */
    // self.getReverseRouting = function(bundle) {
        
    // }

    /**
     * Compare urls
     *
     * @param {object} params - Route params containing the given url to be compared with
     * @param {string|array} url - routing.json url
     * @param {object} [request]
     * @param {object} [response] - only used for query validation
     * @param {object} [next] - only used for query validation
     *
     * @return {object|false} foundRoute
     * */
    self.compareUrls = async function(params, url, request, response, next) {
        
        if ( typeof(request) == 'undefined' ) {
            request = { routing: {} };
        }
        // Sample debug break for specific rule
        // if ( params.rule == 'my-specific-rule@bundle' ) {
        //     console.debug('passed '+ params.rule);
        // }

        if ( /\,/.test(url) ) {
            var i               = 0
                , urls          = url.split(/\,/g)
                , len           = urls.length
                , foundRoute    = {
                    past: false,
                    request: request
                };


            while (i < len && !foundRoute.past) {
                foundRoute = await parseRouting(params, urls[i], request, response, next);
                ++i;
            }

            return foundRoute;
        } else {
            return await parseRouting(params, url, request, response, next);
        }
    };

    /**
     * Check if rule has params
     *
     * @param {string} pathname
     * @return {boolean} found
     *
     * @private
     * */
    var hasParams = function(pathname) {
        return (/:/.test(pathname)) ? true : false;
    };

    /**
     * Parse routing for mathcing url
     *
     * @param {object} params - `params` is the same `request.routing` that can be retried in controller with: req.routin
     * @param {string} url
     * @param {object} request
     * @param {object} [response] - Only used for query validation
     * @param {object} [next] - Only used for query validation
     *
     * @return {object} foundRoute
     *
     * */
    var parseRouting = async function(params, url, request, response, next) {

        var uRe             = params.url.split(/\//)
            , uRo           = url.split(/\//)
            , uReCount      = 0
            , uRoCount      = 0
            , maxLen        = uRo.length
            , score         = 0
            , foundRoute    = {}
            , i             = 0
        ;
        
        //attaching routing description for this request
        var method = request.method.toLowerCase();
        var paramMethod = params.method.toLowerCase();
                    
        var hasAlreadyBeenScored = false;
        if ( 
            typeof(params.requirements) != 'undefined'
            && /get|delete/i.test(method)
            && typeof(request[method]) != 'undefined'
            ||
            // GET request is in fact in this case a DELETE request
            typeof(params.requirements) != 'undefined'
            && /get/i.test(method)
            && /delete/i.test(paramMethod)
        ) {            
            
            if ( /get/i.test(method) && /delete/i.test(paramMethod) ) {
                method = paramMethod;
            }
            // `delete` methods don't have a body
            // So, request.delete is {} by default
            if ( /^(delete)$/i.test(method) && uRe.length === uRo.length ) { 
                // just in case
                if ( typeof(request[method]) == 'undefined' ) {
                    request[method] = {};
                }
                for (let p = 0, pLen = uRo.length; p < pLen; p++) {
                    if (uRe[p] === uRo[p]) {    
                        ++score;                    
                        continue;
                    }
                    let _key = uRo[p].substr(1);
                    if ( typeof(params.requirements[_key]) == 'undefined' ) {
                        continue;
                    }
                    let condition = params.requirements[_key];
                    if ( /^\//.test(condition) ) {
                        condition = condition.substr(1, condition.lastIndexOf('/')-1);
                    } else if ( /^validator\:\:/.test(condition) && await fitsWithRequirements(uRo[p], uRe[p], params, request, response, next) ) {
                        ++score;
                        continue;
                    }
                    if (
                        /^:/.test(uRo[p]) 
                        && typeof(condition) != 'undefined'
                        && new RegExp(condition).test(uRe[p])
                    ) {
                        ++score;                        
                        request[method][uRo[p].substr(1)] = uRe[p];    
                    }
                }
                hasAlreadyBeenScored = true;           
            }
            
            
            for (let p in request[method]) {
                if ( typeof(params.requirements[p]) != 'undefined' && uRo.indexOf(':' + p) < 0 ) {
                    uRo[uRoCount] = ':' + p; ++uRoCount;
                    uRe[uReCount] = request[method][p];
                    ++uReCount;
                    if (!hasAlreadyBeenScored && uRe.length === uRo.length)
                        ++maxLen;                    
                }
            }
        }
        
        
        if (!hasAlreadyBeenScored && uRe.length === uRo.length) {
            for (; i < maxLen; ++i) {
                if (uRe[i] === uRo[i]) {
                    ++score;
                } else if (score == i && hasParams(uRo[i]) && await fitsWithRequirements(uRo[i], uRe[i], params, request, response, next)) {
                    ++score;
                }
            }
        }

        foundRoute.past     = (score === maxLen) ? true : false;
        
        if (foundRoute.past) {
            // attaching routing description for this request
            //request.routing = params; // can be retried in controller with: req.routing
            // && replacing placeholders
            request.routing = checkRouteParams(params, request[method]);
            foundRoute.request  = request;
        }
        

        return foundRoute;
    };

    /**
     * Fits with requiremements
     * This is for server side use only
     * http://en.wikipedia.org/wiki/Regular_expression
     *
     * @param {string} urlVar
     * @param {string} urlVal
     * @param {object} params
     *
     * @return {boolean} true|false - `true` if it fits
     *
     * @private
     * */
    var fitsWithRequirements = async function(urlVar, urlVal, params, request, response, next) {
        //var isValid = new Validator('routing', { email: "contact@gina.io"}, null, {email: {isEmail: true}} ).isEmail().valid;
        var matched     = -1
            , _param    = urlVar.match(/\:\w+/g)
            , regex     = new RegExp(urlVar, 'g')
            , re        = null
            , flags     = null
            , key       = null
            , tested    = false
            
            , _validator    = null
            , _data         = null
            , _ruleObj      = null
            , _rule         = null
            , rule          = null
            , str           = null
            // request method
            , requestMethod        = request.method.toLowerCase()
        ;
        
        if (!_param.length) return false;

        //  if custom path, path rewrite
        if (params.param.path && regex.test(params.param.path)) {
            params.param.path = params.param.path.replace(regex, urlVal);
        }
        
        //  if custom namespace, namespace rewrite
        if (params.param.namespace && regex.test(params.param.namespace)) {            
            params.param.namespace = params.param.namespace.replace(regex, urlVal);            
        }
        
        //  if custom file, file rewrite
        // if (params.param.file && regex.test(params.param.file)) {            
        //     params.param.file = params.param.file.replace(regex, urlVal);            
        // }
        // file is handle like url replacement (path is like pathname)
        if (typeof (params.param.file) != 'undefined' && /:/.test(params.param.file)) {
            var _regex = new RegExp('(:'+urlVar+'/|:'+urlVar+'$)', 'g'); 
            replacement.variable = urlVal;        
            params.param.file = params.param.file.replace( _regex, replacement );
        }

        //  if custom title, title rewrite
        if (params.param.title && regex.test(params.param.title)) {    
            params.param.title = params.param.title.replace(regex, urlVal);
        }

        if (_param.length == 1) {// fast one
            
            re = new RegExp( _param[0]);
            matched = (_param.indexOf(urlVar) > -1) ? _param.indexOf(urlVar) : false;
            
            if (matched === false ) {
                // In order to support rules defined like :
                //      { params.url }  => `/section/:name/page:number`
                //      { request.url } => `/section/plante/page4`
                //
                //      with keys = [ ":name", ":number" ]
                
                if ( urlVar.match(re) ) {
                    matched = 0;
                }
            }
            

            if (matched === false) return matched;
            // filter on method
            if (params.method.toLowerCase() !== requestMethod) return false;
            
            if ( typeof(request[requestMethod]) == 'undefined' ) {
                request[requestMethod] = {}
            }

            key     = _param[matched].substr(1);
            // escaping `\` characters
            // TODO - remove comment : all regex requirement must start with `/`
            //regex   = ( /\\/.test(params.requirements[key]) ) ? params.requirements[key].replace(/\\/, '') : params.requirements[key];
            regex = params.requirements[key];
            if (/^\//.test(regex)) {
                re      = regex.match(/\/(.*)\//).pop();
                flags   = regex.replace('/' + re + '/', '');                

                tested  = new RegExp(re, flags).test(urlVal)
            } else if ( /^validator\:\:/.test(regex) && urlVal) {
                /**
                 * "requirements" : {
                 *      "id" : "/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i",
                 *      "email": "validator::{ isEmail: true, isString: [7] }"
                 *  }
                 * 
                 * e.g.: tested = new Validator('routing', _data, null, {email: {isEmail: true, subject: \"Anything\"}} ).isEmail().valid;
                 */ 
                _data = {}; _ruleObj = {}; _rule = {}; str = '';                
                urlVar.replace( new RegExp('[^'+ key +']','g'), function(){ str += arguments[0] });                
                _data[key]  = urlVal.replace( new RegExp(str, 'g'), '');
                try {
                    //_ruleObj    = JSON.parse(regex.split(/::/).splice(1)[0].replace(/([^\W+ true false])+(\w+)/g, '"$&"'));
                    _ruleObj    = JSON.parse(
                    regex.split(/::/).splice(1)[0]
                        .replace(/([^\:\"\s+](\w+))\:/g, '"$1":') // { query: { validIf: true }} => { "query": { "validIf": true }}
                        .replace(/([^\:\"\s+](\w+))\s+\:/g, '"$1":') // note the space between `validIf` & `:` { query: { validIf : true }} => { "query": { "validIf": true }}
                    );                    
                } catch (err) {
                    throw err;
                }
                //_ruleObj    = JSON.parse(regex.split(/::/).splice(1)[0].replace(/([^\W+ true false])+(\w+)/g, '"$&"'));       
                if (typeof(_ruleObj.query) != 'undefined' && typeof(_ruleObj.query.data) != 'undefined') {
                    // since we only have one param
                    // :var1 == :var1
                    if ( urlVar == _ruleObj.query.data[ Object.keys(_ruleObj.query.data)[0] ] ) {
                        _ruleObj.query.data[ Object.keys(_ruleObj.query.data)[0] ] = _data[key];
                        // Set in case it is not found
                        request.params[key] = _data[key];
                    }
                }
                _rule[key]  = _ruleObj;                
                _validator  = new Validator('routing', _data, null, _rule );
                if (_ruleObj.count() == 0 ) {
                    console.error('Route validation failed '+ params.rule);
                    return false;
                }
                for (rule in _ruleObj) {
                    if (Array.isArray(_ruleObj[rule])) { // has args
                        await _validator[key][rule].apply(_validator[key], _ruleObj[rule]);
                    } else {
                        await _validator[key][rule](_ruleObj[rule], request, response, next);
                    }                    
                }
                tested = _validator.isValid();
            } else {
                tested = new RegExp(params.requirements[key]).test(urlVal);
            }

            if (
                typeof(params.param[key]) != 'undefined' &&
                typeof(params.requirements) != 'undefined' &&
                typeof(params.requirements[key]) != 'undefined' &&
                typeof(request.params) != 'undefined' &&
                tested
            ) {                
                request.params[key] = urlVal;
                if ( typeof(request[requestMethod][key]) == 'undefined' ) {
                    request[requestMethod][key] = urlVal;
                }
                return true;
            }

        } else { // slow one

            // In order to support rules defined like :
            //      { params.url }  => `/section/:name/page:number`
            //      { request.url } => `/section/plante/page4`
            //
            //      with keys = [ ":name", ":number" ]

            var keys        = _param
                , tplUrl    = params.url
                , url       = request.url
                , values    = {}
                , strVal    = ''
                , started   = false
                , i         = 0
            ;

            for (var c = 0, posLen = url.length; c < posLen; ++c) {
                if (url.charAt(c) == tplUrl.charAt(i) && !started) {
                    ++i
                    continue
                } else if (strVal == '') { // start

                    started = true;
                    strVal += url.charAt(c);
                } else if (c > (tplUrl.indexOf(keys[0]) + keys[0].length)) {

                    regex = params.requirements[keys[0]];
                    urlVal = strVal.substr(0, strVal.length);

                    if (/^\//.test(regex)) {
                        re      = regex.match(/\/(.*)\//).pop();
                        flags   = regex.replace('/' + re + '/', '');

                        tested = new RegExp(re, flags).test(urlVal)

                    } else if ( /^validator\:\:/.test(regex) ) {
                        /**
                         * "requirements" : {
                         *      "id" : "/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i",
                         *      "email": "validator::{ isEmail: true, isString: [7] }"
                         *  }
                         * 
                         * e.g.: tested = new Validator('routing', _data, null, {email: {isEmail: true}} ).isEmail().valid;
                         */ 
                        _data = {}; _ruleObj = {}; _rule = {}; str = '';                
                        urlVar.replace( new RegExp('[^'+ key[0] +']','g'), function(){ str += arguments[0]  });                
                        _data[key[0]]  = urlVal.replace( new RegExp(str, 'g'), '');
                        _ruleObj    = JSON.parse(regex.split(/::/).splice(1)[0].replace(/([^\W+ true false])+(\w+)/g, '"$&"'));       
                        _rule[key[0]]  = _ruleObj;                
                        _validator  = new Validator('routing', _data, null, _rule );
                        
                        for (rule in _ruleObj) {
                            if (Array.isArray(_ruleObj[rule])) { // has args
                                _validator[key[0]][rule].apply(_validator[key[0]], _ruleObj[rule])
                            } else {
                                _validator[key[0]][rule](_ruleObj[rule])
                            }                    
                        }
                        tested = _validator.isValid();
                    } else {
                        tested = new RegExp(params.requirements[key[0]]).test(urlVal)
                    }

                    if (tested) {
                        values[keys[0].substr(1)] = urlVal
                    } else {
                        return false
                    }

                    strVal = '';
                    started = false;
                    i = (tplUrl.indexOf(keys[0]) + keys[0].length);
                    c -= 1;

                    keys.splice(0, 1)
                } else {
                    strVal += url.charAt(c);
                    ++i
                }

                if (c == posLen - 1) {

                    regex = params.requirements[keys[0]];
                    urlVal = strVal.substr(0, strVal.length);

                    if (/^\//.test(regex)) {
                        re = regex.match(/\/(.*)\//).pop();
                        flags = regex.replace('/' + re + '/', '');

                        tested = new RegExp(re, flags).test(urlVal)

                    } else {
                        tested = new RegExp(params.requirements[key]).test(urlVal)
                    }

                    if (tested) {
                        values[keys[0].substr(1)] = urlVal
                    } else {
                        return false
                    }
                }
            }

            if (values.count() == keys.length) {
                key = null;
                for (key in values) {
                    request.params[key] = values[key];
                }
                return true
            }
        }

        return false
    }
    
    var replacement = function(matched){
        return ( /\/$/.test(matched) ? replacement.variable+ '/': replacement.variable )            
    };
    var checkRouteParams = function(route, params) {
        
        for (var p in route.param) {
            if ( /^:/.test(route.param[p]) ) {
                variable = route.param[p].substr(1);
                
                if ( typeof(params) != 'undefined' && typeof(params[variable]) != 'undefined' ) {
                    
                    regex = new RegExp('(:'+variable+'/|:'+variable+'$)', 'g');                   
                    

                    if ( typeof(route.param.path) != 'undefined' && /:/.test(route.param.path) ) {
                        route.param.path = route.param.path.replace( regex, params[variable]);
                    }
                    if (typeof (route.param.title) != 'undefined' && /:/.test(route.param.title)) {
                        route.param.title = route.param.title.replace( regex, params[variable]);
                    }
                    if (typeof (route.param.namespace) != 'undefined' && /:/.test(route.param.namespace)) {
                        route.param.namespace = route.param.namespace.replace( regex, params[variable]);
                    }
                    // file is handle like url replacement (path is like pathname)
                    if (typeof (route.param.file) != 'undefined' && /:/.test(route.param.file)) {
                        replacement.variable = params[variable];        
                        route.param.file = route.param.file.replace( regex, replacement );
                    }
                                        
                    if ( /\,/.test(route.url) ) {                        
                        urls = route.url.split(/\,/g);
                        i = 0; len = urls.length;
                        for (; i < len; ++i) {
                            replacement.variable = params[variable]; 
                            urls[i] = urls[i].replace( regex, replacement );
                        }
                        route.url = urls.join(',');
                    } else {        
                        replacement.variable = params[variable];        
                        route.url = route.url.replace( regex, replacement );
                    }
                }
            }
        }
        
        return route;
    }

    /**
     * @function getRoute
     *
     * @param {string} rule e.g.: [ <scheme>:// ]<name>[ @<bundle> ][ /<environment> ]
     * @param {object} params
     * @param {number} [urlIndex] in case you have more than one url registered for the current route, you can select the one you want to use. Default is 0.
     *
     * @return {object} route
     * */
    self.getRoute = function(rule, params, urlIndex) {
        
        var config = null;
        if (isGFFCtx) {
            config = window.gina.config;
        } else {
            config = getContext('gina').config;
            if ( typeof(getContext('argvFilename')) != 'undefined' ) {
                config.getRouting = getContext('gina').Config.instance.getRouting;
            }
        }
        
        var env         = config.env || GINA_ENV  // by default, takes the current bundle
            , envTmp    = null
            //, scheme    = null
            , bundle    = config.bundle // by default, takes the current bundle
        ;
        
        if ( !/\@/.test(rule) && typeof(bundle) != 'undefined' && bundle != null) {
            rule = rule.toLowerCase()
            rule += '@' + bundle
        }

        if ( /\@/.test(rule) ) {

            var arr = ( rule.replace(/(.*)\:\/\//, '') ).split(/\@/);

            bundle  = arr[1];

            // getting env
            if ( /\/(.*)$/.test(rule) ) {
                envTmp  = ( rule.replace(/(.*)\:\/\//, '') ).split(/\/(.*)$/)[1];
                bundle  = bundle.replace(/\/(.*)$/, '');
                env     = envTmp || env;
            }


            // getting scheme
            //scheme = ( /\:\/\//.test(rule) ) ? rule.split(/\:\/\//)[0] : config.bundlesConfiguration.conf[bundle][env].server.scheme;

            rule = arr[0].toLowerCase() +'@'+ bundle;
        }
        
        
        var routing = config.getRouting(bundle, env);

        if ( typeof(routing[rule]) == 'undefined' ) {
            throw new Error('[ RoutingHelper::getRouting(rule, params) ] : `' +rule + '` not found !')
        }

        var route = JSON.clone(routing[rule]);
        var variable    = null
            , regex     = null
            , urls      = null
            , i         = null
            , len       = null
            , msg       = null
        ;
        route = checkRouteParams(route, params);

        if ( /\,/.test(route.url) ) {
            urlIndex = ( typeof(urlIndex) != 'undefined' ) ? urlIndex : 0;
            route.url = route.url.split(/,/g)[urlIndex];            
        }
        // fix url in case of empty param value allowed by the routing rule
        // to prevent having a folder.
        // eg.: {..., id: '/^\\s*$/'} => {..., id: ''} => /path/to/ becoming /path/to
        if ( /\/$/.test(route.url) && route.url != '/' )
            route.url = route.url.substr(0, route.url.length-1);
        
        // Completeting url with extra params e.g.: ?param1=val1&param2=val2
        if ( /GET/i.test(route.method) && typeof(params) != 'undefined' ) {
            var queryParams = '?', maskedUrl = routing[rule].url;
            //self.reservedParams;
            for (let r in route.param) {
                if ( self.reservedParams.indexOf(r) > -1 || new RegExp(route.param[r]).test(maskedUrl) )
                    continue;
                if (typeof(params[r]) != 'undefined' )
                    queryParams += r +'='+ params[r]+ '&';
            }
            
            if (queryParams.length > 1) {
                queryParams = queryParams.substring(0, queryParams.length-1);
                route.url += queryParams;
            }
        }
        
        // recommanded for x-bundle coms
        // leave `ignoreWebRoot` empty or set it to false for x-bundle coms
        route.toUrl = function (ignoreWebRoot) {
            
            var urlProps = null;
            if ( /^redirect$/i.test(this.param.control) ) {
                urlProps = self.getUrlProps(this.bundle, (env||GINA_ENV));
            }
            
            var wroot       = this.webroot || urlProps.webroot
                , hostname  = this.hostname || urlProps.hostname
                , path      = this.url
            ;
            
            this.url = ( typeof(ignoreWebRoot) != 'undefined' && ignoreWebRoot == true ) ? path.replace(wroot, '/') : path;

            return hostname + this.url
        };
        
        /**
         * request current url
         * 
         * @param {boolean} [ignoreWebRoot]
         * @param {object} [options] - see: https://nodejs.org/api/https.html#https_new_agent_options
         * 
         * @callback {callback} [cb] - see: https://nodejs.org/api/https.html#https_new_agent_options
         *      @param {object} res
         */
        route.request = function(ignoreWebRoot, options, cb) {
            
            var wroot       = this.webroot
                , hostname  = this.hostname
                , url       = ( typeof(ignoreWebRoot) != 'undefined' && ignoreWebRoot == true ) ? path.replace(wroot, '/') : this.url
            ;
            
            var scheme = ( /^https/.test(hostname) ) ? 'https' : 'http';
            
            if (isGFFCtx) {
                var target = ( typeof(options) != 'undefined' && typeof(options.target) != 'undefined' ) ? options.target : "_self";
                window.open(url, target)
            } else {
                var agent = require(''+scheme);          
                agent.get(url, options, cb)
            }                
        }
        
        if ( /\:/.test(route.url) ) {
            var paramList = route.url
                                .match(/(\:(.*)\/|\:(.*)$)/g)
                                .map(function(el){  return el.replace(/\//g, ''); }).join(', ');
            msg = '[ RoutingHelper::getRoute(rule[, bundle, method]) ] : route [ %r ] param placeholder not defined: `' + route.url + '` !\n Check your route description to compare requirements against param variables [ '+ paramList +']';
            msg = msg.replace(/\%r/, rule);
            console.warn( new Error(msg) );
            //return false;
        }

        return route
    };

    var getFormatedRoute = function(route, url, hash) {
        // fix url in case of empty param value allowed by the routing rule
        // to prevent having a folder.
        // eg.: {..., id: '/^\\s*$/'} => {..., id: ''} => /path/to/ becoming /path/to
        if ( /\/$/.test(url) && url != '/' )
            url = url.substr(0, url.length-1);
        // adding hash if found
        if (hash)
            url += hash;
        
        route.url = url;
        // recommanded for x-bundle coms
        // leave `ignoreWebRoot` empty or set it to false for x-bundle coms
        route.toUrl = function (ignoreWebRoot) {                
            var wroot       = this.webroot
                , hostname  = this.hostname
                , path      = this.url
            ;
            
            this.url = ( typeof(ignoreWebRoot) != 'undefined' && ignoreWebRoot == true ) ? path.replace(wroot, '/') : path;

            return hostname + this.url
        };
        
        return route
    }

    /**
     * Get route by url
     * N.B.: this will only work with rules declared with `GET` method property
     *
     * @function getRouteByUrl
     *
     * @param {string} url e.g.: /webroot/some/url/path or http
     * @param {string} [bundle] targeted bundle
     * @param {string} [method] request method (GET|PUT|PUT|DELETE) - GET is set by default
     * @param {object} [request] 
     * @param {boolean} [isOverridinMethod] // will replace request.method by the provided method - Used for redirections
     * 
     * @return {object|boolean} route - when route is found; `false` when not found
     * */
    
    self.getRouteByUrl = function (url, bundle, method, request, isOverridinMethod) {
        
        if (
            arguments.length == 2 
            && typeof(arguments[1]) != 'undefined' 
            && self.allowedMethods.indexOf(arguments[1].toLowerCase()) > -1 
        ) {
            method = arguments[1];
            bundle = undefined;
        }
        var webroot             = null
            , route             = null
            , routing           = null
            , reverseRouting    = null
            , hash              = null // #section nav
            , hostname          = null
            , host              = null
        ;
        
        if ( /\#/.test(url) && url.length > 1 ) {
            var urlPart = url.split(/\#/);
            url     = urlPart[0];
            hash    = '#' + urlPart[1];
            
            urlPart = null;
        }
        
        // fast method
        if (
            arguments.length == 1 
            && typeof(arguments[0]) != 'undefined'            
        ) {
            if ( !/^(https|http)/i.test(url) && !/^\//.test(url)) {
                url = '/'+ url;
            }
            
            webroot = '/' + url.split(/\//g)[1];
            if (isGFFCtx) {
                reverseRouting  = gina.config.reverseRouting;
                routing         = gina.config.routing
            }
            // get bundle
            if ( typeof(reverseRouting[webroot]) != 'undefined' ) {
                var infos = routing[ reverseRouting[webroot] ];
                bundle      = infos.bundle;
                webroot     = infos.webroot;
                host        = infos.host;
                hostname    = infos.hostname;
                infos       = null;
            }          
        }
        
        isOverridinMethod = ( typeof(arguments[arguments.length-1]) != 'boolean') ? false : arguments[arguments.length-1];

        var matched             = false            
            , config            = null
            , env               = null
            , prefix            = null
            , pathname          = null
            , params            = null
            , isRoute           = null
            , foundRoute        = null            
            , routeObj          = null            
        ;
        
        
        
        var isMethodProvidedByDefault = ( typeof(method) != 'undefined' ) ? true : false;

        if (isGFFCtx) {
            config          = window.gina.config;
            bundle          = (typeof (bundle) != 'undefined') ? bundle : config.bundle;
            env             = config.env;
            routing         = routing || config.getRouting(bundle);
            reverseRouting  = reverseRouting || config.reverseRouting;
            isXMLRequest    = ( typeof(isXMLRequest) != 'undefined' ) ? isXMLRequest : false; // TODO - retrieve the right value

            hostname        = hostname || config.hostname;
            webroot         = webroot || config.webroot;
            prefix          = hostname + webroot;

            request = {
                routing: {},
                method: method,
                params: {},
                url: url
            };
        } else {

            var gnaCtx      = getContext('gina');
            
            config          = gnaCtx.config;
            bundle          = (typeof (bundle) != 'undefined') ? bundle : config.bundle;
            env             = config.env;
            routing         = config.getRouting(bundle);
            
            

            hostname        = config.envConf[bundle][env].hostname;
            webroot         = config.envConf[bundle][env].server.webroot;
            prefix          = hostname + webroot;
            
            if ( !request ) {
                request = {
                    routing: {},
                    isXMLRequest: false,
                    method : ( typeof(method) != 'undefined' ) ? method.toLowerCase() : 'get',
                    params: {},
                    url: url
                }
            }
            if (isOverridinMethod) {
                request.method = method;
            }
            isXMLRequest    = request.isXMLRequest || false;
        }

        pathname    = url.replace( new RegExp('^('+ hostname +'|'+hostname.replace(/\:\d+/, '') +')' ), '');
        if ( typeof(request.routing.path) == 'undefined' )
            request.routing.path = unescape(pathname);
        method      = ( typeof(method) != 'undefined' ) ? method.toLowerCase() : 'get';
                
        if (isMethodProvidedByDefault) {
            // to handle 303 redirect like PUT -> GET
            request.originalMethod = request.method;
            
            request.method = method;
            request.routing.path = unescape(pathname)
        }
        // last method check
        if ( !request.method)
            request.method = method;

        //  getting params
        params = {};
        
        

        var paramsList = null;
        var re = new RegExp(method, 'i');
        var localMethod = null;
        // N.B.: this part of the code must remain identical to the one used in `server.js`
        out:
            for (var name in routing) {
                if (typeof (routing[name]['param']) == 'undefined')
                    break;

                // bundle filter
                if (routing[name].bundle != bundle) continue;

                // method filter
                localMethod = routing[name].method;             
                if ( /\,/.test( localMethod ) && re.test(localMethod) ) {
                    localMethod = request.method
                } 
                if (typeof (routing[name].method) != 'undefined' && !re.test(localMethod)) continue;
                
                //Preparing params to relay to the core/router.                
                params = {
                    method              : localMethod,
                    requirements        : routing[name].requirements,
                    namespace           : routing[name].namespace || undefined,
                    url                 : unescape(pathname), /// avoid %20
                    rule                : routing[name].originalRule || name,
                    param               : routing[name].param,
                    //middleware: routing[name].middleware,
                    middleware          : JSON.clone(routing[name].middleware),
                    bundle              : routing[name].bundle,
                    isXMLRequest        : isXMLRequest
                };

                // normal case
                //Parsing for the right url.
                try {                                        
                    
                    isRoute = self.compareUrls(params, routing[name].url, request);

                    if (isRoute.past) {

                        route = JSON.clone(routing[name]);
                        route.name = name;

                        matched = true;
                        isRoute = {};

                        break;
                    }

                } catch (err) {
                    throw new Error('Route [ ' + name + ' ] needs your attention.\n' + err.stack);
                }
            } //EO for break out

        if (!matched) {
            if (isGFFCtx) {  
                var urlHasChanged = false;              
                if ( 
                    url == '#' 
                    && /GET/i.test(method) 
                    && isMethodProvidedByDefault 
                    || /^404\:/.test(url)
                ) {
                    url = location.pathname;
                    urlHasChanged = true;
                }
                
                if ( typeof(self.notFound) == 'undefined' ) {
                    self.notFound = {}
                }
                
                var notFound = null, msg = '[ RoutingHelper::getRouteByUrl(rule[, bundle, method]) ] : route [ %r ] is called but not found inside your view: `' + url + '` !';
                if ( gina.hasPopinHandler && gina.popinIsBinded ) {
                    notFound = gina.popin.getActivePopin().target.innerHTML.match(/404\:\[\w+\][a-z 0-9-_@]+/);
                } else {
                    notFound = document.body.innerHTML.match(/404\:\[\w+\][a-z 0-9-_@]+/);
                }
               
                notFound = (notFound && notFound.length > 0) ? notFound[0] : null;
                
                if ( notFound && isMethodProvidedByDefault && urlHasChanged ) {
                                        
                    var m = notFound.match(/\[\w+\]/)[0];                    
                    
                    notFound = notFound.replace('404:'+m, m.replace(/\[|\]/g, '')+'::' );
                    
                    msg = msg.replace(/\%r/, notFound.replace(/404\:\s+/, ''));
                    
                    if (typeof(self.notFound[notFound]) == 'undefined') {
                        self.notFound[notFound] = { 
                            count: 1,
                            message: msg 
                        };
                    } else if ( isMethodProvidedByDefault && typeof(self.notFound[notFound]) != 'undefined' ) {
                        ++self.notFound[notFound].count;
                    }
                                                
                    return false  
                } 
                
                notFound = null;     
                                               
                var altRule = gina.config.reverseRouting[url] || null;                
                if (
                    !notFound 
                    && altRule
                    && typeof(altRule) != 'undefined'
                    && altRule.split(/\@(.+)$/)[1] == bundle
                ) {
                    
                    notFound = altRule;
                    if ( typeof(self.notFound[notFound]) == 'undefined' ) {
                        
                        msg = msg.replace(/\%r/, method.toUpperCase() +'::'+ altRule);
                        
                        self.notFound[notFound] = { 
                            count: 1,
                            message: msg 
                        };
                        //console.warn(msg);   
                    } else if ( isMethodProvidedByDefault && typeof(self.notFound[notFound]) != 'undefined' ) {
                        ++self.notFound[notFound].count;
                    }
                                                    
                    return false
                }
                
                // forms
                var altRoute = self.compareUrls(params, url, request) || null;
                if(altRoute.past && isMethodProvidedByDefault) {
                    notFound = method.toUpperCase() +'::'+ altRoute.request.routing.rule;
                    if ( typeof(self.notFound[notFound]) == 'undefined' ) {
                        msg = msg.replace(/\%r/, notFound);
                        //console.warn(msg);  
                    } else {
                        ++self.notFound[notFound].count;
                    }
                                                     
                    return false
                }                                             
                return false
            }

            
            console.warn( new Error('[ RoutingHelper::getRouteByUrl(rule[, bundle, method, request]) ] : route not found for url: `' + url + '` !').stack );            
            return false;
        } else {
            // fix url in case of empty param value allowed by the routing rule
            // to prevent having a folder.
            // eg.: {..., id: '/^\\s*$/'} => {..., id: ''} => /path/to/ becoming /path/to
            if ( /\/$/.test(url) && url != '/' )
                url = url.substr(0, url.length-1);
            // adding hash if found
            if (hash)
                url += hash;
            
            route.url = url;
            // recommanded for x-bundle coms
            // leave `ignoreWebRoot` empty or set it to false for x-bundle coms
            route.toUrl = function (ignoreWebRoot) {                
                var wroot       = this.webroot
                    , hostname  = this.hostname
                    , path      = this.url
                ;
                
                this.url = ( typeof(ignoreWebRoot) != 'undefined' && ignoreWebRoot == true ) ? path.replace(wroot, '/') : path;
    
                return hostname + this.url
            };
            
            return route
        }
    }

    return self
}

if ((typeof (module) !== 'undefined') && module.exports) {
    // Publish as node.js module
    module.exports = Routing()
} else if (typeof (define) === 'function' && define.amd) {
    // Publish as AMD module
    define(function() { return Routing() })
}