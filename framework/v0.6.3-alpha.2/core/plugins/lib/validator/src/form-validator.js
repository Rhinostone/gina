/**
 * FormValidatorUtil
 *
 * Dependencies:
 *  - lib/helpers
 *  - lib/helpers/dateFormat
 *  - lib/merge
 *  - lib/routing (for API calls)
 *
 * @param {object} data
 * @param {object} [ $fields ] - isGFFCtx only
 * @param {object} [ xhrOptions ] - isGFFCtx only
 * @param {object} [ fieldsSet ] - isGFFCtx only; required for when ginaFormLiveCheckEnabled
 * @param {string} [ culture ] - !isGFFCtx (server) only; per-request culture (e.g. "fr_FR").
 *      When a string, built-in rule labels resolve from the bundle catalog's
 *      `_validator.<rule>` namespace (catalog wins per key, English defaults fill).
 *      A non-string (e.g. the routing-mode rule object) is ignored by the overlay guard.
 * */
function FormValidatorUtil(data, $fields, xhrOptions, fieldsSet, culture) {

    var isGFFCtx        = ( ( typeof(module) !== 'undefined' ) && module.exports ) ? false : true;

    // if (isGFFCtx && !$fields )
    //     throw new Error('No `Validator` instance found.\nTry:\nvar FormValidator = require("gina/validator"):\nvar formValidator = new FormValidator(...);')

    var merge           = (isGFFCtx) ? require('lib/merge') : require('../../../../../lib/merge');
    var helpers         = (isGFFCtx) ? {} : require('../../../../../helpers');
    var dateFormat      = (isGFFCtx) ? require('helpers/dateFormat') : helpers.dateFormat;
    var routing         = (isGFFCtx) ? require('lib/routing') : require('../../../../../lib/routing');
    // #i18n (server only) - bundle catalog access for built-in-label localization.
    var i18n            = (isGFFCtx) ? null : require('../../../../../lib/i18n');

    /**
     * #CSRF2 follow-up — read the gina-csrf-token cookie set by the Csrf plugin.
     *
     * Pure, dependency-free parser for `document.cookie`. Returns the token
     * value (URL-decoded) or null when the cookie is absent. Browser-only
     * (isGFFCtx); when running outside a browser document, returns null.
     *
     * No eval / Function / regex on user-controlled segments — name and
     * value are compared as plain strings via indexOf + slice only.
     *
     * @returns {string|null}
     * */
    var readCsrfCookie = function () {
        var name = 'gina-csrf-token';
        if ( typeof(document) === 'undefined' || !document || typeof(document.cookie) !== 'string' ) {
            return null;
        }
        var raw = document.cookie || '';
        if (!raw) {
            return null;
        }
        var parts = raw.split(';');
        for (var i = 0, len = parts.length; i < len; ++i) {
            var part = parts[i];
            while (part.charAt(0) === ' ' || part.charAt(0) === '\t') {
                part = part.slice(1);
            }
            var eq = part.indexOf('=');
            if (eq < 0) {
                continue;
            }
            var key = part.slice(0, eq);
            if (key !== name) {
                continue;
            }
            var val = part.slice(eq + 1);
            try {
                return decodeURIComponent(val);
            } catch (e) {
                return val;
            }
        }
        return null;
    };

    /**
     * #CSRF2 follow-up — true for HTTP methods that mutate state.
     *
     * GET, HEAD, OPTIONS are CSRF-safe by spec. All other methods require
     * the X-Gina-CSRF-Token header.
     *
     * @param {string} method
     * @returns {boolean}
     * */
    var isMutatingMethod = function (method) {
        if ( typeof(method) !== 'string' || !method ) {
            return false;
        }
        var m = method.toUpperCase();
        return (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS');
    };

    var hasUserValidators = function() {

        var _hasUserValidators = false, formsContext = null;
        // backend validation check
        if (!isGFFCtx) {
            // TODO - retrieve bakcend forms context
            formsContext = getContext('gina').forms || null;
        } else if (isGFFCtx &&  typeof(gina.forms) != 'undefined') {
            formsContext = gina.forms
        }
        if ( formsContext && typeof(formsContext.validators) != 'undefined' ) {
            _hasUserValidators = true
        }
        return _hasUserValidators;
    }
    /**@js_externs local*/
    var local = {
        'errors': {},
        'keys': {
            '%l': 'label', // %l => label: needs `data-gina-form-field-label` attribute (frontend only)
            '%n': 'name', // %n => field name
            '%s': 'size' // %s => length
        },
        'errorLabels': {},
        'data': {}, // output to send
        'excluded': []
    };

    // Built-in rule labels default to English. When the browser has a negotiated
    // culture on `gina.config.culture` AND the app registered per-culture overrides
    // via `gina.validator.setErrorLabels()`, overlay that culture's labels over the
    // English defaults (app label wins per key, English fills gaps — same merge
    // direction as `setErrorLabels()` below). Fallback: exact culture (`fr_FR`) ->
    // base language (`fr`) -> English. Server-side (`!isGFFCtx`) and when nothing is
    // registered, English is used verbatim. A per-field/rule `error` still wins over
    // all of this (see `this.error || local.errorLabels[...]` at each rule).
    var _defaultErrorLabels = {
        'is': 'Condition not satisfied',
        'isEmail': 'A valid email is required',
        'isRequired': 'Cannot be left empty',
        'isBoolean': 'Must be a valid boolean',
        'isNumber': 'Must be a number: allowed values are integers or floats',
        'isNumberLength': 'Must contain %s characters',
        'isNumberMinLength': 'Should be at least %s characters',
        'isNumberMaxLength': 'Should not be more than %s characters',
        'isInteger': 'Must be an integer',
        'isIntegerLength': 'Must have %s characters',
        'isIntegerMinLength': 'Should be at least %s characters',
        'isIntegerMaxLength': 'Should not be more than %s characters',
        'toInteger': 'Could not be converted to integer',
        'isFloat': 'Must be a proper float',
        'isFloatException': 'Float exception found: %n',
        'toFloat': 'Could not be converted to float',
        'toFloatNAN': 'Value must be a valid number',
        'isDate': 'Must be a valid Date',
        'isString': 'Must be a string',
        'isStringLength': 'Must have %s characters',
        'isStringMinLength': 'Should be at least %s characters',
        'isStringMaxLength': 'Should not be more than %s characters',
        'isJsonWebToken': 'Must be a valid JSON Web Token',
        'query': 'Must be a valid response',
        'isApiError': 'Condition not satisfied',
        'isInList': 'Must be one of: %s'
    };
    /**
     * Rules already warned about by `replace()`'s fail-soft guard, so one mistyped label
     * emits one warning and not one per debounced keystroke. Scoped to this engine
     * instance on purpose: `validate()` builds a fresh engine per pass, but a
     * module-scoped cache would suppress a second bundle's warning on the server, where
     * the module is shared across bundles and requests.
     * @inner
     * @type {Object.<string, boolean>}
     */
    var _labelWarnings = {};
    /**
     * #B178 — errors-key / label-key alias fill for app-supplied labels.
     *
     * Four rule families consult a SPECIFIC label key while writing the error
     * under a GENERIC one (the NaN branch of the float coercion, and the
     * min/max variants of the three Length families), so the key an app can
     * OBSERVE in a field's `errors` object is not the key the catalog is
     * consulted under — translating the observable key was a silent no-op.
     * This copies each app-supplied generic onto the specifics the app did
     * not supply itself. English defaults are never touched here; an
     * app-supplied specific key always wins over its generic.
     * @inner
     * @param {object} labels - app-supplied label map (extended in place)
     * @returns {object} the same map, alias keys filled
     */
    var _labelAliasFill = function(labels) {
        // consulted (specific) key <- supplied (observable/generic) key
        var aliasMap = {
            'toFloatNAN'         : 'toFloat',
            'isNumberMinLength'  : 'isNumberLength',
            'isNumberMaxLength'  : 'isNumberLength',
            'isIntegerMinLength' : 'isIntegerLength',
            'isIntegerMaxLength' : 'isIntegerLength',
            'isStringMinLength'  : 'isStringLength',
            'isStringMaxLength'  : 'isStringLength'
        };
        for (var specific in aliasMap) {
            if (
                typeof(labels[specific]) == 'undefined'
                && typeof(labels[aliasMap[specific]]) != 'undefined'
            ) {
                labels[specific] = labels[aliasMap[specific]];
            }
        }
        return labels;
    };
    local.errorLabels = _defaultErrorLabels;
    // #i18n (server) — resolve built-in rule labels from the bundle catalog's
    // `_validator.<rule>` namespace for the negotiated `culture`. Mirrors the client
    // overlay below (catalog wins per key, English defaults fill gaps — target-wins
    // merge). Existence-guarded via i18n.resolveKey (undefined on miss, never `t()`
    // which echoes the raw key). A per-field/rule `error` still wins (see
    // `this.error || local.errorLabels[...]` at each rule).
    if ( !isGFFCtx && i18n && typeof(culture) === 'string' && culture ) {
        var _vBundle = getContext('bundle');
        if (_vBundle) {
            var _vChain = i18n.walkFallback(culture), _vNode = null;
            for (var _vi = 0; _vi < _vChain.length; _vi++) {
                var _vCat = i18n.getCatalog(_vBundle, _vChain[_vi]);
                if (_vCat) {
                    var _vFound = i18n.resolveKey(_vCat, '_validator');
                    if (_vFound && typeof(_vFound) === 'object') { _vNode = _vFound; break; }
                }
            }
            if (_vNode) {
                // #B178 — fill consulted-key aliases from the app's observable keys first
                _vNode = _labelAliasFill(JSON.clone(_vNode));
                local.errorLabels = merge(JSON.clone(_vNode), _defaultErrorLabels);
            }
        }
    }
    // #i18n (client) — overlay built-in rule labels for the negotiated culture.
    // Precedence (highest first): app `setErrorLabels()` overrides
    // (`gina.validator._errorLabelsByCulture[<culture>]`) > server-whispered bundle
    // catalog subset (`gina.config.validatorLabels`, resolved server-side for
    // `gina.config.culture`) > English defaults. Each layer is applied by a
    // target-wins/source-fills merge over the running `local.errorLabels`, so a
    // higher layer wins per key and lower layers fill gaps. Client only (isGFFCtx);
    // a per-field/rule `error` still wins over all of this.
    if (
        isGFFCtx
        && typeof(gina) != 'undefined'
        && typeof(gina.config) != 'undefined'
    ) {
        var _culture       = gina.config.culture;
        var _baseLang      = ( _culture && _culture.indexOf('_') > 0 ) ? _culture.substr(0, _culture.indexOf('_')) : _culture;
        // layer 3 (highest) — app-registered per-culture overrides (setErrorLabels)
        var _cultureLabels = ( typeof(gina.validator) != 'undefined' && gina.validator._errorLabelsByCulture && _culture )
            ? ( gina.validator._errorLabelsByCulture[_culture]
                || ( _baseLang ? gina.validator._errorLabelsByCulture[_baseLang] : null )
                || null )
            : null;
        // layer 2 — server-whispered bundle catalog subset (culture-resolved server-side)
        var _catalogLabels = null;
        if ( gina.config.validatorLabels && typeof(gina.config.validatorLabels) == 'object' ) {
            for (var _clk in gina.config.validatorLabels) {
                if ( gina.config.validatorLabels.hasOwnProperty(_clk) ) { _catalogLabels = gina.config.validatorLabels; break; }
            }
        }
        // apply lowest-precedence layer first, then let each higher layer win per key
        if (_catalogLabels) {
            // #B178 — alias fill on a copy, so the whispered config object is never mutated
            _catalogLabels = _labelAliasFill(JSON.clone(_catalogLabels));
            local.errorLabels = merge(JSON.clone(_catalogLabels), local.errorLabels);
        }
        if (_cultureLabels) {
            _cultureLabels = _labelAliasFill(JSON.clone(_cultureLabels));
            local.errorLabels = merge(JSON.clone(_cultureLabels), local.errorLabels);
        }
    }
    var self  = null;
    if (!data) {
        throw new Error('missing data param')
    } else {
        // cloning
        self  = merge(JSON.clone(data), self );
        // self  = merge(data, self );
        local.data = merge(JSON.clone(data), local.data);
        // local.data = merge(data, local.data);
    }

    var getElementByName = function($form, name) { // frontend only
        var $foundElement   = null;
        for (let f in fieldsSet) {
            if (fieldsSet[f].name !== name) continue;

            $foundElement = new DOMParser()
                .parseFromString($form.innerHTML , 'text/html')
                .getElementById( fieldsSet[f].id );
            break;
        }
        if ($foundElement)
            return $foundElement;

        throw new Error('Field `'+ name +'` not found in fieldsSet');
    }

    /**
     * bufferToString - Convert Buffer to String
     * Will apply `Utf8Array` to `String`
     * @param {array} arrayBuffer
     */
    var bufferToString = function(arrayBuffer) {
        var out     = null
            , i     = null
            , len   = null
            , c     = null
        ;
        var char2 = null, char3 = null;

        out = '';
        len = arrayBuffer.length;
        i   = 0;
        while(i < len) {
            c = arrayBuffer[i++];
            switch (c >> 4) {
                case 0: case 1: case 2: case 3: case 4: case 5: case 6: case 7:
                    // 0xxxxxxx
                    out += String.fromCharCode(c);
                    break;
                case 12: case 13:
                    // 110x xxxx   10xx xxxx
                    char2 = arrayBuffer[i++];
                    out += String.fromCharCode(((c & 0x1F) << 6) | (char2 & 0x3F));
                    break;
                case 14:
                    // 1110 xxxx  10xx xxxx  10xx xxxx
                    char2 = arrayBuffer[i++];
                    char3 = arrayBuffer[i++];
                    out += String.fromCharCode(((c & 0x0F) << 12) |
                                ((char2 & 0x3F) << 6) |
                                ((char3 & 0x3F) << 0));
                    break;
            }
        }

        return out;
    };

    var compileError = function(error, data) {
        // #B87: tolerate a non-string `error` from a future call site — the only
        // current caller is string-gated at the query result site, but nothing in
        // this function's own contract enforces it and `error.match()` throws on
        // anything else. A non-string carries no `{{placeholder}}` to compile, so
        // it is returned as-is; if it then lands in `replace()` as a label, the
        // #B86 fail-soft degrades it to the English default with a warn.
        if ( typeof(error) != 'string' ) {
            return error;
        }
        var varArr = error.match(/\{\{([^{{}}]+)\}\}/g );
        // `String.match` with a /g regex yields `null` — not [] — when nothing matches, so a
        // backend field error carrying no `{{placeholder}}` (the common shape, e.g. "Already
        // taken") used to die on `varArr.length` before it could be rendered. Nothing along
        // the only call path catches it, and the throw kills the whole validation pass.
        if (!varArr) {
            return error;
        }
        for (let v=0, vLen=varArr.length; v<vLen; v++) {
            let localValue = varArr[v]
                                .replace(/\[/g, '["')
                                .replace(/\]/g, '"]')
                                .replace(/\{|\}/g, '')
                                .trim();

            try {
                // #SCS1e (2026-04-24) — replaced `eval('data.' + localValue)` with a safe
                // dot+bracket path walker. `localValue` is derived from `{{...}}` placeholders
                // in error messages; the transforms at lines 152-158 produce
                // `ident (. ident | ["quoted"])*`. The old eval executed anything that parsed
                // as JS; a crafted placeholder like `{{constructor.constructor('return
                // process.exit()')()}}` would reach eval unsanitised (the `[` → `["` / `]` →
                // `"]` transforms don't neutralise dotted method access). The walker rejects
                // any segment that isn't a bare identifier or a double-quoted bracket key.
                // localValue = eval('data.'+ localValue).replace(/^\"|\"$/g, '');
                let _scsRest = localValue;
                let _scsSegments = [];
                let _scsM = _scsRest.match(/^([A-Za-z_$][\w$]*)/);
                if (!_scsM) { throw new Error('Invalid property path: `' + localValue + '`'); }
                _scsSegments.push(_scsM[1]);
                _scsRest = _scsRest.slice(_scsM[0].length);
                while (_scsRest.length > 0) {
                    _scsM = _scsRest.match(/^\.([A-Za-z_$][\w$]*)/);
                    if (_scsM) {
                        _scsSegments.push(_scsM[1]);
                        _scsRest = _scsRest.slice(_scsM[0].length);
                        continue;
                    }
                    _scsM = _scsRest.match(/^\["([^"\]]*)"\]/);
                    if (_scsM) {
                        _scsSegments.push(_scsM[1]);
                        _scsRest = _scsRest.slice(_scsM[0].length);
                        continue;
                    }
                    throw new Error('Invalid property path: `' + localValue + '`');
                }
                let _scsCur = data;
                for (let _scsI = 0; _scsCur != null && _scsI < _scsSegments.length; _scsI++) {
                    _scsCur = _scsCur[_scsSegments[_scsI]];
                }
                localValue = _scsCur.replace(/^\"|\"$/g, '');
                error = error.replace( new RegExp( varArr[v].replace(/\{|\[|\]|\}/g, '\\$&') , 'g'), localValue);
            } catch(e) {}
        }

        return error
    };

    // TODO - One method for the front, and one for the server
    var queryFromFrontend = function(options, errorMessage) {
        var errors      = self[this['name']]['errors'] || {};
        var id          = this.target.id || this.target.getAttribute('id');


        // stop if
        //  - previous error detected
        if ( !self.isValid() ) {
            console.debug('stopping on errors ...');
            triggerEvent(gina, this.target, 'asyncCompleted.' + id, self[this['name']]);
            //return self[this.name];
            return;
        }

        var testedValue = this.target.dataset.ginaFormValidatorTestedValue;
        console.debug('[ '+ this['name'] +' ]', 'TESTED VALUE -> ' + this.value +' vs '+ testedValue);
        var _evt = 'asyncCompleted.' + id;
        var currentFormId = this.target.form.getAttribute('id');
        var cachedErrors = (
                            typeof(gina.validator) != 'undefined'
                            && typeof(gina.validator.$forms[currentFormId]) != 'undefined'
                            && typeof(gina.validator.$forms[currentFormId].cachedErrors) != 'undefined'
                        )
                        ? gina.validator.$forms[currentFormId].cachedErrors
                        : null;
        if ( !testedValue || typeof(testedValue) == 'undefined' || testedValue !== this.value ) {
            this.target.dataset.ginaFormValidatorTestedValue = this.value;
            // remove cachedErrors
            if (
                cachedErrors
                && typeof(cachedErrors[this.name]) != 'undefined'
                && typeof(cachedErrors[this.name].query) != 'undefined'
            ) {
                delete cachedErrors[this.name].query;
                if (
                    typeof(gina.validator.$forms[currentFormId]) != 'undefined'
                    &&
                    typeof(gina.validator.$forms[currentFormId].errors) != 'undefined'
                ) {
                    delete gina.validator.$forms[currentFormId].errors.query;
                }

            }
        } else if (testedValue === this.value) {
            // not resending to backend, but in case of cached errors, re display same error message
            var hasCachedErrors = false;
            if (
                cachedErrors
                && typeof(cachedErrors[this.name]) != 'undefined'
                && typeof(cachedErrors[this.name].query) != 'undefined'
                && typeof(cachedErrors[this.name].query[this.value]) != 'undefined'
            ) {
                this.error = errorMessage = cachedErrors[this.name].query[this.value].slice(0);
                hasCachedErrors = true;
            }
            errors['query'] = replace( this.error || errorMessage || local.errorLabels['query'], this, 'query');
            console.debug('[2] potential cached error detected !! ', hasCachedErrors, cachedErrors, ' vs ', errors['query']);

            if (hasCachedErrors) {
                this['errors'] = errors;
                this.valid = false;
            }
            // Do not remove this test
            if ( typeof( gina.events[_evt]) != 'undefined' ) {
                triggerEvent(gina, this.target, _evt, self[this['name']]);
            }

            return self[this.name];
        }
        //console.debug('Did not return !!!');

        var xhr = null, _this = this;
        // setting up AJAX
        if (window.XMLHttpRequest) { // Mozilla, Safari, ...
            xhr = new XMLHttpRequest();
        } else if (window.ActiveXObject) { // IE
            try {
                xhr = new ActiveXObject("Msxml2.XMLHTTP");
            } catch (e) {
                try {
                    xhr = new ActiveXObject("Microsoft.XMLHTTP");
                }
                catch (e) {}
            }
        }

        // forcing to sync mode
        var queryOptions = { isSynchrone: false, headers: {} };
        var queryData = options.data || null, strData = null;
        var isInlineValidation = (/^true$/i.test(this.target.form.dataset.ginaFormLiveCheckEnabled)) ? true : false; // TRUE if liveCheckEnabled

        // replace placeholders by field values
        strData = JSON.stringify(queryData);
        if ( /\$/.test(strData) ) {
            var variables = strData.match(/\$[-_\[\]a-z 0-9]+/g) || [];
            var value = null, key = null;
            for (let i = 0, len = variables.length; i < len; i++) {
                key = variables[i].replace(/\$/g, '');
                re = new RegExp("\\"+ variables[i].replace(/\[|\]/g, '\\$&'), "g");
                value = local.data[key] || null;
                if (!value && isInlineValidation) {
                    // Retrieving live value instead of using fieldsSet.value
                    value = getElementByName(this.target.form, key).value;
                }

                strData = strData.replace( re, value );
            }
        }
        // cleanup before sending
        queryData = strData.replace(/\\"/g, '');
        // TODO - support regexp for validIf
        var validIf = ( typeof(options.validIf) == 'undefined' ) ? true : options.validIf;

        queryOptions = merge(queryOptions, options, xhrOptions);
        delete queryOptions.data;
        delete queryOptions.validIf;

        var enctype = queryOptions.headers['Content-Type'];
        var result      = null
            , $target   = this.target
            //, id        = $target.getAttribute('id')
        ;
        id = $target.getAttribute('id')

        // checking url
        if (!/^http/.test(queryOptions.url) && /\@/.test(queryOptions.url) ) {
            try {
                var route = routing.getRoute(queryOptions.url);
                queryOptions.url = route.toUrl();
            } catch (routingError) {
                throw routingError;
            }
        }

        if ( queryOptions.withCredentials ) {
            if ('withCredentials' in xhr) {
                // XHR for Chrome/Firefox/Opera/Safari.
                if (queryOptions.isSynchrone) {
                    xhr.open(queryOptions.method, queryOptions.url, queryOptions.isSynchrone)
                } else {
                    xhr.open(queryOptions.method, queryOptions.url)
                }
            } else if ( typeof XDomainRequest != 'undefined' ) {
                // XDomainRequest for IE.
                xhr = new XDomainRequest();
                // if (queryOptions.isSynchrone) {
                //     xhr.open(queryOptions.method, queryOptions.url, queryOptions.isSynchrone);
                // } else {
                    xhr.open(queryOptions.method, queryOptions.url);
                // }
            } else {
                // CORS not supported.
                xhr = null;
                result = 'CORS not supported: the server is missing the header `"Access-Control-Allow-Credentials": true` ';
                //triggerEvent(gina, $target, 'error.' + id, result);
                throw new Error(result);
            }

            if ( typeof(queryOptions.responseType) != 'undefined' ) {
                /**
                 * Note: We expect to remove support for synchronous use of XMLHTTPRequest() during page unloads in Chrome in version 88,
                 * scheduled to ship in January 2021.
                 * The XMLHttpRequest2 spec was recently changed to prohibit sending a synchronous request when XMLHttpRequest.responseType
                 */
                xhr.responseType = queryOptions.responseType;
            } else {
                xhr.responseType = '';
            }

            xhr.withCredentials = true;
        } else {
            if (queryOptions.isSynchrone) {
                xhr.open(queryOptions.method, queryOptions.url, queryOptions.isSynchrone)
            } else {
                xhr.open(queryOptions.method, queryOptions.url)
            }
        }

        // setting up headers -    all but Content-Type ; it will be set right before .send() is called
        for (var hearder in queryOptions.headers) {
            if (hearder == 'Content-Type' && typeof (enctype) != 'undefined' && enctype != null && enctype != '')
                continue;

            xhr.setRequestHeader(hearder, queryOptions.headers[hearder]);
        }
        if (typeof (enctype) != 'undefined' && enctype != null && enctype != '') {
            xhr.setRequestHeader('Content-Type', enctype);
        }

        // #CSRF2 follow-up — inject X-Gina-CSRF-Token on mutating methods (live-validation path)
        if ( isMutatingMethod(queryOptions.method) ) {
            var csrfToken = readCsrfCookie();
            if (csrfToken) {
                xhr.setRequestHeader('X-Gina-CSRF-Token', csrfToken);
            }
        }

        var processQueryResult = function(result) {

            // #B87: a boolean checkbox routed through a `query` rule carries a real
            // boolean — `.toLowerCase()` only applies to string values
            _this.value      = local['data'][_this.name] = (_this.value && typeof(_this.value) == 'string') ? _this.value.toLowerCase() : _this.value;

            var isValid     = result.isValid || false;
            if (validIf != isValid) {
                isValid = false;
            } else {
                isValid = true;
            }
            self[_this['name']].valid = isValid;
            var errors      = self[_this['name']]['errors'] || {};

            var errorFields = ( typeof(result.error) != 'undefined' && typeof(result.fields) != 'undefined' ) ? result.fields : {};

            if (errorFields.count() > 0 && !isValid || !isValid) {

                if (!isValid) {
                    var systemError = null;
                    if ( typeof(errorFields[_this.name]) != 'undefined') {

                        // compiling against rules[field].query.data
                        // Only a string can be compiled — `compileError` runs `error.match()`.
                        // A non-string field error from the backend leaves the resolved
                        // `query` label in place (localized, else the English default)
                        // rather than taking the pass down.
                        if ( typeof(errorFields[_this.name]) === 'string' ) {
                            local.errorLabels['query'] = compileError(errorFields[_this.name], options.data);
                        }


                    } else if ( typeof(result.error) != 'undefined' && /^5/.test(result.status) ) {
                        // system error
                        systemError = result.error;
                    }
                    // Fixed added on 2023-01-10
                    // We want `local.errorLabels['query']` before the generic|user defined `rule` error
                    var optionError = ( typeof(options['error']) != 'undefined' ) ? options['error'] : null;
                    errors['query'] = replace(systemError || _this['error'] || optionError || local.errorLabels['query'], _this, 'query');

                    console.debug('[1] query error detected !! ', result, errorFields, errors['query']);
                }

                if ( !errors['query'] && _this.value == '' ) {
                    isValid = true;
                }
            }

            // if error tagged by a previous validation, remove it when isValid == true
            if ( isValid && typeof(errors['query']) != 'undefined' ) {
                delete errors['query'];
            }

            // To handle multiple errors from backend
            // for (var f in errorFields.length) {
            //     if ( !errors['query'] && _this.value == '' ) {
            //         isValid = true;
            //     }

            //     if (!isValid) {
            //         errors['query'] = replace(_this['error'] || local.errorLabels['query'], _this)
            //     }
            //     // if error tagged by a previous validation, remove it when isValid == true
            //     else if ( isValid && typeof(errors['query']) != 'undefined' ) {
            //         delete errors['query'];
            //     }
            // }

            _this.valid = isValid;
            var cachedErrors = gina.validator.$forms[_this.target.form.getAttribute('id')].cachedErrors || {};
            if ( errors.count() > 0 ) {

                _this['errors'] = errors;
                if ( typeof(self[_this['name']].errors) == 'undefined' ) {
                    self[_this['name']].errors = {};
                }

                self[_this['name']].errors = merge(self[_this['name']].errors, errors);

                if ( typeof(errors.query) != 'undefined' && errors.query ) {

                    if ( typeof(cachedErrors[_this.name]) == 'undefined' ) {
                        cachedErrors[_this.name] = {}
                    }
                    if ( typeof(cachedErrors[_this.name].query) == 'undefined' ) {
                        cachedErrors[_this.name].query = {}
                    }

                    cachedErrors[_this.name].query[_this.value] = errors.query.slice(0);
                }

                var errClass = _this.target.getAttribute('data-gina-form-errors');
                if ( !/query/.test(errClass) ) {
                    if ( !errClass || errClass =='' ) {
                        errClass = 'query'
                    } else {
                        errClass +=' query'
                    }
                    _this.target.setAttribute('data-gina-form-errors', errClass);
                }
            } else if (
                typeof(cachedErrors[_this.name]) != 'undefined'
                && typeof(cachedErrors[_this.name].query) != 'undefined'
                && typeof(cachedErrors[_this.name].query[_this.value]) != 'undefined'
            ) {
                delete cachedErrors[_this.name].query[_this.value];
            }

            var id = _this.target.id || _this.target.getAttribute('id');
            console.debug('prematurely completed event `'+ 'asyncCompleted.' + id +'`');

            return triggerEvent(gina, _this.target, 'asyncCompleted.' + id, self[_this['name']]);
        } // EO processQueryResult

        /**
         * #B87 blanket guard: the XHR result lands asynchronously, so by the
         * time it is processed the form may have been unbound or the field
         * detached (e.g. a popin closed mid-flight) — a throw inside the
         * processing used to leave `asyncCompleted.<id>` unfired, hanging the
         * submit path's async waiter for the whole pass. Warn and release the
         * waiter with the field state as-is: the query verdict is unknown,
         * and the server re-validates on submit either way.
         *
         * @inner
         * @param {object} err - Error thrown while handling the query result
         *
         * @returns {undefined}
         */
        var releaseQueryWaiter = function(err) {
            console.warn('[ FormValidator ] `query` result handling failed for field `'+ (_this && _this.name) +'`: '+ ( err && err.message || err ));
            try {
                var _releaseId = _this.target && (_this.target.id || _this.target.getAttribute('id'));
                if (_releaseId) {
                    triggerEvent(gina, _this.target, 'asyncCompleted.' + _releaseId, self[_this['name']]);
                }
            } catch (ignore) {}
        }

        /**
         * Guarded entry point for the XHR handlers below — delegates to
         * `processQueryResult` and routes any throw to `releaseQueryWaiter`
         * so the async waiter can never be left hanging (#B87).
         *
         * @inner
         * @param {object} result - Parsed backend response
         *
         * @returns {undefined}
         */
        var onResult = function(result) {
            try {
                return processQueryResult(result);
            } catch (err) {
                return releaseQueryWaiter(err);
            }
        }


        if (xhr) {

            xhr.onerror = function(event, err) {
                // #B87: blanket-guarded like `xhr.onload` — a throw while shaping
                // the error result (e.g. bad JSON under a JSON content-type) must
                // release the async waiter, not hang it
                try {
                    var error = 'Transaction error: might be due to the server CORS settings.\nPlease, check the console for more details.';
                    var result = {
                        'status':  xhr.status, //500,
                        'error' : error
                    };

                    console.debug('query error [2] detected !! ', err, error);
                    isOnException = true;
                    result = this.responseText;
                    var contentType     = this.getResponseHeader("Content-Type");
                    if ( /\/json/.test( contentType ) ) {
                        result = JSON.parse(this.responseText);

                        if ( typeof(result.status) == 'undefined' )
                            result.status = this.status;

                        //triggerEvent(gina, $target, 'success.' + id, result);
                        return onResult(result)
                    } else {
                        result = { 'status': xhr.status, 'message': '' };
                        if ( /^(\{|\[)/.test( xhr.responseText ) ) {
                            try {
                                result = merge( result, JSON.parse(xhr.responseText) );
                            } catch (err) {
                                result = merge(result, err);
                            }
                        }
                        return onResult(result);
                    }
                } catch (e) {
                    return releaseQueryWaiter(e);
                }
            }// Eo xhr.onerror

            // catching ready state cb
            // var isOnException = false;
            // xhr.onreadystatechange = function (event) {
            //     if (xhr.readyState == 4) {

            //         console.warn(xhr.status, xhr.responseText);

            //         if (xhr.status === 200) {
            //             console.log("-> Success [3]" + xhr.responseText);
            //             try {
            //                 result = this.responseText;
            //                 var contentType     = this.getResponseHeader("Content-Type");
            //                 if ( /\/json/.test( contentType ) ) {
            //                     result = JSON.parse(this.responseText);

            //                     if ( typeof(result.status) == 'undefined' )
            //                         result.status = this.status;

            //                     //triggerEvent(gina, $target, 'success.' + id, result);
            //                     return onResult(result)
            //                 } else {
            //                     result = { 'status': xhr.status, 'message': '' };
            //                     if ( /^(\{|\[)/.test( xhr.responseText ) ) {
            //                         try {
            //                             result = merge( result, JSON.parse(xhr.responseText) );
            //                         } catch (err) {
            //                             result = merge(result, err);
            //                         }
            //                     }
            //                     return onResult(result);
            //                 }
            //             } catch (err) {
            //                 throw err;
            //             }
            //         } else {
            //             isOnException = true;
            //             console.log("-> Error [3]", xhr.statusText, 'isOnException: '+ isOnException);
            //         }
            //     }
            // } // EO xhr.onreadystatechange = function (event) {

            xhr.onload = function () {
                try {
                    result = this.responseText;
                    var contentType     = this.getResponseHeader("Content-Type");
                    if ( /\/json/.test( contentType ) ) {
                        result = JSON.parse(this.responseText);

                        if ( typeof(result.status) == 'undefined' )
                            result.status = this.status;

                        //triggerEvent(gina, $target, 'success.' + id, result);
                        return onResult(result)
                    } else {
                        result = { 'status': xhr.status, 'message': '' };
                        if ( /^(\{|\[)/.test( xhr.responseText ) ) {
                            try {
                                result = merge( result, JSON.parse(xhr.responseText) );
                            } catch (err) {
                                result = merge(result, err);
                            }
                        }
                        return onResult(result);
                    }
                } catch (err) {
                    // #B87: a malformed response (e.g. bad JSON under a JSON
                    // content-type) must release the async waiter, not hang it
                    return releaseQueryWaiter(err);
                }
            }// xhr.onload = function () {

            if (data) {
                xhr.send( queryData ); // stringyfied
            }  else {
                xhr.send();
            }
        }
    }

    /**
     * queryFromBackend
     *
     *
     * @param {object} options
     * @param {object} request
     * @param {object} response
     * @param {callback} next
     *
     *
     */
    var queryFromBackend = async function(options, request, response, next) {
        var Config = require(_(GINA_FRAMEWORK_DIR +'/core/config.js', true));
        var config      = new Config().getInstance();

        var opt     = null
            //appConf.proxy.<bundle>;
            , rule  = null
            , bundle = null
            , currentBundle = getContext('bundle')
        ;
        // trying to retrieve proxy conf
        if ( /\@/.test(options.url) ) {
            var attr = options.url.split(/@/);
            rule = attr[0];
            bundle = attr[1];
            var proxyConf = getConfig( currentBundle, 'app' ).proxy;
            try {
                if (config.bundle !== bundle) { // ignore if same bundle
                    // getting proxy conf when available
                    opt = getConfig( currentBundle, 'app' ).proxy[bundle];
                }
            } catch (proxyError) {
                throw new Error('Could not retrieve `proxy` configuration for bundle `'+ bundle +'`. Please check your `/config/app.json`.\n'+proxyError.stack);
            }

            attr = null;
        } else {
            // TODO - handle else; when it is an external domain/url
            throw new Error('external url/domain not  handled at this moment, please contact us if you need support for it.')
        }
        var route       = JSON.clone(routing.getRoute(options.url, options.data));
        // var route       = routing.getRoute(options.url, options.data);

        var env             = config.env;
        var conf            = config[bundle][env];
        var serverInstance  = conf.content.server;
        // If you change here, you will also have to refrect changes in the core/server.js
        if ( typeof(serverInstance._cached) == 'undefined' ) {
            serverInstance._cached = new Map();
        }
        if ( typeof(serverInstance._cachedPath) == 'undefined' ) {
            serverInstance._cachePath = serverInstance.cache.path;
        }
        if ( typeof(serverInstance._cacheIsEnabled) == 'undefined' ) {
            serverInstance._cacheIsEnabled = serverInstance.cache.enable;
        }

        if (!opt) { // setup opt by default if no proxy conf found
            if (config.bundle == bundle) {
                var credentials = getConfig( currentBundle, 'settings' ).server.credentials;
                options.ca = credentials.ca || null;
                options.hostname    = conf.server.scheme +'://'+ conf.host;
                options.port        = conf.port[conf.server.protocol][conf.server.scheme];
                options.protocol    = conf.server.protocol;
                options.rejectUnauthorized  = false;
            }
            opt = {
                "ca"        : options.ca,
                "hostname"  : options.hostname,
                "port"      : options.port,
                "path"      : options.path
            };

            if ( typeof(options.protocol) != 'undefined' ) {
                opt.protocol = options.protocol
            }
            if ( typeof(options.rejectUnauthorized) != 'undefined' ) {
                opt.rejectUnauthorized = options.rejectUnauthorized
            }
        }

        /**
         * BO routing configuration
         * Attention: this portion of code is from `router.js`
         * Any modification on this part must be reflected on `router.js`
         */
        // default param setting
        var params = {
            method              : route.method,
            requirements        : route.requirements,
            namespace           : route.namespace || undefined,
            url                 : decodeURI(route.url), /// avoid %20
            rule                : rule + '@' + bundle,
            param               : JSON.clone(route.param),
            middleware          : JSON.clone(route.middleware),
            bundle              : route.bundle,
            isXMLRequest        : request.isXMLRequest,
            isWithCredentials   : request.isWithCredentials
        };

        var templateName = params.rule.replace('\@'+ bundle, '') || '_common';
        var routeHasViews = ( typeof(conf.content.templates) != 'undefined' ) ? true : false;
        var controllerOptions = {
            // view namespace first
            template: (routeHasViews) ? conf.content.templates[templateName] || conf.content.templates._common : undefined,
            // namespace       : params.param.namespace || namespace,
            //control         : route.param.control,
            // controller      : controllerFile,
            //controller: '<span class="gina-bundle-name">' + bundle +'</span>/controllers/controller.js',
            //file: route.param.file, // matches rule name by default
            //bundle          : bundle,//module
            // bundlePath      : conf.bundlesPath + '/' + bundle,
            // rootPath        : self.executionPath,
            //instance: self.serverInstance,
            //template: (routeHasViews) ? conf.content.templates[templateName] : undefined,
            //isUsingTemplate: local.isUsingTemplate,
            isCacheless: conf.isCacheless //,
            //path: params.param.path || null, // user custom path : namespace should be ignored | left blank
            //assets: {}
        };

        controllerOptions = merge(controllerOptions, params);

        // BO - Template outside of namespace fix added on 2021-08-19
        // We want to keep original conf untouched
        var _conf = JSON.clone(conf);
        // controllerOptions.conf = JSON.clone(conf);
        controllerOptions.conf = _conf;
        controllerOptions.conf.content.routing[controllerOptions.rule].param = params.param;
        // inheriting from _common
        if (
            controllerOptions.template
            && typeof(controllerOptions.template.ginaLoader) == 'undefined'
        ) {
            controllerOptions.template.ginaLoader = controllerOptions.conf.content.templates._common.ginaLoader;
        }
        controllerOptions.conf.content.routing[controllerOptions.rule].param = params.param;
        delete controllerOptions.middleware;
        delete controllerOptions.param;
        delete controllerOptions.requirements;
        // EO - Template outside of namespace
        /**
         * EO routing configuration
         */

        var Controller = require(_(GINA_FRAMEWORK_DIR +'/core/controller/controller.js'), true);
        var controller = new Controller(controllerOptions);
        controller.name = route.param.control;
        // #B115 — prefer the LIVE engine published by server.js start(): query()
        // re-points lib/cache's process-wide backing Map to the controller's
        // `serverInstance._cached`, so handing it the config dict's own minted Map
        // sends a concurrent render's cache ops (compiled templates, output cache)
        // to the wrong store and strands the pooled HTTP/2 session + its
        // `_http2Sessions` tracker where nothing reads them. The config dict above
        // (+ its minted `_cached`) remains the fallback when no server runs in this
        // process (offline CLI / test harnesses).
        controller.serverInstance = ( process.gina && process.gina._serverInstance )
            ? process.gina._serverInstance
            : serverInstance;
        controller.setOptions(request, response, next, controllerOptions);

        var data = ( typeof(options.data) == 'object' && options.data.count() > 0 )
                ? options.data
                : {};
        // inherited data from current query asking for validation
        var urlParams = '';
        if ( /^get|delete|put$/i.test(options.method) ) {
            urlParams += '?';
            var i = 0;
            for (let p in data) {
                if (i > 0) {
                    urlParams += '&';
                }
                let val = (typeof(data[p]) == 'object') ? encodeRFC5987ValueChars(JSON.stringify(data[p])) : data[p];
                urlParams += p +'='+ val;
                i++;
            }
        }
        opt.method  = options.method;
        //opt.path    = route.url + urlParams;
        opt.path    = route.url;

        var util            = require('util');
        var promisify       = util.promisify;
        var result = { isValid: false }, err = false;

        await promisify(controller.query)(opt, data)
            .then(function onResult(_result) {
                result = _result;
            })
            .catch(function onResultError(_err) {
                err = _err;
            });
        if (err) {
            //throw err;
            console.error(err);
            result.error = err;
        }
        return result;
    };

    /**
     * query
     */
    var query = null;
    if (isGFFCtx) {
        query = queryFromFrontend;
    } else {
        query = queryFromBackend;
    }


    /**
     * addField
     * Add field to the validation context
     * @param {string} el
     * @param {string|boolean|number|object} [value]
     */
    var addField = function(el, value) {
        var val = null, label = null;

        if ( typeof(self[el]) == 'undefined' && typeof(value) != 'undefined' ) {
            self[el] = val = value;
        }

        if ( typeof(self[el]) == 'object' ) {
            try {
                val = JSON.parse( JSON.stringify( self[el] ))
            } catch (err) {
                val = self[el]
            }
        } else {
            val = self[el]
        }

        label = '';
        if ( isGFFCtx && typeof($fields) != 'undefined' ) { // frontend only
            label = $fields[el].getAttribute('data-gina-form-field-label') || '';
        }

        // keys are stringyfied because of the compiler !!!
        self[el] = {
            'target': (isGFFCtx && typeof($fields) != 'undefined') ? $fields[el] : null,
            'name': el,
            'value': val,
            'valid': false,
            // is name by default, but you should use setLabe(name) to change it if you need to
            'label': label,
            // check as field to exclude while sending datas to the model
            'exclude': false
        };

        /**
         *
         * is(condition)       -> validate if value matches `condition`
         *
         *  When entered in a JSON rule, you must double the backslashes
         *
         *  e.g.:
         *       "/\\D+/"       -> like [^0-9]
         *       "!/^\\\\s+/"   -> not starting by white space allow
         *       "/^[0-9]+$/"   -> only numbers
         *       "$field === $fieldOther"   -> will be evaluated
         *
         * @param {object|string} condition - RegExp object, or condition to eval, or eval result
         * @param {string} [errorMessage] - error message
         * @param {string} [errorStack] - error stack
         *
         * */
        self[el]['is'] = function(condition, errorMessage, errorStack) {
            var isValid     = false;
            // #B127 — alias root: window in the browser, the Node global on the
            // server, so numbered `is<N>` aliases keep DISTINCT error keys on both
            // sides. The installer's setAlias IIFE already writes the alias to the
            // Node global (sloppy-mode `this`); the old window-only read collapsed
            // every server alias to the shared key `is`, which let a later PASSING
            // alias delete an earlier FAILING alias's error (see the !isValid /
            // delete bookkeeping below) — the field then validated clean.
            var _aliasRoot  = ( typeof(window) != 'undefined' ) ? window : ( ( typeof(global) != 'undefined' ) ? global : null );
            var alias       = ( _aliasRoot && typeof(_aliasRoot._currentValidatorAlias) != 'undefined' ) ? _aliasRoot._currentValidatorAlias : 'is';
            if ( _aliasRoot && _aliasRoot._currentValidatorAlias )
                delete _aliasRoot._currentValidatorAlias;

            var errors      = self[this['name']]['errors'] || {};
            local.data[this.name] = self[this.name].value;

            if (
                typeof(errors['isRequired']) == 'undefined'
                && this.value == ''
                && !/^false$/i.test(this.value)
                && this.value != 0
                ||
                !errors['isRequired']
                && this.value == ''
                && !/^false$/i.test(this.value)
                && this.value != 0
            ) {
                isValid = true;
            } else if (!errors['isRequired'] && typeof(this.value) == 'string' && this.value == '') {
                isValid = true;
            }

            if ( !isValid && /^(true|false)$/i.test(condition) ) { // because it can be evaluated on backend validation
                isValid = condition;
            } else if (!isValid) {
                var re = null, flags = null;
                // Fixed added on 2021-03-13: $variable now replaced with real value beafore validation
                if ( /[\!\=>\>\<a-z 0-9]+/i.test(condition) ) {
                    var variables = condition.match(/\${0}[-_,.\[\]a-z0-9]+/ig); // without space(s)
                    if (variables && variables.length > 0) {
                        var compiledCondition = condition;
                        for (var i = 0, len = variables.length; i < len; ++i) {
                            // $varibale comparison
                            if ( typeof(self[ variables[i] ]) != 'undefined' && variables[i]) {
                                re = new RegExp("\\$"+ variables[i] +"(?!\\S+)", "g");
                                if ( self[ variables[i] ].value == "" ) {
                                    compiledCondition = compiledCondition.replace(re, '""');
                                } else if ( typeof(self[ variables[i] ].value) == 'string' ) {
                                    compiledCondition = compiledCondition.replace(re, '"'+ self[ variables[i] ].value +'"');
                                } else {
                                    compiledCondition = compiledCondition.replace(re, self[ variables[i] ].value);
                                }
                            }
                        }

                        try {
                            // security checks
                            compiledCondition = compiledCondition.replace(/(\(|\)|return)/g, '');
                            // #SCS1e (2026-04-24) — replaced the two `eval(...)` calls below with
                            // auditable equivalents. After `$var` substitution (lines 910-920) and
                            // paren/return strip above, `compiledCondition` is either:
                            //   (a) a regex literal `/<body>/<flags>` (when `/^\//` matches), or
                            //   (b) a binary comparison `<operand><op><operand>` where operand ∈
                            //       {number, "string", true, false, null, undefined} and op ∈
                            //       {===, !==, ==, !=, <, >, <=, >=}.
                            // Old eval executed arbitrary JS; any value reaching `$var` substitution
                            // that contained a quote (e.g. user input `bar"; process.exit();//`)
                            // could escape the `"..."` wrapper at line 916 and reach eval as
                            // arbitrary code. Grammar-locked replacements reject any input that
                            // doesn't fit the two documented shapes.
                            // if ( /^\//.test(compiledCondition) ) {
                            //     isValid = eval(compiledCondition + '.test("' + this.value + '")')
                            // } else {
                            //     isValid = eval(compiledCondition)
                            // }
                            if ( /^\//.test(compiledCondition) ) {
                                var _scsRegexMatch = compiledCondition.match(/^\/(.+)\/([a-z]*)$/);
                                if (!_scsRegexMatch) {
                                    throw new Error('Invalid regex literal: `' + compiledCondition + '`');
                                }
                                isValid = new RegExp(_scsRegexMatch[1], _scsRegexMatch[2]).test(this.value);
                            } else {
                                var _SCS_BINARY_RE = /^\s*(null|undefined|true|false|"[^"]*"|-?\d+(?:\.\d+)?)\s*(===|!==|<=|>=|==|!=|<|>)\s*(null|undefined|true|false|"[^"]*"|-?\d+(?:\.\d+)?)\s*$/;
                                var _scsBinMatch = (typeof(compiledCondition) == 'string') ? compiledCondition.match(_SCS_BINARY_RE) : null;
                                if (!_scsBinMatch) {
                                    // A condition that doesn't fit the grammar (e.g. a dangling
                                    // operator left by an empty cross-field reference) must FAIL
                                    // THE FIELD, not throw: is() runs on every keystroke during
                                    // live-check, and an uncaught throw propagates out of the
                                    // whole-form validity pass (main.js checkFieldAgainstRules
                                    // re-wraps + re-throws it), leaving the submit trigger ungated.
                                    // A genuine authoring typo stays visible via the warning
                                    // without killing live validation. Fail-closed: the field is
                                    // treated as invalid on both the client and the server.
                                    console.warn('[FormValidator] Could not evaluate condition `' + compiledCondition + '` - treating field as invalid.\n(grammar: <operand><op><operand>; operand ∈ number | "string" | true | false | null | undefined; op ∈ === !== == != < > <= >=)');
                                    isValid = false;
                                } else {
                                    var _scsParseOperand = function(s) {
                                        var _t = s.replace(/^\s+|\s+$/g, '');
                                        if (_t === 'null')      return null;
                                        if (_t === 'undefined') return undefined;
                                        if (_t === 'true')      return true;
                                        if (_t === 'false')     return false;
                                        if (/^"[^"]*"$/.test(_t)) return _t.slice(1, -1);
                                        var _n = Number(_t);
                                        if (!isNaN(_n) && _t !== '') return _n;
                                        throw new Error('Invalid operand: `' + s + '`');
                                    };
                                    var _scsLeft  = _scsParseOperand(_scsBinMatch[1]);
                                    var _scsOp    = _scsBinMatch[2];
                                    var _scsRight = _scsParseOperand(_scsBinMatch[3]);
                                    switch (_scsOp) {
                                        case '===': isValid = _scsLeft === _scsRight; break;
                                        case '!==': isValid = _scsLeft !== _scsRight; break;
                                        case '==':  isValid = _scsLeft ==  _scsRight; break;
                                        case '!=':  isValid = _scsLeft !=  _scsRight; break;
                                        case '<':   isValid = _scsLeft <   _scsRight; break;
                                        case '>':   isValid = _scsLeft >   _scsRight; break;
                                        case '<=':  isValid = _scsLeft <=  _scsRight; break;
                                        case '>=':  isValid = _scsLeft >=  _scsRight; break;
                                    }
                                }
                            }

                        } catch (err) {
                            throw new Error(err.stack||err.message)
                        }
                    }
                } else if ( condition instanceof RegExp ) {

                    isValid = condition.test(this.value) ? true : false;

                } else if( typeof(condition) == 'boolean') {

                    isValid = (condition) ? true : false;

                } else {
                    try {
                        // TODO - motif /gi to pass to the second argument
                        if ( /\/(.*)\//.test(condition) ) {
                            re = condition.match(/\/(.*)\//).pop();
                            flags = condition.replace('/' + re + '/', '');

                            isValid = new RegExp(re, flags).test(this.value)
                        } else {
                            // #M21b — free-form JS condition shape unsupported; declare a documented shape instead
                            throw new Error('[FormValidator] Unsupported condition shape — supported: binary comparison (a OP b), RegExp, boolean, /regex/flags literal. Got: `' + condition + '`');
                        }

                        //valid = new RegExp(condition.replace(/\//g, '')).test(this.value)
                    } catch (err) {
                        throw new Error(err.stack||err.message)
                    }
                }
            }

            if (!isValid) {
                // #B178 — numbered aliases (is1, is2, ...) have no per-alias default
                // label: fall back to the shared base label instead of an empty message
                errors[alias] = replace(this.error || errorMessage || local.errorLabels[alias] || local.errorLabels['is'], this, alias);
                if ( typeof(errorStack) != 'undefined' )
                    errors['stack'] = errorStack;
            }
            // if error tagged by a previous vlaidation, remove it when isValid == true
            else if ( isValid && typeof(errors[alias]) != 'undefined' ) {
                delete errors[alias];
                //delete errors['stack'];
            }

            this.valid = isValid;
            if ( errors.count() > 0 )
                this['errors'] = errors;


            return self[this.name]
        }

        self[el]['set'] = function(value) {
            this.value  = local['data'][this.name] = value;
            //  html
            this.target.setAttribute('value', value);
            // Todo : select and radio case to apply change

            return self[this.name]
        }

        self[el]['isEmail'] = function() {


            this.value      = local['data'][this.name] = (this.value) ? this.value.toLowerCase() : this.value;
            // Apply on current field upper -> lower
            if (
                isGFFCtx
                && this.target
                && this.target.value != ''
                && /[A-Z]+/.test(this.target.value)
            ) {
                this.target.value = this.value;
            }


            var rgx         = /^(([^<>()[\]\\.,;:\s@\"]+(\.[^<>()[\]\\.,;:\s@\"]+)*)|(\".+\"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
            var isValid     = rgx.test(this['value']) ? true : false;
            var errors      = self[this['name']]['errors'] || {};

            // #B78 - an empty value is adjudicated by isRequired alone: bypass on empty so a
            // required+empty field records only isRequired, not a second 'invalid' message.
            if ( this.value == '' ) {
                isValid = true;
            }

            if (!isValid) {
                errors['isEmail'] = replace(this['error'] || local.errorLabels['isEmail'], this, 'isEmail')
            }
            // if error tagged by a previous vlaidation, remove it when isValid == true
            else if ( isValid && typeof(errors['isEmail']) != 'undefined' ) {
                delete errors['isEmail'];
                //delete errors['stack'];
            }

            // #B78 - keep .valid consistent with a surviving isRequired error.
            this.valid = isValid && !errors['isRequired'];

            if ( errors.count() > 0 )
                this['errors'] = errors;

            return self[this['name']]
        }

        self[el]['isJsonWebToken'] = function() {


            this.value      = local['data'][this.name] = (this.value) ? this.value.toLowerCase() : this.value;
            // Apply on current field upper -> lower
            if (
                isGFFCtx
                && this.target
                && this.target.value != ''
                && /[A-Z]+/.test(this.target.value)
            ) {
                this.target.value = this.value;
            }

            var rgx         = /^[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*$/;
            var isValid     = rgx.test(this['value']) ? true : false;
            var errors      = self[this['name']]['errors'] || {};

            // #B78 - an empty value is adjudicated by isRequired alone: bypass on empty so a
            // required+empty field records only isRequired, not a second 'invalid' message.
            if ( this.value == '' ) {
                isValid = true;
            }

            if (!isValid) {
                errors['isJsonWebToken'] = replace(this['error'] || local.errorLabels['isJsonWebToken'], this, 'isJsonWebToken')
            }
            // if error tagged by a previous vlaidation, remove it when isValid == true
            else if ( isValid && typeof(errors['isJsonWebToken']) != 'undefined' ) {
                delete errors['isJsonWebToken'];
                //delete errors['stack'];
            }

            // #B78 - keep .valid consistent with a surviving isRequired error.
            this.valid = isValid && !errors['isRequired'];

            if ( errors.count() > 0 )
                this['errors'] = errors;

            return self[this['name']]
        }

        /**
         * Check if boolean and convert to `true/false` booloean if value is a string or a number
         * Will include `false` value if isRequired
         * */
        self[el]['isBoolean'] = function() {
            var val     = null
                , errors = self[this['name']]['errors'] || {}
            ;

            if ( errors['isRequired'] && this.value == false) {
                isValid = true;
                delete errors['isRequired'];
                this['errors'] = errors;
            }

            switch(this.value) {
                case 'true':
                case true:
                case 1:
                    val = this.value = local.data[this.name] = true;
                    break;
                case 'false':
                case false:
                case 0:
                    val = this.value = local.data[this.name] = false;
                    break;
            }

            var isValid = (val !== null) ? true : false;

            if (!isValid) {
                errors['isBoolean'] = replace(this.error || local.errorLabels['isBoolean'], this, 'isBoolean')
            }
            // if error tagged by a previous vlaidation, remove it when isValid == true
            else if ( isValid && typeof(errors['isBoolean']) != 'undefined' ) {
                delete errors['isBoolean'];
                //delete errors['stack'];
            }

            this.valid = isValid;
            if ( errors.count() > 0 )
                this['errors'] = errors;

            return self[this.name]
        }

        /**
         * Check if value is an a Number.
         *  - valid if a number is found
         *  - cast into a number if a string is found
         *  - if string is blank, no transformation will be done: valid if not required
         *
         *  @param {number} minLength
         *  @param {number} maxLength
         *
         *  @returns {object} result
         * */
        self[el]['isNumber'] = function(minLength, maxLength) {
            var val             = this.value
                , len           = 0
                , isValid       = false
                , isMinLength   = true
                , isMaxLength   = true
                , errors        = self[this['name']]['errors'] || {}
            ;

            // test if val is a number
            try {
                // if val is a string replaces comas by points
                if ( typeof(val) == 'string' && /\,|\./g.test(val) ) {
                    val = local.data[this.name] = this.value = parseFloat( val.replace(/,/g, '.').replace(/\s+/g, '') );
                } else if ( typeof(val) == 'string' && val != '') {
                    val = local.data[this.name] = this.value = parseInt( val.replace(/\s+/g, '') );
                }

            } catch (err) {
                errors['isNumber'] = replace(this.error || local.errorLabels['isNumber'], this, 'isNumber');
                this.valid = false;
                if ( errors.count() > 0 )
                    this['errors'] = errors;
            }

            if ( +val === +val ) {
                isValid = true;
                if ( !errors['isRequired'] && val != '' ) {
                    len = val.toString().length;
                    // if so also test max and min length if defined
                    if (minLength && typeof(minLength) == 'number' && len < minLength) {
                        isMinLength = false;
                        this['size'] = minLength;
                    }
                    if (maxLength && typeof(maxLength) == 'number' && len > maxLength) {
                        isMaxLength = false;
                        this['size'] = maxLength;
                    }
                }
            }

            // if val is invalid return error message
            if ( !isValid || !isMinLength || !isMaxLength ) {

                if ( !isValid )
                    errors['isNumber'] = replace(this.error || local.errorLabels['isNumber'], this, 'isNumber');
                if ( !isMinLength || !isMaxLength ) {
                    if ( !isMinLength )
                        errors['isNumberLength'] = replace(this.error || local.errorLabels['isNumberMinLength'], this, 'isNumberMinLength');
                    if ( !isMaxLength )
                        errors['isNumberLength'] = replace(this.error || local.errorLabels['isNumberMaxLength'], this, 'isNumberMaxLength');
                    if ( minLength === maxLength )
                        errors['isNumberLength'] = replace(this.error || local.errorLabels['isNumberLength'], this, 'isNumberLength');
                }

                isValid = false;
            }
            // if error tagged by a previous vlaidation, remove it when isValid == true
            if ( isValid && typeof(errors['isNumberLength']) != 'undefined') {
                delete errors['isNumberLength'];
            }

            this.valid = isValid;
            val = this.value = local.data[this.name] = ( val != '' ) ? Number(val) : val;
            if ( errors.count() > 0 )
                this['errors'] = errors;

            return self[this.name]
        }

        self[el]['toInteger'] = function() {
            var val = this.value
                , errors = self[this['name']]['errors'] || {}
            ;

            if (!val) {
                return self[this.name]
            } else {
                try {
                    //val = this.value = local.data[this.name] = ~~(val.match(/[0-9]+/g).join(''));
                    val = this.value = local.data[this.name] = Math.round(val);
                } catch (err) {

                    errors['toInteger'] = replace(this.error || local.errorLabels['toInteger'], this, 'toInteger');
                    this.valid = false;
                    if ( errors.count() > 0 )
                        this['errors'] = errors;
                }

            }

            return self[this.name]
        }

        self[el]['isInteger'] = function(minLength, maxLength) {
            var val             = this.value
                , isValid       = false
                , isMinLength   = true
                , isMaxLength   = true
                , errors        = self[this['name']]['errors'] || {}
                ;

            // test if val is a number
            if ( +val === +val && val % 1 === 0 ) {
                isValid = true;
                if ( !errors['isRequired'] && val != '' ) {
                    // if so also test max and min length if defined
                    if (minLength && typeof(minLength) == 'number' && val.length < minLength) {
                        isMinLength = false;
                        this['size'] = minLength;
                    }
                    if (maxLength && typeof(maxLength) == 'number' && val.length > maxLength) {
                        isMaxLength = false;
                        this['size'] = maxLength;
                    }
                }
            }
            // if val is invalid return error message
            if ( !isValid || !isMinLength || !isMaxLength ) {

                if ( !isValid )
                    errors['isInteger'] = replace(this.error || local.errorLabels['isInteger'], this, 'isInteger');

                if ( !isMinLength || !isMaxLength ) {

                    if ( !isMinLength ) {
                        errors['isIntegerLength'] = replace(this.error || local.errorLabels['isIntegerMinLength'], this, 'isIntegerMinLength');
                        isValid = false;
                    }

                    if ( !isMaxLength ) {
                        errors['isIntegerLength'] = replace(this.error || local.errorLabels['isIntegerMaxLength'], this, 'isIntegerMaxLength');
                        isValid = false;
                    }

                    if ( minLength === maxLength ) {
                        errors['isIntegerLength'] = replace(this.error || local.errorLabels['isIntegerLength'], this, 'isIntegerLength');
                        isValid = false;
                    }
                }
            }

            this.valid = isValid;
            val = this.value = local.data[this.name] = Number(val);

            if ( errors.count() > 0 )
                this['errors'] = errors;

            return self[this.name]
        }


        self[el]['toFloat'] = function(decimals) {
            // Fixed on 2025-03-12
            // In case we are dealing with a filtered value (swig::formatNumber())
            var val                     = document.getElementById(this.target.getAttribute('id')).value || this.value
                isFloatingWithCommas    = false
            ;
            if ( typeof(val) == 'string' ) {
                val = val.replace(/\s+/g, '');
                // Fixed on 2025-03-12
                // thousand separator ?
                if ( /\,/.test(val) && /\./.test(val) ) {
                    val = val.replace(/\,/g,'');
                }
                else if ( /\,/.test(val) ) {
                    val = val.replace(/\,/g,'.');
                    isFloatingWithCommas = true;
                }
            }

            local.data[this.name] = val;
            var errors    = self[this['name']]['errors'] || {}
                , isValid   = true
            ;

            if (decimals) {
                this['decimals'] = parseInt(decimals)
            } else if ( typeof(this['decimals']) == 'undefined' ) {
                this['decimals'] = 2
            }

            if (!val) {
                return self[this.name]
            } else {
                if ( this['isNumber']().valid ) {
                    try {
                        if ( !Number.isFinite(val) ) {
                            // Number <> number
                            val = new Number(parseFloat(val.match(/[0-9.,]+/g).join('').replace(/,/, '.')));
                        }
                    } catch(err) {
                        isValid = false;
                        errors['toFloat'] = replace(this.error || local.errorLabels['toFloat'], this, 'toFloat');
                        this.valid = false;
                        if ( errors.count() > 0 )
                            this['errors'] = errors;
                    }
                } else {
                    isValid = false;
                    errors['toFloat'] = replace(this.error || local.errorLabels['toFloatNAN'], this, 'toFloatNAN')
                }
            }

            if (this['decimals'] && val && !errors['toFloat']) {
                val = parseFloat(val.toFixed(this['decimals']));
            }

            this.value = local.data[this.name] = val;
            if (isGFFCtx) {
                // restore original input format for display
                if (isFloatingWithCommas) {
                    val = (''+val).replace(/\./g,',');
                }
                this.target.setAttribute('value', val);
            }

            this.valid = isValid;
            if ( errors.count() > 0 ) {
                this['errors'] = errors;
            }

            return self[this.name]
        }

        /**
         * Check if value is float. No transformation is done here.
         * Can be used in combo preceded by *.toFloat(2) to transform data if needed:
         *  1 => 1.0
         *  or
         *  3 500,5 => 3500.50
         *
         *
         * @param {number} [ decimals ]
         *
         * TODO - decimals transformation
         * */
        self[el]['isFloat'] = function(decimals) {

            if ( typeof(this.value) == 'string' ) {
                this.value = this.value.replace(/\s+/g, '');
            }

            var val         = local.data[this.name] = this.value
                , isValid   = false
                , errors    = self[this['name']]['errors'] || {}
            ;


            if ( typeof(val) == 'string' && /\./.test(val) && Number.isFinite( Number(val) ) ) {
                isValid = true
            }

            // if string replaces comas by points
            if (typeof(val) == 'string' && /,/g.test(val)) {
                val =  this.value = local.data[this.name] = Number(val.replace(/,/g, '.'))
            }

            // test if val is strictly a float
            // #B46 (2026-06-15) — accept STRING floats, not only real JS numbers.
            // The old gate `Number(val) === val` is true only for a real number,
            // so a string "1.5" (browser .value and urlencoded bodies are ALWAYS
            // strings) was rejected server-side. Coerce to Number first, then
            // require a finite value with a fractional part. Whole numbers ("2", 2)
            // still fail (no fractional part), preserving isFloat's contract that
            // an integer is not a float.
            // was:
            // if ( Number(val) === val && val % 1 !== 0 ) {
            //     this.value = local.data[this.name] = Number(val);
            //     isValid = true
            // } else {
            //     isValid = false
            // }
            var floatVal = Number(val);
            if ( Number.isFinite(floatVal) && floatVal % 1 !== 0 ) {
                this.value = local.data[this.name] = floatVal;
                isValid = true
            } else {
                isValid = false
            }

            // #B78 - an empty value is adjudicated by isRequired alone: bypass on empty so a
            // required+empty field records only isRequired, not a second 'invalid' message.
            if ( this.value == '' ) {
                isValid = true
            }

            if (!isValid) {
                errors['isFloat'] = replace(this.error || local.errorLabels['isFloat'], this, 'isFloat')
            }

            // #B78 - keep .valid consistent with a surviving isRequired error.
            this.valid = isValid && !errors['isRequired'];
            if ( errors.count() > 0 )
                this['errors'] = errors;

            return self[this.name]
        }

        self[el]['isRequired'] = function(isApplicable) {

            if ( typeof(isApplicable) == 'boolean' && !isApplicable ) {

                this.valid = true;

                // is in excluded ?
                var excludedIndex = local.excluded.indexOf(this.name);
                if ( excludedIndex > -1 ) {
                    local.excluded.splice(excludedIndex, 1);
                }

                return self[this.name]
            }

            // radio group case
            if (
                isGFFCtx
                && this.target
                && this.target.tagName == 'INPUT'
                && typeof(this.target.type) != 'undefined'
                && this.target.type == 'radio'
            ) {
                // [HTML5 form-reassociation] Scope the radio group by form-owner per
                // HTML5 spec. `getElementsByName` returns same-name radios across the
                // whole document regardless of owner — without this filter, the
                // first-checked pick cross-fires into sibling forms whose radios
                // happen to share the name (the multi-entry layout where each entry
                // has its own reassociated form). Mirrors the equivalent filter in
                // main.js's updateRadio.
                var $target = this.target;
                var rawRadios = document.getElementsByName(this.name);
                var radios = Array.prototype.filter.call(rawRadios, function (_r) {
                    return _r.form === $target.form;
                });
                for (var i = 0, len = radios.length; i < len; ++i) {
                    if (radios[i].checked) {
                        if ( /true|false/.test(radios[i].value) ) {
                            this.value = local.data[this.name] = ( /true/.test(radios[i].value) ) ? true : false
                        } else {
                            this.value = local.data[this.name] = radios[i].value;
                        }

                        this.valid = true;
                        break;
                    }
                }
            }


            var isValid = ( typeof(this.value) != 'undefined' && this.value != null && this.value != '' && !/^\s+/.test(this.value) ) ? true : false;
            var errors  = self[this['name']]['errors'] || {};


            if (!isValid) {
                errors['isRequired'] = replace(this.error || local.errorLabels['isRequired'], this, 'isRequired')
            }
            // if error tagged by a previous vlaidation, remove it when isValid == true
            else if ( isValid ) {
                if (typeof(errors['isRequired']) != 'undefined' )
                    delete errors['isRequired'];
                //delete errors['stack'];
                // if ( typeof(self[this.name]['errors']) != 'undefined' && typeof(self[this.name]['errors']['isRequired']) != 'undefined' )
                //     delete self[this.name]['errors']['isRequired'];
            }

            this.valid = isValid;
            if (errors.count() > 0)
                this['errors'] = errors;

            return self[this.name]
        }
        /**
         *
         * isString()       -> validate if value is string
         * isString(10)     -> validate if value is at least 10 chars length
         * isString(0, 45)  -> no minimum length, but validate if value is maximum 45 chars length
         * NB.:
         * In your JSON rule ;
         * {
         *  "password": {
         *      "isRequired": true,
         *
         *      "isString": true // Means that we just want a string and we don't care of its length
         *      // OR
         *      "isString": 7 // Means at least 7 chars length
         *      // OR
         *      "isString": [7, 40] // Means at least 7 chars length and maximum 40 chars length
         *      // OR
         *      "isString": [7] // Means at least 7 chars length, same as 7 above: a one-element array supplies minLength only
         *      // OR
         *      "isString": [7, 7] // Means strictly equal to 7 chars length
         *  }
         * }
         * @param {number|undefined} [ minLength ]
         * @param {number} [ maxLength ]
         * */
        self[el]['isString'] = function(minLength, maxLength) {

            var val             = local.data[this.name] = this.value
                , isValid       = false
                , isMinLength   = true
                , isMaxLength   = true
                , errors        = self[this['name']]['errors'] || {}
            ;


            // test if val is a string
            if ( typeof(val) == 'string' ) {
                //isValid = true;

                if ( !errors['isRequired'] && val != '' ) {
                    isValid = true;
                    // if so also test max and min length if defined
                    if (minLength && typeof(minLength) == 'number' && val.length < minLength) {
                        isMinLength = false;
                        this['size'] = minLength;
                    }
                    if (maxLength && typeof(maxLength) == 'number' && val.length > maxLength) {
                        isMaxLength = false;
                        this['size'] = maxLength;
                    }
                }

            }

            // if val is invalid return error message
            if (!isValid || !isMinLength || !isMaxLength ) {

                if (!isValid && errors['isRequired'] && val == '') {
                    isValid = false;
                    // #B78 - required+empty is adjudicated by isRequired alone; keep the field
                    // invalid (isValid stays false) but do NOT pile on a second 'must be a string' message.
                } else if (!isValid && !errors['isRequired']) {
                    isValid = true;
                }

                if ( !isMinLength || !isMaxLength) {
                    isValid = false;

                    if ( !isMinLength )
                        errors['isStringLength'] = replace(this['error'] || local.errorLabels['isStringMinLength'], this, 'isStringMinLength');
                    if ( !isMaxLength )
                        errors['isStringLength'] = replace(this['error'] || local.errorLabels['isStringMaxLength'], this, 'isStringMaxLength');
                    if (minLength === maxLength)
                        errors['isStringLength'] = replace(this['error'] || local.errorLabels['isStringLength'], this, 'isStringLength');
                }

            }

            this.valid = isValid;
            if ( errors.count() > 0 ) {
                this['errors'] = errors;
            }

            return self[this.name]
        }

        /**
         * Check if date
         *
         * @param {string|boolean} [mask] - by default "yyyy-mm-dd"
         *
         * @returns {object} field object (chainable). The parsed Date is preserved on the field's `.value` and rendered via the field's own `.format()` method (DateFormatHelper — an adaptation of Steven Levithan's code).
         * */
        self[el]['isDate'] = function(mask) {
            var val         = this.value
                , isValid   = false
                , errors    = self[this['name']]['errors'] || {}
                , m         = null
                , date      = null
            ;
            // Default validation on livecheck & invalid init value
            if (!val || val == '' || /NaN|Invalid Date/i.test(val) ) {
                if ( /NaN|Invalid Date/i.test(val) ) {
                    console.warn('[FormValidator::isDate] Provided value for field `'+ this.name +'` is not allowed: `'+ val +'`');
                    errors['isDate'] = replace(this.error || local.errorLabels['isDate'], this, 'isDate');

                }
                this.valid = isValid;
                if ( errors.count() > 0 )
                    this['errors'] = errors;

                return self[this.name];
            }

            if (
                typeof(mask) == 'undefined'
                ||
                typeof(mask) != 'undefined' && /true/i.test(mask)
            ) {
                mask = "yyyy-mm-dd"; // by default
            }

            if (val instanceof Date) {
                date = val.format(mask);
            } else {

                try {
                    m = mask.match(/[^\/\- ]+/g);
                } catch (err) {
                    throw new Error('[FormValidator::isDate] Provided mask not allowed: `'+ mask +'`');
                }

                // #B47 (2026-06-15) — build the Date from explicit numeric
                // components identified by the mask tokens (y*/m*/d*), then
                // range-check via a round-trip. The old path rebuilt the string
                // FROM THE MASK (keeping its separators) and handed it to
                // `new Date(str)`, which parses a slash mask (e.g. "15/06/2023")
                // as US MM/DD -> month 15 -> Invalid Date, so any non-ISO mask
                // with day>12 (or non-US field order) was wrongly rejected. A
                // naive `new Date(y, m-1, d)` is not enough either: JS rolls
                // invalid components over (new Date(2023,12,45) is a valid date),
                // so the round-trip check (constructed components must equal the
                // inputs) is what still rejects e.g. 2023-13-45 and 2023-02-30.
                // was:
                // try {
                //     val = val.match(/[^\/\- ]+/g);
                //     var dic = {}, d, len;
                //     for (d=0, len=m.length; d<len; ++d) { dic[m[d]] = val[d] }
                //     var formatedDate = mask;
                //     for (var v in dic) { formatedDate = formatedDate.replace(new RegExp(v, "g"), dic[v]) }
                // } catch (err) { throw new Error('...Provided value not allowed...'); }
                // date = this.value = local.data[this.name] = new Date(formatedDate);
                var dic = {}, d, len, parts = null,
                    yNum = NaN, moNum = NaN, dNum = NaN;
                try {
                    parts = val.match(/[^\/\- ]+/g);
                    for (d = 0, len = m.length; d < len; ++d) {
                        dic[m[d]] = parts[d];
                    }
                } catch (err) {
                    throw new Error('[FormValidator::isDate] Provided value not allowed: `'+ val +'`' + err);
                }

                for (var tok in dic) {
                    if ( /y/i.test(tok) )      { yNum  = parseInt(dic[tok], 10); }
                    else if ( /m/i.test(tok) ) { moNum = parseInt(dic[tok], 10); }
                    else if ( /d/i.test(tok) ) { dNum  = parseInt(dic[tok], 10); }
                }

                if (
                    !Number.isFinite(yNum) || !Number.isFinite(moNum) || !Number.isFinite(dNum)
                    || moNum < 1 || moNum > 12 || dNum < 1 || dNum > 31
                ) {
                    date = this.value = local.data[this.name] = new Date(NaN);
                } else {
                    date = new Date(yNum, moNum - 1, dNum);
                    // reject rolled-over components (e.g. Feb 30 -> Mar 2)
                    if (
                        date.getFullYear() !== yNum
                        || date.getMonth() !== (moNum - 1)
                        || date.getDate() !== dNum
                    ) {
                        date = new Date(NaN);
                    }
                    this.value = local.data[this.name] = date;
                }

                if ( /Invalid Date/i.test(date) || date instanceof Date === false ) {
                    if ( !errors['isRequired'] && this.value == '' ) {
                        isValid = true
                    } else {
                        errors['isDate'] = replace(this.error || local.errorLabels['isDate'], this, 'isDate');
                    }

                    this.valid = isValid;
                    if ( errors.count() > 0 )
                        this['errors'] = errors;

                    return self[this.name]
                }
                isValid = true;
            }

            this.valid = isValid;

            // #B48 (2026-06-17) — return the field object (chainable), like
            // every other rule, instead of the raw parsed Date. The Date is
            // preserved on this.value (set above), so
            // `field.isDate(mask).format('isoDateTime')` still renders it via
            // the field's own `format` method; returning the Date here broke
            // chaining into any validator rule (a Date has no .isX()).
            // was: return date
            return self[this.name]
        }

        /**
         * Check if value is one of the allowed values (strict equality).
         *
         * The routing dispatcher spreads array-valued rule configs via
         * `apply()`, so `isInList: ["a", "b"]` lands here as positional
         * args; collected via `arguments`. Empty allowed-list rejects
         * every value (no value can satisfy an empty membership
         * constraint). Non-primitive args indicate the non-array dispatch
         * path (`isInList: "draft"`) — throw a config error.
         *
         * @param {...(string|number|boolean)} allowedValues - values that pass
         * @returns {object} field object (chainable)
         *
         * @example
         *     // routing.json rule
         *     "field[status]": {
         *         "isString": true,
         *         "isInList": ["draft", "pending", "sent", "paid"]
         *     }
         * */
        self[el]['isInList'] = function() {
            var errors = self[this['name']]['errors'] || {};

            var allowedValues = [];
            for (var i = 0, len = arguments.length; i < len; ++i) {
                var t = typeof(arguments[i]);
                if (t !== 'string' && t !== 'number' && t !== 'boolean') {
                    throw new Error('`isInList` requires an array of allowed primitive values; got ' + t + ' at position ' + i + '. Use `isInList: ["a", "b", "c"]` form.');
                }
                allowedValues.push(arguments[i]);
            }

            var val     = local.data[this.name] = this.value;
            var isValid = false;

            // #B78 - an empty/null value is adjudicated by isRequired alone.
            if ( (val === '' || val == null) ) {
                isValid = true;
            } else if ( allowedValues.indexOf(val) > -1 ) {
                isValid = true;
            }

            if (!isValid) {
                this['size'] = allowedValues.join(', ');
                errors['isInList'] = replace(this.error || local.errorLabels['isInList'], this, 'isInList');
            } else if ( typeof(errors['isInList']) != 'undefined' ) {
                delete errors['isInList'];
            }

            // #B78 - keep .valid consistent with a surviving isRequired error.
            this.valid = isValid && !errors['isRequired'];
            if ( errors.count() > 0 ) {
                this['errors'] = errors;
            }

            return self[this.name]
        }

        /**
         * Formating date using DateFormatHelper
         * Check out documentation in the helper source: `lib/helpers/dateFormat.js`
         * e.g.:
         *      d.start
         *        .isDate('dd/mm/yyyy')
         *        .format('isoDateTime');
         *
         *
         * */
        self[el]['format'] = function(mask, utc) {
            var val = this.value;
            if (!val) return self[this.name];

            return val.format(mask, utc)
        };

        /**
         * Set flash
         *
         * @param {str} flash
         * */
        self[el]['setFlash'] = function(regex, flash) {
            if ( typeof(flash) != 'undefined' && flash != '') {
                this.error = flash
            }
            return self[this.name]
        }

        /**
         * Set label
         *
         * @param {str} label
         * */
        self[el]['setLabel'] = function(label) {
            if ( typeof(label) != 'undefined' && label != '') {
                this.label = label
            }
            return self[this.name]
        }

        /**
         * Trim when string starts or ends with white space(s)
         *
         * @param {str} trimmed off string
         * */
        self[el]['trim'] = function(isApplicable) {
            if ( typeof(isApplicable) == 'boolean' && isApplicable ) {
                //if ( typeof(this.value) == 'string' ) {
                    this.value = this.value.replace(/^\s+|\s+$/, '');
                    local.data[this.name] = local.data[this.name] = this.value;
                //}
                return self[this.name]
            }
        }

        /**
         * Exclude when converting back to datas
         *
         * @returns {object} data
         * */
        self[el]['exclude'] = function(isApplicable) {

            if ( typeof(isApplicable) == 'boolean' && !isApplicable ) {

                if ( /^true|false$/i.test(this.value)) {
                    this.value = (/^true$/i.test(this.value)) ? true : false;
                    local.data[this.name] = this.value;
                }

                return self[this.name]
            }
            this.isExcluded = false;
            // list field to be purged
            if ( local.excluded.indexOf(this.name) < 0) {
                local.excluded.push(this.name);
                this.isExcluded = true;
            }


            // remove existing errors
            return self[this.name];
        }
        /**
         * Validation through API call
         * Try to put this rule at the end to prevent sending
         * a request to the remote host if previous rules failed
         */
        self[el]['query'] = query;


        self[el]['getValidationContext'] = function() {
            return {
                'isGFFCtx'  : isGFFCtx,
                'self'      : self,
                'local'     : local,
                'replace'   : replace
            }
        }
        // Merging user validators
        // To debug, open inspector and look into `Extra Scripts`
        if ( hasUserValidators() ) {
            var userValidator = null, filename = null;
            try {
                for (let v in gina.forms.validators) {
                    filename = '/validators/'+ v + '/main.js';
                    // setting default local error — #B178: only when the app has not
                    // already supplied one (catalog or setErrorLabels); the former
                    // unconditional assignment clobbered app translations for every
                    // user-validator key
                    if ( typeof(local.errorLabels[v]) == 'undefined' ) {
                        local.errorLabels[v] = 'Condition not satisfied';
                    }
                    // converting Buffer to string
                    if ( isGFFCtx ) {
                        //userValidatorError = String.fromCharCode.apply(null, new Uint16Array(gina.forms.validators[v].data));
                        userValidator = bufferToString(gina.forms.validators[v].data); // ok
                        var passedContext = 'var validationContext = this.getValidationContext(),isGFFCtx = validationContext.isGFFCtx,self = validationContext.self,local = validationContext.local,replace = validationContext.replace;';
                        userValidator = userValidator.replace(/(\)\s+\{|\)\{){1}/, '$&\n\t'+ passedContext);

                        //userValidator += '\n//#sourceURL='+ v +'.js';
                    } else {
                        userValidator = gina.forms.validators[v].toString();
                    }

                    // #M21c — Pattern B eval surface (trust-model invariant)
                    // Load-bearing: user-defined validator function bodies are registered on
                    // `gina.forms.validators` from disk-loaded `bundle/validators/<name>/main.js`
                    // files at framework boot. Trust assumption: the source of `userValidator`
                    // is always disk-sourced at boot — never request-time input (req.*, request.*,
                    // form values, URL params). End-user data MUST NOT reach this eval.
                    // Invariant pinned by test/lib/validator-scs1i.test.js (zero write sites for
                    // `gina.forms.validators` in framework source; zero request-time identifiers
                    // around the userValidator source chain).
                    self[el][v] = eval('(' + userValidator + ')\n//# sourceURL='+ v +'.js');
                    //self[el][v] = Function('errorMessage', 'errorStack', userValidator);
                }
            } catch (userValidatorError) {
                throw new Error('[UserFormValidator] Could not evaluate: `'+ filename +'`\n'+userValidatorError.stack);
            }
        }
    } // EO addField(el, value)


    for (let el in self) {
        // Adding fields & validators to context
        addField(el, self[el]);
    }

    self['addField'] = function(el, value) {
        if ( typeof(self[el]) != 'undefined' ) {
            return
        }
        addField(el, value);
    };


    // self['getExcludedFields'] = function() {
    //     return local.excluded;
    // };

    /**
     * Check if errors found during validation
     *
     * @returns {boolean}
     * */
    self['isValid'] = function() {
        return (self['getErrors']().count() > 0) ? false : true;
    }
    self['setErrors'] = function(errors) {
        if (!errors) {
            return {}
        }
        for (var field in self) {
            if ( typeof(self[field]) != 'object' ) {
                continue
            }
            // if ( typeof(self[field]['errors']) == 'undefined' || self[field]['errors'].count() == 0 ) {
            //     delete errors[field];
            //     continue;
            // }
            // if ( typeof(errors[field]) == 'undefined' ) {
            //     continue;
            // }
            for (var r in self[field]) {
                // no error for the current field rule
                if (
                    typeof(errors[field]) != 'object'
                    ||
                    typeof(errors[field][r]) == 'undefined'
                ) {
                    continue;
                }


                if (
                    typeof(self[field].valid) != 'undefined'
                    && /^true$/i.test(self[field].valid)
                ) {
                    delete errors[field][r];
                    continue;
                }


                if ( typeof( self[field]['errors']) == 'undefined' ) {
                    self[field]['errors'] = {}
                }

                self[field]['errors'][r] = errors[field][r];
            }

            // if field does not have errors, remove errors[field]
            if (
                typeof(self[field]['errors']) == 'undefined'
                    && typeof(errors[field]) != 'undefined'
                ||
                typeof(self[field]['errors']) != 'undefined'
                    && self[field]['errors'].count() == 0
                    && typeof(errors[field]) != 'undefined'
            ) {
                delete errors[field];
                continue;
            }
        }
        return errors;
    }
    /**
     * getErrors
     * NB.: This portion is shared between the front & the back
     *
     * @param {string} [fieldName]
     *
     * @returns errors
     */
    self['getErrors'] = function(fieldName) {
        var errors = {};

        if ( typeof(fieldName) != 'undefined' ) {
            if ( typeof(self[fieldName]) != 'undefined' && self[fieldName] && typeof(self[fieldName]['errors']) != 'undefined' && self[fieldName]['errors'].count() > 0 ) {
                errors[fieldName] = self[fieldName]['errors'];
            }
            return errors
        }

        for (var field in self) {
            if (
                typeof(self[field]) != 'object'
            ) {
                continue;
            }

            if ( typeof(self[field]['errors']) != 'undefined' ) {
                if ( self[field]['errors'].count() > 0)
                    errors[field] = self[field]['errors'];
            }
        }

        return errors
    }

    self['toData'] = function() {

        // cleaning data
        if (local.excluded.length > 0) {
            for (var i = 0, len = local.excluded.length; i < len; ++i) {
                if ( typeof(local.data[ local.excluded[i] ]) != 'undefined' ) {
                    delete local.data[ local.excluded[i] ]
                }
            }
        }
        // local.data = JSON.parse(JSON.stringify(local.data).replace(/\"(true|false)\"/gi, '$1'))
        return local.data
    }

    /**
     * Interpolate the `%l`/`%n`/`%s` tokens of an error label against a field object.
     *
     * `target` reaches here from four independent sources, none of which the framework
     * controls: a bundle catalog's `_validator.<rule>` label, a runtime
     * `gina.validator.setErrorLabels()` override, a rule's `errorMessage` argument
     * (`is: ["$a === $b", <errorMessage>]`), and a per-field `error` (plus the `query`
     * rule's `systemError`/`optionError`). Only the first is linted at boot.
     *
     * A non-string `target` used to throw here, and the throw is unrecoverable: it
     * escapes `validate()`, so the submit-validation callback never runs and the form
     * silently refuses to submit, and a boot-time pass aborts the whole form-binding
     * loop. So degrade instead of dying — an authoring mistake must never cost a form.
     *
     * @inner
     * @param   {*}      target     - The unresolved label. Fail-soft when not a string.
     * @param   {object} fieldObj   - Field the label is rendered for; supplies the tokens.
     * @param   {string} [rule]     - Rule the label belongs to. OPTIONAL: `replace` is
     *      re-exported to app-defined validators through `getValidationContext()`, which
     *      call it with two arguments. Absent, a non-string label degrades to an empty
     *      message rather than to the rule's English default.
     * @returns {string} The interpolated label; never throws.
     *
     * @example
     *   replace('Should be at least %s characters', { size: 5 })  // -> 'Should be at least 5 characters'
     *   replace({ message: 'oops' }, field, 'isRequired')         // -> 'Cannot be left empty' (+ one warn)
     */
    /**@js_externs replace*/
    var replace = function(target, fieldObj, rule) {
        if ( typeof(target) !== 'string' ) {
            // Prefer the rule's resolved label (it may be localised) over the English
            // default — the resolved label is only unusable when it IS the bad value,
            // in which case the `typeof` test below skips it and English wins.
            var _fallback = ( rule && typeof(local.errorLabels[rule]) === 'string' )
                ? local.errorLabels[rule]
                : ( rule && typeof(_defaultErrorLabels[rule]) === 'string' )
                    ? _defaultErrorLabels[rule]
                    : '';
            var _warnKey = rule || '(unknown rule)';
            if ( !_labelWarnings[_warnKey] ) {
                _labelWarnings[_warnKey] = true;
                console.warn('[FormValidator] error label for rule `' + _warnKey + '` must be a string'
                    + ' — got ' + ( target === null ? 'null' : typeof(target) ) + '.'
                    + ' Falling back to ' + ( _fallback ? '`' + _fallback + '`' : 'an empty message' ) + '.'
                    + ' Check the bundle catalog\'s `_validator` node, `setErrorLabels()`, the rule\'s'
                    + ' `errorMessage` argument, and the field\'s `error`.');
            }
            target = _fallback;
        }
        var keys = target.match(/%[a-z]+/gi);
        if (keys) {
            for (var k = 0, len = keys.length; k < len; ++k) {
                target = target.replace(new RegExp(keys[k], 'g'), fieldObj[local.keys[keys[k]]])
            }
        }

        return target
    }

    /**
     * Override error labels per rule key — an app-supplied key wins over the
     * culture catalog and the English defaults for this validator instance.
     *
     * #B178 — the supplied map is alias-filled first, so translating an
     * OBSERVABLE errors key (e.g. the float coercion's key, or a Length
     * family's generic key) also covers the specific label keys the engine
     * actually consults (its NaN variant, the min/max variants). A supplied
     * specific key still wins over its generic. Note the passed object is
     * extended in place (it already was, via the merge).
     *
     * @param {Object.<string, string>} errorLabels - rule key to label text
     * @returns {void}
     * @example
     * validator.setErrorLabels({ toFloat: 'Doit etre un nombre valide' });
     */
    self['setErrorLabels'] = function (errorLabels) {
        if ( typeof(errorLabels) != 'undefined') {
            _labelAliasFill(errorLabels);
            local.errorLabels = merge(errorLabels, local.errorLabels)
        }
    }

    return self
};

if ( ( typeof(module) !== 'undefined' ) && module.exports ) {
    // Publish as node.js module
    module.exports  = FormValidatorUtil
} else if ( typeof(define) === 'function' && define.amd) {
    // Publish as AMD module
    define(function() { return FormValidatorUtil })
}