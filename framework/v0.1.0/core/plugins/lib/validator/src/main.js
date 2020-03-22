
/**
 * ValidatorPlugin
 *
 * Dependencies:
 *  - utils/form-validator
 *  - utils/merge
 *  - utils/events
 *  - vendor/uuid
 *
 * @param {object} rule
 * @param {object} [ data ] // from request
 * @param {string} [ formId ]
 * */
function ValidatorPlugin(rules, data, formId) {

    this.plugin = 'validator';

    /**
     * validator event handler - isGFFCtx only
     * */
    var events      = ['ready', 'error', 'progress', 'submit', 'success', 'change', "destroy"];

    /** imports */
    var isGFFCtx        = ( ( typeof(module) !== 'undefined' ) && module.exports ) ? false : true;
    if (isGFFCtx) {
        require('utils/events');
        registerEvents(this.plugin, events);

        require('utils/dom');
        require('utils/effects');

    } else {
        var cacheless   = (process.env.IS_CACHELESS == 'false') ? false : true;
        if (cacheless) {
            delete require.cache[require.resolve('./form-validator')]
        }
    }

    var uuid            = (isGFFCtx) ? require('vendor/uuid') : require('uuid');
    var merge           = (isGFFCtx) ? require('utils/merge') : require('../../../../../lib/merge');
    var FormValidator   = (isGFFCtx) ? require('utils/form-validator') : require('./form-validator');

    /** definitions */
    var instance    = { // isGFFCtx only
        'id'                : 'validator-' + uuid.v4(),

        'plugin'            : this.plugin,
        'on'                : (isGFFCtx) ? on : null,
        'eventData'         : {},
        'target'            : (isGFFCtx) ? document : null, // by default

        'initialized'       : false,
        'isReady'           : false,
        'rules'             : {},
        '$forms'            : {},
        'getFormById'       : null,
        'validateFormById'  : null,
        'setOptions'        : null,
        'resetErrorsDisplay': null,
        'resetFields'       : null
    };

    // validator proto
    var $validator      = { // isGFFCtx only
        'id'                    : null, // form id

        'plugin'                : this.plugin,
        'on'                    : (isGFFCtx) ? on : null,
        'eventData'             : {},
        'target'                : (isGFFCtx) ? document : null, // by default

        'binded'                : false,
        'withUserBindings'      : false,
        'rules'                 : {},
        'setOptions'            : null,
        'send'                  : null,
        'submit'                : null,
        'destroy'               : null,
        'resetErrorsDisplay'    : null,
        'resetFields'           : null
    };


    /**
     * XML Request - isGFFCtx only
     * */
    var xhr         = null;
    var xhrOptions  = {
        'url'           : '',
        'method'        : 'GET',
        'isSynchrone'   : false,
        'withCredentials': false,
        'headers'       : {
            // to upload, use `multipart/form-data` for `enctype`
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            // cross domain is enabled by default, but you need to setup `Access-Control-Allow-Origin`
            'X-Requested-With': 'XMLHttpRequest' // in case of cross domain origin

        }
    };

    /**
     * backend definitions
     * */
    var setCustomRules = function (customRules) {
        // parsing rules
        if ( typeof(customRule) != 'undefined' ) {
            try {
                parseRules(customRule, '');
                checkForRulesImports(customRule);
            } catch (err) {
                throw err
            }
        }
    }

    var backendProto = {
        'setCustomRules': setCustomRules
    };


    /**
     * Backend init
     *
     * @param {object} rules
     * @param {object} [customRule]
     * */
    var backendInit = function (rules, data, formId) {

        var $form = ( typeof(formId) != 'undefined' ) ? { 'id': formId } : null;
        var fields = {};
        
        for (var field in data) {
            fields[field] = data[field]
        }


        // parsing rules
        if ( typeof(rules) != 'undefined' && rules.count() > 0 ) {
            
            try {
                parseRules(rules, '');
                checkForRulesImports(rules);
            } catch (err) {
                throw err
            }

            backendProto.rules = instance.rules;

            return validate($form, fields, null, instance.rules)

        } else {
            // without rules - by hand
            return new FormValidator(fields)
        }
    }


    /**
     * GFF definitions
     * */

    var setOptions = function (options) {
        var options = merge(options, xhrOptions);
        xhrOptions = options;
    }


    var getFormById = function(formId) {
        var $form = null, _id = formId;

        if ( !instance['$forms'] )
            throw new Error('`$forms` collection not found');

        if ( typeof(_id) == 'undefined') {
            throw new Error('[ FormValidator::getFormById(formId) ] `formId` is missing')
        }

        _id = _id.replace(/\#/, '');

        // in case form is created on the fly and is not yet registered
        if (document.getElementById(_id) != null && typeof (instance['$forms'][_id]) == 'undefined') {
            //instance['$forms'][_id] = document.getElementById(_id);
            
            initForm( document.getElementById(_id) );
        }

        if ( typeof(instance['$forms'][_id]) != 'undefined' ) {
            instance['$forms'][_id].withUserBindings = true;

            if ( typeof(this.$forms[_id]) == 'undefined') {
                this.$forms[_id] = instance['$forms'][_id];
            }
            $form = this.$forms[_id];
        }

        return $form
    }


    /**
     * validateFormById
     *
     * @param {string} formId
     * @param {object} [customRule]
     *
     * @return {object} $form
     * */
    var validateFormById = function(formId, customRule) {
        var $form = null, _id = formId;


        if ( !instance['$forms'] ) {
            throw new Error('`$forms` collection not found')
        }


        if ( typeof(_id) == 'undefined') {
            if ( typeof(this.id) != 'undefined' && this.id != '' && this.id != null ) {
                _id = this.id
            } else {
                throw new Error('[ FormValidator::validateFormById(formId, customRule) ] `formId` is missing')
            }
        }

        if ( typeof(_id) == 'string') {
            _id = _id.replace(/\#/, '')
        } else if ( typeof(_id) == 'object' && !Array.isArray(_id) ) { // weird exception

            var $target = _id.form;
            _id = $target.getAttribute('id') || 'form.'+uuid.v4();

            $target.setAttribute('id', _id);// just in case

        } else {
            throw new Error('[ FormValidator::validateFormById(formId[, customRule]) ] `formId` should be a `string`');
        }

        checkForDuplicateForm(_id);
        
        if ( typeof(instance['$forms'][_id]) != 'undefined' ) {            
            $form   = this.$forms[_id] = instance['$forms'][_id];
        } else { // binding a form out of context (outside of the main instance)
            var $target             = document.getElementById(_id);
            $validator.id           = _id;
            $validator.target       = $target;

            $form = this.$forms[_id] = instance.$forms[_id] = merge({}, $validator);

            var rule    = null;
            if ( typeof(customRule) == 'undefined') {
                rule = _id.replace(/\-/g, '.');

                if ( typeof(instance.rules[rule]) != 'undefined' ) {
                    $form['rule'] = customRule = instance.rules[rule];
                } else if ( typeof($form.target) != 'undefined' && $form.target !== null && $form.target.getAttribute('data-gina-form-rule') ) {
                    rule = $form.target.getAttribute('data-gina-form-rule').replace(/\-/g, '.');

                    if ( typeof(instance.rules[rule]) != 'undefined' ) {
                        $form['rule'] = instance.rules[rule]
                    } else {
                        throw new Error('[ FormValidator::validateFormById(formId) ] using `data-gina-form-rule` on form `'+$form.target+'`: no matching rule found')
                    }
                } // no else to allow form without any rule
            } else {
                rule = customRule.replace(/\-/g, '.');

                if ( typeof(instance.rules[rule]) != 'undefined' ) {
                    $form['rule'] = instance.rules[rule]
                } else {
                    throw new Error('[ FormValidator::validateFormById(formId, customRule) ] `'+customRule+'` is not a valid rule')
                }
            }
            
            if ($target && !$form.binded)
                bindForm($target, rule);
        }
        
        

        if (!$form) throw new Error('[ FormValidator::validateFormById(formId, customRule) ] `'+_id+'` not found');

        return $form || null;

    }

    /**
     * handleErrorsDisplay
     * Attention: if you are going to handle errors display by hand, set data to `null` to prevent Toolbar refresh with empty data
     * @param {object} $form 
     * @param {object} errors 
     * @param {object|null} data 
     */
    var handleErrorsDisplay = function($form, errors, data) {

        if ( GINA_ENV_IS_DEV )
            var formsErrors = null;

        var name    = null, errAttr = null;
        var $err    = null, $msg = null;
        var $el     = null, $parent = null, $target = null;
        var id      = $form.getAttribute('id');
        var data    = ( typeof(data) != 'undefined' ) ? data : {};

        for (var i = 0, len = $form.length; i<len; ++i) {
            $el     = $form[i];
            if ( /form\-item\-wrapper$/.test($el.parentNode.className) ) {
                $parent = $el.parentNode.parentNode;
                $target = $el.parentNode;
            } else {
                $parent = $el.parentNode;
                $target = $el;
            }

            name    = $el.getAttribute('name');
            errAttr = $el.getAttribute('data-gina-form-errors');

            if (!name) continue;

            if ( typeof(errors[name]) != 'undefined' && !/form\-item\-error/.test($parent.className) ) {

                $parent.className += ($parent.className == '' ) ? 'form-item-error' : ' form-item-error';

                $err = document.createElement('div');
                $err.setAttribute('class', 'form-item-error-message');

                // injecting error messages
                for (var e in errors[name]) {

                    if (e != 'stack') { // ignore stack for display
                        $msg = document.createElement('p');
                        $msg.appendChild( document.createTextNode(errors[name][e]) );
                        $err.appendChild($msg);
                    }

                    if ( GINA_ENV_IS_DEV ) {
                        if (!formsErrors) formsErrors = {};
                        if ( !formsErrors[ name ] )
                            formsErrors[ name ] = {};

                        formsErrors[ name ][e] = errors[name][e]
                    }
                }

                if ($target.type != 'hidden')
                    insertAfter($target, $err);

            } else if ( typeof(errors[name]) == 'undefined' && /form\-item\-error/.test($parent.className) ) {
                // reset when not in error
                // remove child elements
                var $children = $parent.getElementsByTagName('div');
                for (var c = 0, cLen = $children.length; c<cLen; ++c) {
                    if ( /form\-item\-error\-message/.test($children[c].className) ) {
                        //$parent.removeChild($children[c]);
                        $children[c].parentElement.removeChild($children[c]);
                        break
                    }
                }

                $parent.className = $parent.className.replace(/(\s+form\-item\-error|form\-item\-error)/, '');

            } else if ( typeof(errors[name]) != 'undefined' && errAttr) {
                // refreshing already displayed error on msg update
                var $divs = $parent.getElementsByTagName('div');
                for (var d = 0, dLen = $divs.length; d<dLen; ++d) {
                    if ($divs[d].className == 'form-item-error-message') {

                        $divs[d].parentElement.removeChild($divs[d]);
                        $err = document.createElement('div');
                        $err.setAttribute('class', 'form-item-error-message');

                        // injecting error messages
                        for (var e in errors[name]) {
                            $msg = document.createElement('p');
                            $msg.appendChild( document.createTextNode(errors[name][e]) );
                            $err.appendChild($msg);

                            if ( GINA_ENV_IS_DEV ) {
                                if (!formsErrors) formsErrors = {};
                                if ( !formsErrors[ name ] )
                                    formsErrors[ name ] = {};

                                formsErrors[ name ][e] = errors[name][e]
                            }
                        }

                        break;
                    }
                }

                if ($target.type != 'hidden')
                    insertAfter($target, $err);

            }
        }


        var objCallback = null;
        if ( formsErrors ) {

            triggerEvent(gina, $form, 'error.' + id, errors)

            if ( isGFFCtx && typeof(window.ginaToolbar) == 'object' ) {
                // update toolbar
                if (!gina.forms.errors)
                    gina.forms.errors = {};

                objCallback = {
                    id      : id,
                    errors  : formsErrors
                };

                window.ginaToolbar.update('forms', objCallback);
            }
        } else if ( isGFFCtx && typeof(window.ginaToolbar) == 'object') { // reset toolbar form errors
            if (!gina.forms.errors)
                gina.forms.errors = {};

            objCallback = {
                id: id,
                errors: {}
            };
            if (isGFFCtx)
                window.ginaToolbar.update('forms', objCallback);
        }

        if (gina && isGFFCtx && typeof(window.ginaToolbar) == "object" && data) {
            try {
                // update toolbar
                window.ginaToolbar.update('data-xhr', data);

            } catch (err) {
                throw err
            }
        }

    }


    /**
     * Reset errors display
     *
     * @param {object|string} [$form|formId]
     *
     * */
    var resetErrorsDisplay = function($form) {
        var $form = $form, _id = null;
        if ( typeof($form) == 'undefined' ) {
            if ( typeof(this.target) != 'undefined' ) {
                _id = this.target.getAttribute('id');
            } else {
                _id = this.getAttribute('id');
            }

            $form = instance.$forms[_id]
        } else if ( typeof($form) == 'string' ) {
            _id = $form;
            _id = _id.replace(/\#/, '');

            if ( typeof(instance.$forms[_id]) == 'undefined') {
                throw new Error('[ FormValidator::resetErrorsDisplay([formId]) ] `'+$form+'` not found')
            }

            $form = instance.$forms[_id]
        }
        //reseting error display
        handleErrorsDisplay($form['target'], []);

        return $form
    }

    /**
     * Reset fields
     *
     * @param {object|string} [$form|formId]
     *
     * */
    var resetFields = function($form) {
        var $form = $form, _id = null;
        if ( typeof($form) == 'undefined' ) {
            if ( typeof(this.target) != 'undefined' ) {
                _id = this.target.getAttribute('id');
            } else {
                _id = this.getAttribute('id');
            }

            $form = instance.$forms[_id]
        } else if ( typeof($form) == 'string' ) {
            _id = $form;
            _id = _id.replace(/\#/, '');

            if ( typeof(instance.$forms[_id]) == 'undefined') {
                throw new Error('[ FormValidator::resetErrorsDisplay([formId]) ] `'+$form+'` not found')
            }

            $form = instance.$forms[_id]
        }

        if ($form.fieldsSet) {

            var elId            = null
                , $element      = null
                , type          = null
                , defaultValue  = null;

            for (var f in $form.fieldsSet) {

                $element    = document.getElementById(f)
                type        = $element.tagName.toLowerCase();

                if (type == 'input') {
                    $element.value = $form.fieldsSet[f].value;
                } else if ( type == 'select' ) {
                    
                    defaultValue = $element.getAttribute('data-value') || null;
                    
                    if (defaultValue && typeof($element.options[ defaultValue ]) != 'undefined' ) {
                        $element.options[ defaultValue ].selected = true;
                    } else {
                        $element.options[ $form.fieldsSet[f].value ].selected = true;
                        $element.setAttribute('data-value',  $element.options[ $form.fieldsSet[f].value ].value);    
                    }
                }
            }
        }

        return $form
    }

    // TODO - refreshErrorsDisplay
    // var refreshErrorsDisplay = function ($form) {
    //
    // }

    var submit = function () {

        var $form = null, _id = null, $target = null;

        if ( typeof(this.getAttribute) != 'undefined' ) {
            _id = this.getAttribute('id');
            $target = this;
        } else if ( typeof(this.target) != 'undefined' && this.target != null && typeof(this.target.getAttribute) != 'undefined' ) {
            _id = this.target.getAttribute('id');
            $target = this.target
        }

        if ( typeof(instance.$forms[_id]) == 'undefined') {
            throw new Error('[ FormValidator::submit() ] not `$form` binded. Use `FormValidator::getFormById(id)` or `FormValidator::validateFormById(id)` first ')
        }

        triggerEvent(gina, $target, 'submit');

        return this;
    }


    /**
     * send
     * N.B.: no validation here; if you want to validate against rules, use `.submit()` before
     *
     *
     * @param {object} data
     * @param {object} [ options ] : { isSynchrone: true, withCredentials: true }
     * */
    var send = function(data, options) {

        var $target = this.target , id = $target.getAttribute('id');
        var $form   = instance.$forms[id] || this;
        var result  = null;
        var XHRData = null;
        var isAttachment = null; // handle download
        var hFormIsRequired = null;
        
        options = (typeof (options) != 'undefined') ? merge(options, xhrOptions) : xhrOptions;
        
        // forward callback to HTML data event attribute through `hform` status
        hFormIsRequired = ( $target.getAttribute('data-gina-form-event-on-submit-success') || $target.getAttribute('data-gina-form-event-on-submit-error') ) ? true : false;
        // success -> data-gina-form-event-on-submit-success
        // error -> data-gina-form-event-on-submit-error
        if (hFormIsRequired)
            listenToXhrEvents($form);

        var url         = $target.getAttribute('action') || options.url;
        var method      = $target.getAttribute('method') || options.method;
        method          = method.toUpperCase();
        options.method  = method;
        options.url     = url;

        // to upload, use `multipart/form-data` for `enctype`
        var enctype = $target.getAttribute('enctype') || options.headers['Content-Type'];
                

        if ( options.withCredentials ) {

            if ('withCredentials' in xhr) {
                // XHR for Chrome/Firefox/Opera/Safari.
                if (options.isSynchrone) {
                    xhr.open(options.method, options.url, options.isSynchrone)
                } else {
                    xhr.open(options.method, options.url)
                }
            } else if ( typeof XDomainRequest != 'undefined' ) {
                // XDomainRequest for IE.
                xhr = new XDomainRequest();
                xhr.open(options.method, options.url);
            } else {
                // CORS not supported.
                xhr = null;
                result = 'CORS not supported: the server is missing the header `"Access-Control-Allow-Credentials": true` ';
                triggerEvent(gina, $target, 'error.' + id, result);

                return
            }
            
            if ( typeof(options.responseType) != 'undefined' ) {
                xhr.responseType = options.responseType;
            } else {
                xhr.responseType = '';
            }

            xhr.withCredentials = true;
        } else {
            if (options.isSynchrone) {
                xhr.open(options.method, options.url, options.isSynchrone)
            } else {
                xhr.open(options.method, options.url)
            }
        }

        // setting up headers -    all but Content-Type ; it will be set right before .send() is called
        for (var hearder in options.headers) {
             //if ( hearder == 'Content-Type' && typeof (enctype) != 'undefined' && enctype != null && enctype != '') {
             //    options.headers[hearder] = enctype
             //}
            if (hearder == 'Content-Type' && typeof (enctype) != 'undefined' && enctype != null && enctype != '')
                continue;

            xhr.setRequestHeader(hearder, options.headers[hearder]);
        }
        
        if (xhr) {
            // catching ready state cb
            xhr.onreadystatechange = function (event) {
                
                if (xhr.readyState == 2) { // responseType interception
                    isAttachment    = ( /^attachment\;/.test( xhr.getResponseHeader("Content-Disposition") ) ) ? true : false; 
                    // force blob response type
                    if ( !xhr.responseType && isAttachment ) {
                        xhr.responseType = 'blob';
                    }
                }

                if (xhr.readyState == 4) {
                    var blob            = null;
                    var contentType     = xhr.getResponseHeader("Content-Type");     
                       
                    // 200, 201, 201' etc ...
                    if( /^2/.test(xhr.status) ) {

                        try {
                            
                            
                            // handling blob xhr download
                            if ( /blob/.test(xhr.responseType) || isAttachment ) {
                                if ( typeof(contentType) == 'undefined' || contentType == null) {
                                    contentType = 'application/octet-stream';
                                }
                                
                                blob = new Blob([this.response], { type: contentType });
                                
                                //Create a link element, hide it, direct it towards the blob, and then 'click' it programatically
                                var a = document.createElement('a');
                                a.style = "display: none";
                                document.body.appendChild(a);
                                //Create a DOMString representing the blob and point the link element towards it
                                var url = window.URL.createObjectURL(blob);
                                a.href = url;
                                var contentDisposition = xhr.getResponseHeader("Content-Disposition");
                                a.download = contentDisposition.match('\=(.*)')[0].substr(1);
                                //programatically click the link to trigger the download
                                a.click();
                                //release the reference to the file by revoking the Object URL
                                window.URL.revokeObjectURL(url);
                                
                                result = {
                                    status : xhr.status,
                                    statusText: xhr.statusText,
                                    responseType: blob.type,
                                    type : blob.type,
                                    size : blob.size 
                                }
                                
                            } else { // normal case
                                result = xhr.responseText;                                
                            }
                            

                            
                            if ( /\/json/.test( contentType ) ) {
                                result = JSON.parse(xhr.responseText);
                                
                                if ( typeof(result.status) == 'undefined' )
                                    result.status = xhr.status;
                            }
                            
                            if ( /\/html/.test( contentType ) ) {
                                
                                result = {
                                    contentType : contentType,
                                    content     : xhr.responseText
                                };
                                
                                if ( typeof(result.status) == 'undefined' )
                                    result.status = xhr.status;
                                    
                                // if hasPopinHandler & popinIsBinded
                                if ( typeof(gina.popin) != 'undefined' && gina.hasPopinHandler /** && gina.popinIsBinded*/ ) {
                                    
                                    // select popin by id
                                    var $popin = gina.popin.getActivePopin();
                                    
                                    if ($popin) {
                                                     
                                        XHRData = {};
                                        // update toolbar
                                            
                                        try {
                                            XHRData = new DOMParser().parseFromString(result.content, 'text/html').getElementById('gina-without-layout-xhr-data');
                                            XHRData = JSON.parse(decodeURIComponent(XHRData.value));
                                            
                                            XHRView = new DOMParser().parseFromString(result.content, 'text/html').getElementById('gina-without-layout-xhr-view');      
                                            XHRView = JSON.parse(decodeURIComponent(XHRView.value));
                                            
                                            // update data tab                                                
                                            if ( gina && typeof(window.ginaToolbar) && typeof(XHRData) != 'undefined' ) {
                                                window.ginaToolbar.update("data-xhr", XHRData);
                                            }
                                            
                                            // update view tab
                                            
                                            if ( gina && typeof(window.ginaToolbar) && typeof(XHRView) != 'undefined' ) {
                                                window.ginaToolbar.update("view-xhr", XHRView);
                                            }   

                                        } catch (err) {
                                            throw err
                                        }
                                        
                                        
                                        $popin.loadContent(result.content);
                                                                                
                                        result = XHRData;
                                        triggerEvent(gina, $target, 'success.' + id, result);
                                        
                                        return;
                                    }
                                    
                                    
                                }
                            }

                            $form.eventData.success = result;

                            XHRData = result;
                            // update toolbar
                            if ( gina && typeof(window.ginaToolbar) == "object" && XHRData ) {
                                try {
                                    // don't refresh for html datas
                                    if ( typeof(XHRData) != 'undefined' && /\/html/.test(contentType) ) {
                                        window.ginaToolbar.update("data-xhr", XHRData);
                                    }

                                } catch (err) {
                                    throw err
                                }
                            }

                            triggerEvent(gina, $target, 'success.' + id, result);
                            // intercept upload
                            if ( /^gina\-upload/i.test(id) )
                                onUpload(gina, $target, 'success', id, result);
                                
                            if (hFormIsRequired)
                                triggerEvent(gina, $target, 'success.' + id + '.hform', result);
                            
                        } catch (err) {

                            result = {
                                status:  422,
                                error : err.message,
                                stack : err.stack

                            };

                            $form.eventData.error = result;
                          

                            XHRData = result;                            
                            // update toolbar
                            if ( gina && typeof(window.ginaToolbar) == "object" && XHRData ) {
                                try {

                                    if ( typeof(XHRData) != 'undefined' ) {
                                        window.ginaToolbar.update("data-xhr", XHRData);
                                    }

                                } catch (err) {
                                    throw err
                                }
                            }

                            triggerEvent(gina, $target, 'error.' + id, result);
                            if (hFormIsRequired)
                                triggerEvent(gina, $target, 'error.' + id + '.hform', result);
                        }
                        
                        // handle redirect
                        if ( typeof(result) != 'undefined' && typeof(result.location) != 'undefined' ) {                        
                            window.location.hash = ''; //removing hashtag 
                              
                            // if ( window.location.host == gina.config.hostname && /^(http|https)\:\/\//.test(result.location) ) { // same origin
                            //     result.location = result.location.replace( new RegExp(gina.config.hostname), '' );
                            // } else { // external - need to remove `X-Requested-With` from `options.headers`
                                result.location = (!/^http/.test(result.location) && !/^\//.test(result.location) ) ? location.protocol +'//' + result.location : result.location;
                            //}                        
                            
                            window.location.href = result.location;
                            return;                        
                        }

                    } else if ( xhr.status != 0) {
                        
                        result = { 'status': xhr.status, 'message': '' };
                        // handling blob xhr error
                        if ( /blob/.test(xhr.responseType) ) {
                                                        
                            blob = new Blob([this.response], { type: 'text/plain' });
                            
                            var reader = new FileReader(), blobError = '';
                                                        
                            
                            // This fires after the blob has been read/loaded.
                            reader.addEventListener('loadend', (e) => {
                                
                                if ( /string/i.test(typeof(e.srcElement.result)) ) {
                                    blobError += e.srcElement.result;
                                    // try {
                                    //     result = merge( result, JSON.parse(blobError) )
                                    // } catch (err) {
                                    //     result = merge(result, err)
                                    // }
    
                                } else if ( typeof(e.srcElement.result) == 'object' ) {
                                    result = merge(result, e.srcElement.result)
                                } else {
                                    result.message += e.srcElement.result
                                }
                                
                                // once ready
                                if ( /2/.test(reader.readyState) ) {
                                    
                                    if ( /^(\{|\[)/.test( blobError ) ) {
                                        try {
                                            result = merge( result, JSON.parse(blobError) )
                                        } catch(err) {
                                            result = merge(result, err)
                                        }                                        
                                    }
                                    
                                    if (!result.message)
                                        delete result.message;
                                    
                                    $form.eventData.error = result;

                                    // forward appplication errors to forms.errors when available
                                    if ( typeof(result) != 'undefined' && typeof(result.error) != 'undefined' &&  result.error.fields && typeof(result.error.fields) == 'object') {
                                        var formsErrors = {}, errCount = 0;
                                        for (var f in result.error.fields) {
                                            ++errCount;
                                            formsErrors[f] = { isApplicationValidationError: result.error.fields[f] };
                                        }

                                        if (errCount > 0) {
                                            handleErrorsDisplay($form.target, formsErrors);
                                        }
                                    }

                                    // update toolbar
                                    XHRData = result;
                                    if ( gina && typeof(window.ginaToolbar) == "object" && XHRData ) {
                                        try {
                                            // update toolbar
                                            window.ginaToolbar.update('data-xhr', XHRData );

                                        } catch (err) {
                                            throw err
                                        }
                                    }

                                    triggerEvent(gina, $target, 'error.' + id, result);
                                    if (hFormIsRequired)
                                        triggerEvent(gina, $target, 'error.' + id + '.hform', result);
                                }
                                
                                    
                            });

                            // Start reading the blob as text.
                            reader.readAsText(blob);
                            
                        } else { // normal case
                            
                            if ( /^(\{|\[)/.test( xhr.responseText ) ) {

                                try {
                                    result = merge( result, JSON.parse(xhr.responseText) )
                                } catch (err) {
                                    result = merge(result, err)
                                }

                            } else if ( typeof(xhr.responseText) == 'object' ) {
                                result = merge(result, xhr.responseText)
                            } else {
                                result.message = xhr.responseText
                            }

                            $form.eventData.error = result;

                            // forward appplication errors to forms.errors when available
                            if ( typeof(result) != 'undefined' && typeof(result.error) != 'undefined' &&  result.error.fields && typeof(result.error.fields) == 'object') {
                                var formsErrors = {}, errCount = 0;
                                for (var f in result.error.fields) {
                                    ++errCount;
                                    formsErrors[f] = { isApplicationValidationError: result.error.fields[f] };
                                }

                                if (errCount > 0) {
                                    handleErrorsDisplay($form.target, formsErrors);
                                }
                            }

                            // update toolbar
                            XHRData = result;
                            if ( gina && typeof(window.ginaToolbar) == "object" && XHRData ) {
                                try {
                                    // update toolbar
                                    window.ginaToolbar.update('data-xhr', XHRData );

                                } catch (err) {
                                    throw err
                                }
                            }

                            triggerEvent(gina, $target, 'error.' + id, result);
                            if (hFormIsRequired)
                                triggerEvent(gina, $target, 'error.' + id + '.hform', result);
                                                         
                        }

                            
                    }
                }
            };

            // catching request progress
            xhr.onprogress = function(event) {
                
                var percentComplete = '0';
                if (event.lengthComputable) {
                    percentComplete = event.loaded / event.total;
                    percentComplete = parseInt(percentComplete * 100);

                }

                //var percentComplete = (event.position / event.totalSize)*100;
                var result = {
                    'status': 100,
                    'progress': percentComplete
                };
                
                //console.log('xhr progress ', percentComplete);

                $form.eventData.onprogress = result;

                triggerEvent(gina, $target, 'progress.' + id, result)
            };

            // catching timeout
            xhr.ontimeout = function (event) {
                result = {
                    'status': 408,
                    'error': 'Request Timeout'
                };

                $form.eventData.ontimeout = result;

                triggerEvent(gina, $target, 'error.' + id, result);
                if (hFormIsRequired)
                    triggerEvent(gina, $target, 'error.' + id + '.hform', result);
            };


            // sending
            if (!data)
                data = event.detail.data;

            if (data) {

                var hasBinaries = false;
                
                if ( typeof(data) == 'object' ) {

                    var binaries    = []
                        , b         = 0;

                    try {
                        if ( !(data instanceof FormData) ) {
                            data = JSON.stringify(data)
                        } else {
                            var newData     = {}
                            , uploadGroup   = event.currentTarget.getAttribute('data-gina-form-upload-group') || 'untagged';
                            for (var [key, value] of data.entries()) {
                                // file upload case
                                if (value instanceof File) {
                                    if (!hasBinaries)
                                        hasBinaries = true;
                                    
                                    binaries[b] = {
                                        key: key,
                                        group: uploadGroup, // `untagged` by default
                                        file: value,
                                        bin: ''
                                    };
                                   
                                    ++b;
                                } else {
                                    newData[key] = value
                                }
                                
                            }
                        }

                        
                        if (hasBinaries && binaries.length > 0) {

                            // We need a separator to define each part of the request
                            var boundary = '--ginaWKBoundary' + uuid.v4().replace(/\-/g, ''); 
                            
                            
                            return processFiles(binaries, boundary, '', 0, function onComplete(err, data, done) {
                                
                                if (err) {
                                    throw err
                                } else {

                                    if (done) {
                                        xhr.setRequestHeader('Content-Type', 'multipart/form-data; boundary=' + boundary);
                                        xhr.send(data);

                                        $form.sent = true;
                                    }

                                    done = false;

                                    return false;
                                }                                
                            });
                            
                        } else if ( typeof(newData) != 'undefined' ) { // without file
                            data = JSON.stringify(newData)
                        }
                        
                        
                    } catch (err) {
                        triggerEvent(gina, $target, 'error.' + id, err);
                        if (hFormIsRequired)
                            triggerEvent(gina, $target, 'error.' + id + '.hform', err);
                    }
                }
                //console.log('sending -> ', data);
                //try {
                if (!hasBinaries) {
                //     var intervalID = null;
                //     intervalID = setInterval(function onTotalReadersCheck() {
                //         if (totalReaders <= 0) {
                            
                //             // rather than letting XMLHttpRequest decode the data first.
                //             //xhr.responseType = 'arraybuffer';
                //             //xhr.setRequestHeader('Content-Type', null);
                //             xhr.setRequestHeader('Content-Type', 'multipart/form-data; boundary=' + boundary);                                                        
                //             xhr.send(data);
                            
                //             clearInterval(intervalID);
                //         }
                //     }, 200);
                // } else {

                    if (typeof (enctype) != 'undefined' && enctype != null && enctype != '') {
                        xhr.setRequestHeader('Content-Type', enctype);
                    }

                    xhr.send(data)
                }
                    
                // } catch (err) {
                //     XHRData = result;
                //     if ( gina && typeof(window.ginaToolbar) == "object" && XHRData ) {
                //         try {
                //
                //             if ( typeof(XHRData) != 'undefined' ) {
                //                 window.ginaToolbar.update("data-xhr", XHRData);
                //             }
                //
                //         } catch (err) {
                //             throw err
                //         }
                //     }
                // }

            } else {

                if ( typeof(enctype) != 'undefined' && enctype != null && enctype != ''){
                    xhr.setRequestHeader('Content-Type', enctype);
                }

                xhr.send()
            }

            $form.sent = true;
        }
    }
    
    var onUpload = function(gina, $target, status, id, data) {
                
        var uploadProperties = $target.uploadProperties || null;
        // {                                    
        //     id              : String,
        //     $form           : $Object,
        //     mandatoryFields : Array,
        //     uploadFields    : Collection
        //     hasPreviewContainer : Boolean,
        //     previewContainer : $Object
        // }
        
        if ( !uploadProperties )
            throw new Error('No uploadProperties found !!');
        // parent form
        var $mainForm = uploadProperties.$form;
        var searchArr   = null
            , name      = null
            , $previewContainer     = null
            , files                 = data.files || []
            , $error                = $mainForm.getElementsByClassName('js-error')[0]
        ;
               
        
        //reset errors
        $error.style.display = 'none';
        if (status != 'success') { // handle errors first
           // console.error('[ mainUploadError ] ', status, data)
            var errMsg = data.message || data.error;         
            
            $error.innerHTML = '<p>'+ errMsg +'</p>';
            fadeIn($error);
        } else {
            
            // reset previwContainer
            if ( uploadProperties.hasPreviewContainer ) {                
                $previewContainer = document.getElementById(uploadProperties.previewContainer.id);
                if ($previewContainer)
                    $previewContainer.innerHTML = '';
            }
            
            var fieldsObjectList = null
                , $li   = null
                , $img = null
                , maxWidth = null
            ;
            for (var f = 0, fLen = files.length; f<fLen; ++f) {
                // fill the fields to be saved ;)                
                fieldsObjectList = uploadProperties.uploadFields[f];
                for (var key in fieldsObjectList) {                    
                    fieldsObjectList[key].value = files[f][key];
                    // handle preview
                    if (key == 'preview' ) {
                        for (var previewKey in files[f][key]) {  
                            if ( typeof(files[f][key][previewKey]) != 'undefined' && typeof(fieldsObjectList[key][previewKey]) != 'undefined' ) {
                                fieldsObjectList[key][previewKey].value = files[f][key][previewKey];
                            }
                            
                            // with preview
                            if ( previewKey == 'tmpUri' && uploadProperties.hasPreviewContainer ) {                                
                                $img = document.createElement('IMG');
                                $img.src = files[f][key].tmpUri;
                                $img.style.display = 'none';
                                maxWidth = $previewContainer.getAttribute('data-preview-max-width') || null;
                                if ( maxWidth ) {
                                    $img.width = maxWidth
                                }
                                
                                if ( /ul/i.test(uploadProperties.previewContainer.tagName) ) {
                                    $li = document.createElement('LI');
                                    $li.className = 'item';
                                    $li.appendChild($img);
                                    $previewContainer.appendChild($li);                                
                                } else {
                                    $previewContainer.appendChild($img);
                                }
                                fadeIn($img);
                            } else if ( previewKey == 'tmpUri' ) { // without preview
                                
                            }
                        }
                    }                  
                }
                
            }
        }
    }

    

    /**
     * Convert <Uint8Array|Uint16Array|Uint32Array> to <String>
     * @param {array} buffer
     * @param {number} [byteLength] e.g.: 8, 16 or 32
     * 
     * @return {string} stringBufffer
     */
    var ab2str = function(event, buf, byteLength) {

        var str = '';
        var ab = null;

        if ( typeof(byteLength) == 'undefined' ) {
            var byteLength = 8;
        }

        
        var bits = (byteLength / 8) 


        switch (byteLength) {
            case 8:
                ab = new Uint8Array(buf);
                break;
            case 16:
                ab = new Uint16Array(buf);
                break;

            case 32:
                ab = new Uint32Array(buf);
                break;
                
            default:
                ab = new Uint8Array(buf);      
                break;      

        }


        var abLen = ab.length;
        var CHUNK_SIZE = Math.pow(2, 8) + bits;
        var offset = null, len = null, subab = null;
        
        for (offset = 0; offset < abLen; offset += CHUNK_SIZE) {
            len = Math.min(CHUNK_SIZE, abLen - offset);
            subab = ab.subarray(offset, offset + len);
            str += String.fromCharCode.apply(null, subab);
        }
        return str;
    }


    var processFiles = function(binaries, boundary, data, f, onComplete) {

        var reader = new FileReader();
        
        // progress
        // reader.addEventListener('progress', (e) => {
        //     var percentComplete = '0';
        //     if (e.lengthComputable) {
        //         percentComplete = e.loaded / e.total;
        //         percentComplete = parseInt(percentComplete * 100);

        //     }

        //     // var result = {
        //     //     'status': 100,
        //     //     'progress': percentComplete
        //     // };
            
        //     console.log('progress', percentComplete);

        //     //$form.eventData.onprogress = result;

        //     //triggerEvent(gina, $target, 'progress.' + id, result)
        // });

        reader.addEventListener('load', function onReaderLoaded(e) {

            e.preventDefault();
            
            // var percentComplete = '0';
            // if (e.lengthComputable) {
            //     percentComplete = e.loaded / e.total;
            //     percentComplete = parseInt(percentComplete * 100);
                
            //     console.log('progress', percentComplete);
            // }
                                    

            try {
                
                var bin = ab2str(e, this.result);
                ;                
                binaries[this.index].bin += bin;

                if (!binaries[this.index].file.type) {
                    binaries[this.index].file.type = 'application/octet-stream'
                }

            } catch (err) {
                return onComplete(err, null, true);
            }

            // Start a new part in our body's request
            data += "--" + boundary + "\r\n";

            // Describe it as form data
            data += 'Content-Disposition: form-data; '

                // Define the name of the form data
                + 'name="' + binaries[this.index].key + '"; '
                
                // Define the upload group
                + 'group="' + binaries[this.index].group + '"; '

                // Provide the real name of the file
                + 'filename="' + binaries[this.index].file.name + '"\r\n';


            // And the MIME type of the file
            data += 'Content-Type: ' + binaries[this.index].file.type + '\r\n';
            

            // File length
            data += 'Content-Length: ' + binaries[this.index].bin.length + '\r\n';

            // There's a blank line between the metadata and the data
            data += '\r\n';

            // Append the binary data to our body's request
            data += binaries[this.index].bin + '\r\n';

            ++this.index;
            // is last file ?
            if (this.index == binaries.length) {

                // Once we are done, "close" the body's request
                data += "--" + boundary + "--";

                onComplete(false, data, true);

            } else { // process next file
                processFiles(binaries, boundary, data, this.index, onComplete)
            }

            
        }, false);

        reader.index = f;
        binaries[f].bin = '';

        reader.readAsArrayBuffer(binaries[f].file);
        //reader.readAsBinaryString(binaries[f].file);
    }

    
    var listenToXhrEvents = function($form) {


        //data-gina-form-event-on-submit-success
        var htmlSuccesEventCallback =  $form.target.getAttribute('data-gina-form-event-on-submit-success') || null;
        if (htmlSuccesEventCallback != null) {

            if ( /\((.*)\)/.test(htmlSuccesEventCallback) ) {
                eval(htmlSuccesEventCallback)
            } else {
                $form.on('success.hform',  window[htmlSuccesEventCallback])
            }
        }

        //data-gina-form-event-on-submit-error
        var htmlErrorEventCallback =  $form.target.getAttribute('data-gina-form-event-on-submit-error') || null;
        if (htmlErrorEventCallback != null) {
            if ( /\((.*)\)/.test(htmlErrorEventCallback) ) {
                eval(htmlErrorEventCallback)
            } else {
                $form.on('error.hform', window[htmlErrorEventCallback])
            }
        }
    }

    var destroy = function(formId) {
        var $form = null, _id = formId;


        if ( !instance['$forms'] )
            throw new Error('`$forms` collection not found');


        if ( typeof(_id) == 'undefined') {
            if ( typeof(this.id) != 'undefined' && this.id != '' && this.id != null ) {
                _id  = this.id
            } else {
                throw new Error('[ FormValidator::destroy(formId) ] `formId` is missing')
            }
        }

        if ( typeof(_id) == 'string') {
            _id = _id.replace(/\#/, '')
        } else if ( typeof(_id) == 'object' && !Array.isArray(_id) ) { // weird exception
            var $target = _id.form;
            _id = $target.getAttribute('id') || 'form.'+uuid.v4();

            $target.setAttribute('id', _id);// just in case

        } else {
            throw new Error('[ FormValidator::destroy(formId) ] `formId` should be a `string`');
        }

        if ( typeof(instance['$forms'][_id]) != 'undefined' ) {
            $form = instance['$forms'][_id]
        } else if ( typeof(this.binded) != 'undefined' ) {
            $form = this;
        }

        if ($form) {
            // remove existing listeners

            // form events
            removeListener(gina, $form, 'success.' + _id);
            removeListener(gina, $form, 'error.' + _id);

            if ($form.target.getAttribute('data-gina-form-event-on-submit-success'))
                removeListener(gina, $form, 'success.' + _id + '.hform');
                
            if ($form.target.getAttribute('data-gina-form-event-on-submit-error'))
                removeListener(gina, $form, 'error.' + _id + '.hform');

            removeListener(gina, $form, 'validate.' + _id);
            removeListener(gina, $form, 'submit.' + _id);
            
            

            // binded elements
            var $el         = null
                , evt       = null
                , $els      = []
                , $elTMP    = [];

            // submit buttons
            $elTMP = $form.target.getElementsByTagName('button');
            if ( $elTMP.length > 0 ) {
                for(var i = 0, len = $elTMP.length; i < len; ++i) {
                    if ($elTMP[i].type == 'submit')
                        $els.push($elTMP[i])
                }
            }

            // submit links
            $elTMP = $form.target.getElementsByTagName('a');
            if ( $elTMP.length > 0 ) {
                for(var i = 0, len = $elTMP.length; i < len; ++i) {
                    if ( $elTMP[i].attributes.getNamedItem('data-gina-form-submit') || /^click\./.test( $elTMP[i].attributes.getNamedItem('id') ) || /^link\./.test( $elTMP[i].attributes.getNamedItem('id') ) )
                        $els.push($elTMP[i])
                }
            }

            // checkbox & radio
            $elTMP = $form.target.getElementsByTagName('input');
            if ( $elTMP.length > 0 ) {
                for(var i = 0, len = $elTMP.length; i < len; ++i) {
                    if ($elTMP[i].type == 'checkbox' || $elTMP[i].type == 'radio' )
                        $els.push( $elTMP[i] )
                }
            }

            for (var i = 0, len = $els.length; i < len; ++i) {

                $el = $els[i];

                if ($el.type == 'submit') {

                    evt = $el.getAttribute('id');
                    if ( typeof(gina.events[ evt ]) != 'undefined' )
                        removeListener(gina, $el, gina.events[ evt ]);

                } else {

                    evt ='click.' + $el.getAttribute('id');
                    if ( typeof(gina.events[ evt ]) != 'undefined' )
                        removeListener(gina, $el, evt);
                }
            }

            $form.binded = false;

            addListener(gina, $form.target, 'destroy.' + _id, function(event) {

                cancelEvent(event);

                delete instance['$forms'][_id];
                removeListener(gina, event.currentTarget, event.type);
                removeListener(gina, event.currentTarget,'destroy');
            });

            //triggerEvent(gina, instance['$forms'][_id].target, 'destroy.' + _id);
            triggerEvent(gina, $form.target, 'destroy.' + _id);

        } else {
            throw new Error('[ FormValidator::destroy(formId) ] `'+_id+'` not found');
        }

    }

    var checkForRulesImports = function (rules) {
        // check if rules has imports & replace
        var rulesStr = JSON.stringify(rules, null, 4);
        var importedRules = rulesStr.match(/(\"@import\s+[a-z A-Z 0-9/.]+\")/g);
        if (!instance.rules) {
            instance.rules = {}
        }
        if (importedRules && importedRules.length > 0) {
            var ruleArr = [], rule = {}, tmpRule = null;
            for (var r = 0, len = importedRules.length; r<len; ++r) {
                ruleArr = importedRules[r].replace(/(@import\s+|\"|\')/g, '').split(/\s/g);
                // [""@import client/form", ""@import project26/edit demo/edit"]
                //console.log('ruleArr -> ', ruleArr, importedRules[r]);
                for (var i = 0, iLen = ruleArr.length; i<iLen; ++i) {
                    tmpRule = ruleArr[i].replace(/\//g, '.');
                    if ( typeof(instance.rules[ tmpRule ]) != 'undefined' ) {
                        rule = merge(rule, instance.rules[ tmpRule ])
                    } else {
                        console.warn('[formValidator:rules] <@import error> on `'+importedRules[r]+'`: rule `'+ruleArr[i]+'` not found. Ignoring.');
                        continue;
                    }
                }
                //console.log('replacing ', importedRules[r]);
                rulesStr = rulesStr.replace(importedRules[r], JSON.stringify(rule));
                instance.rules = JSON.parse( JSON.stringify(instance.rules).replace( new RegExp(importedRules[r], 'g'), JSON.stringify(rule)) );
                //console.log('str ', rulesStr);
                rule = {}

            }

            // if (!instance.rules) {
            //     instance.rules = {}
            // }

            
            rules = JSON.parse(rulesStr);
            parseRules(rules, '');

            // if (!isGFFCtx) {
            //     backendProto.rules = instance.rules
            // }
        }
    }

    var init = function (rules) {

        if (gina.hasValidator) {
            instance = merge(instance, gina.validator);
            instance.on('init', function(event) {
                instance.isReady = true;
                triggerEvent(gina, instance.target, 'ready.' + instance.id, instance)
            })
        } else {
            setupInstanceProto();
            instance.on('init', function(event) {
                // parsing rules
                if ( typeof(rules) != 'undefined' && rules.count() ) {
                    try {
                        // making copy
                        gina.forms.rules = JSON.parse(JSON.stringify(rules));
                        
                        parseRules(rules, '');
                        checkForRulesImports(rules);
                    } catch (err) {
                        throw (err)
                    }
                }

                $validator.setOptions           = setOptions;
                $validator.getFormById          = getFormById;
                $validator.validateFormById     = validateFormById;
                $validator.resetErrorsDisplay   = resetErrorsDisplay;
                $validator.resetFields          = resetFields;
                $validator.handleErrorsDisplay  = handleErrorsDisplay;
                $validator.submit               = submit;
                $validator.send                 = send;
                $validator.destroy              = destroy;

                var id          = null
                    , $target   = null
                    , i         = 0
                    , $forms    = []
                    , $allForms = document.getElementsByTagName('form');


                // has rule ?
                for (var f=0, len = $allForms.length; f<len; ++f) {
                    // preparing prototype (need at least an ID for this)

                    if ($allForms[f].getAttribute) {
                        id = $allForms[f].getAttribute('id') || 'form.' + uuid.v4();
                        if ( id !== $allForms[f].getAttribute('id') ) {
                            $allForms[f].setAttribute('id', id)
                        }
                    } else {
                        id = 'form.' + uuid.v4();
                        $allForms[f].setAttribute('id', id)
                    }

                    $allForms[f]['id'] = $validator.id = id;

                    if ( typeof($allForms[f].id) != 'undefined' && $allForms[f].id != 'null' && $allForms[f].id != '') {

                        $validator.target = $allForms[f];
                        instance.$forms[$allForms[f].id] = merge({}, $validator);

                        var customRule = $allForms[f].getAttribute('data-gina-form-rule');

                        if (customRule) {
                            customRule = customRule.replace(/\-/g, '.');
                            if ( typeof(instance.rules[customRule]) == 'undefined' ) {
                                //customRule = null;   
                                throw new Error('['+$allForms[f].id+'] no rule found with key: `'+customRule+'`. Please check if json is not malformed @ /forms/rules/' + customRule.replace(/\./g, '/') +'.json');        
                            } else {
                                customRule = instance.rules[customRule]
                            }
                        }

                        // finding forms handled by rules
                        if ( typeof($allForms[f].id) == 'string' && typeof(instance.rules[$allForms[f].id.replace(/\-/g, '.')]) != 'undefined' ) {
                            $target = instance.$forms[$allForms[f].id].target;
                            if (customRule) {
                                bindForm($target, customRule)
                            } else {
                                bindForm($target)
                            }

                            ++i
                        } else {
                            // weird exception when having in the form an element with name="id"
                            if ( typeof($allForms[f].id) == 'object' ) {
                                delete instance.$forms[$allForms[f].id];

                                var _id = $allForms[f].attributes.getNamedItem('id').nodeValue || 'form.'+uuid.v4();

                                $allForms[f].setAttribute('id', _id);
                                $allForms[f]['id'] = _id;

                                $validator.target = $allForms[f];
                                instance.$forms[_id] = merge({}, $validator);

                                $target = instance.$forms[_id].target;
                                if (customRule) {
                                    bindForm($target, customRule)
                                } else {
                                    bindForm($target)
                                }
                            } else {

                                $target = instance.$forms[$allForms[f].id].target;
                                if (customRule) {
                                    bindForm($target, customRule)
                                } else {
                                    bindForm($target)
                                }
                            }
                        }
                    }

                }


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

                instance.isReady = true;
                gina.hasValidator = true;
                gina.validator = instance;
                triggerEvent(gina, instance.target, 'ready.' + instance.id, instance);
            });

        }

        instance.initialized = true;
        return instance
    }

    var initForm = function ($form) {

        var customRule = null;

        if ($form.getAttribute) {
            id = $form.getAttribute('id') || 'form.' + uuid.v4();
            if (id !== $form.getAttribute('id')) {
                $form.setAttribute('id', id)
            }
        } else {
            id = 'form.' + uuid.v4();
            $form.setAttribute('id', id)
        }

        $form.id = $validator.id = id;

        if (typeof ($form.id) != 'undefined' && $form.id != 'null' && $form.id != '') {

            $validator.target = $form;
            instance.$forms[$form.id] = merge({}, $validator);

            customRule = $form.getAttribute('data-gina-form-rule');

            if (customRule) {
                customRule = customRule.replace(/\-/g, '.');
                if (typeof (instance.rules[customRule]) == 'undefined') {
                    customRule = null;
                    throw new Error('[' + $form.id + '] no rule found with key: `' + customRule + '`');
                } else {
                    customRule = instance.rules[customRule]
                }
            }

            // finding forms handled by rules
            if (typeof ($form.id) == 'string' && typeof (instance.rules[$form.id.replace(/\-/g, '.')]) != 'undefined') {
                $target = instance.$forms[$form.id].target;
                if (customRule) {
                    bindForm($target, customRule)
                } else {
                    bindForm($target)
                }

            } else {
                // weird exception when having in the form an element with name="id"
                if (typeof ($form.id) == 'object') {
                    delete instance.$forms[$form.id];

                    var _id = $form.attributes.getNamedItem('id').nodeValue || 'form.' + uuid.v4();

                    $form.setAttribute('id', _id);
                    $form.id = _id;

                    $validator.target = $form;
                    instance.$forms[_id] = merge({}, $validator);

                    $target = instance.$forms[_id].target;
                    if (customRule) {
                        bindForm($target, customRule)
                    } else {
                        bindForm($target)
                    }
                } else {

                    $target = instance.$forms[$form.id].target;
                    if (customRule) {
                        bindForm($target, customRule)
                    } else {
                        bindForm($target)
                    }
                }
            }
        }        
    }

    /**
     * parseRules - Preparing rules paths
     *
     * @param {object} rules
     * @param {string} tmp - path
     * */
    var parseRules = function(rules, tmp) {
        var _r = null;
        for (var r in rules) {

            if ( typeof(rules[r]) == 'object' && typeof(instance.rules[tmp + r]) == 'undefined' ) {

                _r = r;
                if (/\[|\]/.test(r) ) { // must be a real path
                    _r = r.replace(/\[/g, '.').replace(/\]/g, '');
                }

                instance.rules[tmp + _r] = rules[r];
                //delete instance.rules[r];
                parseRules(rules[r], tmp + _r +'.');
            }
        }
    }

    var makeObjectFromArgs = function(root, args, obj, len, i, value) {

        var key = args[i].replace(/^\[|\]$/g, '');


        if (i == len - 1) { // end
            obj[key] = value

            return root
        }

        var nextKey = args[i + 1].replace(/^\[|\]$/g, '');

        if (typeof (obj[key]) == 'undefined') {

            if (/^\d+$/.test(nextKey)) { // collection index ?
                obj[key] = [];
            } else {
                obj[key] = {};
            }

            ++i;

            return makeObjectFromArgs(root, args, obj[key], len, i, value);
        }


        for (var k in obj) {

            if (k == key) {
                ++i;
                return makeObjectFromArgs(root, args, obj[key], len, i, value);
            }
        }
    }

    /**
     * makeObject - Preparing form data
     *
     * @param {object} obj - data
     * @param {string\number\boolean} value
     * @param {array} string
     * @param {number} len
     * @param {number} i
     *
     * */
    var makeObject = function (obj, value, args, len, i) {

        if (i >= len) {
            return false
        }

        var key     = args[i].replace(/^\[|\]$/g, '');
        var nextKey = ( i < len-1 && typeof(args[i+1]) != 'undefined' ) ?  args[i+1].replace(/^\[|\]$/g, '') : null;

        if ( typeof(obj[key]) == 'undefined' ) {
            if (nextKey && /^\d+$/.test(nextKey)) {
                nextKey = parseInt(nextKey);
                obj[key] = []
            } else {
                obj[key] = {}
            }
        }

        if ( Array.isArray(obj[key]) ) {
            makeObjectFromArgs(obj[key], args, obj[key], args.length, 1, value);
        } else {
            if (i == len - 1) {
                obj[key] = value;
            } else {
                makeObject(obj[key], value, args, len, i + 1)
            }
        }

        // for (var o in obj) {

        //     if ( typeof(obj[o]) == 'object' ) {

        //         if ( Array.isArray(obj[o]) ) {


        //             if (o === key) {

        //                 // var _args = JSON.parse(JSON.stringify(args));
        //                 // _args.splice(0, 1);

        //                 // for (var a = i, aLen = _args.length; a < aLen; ++a) {
        //                 //     key = _args[a].replace(/^\[|\]$/g, '');
        //                 //     if ( /^\d+$/.test(key) ) {
        //                 //         key = parseInt(key)
        //                 //     }
        //                 //     obj[o][nextKey] = {};

        //                 //     if (a == aLen-1) {
        //                 //         obj[o][nextKey][key] = value;
        //                 //     }
        //                 // }
        //                 //obj[o] = makeObjectFromArgs(obj[o], args, obj[o], args.length, 0, value);
        //                 makeObjectFromArgs(obj[o], args, obj[o], args.length, 0, value);
                        
        //             }

        //         } else if ( o === key ) {

        //             if (i == len-1) {
        //                 obj[o] = value;
        //             } else {
        //                 makeObject(obj[o], value, args, len, i+1)
        //             }
        //         }
        //     }
        // }

    }

    var formatData = function (data) {

        var args        = null
            , obj       = {}
            , key       = null
            , fields    = {};

        for (var name in data) {

            if ( /\[(.*)\]/.test(name) ) {
                // backup name key
                key = name;

                // properties
                args    = name.match(/(\[[-_\[a-z 0-9]*\]\]|\[[-_\[a-z 0-9]*\])/ig);

                // root
                name    = name.match(/^[-_a-z 0-9]+\[{0}/ig);

                // building object tree
                makeObject(obj, data[key], args, args.length, 0);

                //if ( Array.isArray(obj) ) {
                //    fields[name] = merge(fields[name], obj);
                //} else {
                    fields[name] = merge(fields[name], obj);
                //}
                
                obj = {}

            } else {
                fields[name] = data[name];
            }
        }

        return fields
    }
    
    var checkForDuplicateForm = function(id) {
        // check for duplicate form ids
        var $allForms = document.getElementsByTagName('form');
        var dID = null, duplicateFound = {};
        for (var d = 0, dLen = $allForms.length; d < dLen; ++d) {
            dID = $allForms[d].getAttribute('id') || null;       
            if ( typeof(duplicateFound[dID]) == 'undefined'  ) {
                duplicateFound[dID] = true;
            } else {
                if (!instance.$forms[dID].warned) {
                    if (gina.popinIsBinded) {
                        console.warn('Popin/Validator::bindForm($target, customRule): `'+ dID +'` is a duplicate form ID. If not fixed, this could lead to an undesirable behaviour.\n Check inside your popin content');    
                    } else {
                        console.warn('Validator::bindForm($target, customRule): `'+ dID +'` is a duplicate form ID. If not fixed, this could lead to an undesirable behaviour.');
                    }
                    instance.$forms[dID].warned = true;
                }                    
            }
        }
    }


    /**
     * bindForm
     *
     * @param {object} $target - DOM element
     * @param {object} [customRule]
     * */
    var bindForm = function($target, customRule) {

        var $form = null, _id = null;

        try {
            if ( $target.getAttribute && $target.getAttribute('id') ) {
                _id = $target.getAttribute('id');
                if ( typeof(instance.$forms[_id]) != 'undefined')
                    $form = instance.$forms[_id];
                else
                    throw new Error('form instance `'+ _id +'` not found');

            } else {
                throw new Error('Validator::bindForm($target, customRule): `$target` must be a DOM element\n'+err.stack )
            }
        } catch(err) {
            throw new Error('Validator::bindForm($target, customRule) could not bind form `'+ $target +'`\n'+err.stack )
        }

        if ( typeof($form) != 'undefined' && $form.binded) {
            return false
        }
             

        var withRules = false, rule = null, evt = '', procced = null;

        if ( typeof(customRule) != 'undefined' || typeof(_id) == 'string' && typeof(instance.rules[_id.replace(/\-/g, '.')]) != 'undefined' ) {
            withRules = true;

            if ( customRule && typeof(customRule) == 'object' ) {
                rule = customRule
            } else if ( customRule && typeof(customRule) == 'string' && typeof(instance.rules[customRule.replace(/\-/g, '.')]) != 'undefined') {
                rule = instance.rules[customRule.replace(/\-/g, '.')]
            } else {
                rule = instance.rules[_id.replace(/\-/g, '.')]
            }

            $form.rules = rule
        }

        // form fields collection
        if (!$form.fieldsSet)
            $form.fieldsSet = {};

        // binding form elements
        var type        = null
            , id        = null
            // input: checkbox, radio
            , $inputs   = $target.getElementsByTagName('input')
            // select
            , $select   = $target.getElementsByTagName('select')
            , formElementGroup = {}
            , formElementGroupTmp = null
            , formElementGroupItems = {}
            // file upload
            , $htmlTarget = null
            , uploadTriggerId = null
            , $uploadTrigger = null
            , $upload       = null
            , $progress = null
            // to keep track of file collections
            , idxArr            = []
            , idx               = 0
        ;

        var elId = null;
        
                
        for (var f = 0, len = $inputs.length; f < len; ++f) {
            elId = $inputs[f].getAttribute('id');
            if (!elId) {
                elId = 'input.' + uuid.v4();
                $inputs[f].setAttribute('id', elId)
            }

            if (!$form.fieldsSet[ elId ]) {
                $form.fieldsSet[elId] = {
                    id: elId,
                    name: $inputs[f].name || null,
                    value: $inputs[f].value || null
                }
            }
            
            formElementGroupTmp = $inputs[f].getAttribute('data-gina-form-element-group');
            if (formElementGroupTmp) {
                formElementGroup[ $inputs[f].name ] = new RegExp('^'+formElementGroupTmp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
                if (withRules) {
                    if ( typeof($form.rules[ $inputs[f].name ]) == 'undefined') {
                        $form.rules[ $inputs[f].name ] = {}
                    }
                    $form.rules[ $inputs[f].name ].exclude = true;
                }
            }
            
            if ( formElementGroup.count() > 0 ) {
                for ( var g in formElementGroup ) {
                    if ($inputs[f].name == g) continue;
                    
                    if ( formElementGroup[g].test($inputs[f].name) ) {
                        
                        $inputs[f].disabled = true;
                        if ( typeof(formElementGroupItems[ g ]) == 'undefined' ) {
                            formElementGroupItems[ g ] = {}
                        }
                        formElementGroupItems[ g ][ $inputs[f].name ] = $inputs[f];
                    }
                }
            }
            // file upload
            // todo : data-gina-file-autosend="false" when false, don't trigger the sending to the backend
            // todo : progress bar
            // todo : on('success') -> preview
            if ( /^file$/i.test($inputs[f].type) ) {
                // trigger is by default you {input.id} + '-trigger' 
                // e.g.: <input type="file" id="my-upload" name="my-upload">
                // => <button type="button" id="my-upload-trigger">Choose a file</button>
                // But you can use atrtibute `data-gina-form-upload-trigger` to override it
                
                uploadTriggerId = $inputs[f].getAttribute('data-gina-form-upload-trigger');
                if (!uploadTriggerId)
                    uploadTriggerId = $inputs[f].id + '-trigger';
                    
                $uploadTrigger = null;
                // `$htmlTarget` cannot be used if you need to add a listner on the searched element
                $htmlTarget = new DOMParser().parseFromString($target.innerHTML, 'text/html');
                if (uploadTriggerId) {                    
                    $uploadTrigger = document.getElementById(uploadTriggerId);
                }                    
                // binding upload trigger
                if ( $uploadTrigger ) {
                    $uploadTrigger.setAttribute('data-gina-form-upload-target', $inputs[f].id);
                    addListener(gina, $uploadTrigger, 'click', function(event) {
                        event.preventDefault();
                        var $el     = event.target;
                         
                        var fileElemId  = $el.getAttribute('data-gina-form-upload-target') || null;   
                        if (fileElemId)
                            $upload = document.getElementById(fileElemId);
                        
                        if ($upload) {
                            $upload.value = '';// force reset : != multiple
                            triggerEvent(gina, $upload, 'click', event.detail);  
                        }                                     
                    });
                }
                
                // binding file element == $upload
                addListener(gina, $inputs[f], 'change', function(event) {
                    event.preventDefault();
                    var $el     = event.target;
                    // [0] is for a single file, when multiple == false
                    var files = $el.files;
                    if (!files.length ) return false;
                    
                    // $progress = $($(this).parent().find('.progress'));
                    var url             = $el.getAttribute('data-gina-form-upload-action');      
                    var name            = $el.getAttribute('name');
                    var fileId          = name;                    
                    var uploadFormId    = 'gina-upload-' + name.replace(/\[/g, '-').replace(/\]/g, ''); 
                    var eventOnSuccess  = $el.getAttribute('data-gina-form-upload-on-success');
                    var eventOnError    = $el.getAttribute('data-gina-form-upload-on-error');
                    
                    if (files.length > 0) {
                        // create form if not exists
                        var $activePopin = null;
                        var $uploadForm = null;
                        var isPopinContext = false;
                        if ( gina.hasPopinHandler && gina.popinIsBinded ) {
                            $activePopin = gina.popin.getActivePopin();
                        }
                        
                        if ( $activePopin && $activePopin.isOpen ) {
                            isPopinContext = true;
                            // getting active popin
                            $activePopin.$target = new DOMParser().parseFromString($activePopin.target.outerHTML, 'text/html');
                            // binding to DOM
                            $activePopin.$target.getElementById($activePopin.id).innerHTML = document.getElementById($activePopin.id).innerHTML;
                            
                            $uploadForm = $activePopin.$target.getElementById(uploadFormId);                            
                        } else {
                            $uploadForm = document.getElementById(uploadFormId);
                        }
                        
                        if ( !$uploadForm ) {
                            $uploadForm = (isPopinContext) ? $activePopin.$target.createElement('form') : document.createElement('form');

                            // adding form attributes
                            $uploadForm.id       = uploadFormId;
                            $uploadForm.action   = url;
                            $uploadForm.enctype  = 'multipart/form-data';
                            $uploadForm.method   = 'POST';
                                                        
                            
                            if ( typeof($el.form) != 'undefined' ) {
                                
                                // adding virtual fields
                                var fieldPrefix = 'files'; // by default
                                var fieldName   = $el.getAttribute('data-gina-form-upload-prefix') || $el.name || $el.getAttribute('name');
                                var fieldId     = $el.id || $el.getAttribute('id');
                                
                                var hasPreviewContainer = false;
                                var previewContainer = $el.getAttribute('data-gina-form-upload-preview') || fieldId + '-preview';
                                previewContainer = (isPopinContext)
                                                        ? $activePopin.$target.getElementById(previewContainer)
                                                        : document.getElementById(previewContainer); 
                                                        
                                if ( typeof(previewContainer) != 'undefined' ) {
                                    hasPreviewContainer = true;                                                                                                            
                                }
                                
                                if (fieldName) {
                                    fieldPrefix = fieldName
                                }
                                
                                idx = idxArr.indexOf(fieldPrefix);
                                if ( idx < 0 ) {
                                    idx = idxArr.length;
                                    idxArr[ idx ] = fieldPrefix
                                } else {
                                    idxArr[ idx ] = fieldPrefix
                                }
                                
                                var hiddenFields        = []
                                    , hiddenFieldObject = null                                    
                                    , mandatoryFields   = [
                                        'name'
                                        , 'group'
                                        , 'originalFilename'
                                        , 'encoding'
                                        , 'size'
                                        //, 'height'
                                        //, 'width'
                                        , 'location'
                                        , 'mime'
                                        , 'preview'
                                    ]
                                    , formInputsFields  = $el.form.getElementsByTagName('INPUT')
                                    , fieldType         = null
                                    , hiddenField       = null
                                    , _name             = null
                                    , _nameRe           = null
                                    , subPrefix         = null
                                ;
                                
                                for (var _f = 0, _fLen = files.length; _f < _fLen; ++_f) { // for each file                                    
                                    
                                    hiddenFields[_f] = null;
                                    subPrefix = fieldPrefix + '['+ _f +']';
                                    _nameRe = new RegExp('^'+subPrefix.replace(/\[/g, '\\[').replace(/\]/g, '\\]'));
                                    // collecting existing DOM fields
                                    for (var h = 0, hLen = formInputsFields.length; h < hLen; ++h) {
                                        fieldType   = formInputsFields[h].getAttribute('type');
                                        hiddenField = null;
                                        _name       = null;
                                        
                                        if (fieldType && /hidden/i.test(fieldType) ) {
                                            hiddenField = formInputsFields[h];
                                            _name = ( /\[\w+\]$/i.test(hiddenField.name) ) ? hiddenField.name.match(/\[\w+\]$/)[0].replace(/\[|\]/g, '') : hiddenField.name;
                                            
                                            // mandatory informations
                                            if (
                                                hiddenField 
                                                && typeof(_name) != 'undefiend' 
                                                && mandatoryFields.indexOf( _name ) > -1
                                                && _nameRe.test( hiddenField.name )
                                            ) {
                                                
                                                if (!hiddenFields[_f] )
                                                    hiddenFields[_f] = {};
                                                    
                                                if ( /\[preview\]/i.test(hiddenField.name) ) {
                                                    if ( typeof(hiddenFields[_f].preview) == 'undefined' )
                                                        hiddenFields[_f].preview = {};
                                                        
                                                    hiddenFields[_f].preview[_name] = hiddenField;
                                                } else {
                                                    hiddenFields[_f][_name] = hiddenField;
                                                }                                        
                                            } else if (
                                                hiddenField 
                                                && typeof(_name) != 'undefiend' 
                                                && mandatoryFields.indexOf( _name ) < 0
                                                && _nameRe.test( hiddenField.name )
                                            ) { // defined by user
                                                if (!hiddenFields[_f] )
                                                    hiddenFields[_f] = {};
                                                    
                                                if ( /\[preview\]/i.test(hiddenField.name) ) {
                                                    if ( typeof(hiddenFields[_f].preview) == 'undefined' )
                                                        hiddenFields[_f].preview = {};
                                                        
                                                    hiddenFields[_f].preview[_name] = hiddenField;
                                                } else {
                                                    hiddenFields[_f][_name] = hiddenField;
                                                } 
                                            }
                                        }                                            
                                    }
                                    
                                    // completing by adding non-declared mandatoring fields in the DOM: all but preview
                                    for (var m = 0, mLen = mandatoryFields.length; m < mLen; ++m) {
                                        // optional, must be set by user
                                        //if ( mandatoryFields[m] == 'preview' )
                                        //    continue;
                                        // needs recheck     
                                        if (!hiddenFields[_f] )
                                            hiddenFields[_f] = {};
                                            
                                        if ( typeof(hiddenFields[_f][ mandatoryFields[m] ]) == 'undefined' ) {
                                            
                                            _name = fieldPrefix +'['+ _f +']['+ mandatoryFields[m] +']'; 
                                            // create input & add it to the form
                                            $newVirtualField = document.createElement('input');
                                            $newVirtualField.type = 'hidden';
                                            $newVirtualField.id = 'input.' + uuid.v4();
                                            $newVirtualField.name = _name;
                                            $newVirtualField.value = '';
                                            
                                            $el.form.appendChild($newVirtualField);
                                            hiddenFields[_f][ mandatoryFields[m] ] = $el.form[$el.form.length-1];// last added
                                        }
                                                                        
                                    }
                                } // EO for files
                                
                                $uploadForm.uploadProperties = {                                    
                                    id                  : $el.form.id || $el.getAttribute('id'),
                                    $form               : $el.form,
                                    mandatoryFields     : mandatoryFields,
                                    uploadFields        : hiddenFields,
                                    hasPreviewContainer : hasPreviewContainer,
                                    isPopinContext      : isPopinContext
                                };
                                if (hasPreviewContainer) {
                                    $uploadForm.uploadProperties.previewContainer = previewContainer;
                                }
                                // if (isPopinContext) {
                                //     $uploadForm.$activePopin = $activePopin;
                                // }
                            }
                            
                            if (eventOnSuccess)
                                $uploadForm.setAttribute('data-gina-form-event-on-submit-success', eventOnSuccess);
                            else
                                $uploadForm.setAttribute('data-gina-form-event-on-submit-success', 'onGenericXhrResponse');
                                
                            if (eventOnError)
                                $uploadForm.setAttribute('data-gina-form-event-on-submit-error', eventOnError);
                            else
                                $uploadForm.setAttribute('data-gina-form-event-on-submit-error', 'onGenericXhrResponse');
                            
                            // var previewId = $el.getAttribute('data-gina-form-upload-preview') || null;
                            // if (previewId)
                            //     $uploadForm.setAttribute('data-gina-form-upload-preview', previewId);
                            
                            // adding for to current doccument
                            if (isPopinContext) {
                                //$activePopin.$target.appendChild($uploadForm)
                                document.getElementById($activePopin.id).appendChild($uploadForm)
                            } else {
                                document.body.appendChild($uploadForm)
                            } 
                        }
                        
                        // binding form
                        try {
                            var $uploadFormValidator = getFormById(uploadFormId);
                            // create a FormData object which will be sent as the data payload in the          
                            var formData = new FormData();
                            // add the files to formData object for the data payload
                            var file = null;          
                            for (var l = 0, lLen = files.length; l < lLen; ++l) {
                                file = files[l];
                                formData.append(fileId, file, file.name);
                            }
                            
                            $uploadFormValidator
                                // .on('error', function(e, result) {
                                //     console.error('[error] ', '\n(e)' + e, '\n(result)' + result)
                                // })
                                .on('success', function(e, result){
                                    
                                    var $el = e.target;
                                    var $preview = null, $ul = null, $li = null, $img = null;
                                    var previewId = $el.getAttribute('data-gina-form-upload-preview') || null;
                                    if (previewId)
                                        $preview = document.getElementById(previewId);
                                    
                                                                        
                                    var files = result.files;
                                    if ($preview) {
                                        $preview.innerHTML = '';
                                        $ul = document.createElement("ul");
                                        for (var f = 0, fLen = files.length; f<fLen; ++f) {
                                            $li = document.createElement("li");
                                            $img = document.createElement("img");
                                            
                                            $img.src = files[f].tmpSrc;
                                            $img.width = files[f].width;
                                            $img.height = files[f].height;
                                            
                                            $li.appendChild($img);
                                            $ul.appendChild($li);
                                        }
                                        $preview.appendChild($ul);
                                    }
                                     
                                })
                                /**.on('progress', function(evt, result) {
                    
                                percentComplete = result.progress;
                    
                                $progress.text(percentComplete + '%');
                                $progress.width(percentComplete + '%');
                    
                                if (percentComplete === 100) {
                                    $progress.html('Done');
                                }
                    
                                // if (evt.lengthComputable) {
                                //   // calculate the percentage of upload completed
                                //   var percentComplete = evt.loaded / evt.total;
                                //   percentComplete = parseInt(percentComplete * 100);
                    
                                //   // update the Bootstrap progress bar with the new percentage
                                //   $progress.text(percentComplete + '%');
                                //   $progress.width(percentComplete + '%');
                    
                                //   // once the upload reaches 100%, set the progress bar text to done
                                //   if (percentComplete === 100) {
                                //     $progress.html('Done');
                                //   }
                    
                                // }
                                }) */            
                                .send(formData, { withCredentials: true/*, isSynchrone: true*/ });
                            
                        } catch (formErr) {
                            throw formErr;
                        }
                        
                    }
                    
                });
                
                
            }
        }

        var updateSelect = function($el) {
            //var selectedIndex = $el.selectedIndex;
            //var isBoolean = /^(true|false)$/i.test($el.value);
            
            $el.setAttribute('data-value', $el.value);
        };
        
        var selectedIndex = null, selectedValue = null;
        for (var s = 0, sLen = $select.length; s < sLen; ++s) {
            elId = $select[s].getAttribute('id');

            if (elId && /^gina\-toolbar/.test(elId)) continue;

            if (!elId) {
                elId = 'select.' + uuid.v4();
                $select[s].setAttribute('id', elId)
            }
            
            addListener(gina, $select[s], 'change', function(event) {
                var $el = event.target;
                
                if (/select/i.test($el.type) ) {                    
                    updateSelect($el);
                }                
            });

            if ($select[s].options && !$form.fieldsSet[ elId ]) {
                selectedIndex = 0;
                selectedValue = $select[s].getAttribute('data-value') || null;
                if ( selectedValue ) {
                    for (var o = 0, oLen = $select[s].options.length; o < oLen; ++o ) {
                        if ( $select[s].options[o].value == selectedValue) {
                            selectedIndex = o;
                            $select[s].selectedIndex = selectedIndex;
                            break
                        }
                    }
                }
                
                if ( typeof($select[s].options[$select[s].selectedIndex]) != 'undefined' && $select[s].options[ $select[s].selectedIndex ].index ) {
                    selectedIndex = $select[s].options[ $select[s].selectedIndex ].index
                }/** else if ( typeof(selectedValue) != 'undefined' ) {
                    for (var o = 0, oLen = $select[s].options.length; o < oLen; ++o ) {
                        if ( $select[s].options[o].value == selectedValue) {
                            selectedIndex = o;
                            break
                        }
                    }
                }*/

                $form.fieldsSet[ elId ] = {
                    id: elId,
                    name: $select[s].name || null,
                    value: selectedIndex || null
                };

                // update select
                if ( typeof($select[s].options[selectedIndex]) != 'undefined' ) {
                    $select[s].options[ selectedIndex ].selected = true;
                    $select[s].setAttribute('data-value',  $select[s].options[ selectedIndex ].value);
                }

            }
        }        

        var updateCheckBox = function($el) {

            var checked     = $el.checked;
            // set to checked if not checked: false -> true
            if ( !checked || checked == 'null' || checked == 'false' || checked == '' ) {

                // prevents ticking behavior
                setTimeout(function () {
                    $el.checked = false;
                }, 0);

                $el.removeAttribute('checked');
                $el.value = false;
                $el.setAttribute('value', 'false');
                
                if ( typeof($el.getAttribute('data-value') != 'undefined' ) )
                    $el.setAttribute('data-value', 'false');
                                   
            } else {                
                
                // prevents ticking behavior
                setTimeout(function () {
                    $el.checked = true;
                }, 0);

                $el.setAttribute('checked', 'checked');
                //boolean exception handling
                $el.value = true;
                $el.setAttribute('value', 'true');
                
                if ( typeof($el.getAttribute('data-value') != 'undefined' ) )
                    $el.setAttribute('data-value', 'true');
                    
            }
            
            // group dependencies handling
            if ( $el.getAttribute('data-gina-form-element-group') ) {
                var elGroup = formElementGroupItems[$el.name];
                for ( var item in elGroup ) {  
                    if (withRules && typeof($form.rule[item]) == 'undefined' ) { 
                        $form.rule[item] = {}
                    }                  
                    if ( /^true$/.test($el.value) ) {
                        elGroup[item].disabled = false;
                        if (withRules) {
                            $form.rules[item].exclude = false;
                        }
                    } else {
                        elGroup[item].disabled = true;
                        if (withRules) {
                            $form.rules[item].exclude = true;
                        }
                    }
                }
            }
            
        };

        var radioGroup = null;
        var updateRadio = function($el, isInit) {
            var checked = $el.checked;
            var isBoolean = /^(true|false)$/i.test($el.value);
            

            // loop if radio group
            if (!isInit) {
                radioGroup = document.getElementsByName($el.name);
                //console.log('found ', radioGroup.length, radioGroup)
                for (var r = 0, rLen = radioGroup.length; r < rLen; ++r) {
                    if (radioGroup[r].id !== $el.id) {
                        radioGroup[r].checked = false;
                        radioGroup[r].removeAttribute('checked');
                    }
                }
            }

            

            if ( !checked || checked == 'null' || checked == 'false' || checked == '' ) {

                // prevents ticking behavior
                setTimeout(function () {
                    $el.checked = false;
                }, 0)

                $el.removeAttribute('checked');

                //if (isBoolean) {
                //    $el.value = false;
                //}

                // if (isBoolean) { // force boolean value
                //     $el.value = (/^true$/.test($el.value)) ? true : false
                // }
                

            } else {

                // prevents ticking behavior
                setTimeout(function () {
                    $el.checked = true;
                }, 0)

                $el.setAttribute('checked', 'checked');
                //$el.value = $el.getAttribute('value');

                //if (isBoolean) { // no multiple choice supported
                //    $el.value = true;
                //}

                

                radioGroup = document.getElementsByName($el.name);
                //console.log('found ', radioGroup.length, radioGroup)
                for (var g = 0, gLen = radioGroup.length; g < gLen; ++g) {
                    if (radioGroup[g].id !== $el.id) {
                        radioGroup[g].checked = false;
                        radioGroup[g].removeAttribute('checked');
                        
                        // if (isBoolean) {
                        //     radioGroup[g].value = false;
                        // }
                        // if ( /^(true|false)$/.test($el.value) ) {
                        //     radioGroup[g].value = (/^true$/.test(radioGroup[g].value)) ? true : false
                        // }
                        
                    }
                }

                // if (isBoolean) { // force boolean value
                //     $el.value = ( /^true$/.test($el.value) ) ? true : false
                // }
            }

            if (isBoolean) { // force boolean value
                $el.value = (/^true$/.test($el.value)) ? true : false
            }
        }
                               

        evt = 'click';

        procced = function () {
            
            
            
            // click proxy            
            addListener(gina, $target, 'click', function(event) {
                
                var $el = event.target;
                
                if (
                    /(label)/i.test(event.target.tagName) && typeof(event.target.control) != 'undefined' && event.target.control != null && /(checkbox|radio)/i.test(event.target.control.type) 
                    || /(label)/i.test(event.target.parentNode.tagName) && typeof(event.target.parentNode.control) != 'undefined' && event.target.parentNode.control != null && /(checkbox|radio)/i.test(event.target.parentNode.control.type) 
                ) {                    
                    // if `event.target.control` not working on all browser,
                    // try to detect `for` attribute OR check if on of the label's event.target.children is an input & type == (checkbox|radio)
                    $el = event.target.control || event.target.parentNode.control;
                    if ( !$el.disabled && /(checkbox|radio)/i.test($el.type) ) {
                        // apply checked choice : if true -> set to false, and if false -> set to true                        
                        if ( /checkbox/i.test($el.type) ) {
                            return updateCheckBox($el);
                        } else {
                            return updateRadio($el);
                        }
                    }                    
                }                        
                
                
                // include only these elements for the binding
                if ( 
                    /(button|input)/i.test($el.tagName) && /(submit|checkbox|radio)/i.test($el.type)
                    || /a/i.test($el.tagName) && $el.attributes.getNamedItem('data-gina-form-submit')
                ) {
                    
                    if ( typeof($el.id) == 'undefined' || !$el.getAttribute('id') ) {
                        $el.setAttribute('id', 'click.' + uuid.v4() );
                        $el.id = $el.getAttribute('id')
                    } else {
                        $el.id = $el.getAttribute('id')
                    }
    
                    
                    if (/^click\./.test($el.id) || withRules) {
    
                        var _evt = $el.id;
    
                        if (!_evt) return false;
    
                        if ( !/^click\./.test(_evt) ) {
                            _evt = $el.id
                        }
    
                        // prevent event to be triggered twice
                        if ( typeof(event.defaultPrevented) != 'undefined' && event.defaultPrevented )
                            return false;
    
                        if (gina.events[_evt]) {
                            cancelEvent(event);
    
                            triggerEvent(gina, $el, _evt, event.detail);
                        }
    
                    }
                }                                

            })
        }
        
        procced();

        
        for (var i = 0, iLen = $inputs.length; i < iLen; ++i) {
            type    = $inputs[i].getAttribute('type');

            if ( typeof($inputs[i].id) == 'undefined' || $inputs[i].id == '' ) {
                $inputs[i].id = type +'-'+ uuid.v4();
                $inputs[i].setAttribute('id', $inputs[i].id)
            }


            // recover default state only on value === true || false || on
            if ( typeof(type) != 'undefined' && type == 'checkbox' && /^(true|false|on)$/i.test($inputs[i].value) || typeof(type) != 'undefined' && type == 'checkbox' && !$inputs[i].getAttribute('value') ) {

                if ( !/^(true|false|on)$/i.test($inputs[i].value)  ) {

                    if ( !$inputs[i].checked || $inputs[i].checked == 'null' || $inputs[i].checked == 'false' || $inputs[i].checked == '' ) {
                        $inputs[i].value = false;
                        $inputs[i].setAttribute('value', false)
                    } else {
                        $inputs[i].value = true;
                        $inputs[i].setAttribute('value', true)
                    }
                }


                evt = $inputs[i].id;

                procced = function ($el, evt) {

                    // recover default state only on value === true || false
                    addListener(gina, $el, evt, function(event) {
                        
                        var value = event.target.value || event.target.getAttribute('value') || event.target.getAttribute('data-value');
                        
                        if ( /^(true|false|on)$/i.test(value) ) {
                            cancelEvent(event);
                            updateCheckBox(event.target);
                        }
                    });

                    // default state recovery
                    var value = $el.value || $el.getAttribute('value') || $el.getAttribute('data-value');
                    if ( typeof(value) != 'undefined' && /^(true|on|false)$/.test(value) ) {
                        $el.checked = /true|on/.test(value) ? true : false;
                        updateCheckBox($el);
                    }    
                }

                if ( typeof(gina.events[evt]) != 'undefined' && gina.events[evt] == $inputs[i].id ) {
                    removeListener(gina, $inputs[i], evt);
                    procced($inputs[i], evt)

                } else {
                    procced($inputs[i], evt)
                }

            } else if ( typeof(type) != 'undefined' && type == 'radio' ) {

                evt = $inputs[i].id;

                procced = function ($el, evt) {
                    addListener(gina, $el, evt, function(event) {

                        cancelEvent(event);
                        updateRadio(event.target);
                    });


                    updateRadio($el, true);
                }

                if ( typeof(gina.events[evt]) != 'undefined' && gina.events[evt] == $inputs[i].id ) {
                    removeListener(gina, $inputs[i], evt);
                    procced(event.target, evt)

                } else {
                    procced($inputs[i], evt)
                }
            }
        }


        if (withRules) {

            evt = 'validate.' + _id;
            procced = function () {

                // attach form event
                addListener(gina, $target, evt, function(event) {
                    cancelEvent(event);


                    var result = event['detail'] || $form.eventData.validation;
                    
                    handleErrorsDisplay(event['target'], result['errors'], result['data']);

                    var _id = event.target.getAttribute('id');

                    if ( result['isValid']() ) { // send if valid
                        // now sending to server
                        if (instance.$forms[_id]) {
                            instance.$forms[_id].send(result['data']);
                        } else if ($form) { // just in case the form is being destroyed
                            $form.send(result['data']);
                        }
                    }
                })
            }

            if ( typeof(gina.events[evt]) != 'undefined' && gina.events[evt] == 'validate.' + _id ) {
                removeListener(gina, $form, evt, procced)
            } else {
                procced()
            }


            var proccedToSubmit = function (evt, $submit) {
                // console.log('placing submit ', evt, $submit);
                // attach submit events
                addListener(gina, $submit, evt, function(event) {
                    // start validation
                    cancelEvent(event);

                    // getting fields & values
                    var $fields     = {}
                        , fields    = { '_length': 0 }
                        , id        = $target.getAttribute('id')
                        , rules     = ( typeof(gina.validator.$forms[id]) != 'undefined' ) ? gina.validator.$forms[id].rules : null
                        , name      = null
                        , value     = 0
                        , type      = null
                        , index     = { checkbox: 0, radio: 0 };


                    for (var i = 0, len = $target.length; i<len; ++i) {

                        name    = $target[i].getAttribute('name');

                        if (!name) continue;

                        // TODO - add switch cases against tagName (checkbox/radio)
                        if ( typeof($target[i].type) != 'undefined' && $target[i].type == 'radio' || typeof($target[i].type) != 'undefined' && $target[i].type == 'checkbox' ) {
                            
                            
                            
                            if ( 
                                $target[i].checked 
                                || typeof (rules[name]) == 'undefined'
                                    && $target[i].value != 'undefined'
                                    && /^(true|false)$/.test($target[i].value)
                                || !$target[i].checked
                                    && typeof (rules[name]) != 'undefined'
                                    && typeof (rules[name].isBoolean) != 'undefined' && /^true$/.test(rules[name].isBoolean)
                                    && typeof (rules[name].isRequired) != 'undefined' && /^true$/.test(rules[name].isRequired)
                            ) {
                                // if is boolean
                                if ( /^(true|false)$/.test($target[i].value) ) {
                                    
                                    if ( typeof(rules[name]) == 'undefined' ) {
                                        rules[name] = { isBoolean: true };
                                    } else if ( typeof(rules[name]) != 'undefined' && typeof(rules[name].isBoolean) == 'undefined' ) {
                                        rules[name].isBoolean = true;
                                    }

                                    if ($target[i].type == 'radio') {
                                        if ( typeof(rules[name]) == 'undefined' )
                                            throw new Error('rule '+ name +' is not defined');
                                            
                                        if (/^true$/.test(rules[name].isBoolean) && $target[i].checked ) {
                                            fields[name] = (/^true$/.test($target[i].value)) ? true : false;
                                        }
                                    } else {
                                        fields[name] = $target[i].value = (/^true$/.test($target[i].value)) ? true : false;
                                    }

                                } else {
                                    fields[name] = $target[i].value
                                }
                            }  else if ( // force validator to pass `false` if boolean is required explicitly
                                rules
                                && typeof(rules[name]) != 'undefined'
                                && typeof(rules[name].isBoolean) != 'undefined'
                                && typeof(rules[name].isRequired) != 'undefined'
                                && !/^(true|false)$/.test($target[i].value)

                            ) {
                                fields[name] = false;
                            }

                        } else {
                            fields[name] = $target[i].value;
                        }

                        if ( typeof($fields[name]) == 'undefined' ) {
                            $fields[name] = $target[i];
                            // reset filed error data attributes
                            $fields[name].setAttribute('data-gina-form-errors', '');
                        }
                        
                        ++fields['_length']
                    }

                    if ( fields['_length'] == 0 ) { // nothing to validate
                        delete fields['_length'];
                        var result = {
                            'errors'    : [],
                            'isValid'   : function() { return true },
                            'data'      : formatData(fields)
                        };

                        triggerEvent(gina, $target, 'validate.' + _id, result)

                    } else {
                        // update rule in case the current event is triggered outside the main sequence
                        // e.g.: form `id` attribute rewritten on the fly
                        _id = $target.getAttribute('id');
                        var customRule = $target.getAttribute('data-gina-form-rule');

                        if ( customRule ) { // 'data-gina-form-rule'
                            rule = gina.validator.rules[ customRule.replace(/\-/g, '.') ];
                        } else {
                            rule = gina.validator.$forms[ _id ].rules;
                        }

                        validate($target, fields, $fields, rule, function onValidation(result){
                            triggerEvent(gina, $target, 'validate.' + _id, result)
                        })
                    }
                });
            }


            // binding submit button
            var $submit         = null
                , $buttons      = []
                , $buttonsTMP   = []
                , linkId        = null 
                , buttonId      = null
            ;
            $buttonsTMP = $target.getElementsByTagName('button');
            if ( $buttonsTMP.length > 0 ) {
                for(var b = 0, len = $buttonsTMP.length; b < len; ++b) {
                    if ($buttonsTMP[b].type == 'submit')
                        $buttons.push($buttonsTMP[b])
                }
            }

            // binding links
            $buttonsTMP = $target.getElementsByTagName('a');            
            if ( $buttonsTMP.length > 0 ) {
                for(var b = 0, len = $buttonsTMP.length; b < len; ++b) {
                    if ( $buttonsTMP[b].attributes.getNamedItem('data-gina-form-submit') ) {
                        $buttons.push($buttonsTMP[b])
                    } else if ( 
                        !$buttonsTMP[b].getAttribute('id') 
                        && !/gina\-popin/.test($buttonsTMP[b].className) 
                        && !gina.popinIsBinded
                        && !/gina\-link/.test($buttonsTMP[b].className) 
                    ) { // will not be binded but will receive an id if not existing
                        linkId = 'link.'+ uuid.v4();
                        $buttonsTMP[b].id = linkId;
                    }
                }
            }


            var onclickAttribute = null, isSubmitType = false;
            for (var b=0, len=$buttons.length; b<len; ++b) {

                $submit = $buttons[b];

                if ($submit.tagName == 'A') { // without this test, XHR callback is ignored
                    //console.log('a#$buttons ', $buttonsTMP[b]);
                    onclickAttribute    = $submit.getAttribute('onclick');
                    isSubmitType        = $submit.getAttribute('data-gina-form-submit');

                    if ( !onclickAttribute && !isSubmitType) {
                        $submit.setAttribute('onclick', 'return false;')
                    } else if ( !/return false/ && !isSubmitType) {
                        if ( /\;$/.test(onclickAttribute) ) {
                            onclickAttribute += 'return false;'
                        } else {
                            onclickAttribute += '; return false;'
                        }
                    }
                }

                if (!$submit['id']) {

                    evt = 'click.'+ uuid.v4();
                    $submit['id'] = evt;
                    $submit.setAttribute( 'id', evt);

                } else {
                    evt = $submit['id'];
                }


                if ( typeof(gina.events[evt]) == 'undefined' || gina.events[evt] != $submit.id ) {
                    proccedToSubmit(evt, $submit)
                }

            }
        }



        evt = 'submit';

        // submit proxy
        addListener(gina, $target, evt, function(e) {

            var $target     = e.target
                , id        = $target.getAttribute('id')
                , isBinded  = instance.$forms[id].binded
            ;

            // prevent event to be triggered twice
            if ( typeof(e.defaultPrevented) != 'undefined' && e.defaultPrevented )
                return false;

            if (withRules || isBinded) {
                cancelEvent(e);
            }


            // just collect data over forms
            // getting fields & values
            var $fields     = {}
                , fields    = { '_length': 0 }
                , id        = $target.getAttribute('id')
                , rules     = ( typeof(gina.validator.$forms[id]) != 'undefined' ) ? gina.validator.$forms[id].rules : null
                , name      = null
                , value     = 0
                , type      = null
                , index     = { checkbox: 0, radio: 0 };


            for (var i = 0, len = $target.length; i<len; ++i) {
                name = $target[i].getAttribute('name');

                if (!name) continue;

                // checkbox or radio
                if ( typeof($target[i].type) != 'undefined' && $target[i].type == 'radio' || typeof($target[i].type) != 'undefined' && $target[i].type == 'checkbox' ) {

                    if ( $target[i].checked ) {
                        // if is boolean
                        if ( /^(true|false)$/.test($target[i].value) ) {
                            fields[name] = $target[i].value = (/^true$/.test($target[i].value)) ? true : false
                        } else {
                            fields[name] = $target[i].value
                        }

                    }  else if ( // force validator to pass `false` if boolean is required explicitly
                    rules
                    && typeof(rules[name]) != 'undefined'
                    && typeof (rules[name].isBoolean) != 'undefined' && $target[i].type == 'checkbox'
                    //&& typeof(rules[name].isRequired) != 'undefined'
                    && !/^(true|false)$/.test($target[i].value)
                    ) {
                        fields[name] = false;
                    }

                } else {
                    fields[name]    = $target[i].value;
                }



                $fields[name] = $target[i];
                // reset filed error data attributes
                $fields[name].setAttribute('data-gina-form-errors', '');

                ++fields['_length']
            }


            if ( fields['_length'] == 0 ) { // nothing to validate

                delete fields['_length'];
                var result = {
                    'errors'    : [],
                    'isValid'   : function() { return true },
                    'data'      : formatData(fields)
                };

                if ( typeof(gina.events['submit.' + id]) != 'undefined' ) { // if `on('submit', cb)` is binded
                    triggerEvent(gina, $target, 'submit.' + id, result);
                } else {
                    triggerEvent(gina, $target, 'validate.' + id, result);
                }

            } else {
                // update rule in case the current event is triggered outside the main sequence
                // e.g.: form `id` attribute rewritten on the fly

                var customRule = $target.getAttribute('data-gina-form-rule');

                if ( customRule ) { // 'data-gina-form-rule'
                    rule = gina.validator.rules[ customRule.replace(/\-/g, '.') ];
                } else {
                    rule = gina.validator.$forms[ id ].rules;
                }

                validate($target, fields, $fields, rule, function onValidation(result){
                    if ( typeof(gina.events['submit.' + id]) != 'undefined' ) { // if `on('submit', cb)` is binded
                        triggerEvent(gina, $target, 'submit.' + id, result);
                    } else {
                        triggerEvent(gina, $target, 'validate.' + id, result);
                    }
                })
            }
        });

        instance.$forms[_id]['binded']  = true;
    }

    var validate = function($form, fields, $fields, rules, cb) {

        delete fields['_length']; //cleaning

        var id                  = null
            , data              = null
            , hasBeenValidated  = false
            , subLevelRules     = 0
            , rootFieldsCount   = fields.count()
        ;

        if (isGFFCtx) {
            id = $form.getAttribute('id') || $form.id;
            instance.$forms[id].fields = fields;
        }
        //console.log(fields, $fields);

        var d = new FormValidator(fields, $fields), args = null;
        var fieldErrorsAttributes = {};
        var re = null, flags = null;

        var forEachField = function($form, fields, $fields, rules, cb, i) {
            
            
            
            var hasCase = false, isInCase = null, conditions = null;
            var caseValue = null, caseType = null;
            var localRules = null, caseName = null;

            //console.log('parsing ', fields, $fields, rules);
            if ( typeof(rules) != 'undefined' ) { // means that no rule is set or found
                
                for (var field in fields) {
                    
                    if ( typeof($fields[field]) == 'undefined' ) {
                        //throw new Error('field `'+ field +'` found for your form rule ('+ $form.id +'), but not found in $field collection.\nPlease, check your HTML or remove `'+ field +'` declaration from your rule.')
                        console.warn('field `'+ field +'` found for your form rule ('+ $form.id +'), but not found in $field collection.\nPlease, check your HTML or remove `'+ field +'` declaration from your rule if this is a mistake.');
                        continue;
                    }
                    // $fields[field].tagName getAttribute('type')
                    //if ( $fields[field].tagName.toLowerCase() == 'input' && /(checkbox)/.test( $fields[field].getAttribute('type') ) && !$fields[field].checked ) {
                    if (
                        $fields[field].tagName.toLowerCase() == 'input' 
                        && /(checkbox)/.test($fields[field].getAttribute('type')) 
                        && !$fields[field].checked 
                        && typeof(rules[field]) == 'undefined' // just in case of rules inside cases
                    ) {
                        //if ( typeof(rules[field]) == 'undefined' && !$fields[field].checked || typeof(rules[field]) != 'undefined' && typeof(rules[field]['isRequired']) != 'undefined' && /(false)/.test(rules[field]['isRequired']) )
                            continue;
                    }

                    hasCase = ( typeof(rules['_case_' + field]) != 'undefined' ) ? true : false;
                    isInCase = false;
                    
                    
                    for (var c in rules) {
                        if (!/^\_case\_/.test(c) ) continue;
                        if ( typeof(rules[c].conditions) == 'undefined' ) continue;
                        if ( typeof(rules[c].conditions[0].rules) == 'undefined' ) continue;
                        
                        if ( typeof(rules[c].conditions) != 'undefined' && Array.isArray(rules[c].conditions) ) {
                            caseName = c.replace('_case_', '');
                            for (var _c = 0, _cLen = rules[c].conditions.length; _c < _cLen; ++_c) {
                                
                                for (var _r in rules[c].conditions[_c].rules) {
                                    
                                    if (field != _r )
                                        continue;
                                    
                                    if ( /^\//.test(_r) ) { // RegExp found
                                        re      = _r.match(/\/(.*)\//).pop();                                        
                                        flags   = _r.replace('/'+ re +'/', '');
                                        // fix escaping "[" & "]"
                                        re      = re.replace(/\[/g, '\\[').replace(/\]/g, '\\]');
                                        re      = new RegExp(re, flags);
                                        if ( re.test(field)  ) {                                                 
                                            isInCase = true;                                         
                                            break;
                                        } 
                                    } else {
                                        if ( typeof(rules[c].conditions[_c].rules[_r]) != 'undefined' && typeof(rules[_r]) == 'undefined' ) {
                                            isInCase = true;
                                            break;
                                        }  
                                    }
                                }
                            }
                        }
                        // if ( typeof(rules[c].conditions[0].rules[field]) != 'undefined' && typeof(rules[field]) == 'undefined' ) {
                        //     isInCase = true;
                        //     break;
                        // }                            
                    }
                    
                    if (isInCase) continue;

                    if (!hasCase) {
                        if (typeof (rules[field]) == 'undefined') continue;


                        // check each field against rule
                        for (var rule in rules[field]) {
                            // check for rule params
                            try {

                                if (Array.isArray(rules[field][rule])) { // has args
                                    //convert array to arguments
                                    args = JSON.parse(JSON.stringify(rules[field][rule]));
                                    if ( /\$[\w\[\]]*/.test(args[0]) ) {
                                        var foundVariables = args[0].match(/\$[\w\[\]]*/g);
                                        for (var v = 0, vLen = foundVariables.length; v < vLen; ++v) {
                                            args[0] = args[0].replace( foundVariables[v], d[foundVariables[v].replace('$', '')].value )
                                        }
                                    }
                                    d[field][rule].apply(d[field], args);
                                    // .match(/\$[\w\[\]]*/g)
                                } else {
                                    d[field][rule](rules[field][rule]);
                                }

                                delete fields[field];

                            } catch (err) {
                                if (rule == 'conditions') {
                                    throw new Error('[ ginaFormValidator ] could not evaluate `' + field + '->' + rule + '()` where `conditions` must be a `collection` (Array)\nStack:\n' + (err.stack | err.message))
                                } else {
                                    throw new Error('[ ginaFormValidator ] could not evaluate `' + field + '->' + rule + '()`\nStack:\n' + (err.stack | err.message))
                                }
                            }
                        }
                    } else {
                        ++i; // add sub level
                        conditions = rules['_case_' + field]['conditions'];

                        if ( !conditions ) {
                            throw new Error('[ ginaFormValidator ] case `_case_'+field+'` found without `condition(s)` !');
                        }
                        
                        
                        for (var c = 0, cLen = conditions.length; c<cLen; ++c) {

                            caseValue = fields[field];

                            if (isGFFCtx) {
                                if (fields[field] == "true")
                                    caseValue = true;
                                else if (fields[field] == "false")
                                    caseValue = false;
                            }

                            //console.log(caseValue +' VS '+ conditions[c]['case'], "->", (caseValue == conditions[c]['case'] || Array.isArray(conditions[c]['case']) && conditions[c]['case'].indexOf(caseValue) > -1) );
                            if ( conditions[c]['case'] === caseValue || Array.isArray(conditions[c]['case']) && conditions[c]['case'].indexOf(caseValue) > -1 || /^\//.test(conditions[c]['case']) ) {

                                //console.log('[fields ] ' + JSON.stringify(fields, null, 4));
                                localRules = {};   
                                // exclude case field if not declared in rules
                                if ( typeof(conditions[c]['rules'][field]) == 'undefined' ) {
                                    conditions[c]['rules'][field] = { exclude: true }            
                                }                             
                                for (var f in conditions[c]['rules']) {
                                    //console.log('F: ', f, '\nrule: '+ JSON.stringify(conditions[c]['rules'][f], null, 2));
                                    if ( /^\//.test(f) ) { // RegExp found

                                        re      = f.match(/\/(.*)\//).pop();                                        
                                        flags   = f.replace('/'+ re +'/', '');
                                        // fix escaping "[" & "]"
                                        re      = re.replace(/\[/g, '\\[').replace(/\]/g, '\\]');
                                        re      = new RegExp(re, flags);

                                        for (var localField in $fields) {
                                            if ( re.test(localField) ) {
                                                if ( /^\//.test(conditions[c]['case']) ) {
                                                    re      = conditions[c]['case'].match(/\/(.*)\//).pop();
                                                    flags   = conditions[c]['case'].replace('/'+ re +'/', '');
                                                    re      = new RegExp(re, flags);

                                                    if ( re.test(caseValue) ) {
                                                        localRules[localField] = conditions[c]['rules'][f];                                                        
                                                    }

                                                } else {
                                                    localRules[localField] = conditions[c]['rules'][f]
                                                }
                                                
                                                // we need to add it to fields list if not declared
                                                if ( typeof(fields[localField]) == 'undefined' ) {
                                                    fields[localField] = caseValue;
                                                }
                                            }
                                        }

                                    } else {
                                        if ( /^\//.test(conditions[c]['case']) ) {
                                            
                                            re      = conditions[c]['case'].match(/\/(.*)\//).pop();                                            
                                            flags   = conditions[c]['case'].replace('/'+ re +'/', '');
                                            // fix escaping "[" & "]"
                                            re      = re.replace(/\[/g, '\\[').replace(/\]/g, '\\]');
                                            re      = new RegExp(re, flags);

                                            if ( re.test(caseValue) ) {
                                                localRules[f] = conditions[c]['rules'][f]
                                            }

                                        } else {
                                            localRules[f] = conditions[c]['rules'][f]
                                        }
                                        
                                        // we need to add it to fields list if not declared
                                        if ( typeof(fields[f]) == 'undefined' ) {
                                            fields[f] = caseValue;
                                        }
                                    }                                    
                                }
                                
                                    
                                
                                ++subLevelRules; // add sub level
                                if (isGFFCtx)
                                    forEachField($form, fields, $fields, localRules, cb, i);
                                else
                                    return forEachField($form, fields, $fields, localRules, cb, i);
                            }
                            
                        }
                        --i;
                    }

                    
                } // EO for
            } 
            
            --subLevelRules;

            if (i <= 0 && subLevelRules < 0) {

                var errors = d['getErrors']();

                // adding data attribute to handle display refresh
                for (var field in errors) {
                    for (rule in errors[field]) {
                        if (!fieldErrorsAttributes[field]) {
                            fieldErrorsAttributes[field] = ''
                        }

                        if (fieldErrorsAttributes[field].indexOf(rule) < 0)
                            fieldErrorsAttributes[field] += rule +' ';
                    }

                    if (isGFFCtx)
                        $fields[field].setAttribute('data-gina-form-errors', fieldErrorsAttributes[field].substr(0, fieldErrorsAttributes[field].length-1))
                }

                //calling back
                try {
                    data = formatData( d['toData']() );

                    if ( isGFFCtx && typeof(window.ginaToolbar) == 'object' ) {
                        // update toolbar
                        if (!gina.forms.sent)
                            gina.forms.sent = {};

                        //gina.forms.sent = data;
                        //gina.forms.id   = id;

                        var objCallback = {
                            id      : id,
                            sent    : data
                        };

                        window.ginaToolbar.update('forms', objCallback);
                    }
                } catch (err) {
                    throw err
                }

                if (!hasBeenValidated) {

                    hasBeenValidated = true;

                    if ( typeof(cb) != 'undefined' && typeof(cb) === 'function' ) {

                        cb({
                            'isValid'   : d['isValid'],
                            'errors'    : errors,
                            'data'      : data
                        })

                    } else {

                        return {
                            'isValid'   : d['isValid'],
                            'errors'    : errors,
                            'data'      : data
                        }
                    }
                }
            }
        }

        // 0 is the starting level
        if (isGFFCtx)
            forEachField($form, fields, $fields, rules, cb, 0);
        else
            return forEachField($form, fields, $fields, rules, cb, 0);
    }

    var setupInstanceProto = function() {

        instance.setOptions             = setOptions;
        instance.getFormById            = getFormById;
        instance.validateFormById       = validateFormById;
        instance.target                 = document;
        instance.validateFormById       = validateFormById;
        instance.resetErrorsDisplay     = resetErrorsDisplay;
        instance.resetFields            = resetFields;
        instance.handleErrorsDisplay    = handleErrorsDisplay;
        instance.send                   = send;
    }

    if (isGFFCtx) {
        return init(rules)
    } else {
        return backendInit(rules, data, formId)
    }

};

if ( ( typeof(module) !== 'undefined' ) && module.exports ) {
    // Publish as node.js module
    module.exports  = ValidatorPlugin
} else if ( typeof(define) === 'function' && define.amd) {
    // Publish as AMD module
    define('gina/validator', ['utils/events', 'utils/dom', 'utils/form-validator'], function(){ return ValidatorPlugin })
}