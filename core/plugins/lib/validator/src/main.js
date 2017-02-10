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

    } else {
        var cacheless   = (process.env.IS_CACHELESS == 'false') ? false : true;
        if (cacheless) {
            delete require.cache[require.resolve('./form-validator')]
        }
    }

    var uuid            = (isGFFCtx) ? require('vendor/uuid') : require('uuid');
    var merge           = (isGFFCtx) ? require('utils/merge') : require('../../../../utils/lib/merge');
    var FormValidator   = (isGFFCtx) ? require('utils/form-validator') : require('./form-validator');

    /** definitions */
    var instance    = { // isGFFCtx only
        'id'                : 'validator-' + uuid.v1(),

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
        'resetErrorsDisplay': null
    };

    // validator proto
    var $validator      = { // isGFFCtx only
        'id'                    : null, // form id

        'plugin'                : this.plugin,
        'on'                    : (isGFFCtx) ? on : null,
        'eventData'             : {},
        'target'                : (isGFFCtx) ? document : null, // by default

        'binded'                : false,
        'rules'                 : {},
        'setOptions'            : null,
        'send'                  : null,
        'submit'                : null,
        'destroy'               : null,
        'resetErrorsDisplay'    : null
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
            parseRules(customRule, '');
            checkForRulesImports(customRule);
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
            parseRules(rules, '');
            checkForRulesImports(rules);

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

        if ( typeof(instance['$forms'][_id]) != 'undefined' ) {
            $form = this.$forms[_id] = instance['$forms'][_id];

            return $form
        }

        return null
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
            _id = $target.getAttribute('id') || 'form.'+uuid.v1();

            $target.setAttribute('id', _id);// just in case

        } else {
            throw new Error('[ FormValidator::validateFormById(formId[, customRule]) ] `formId` should be a `string`');
        }

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
                } else if ( $form.target.getAttribute('data-gina-validator-rule') ) {
                    rule = $form.target.getAttribute('data-gina-validator-rule').replace(/\-/g, '.');

                    if ( typeof(instance.rules[rule]) != 'undefined' ) {
                        $form['rule'] = instance.rules[rule]
                    } else {
                        throw new Error('[ FormValidator::validateFormById(formId) ] using `data-gina-validator-rule` on form `'+$form.target+'`: no matching rule found')
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

            if ($target)
                bindForm($target, rule);
        }

        if (!$form) throw new Error('[ FormValidator::validateFormById(formId, customRule) ] `'+_id+'` not found');

        // if ($form) {
        //     // $form.plugin                = $validator.plugin;
        //     // $form.binded                = false;
        //     // $form.on                    = on;
        //     // $form.setOptions           = setOptions;
        //     // $form.getFormById          = getFormById;
        //     // $form.validateFormById     = validateFormById;
        //     // $form.resetErrorsDisplay   = resetErrorsDisplay;
        //     // $form.handleErrorsDisplay  = handleErrorsDisplay;
        //     // $form.submit               = submit;
        //     // $form.send                 = send;
        //     // $form.destroy              = destroy;
        //
        //     var rule    = null;
        //     if ( typeof(customRule) == 'undefined') {
        //         rule = _id.replace(/\-/g, '.');
        //
        //         if ( typeof(instance.rules[rule]) != 'undefined' ) {
        //             $form['rule'] = customRule = instance.rules[rule];
        //         } else if ( $form.target.getAttribute('data-gina-validator-rule') ) {
        //             rule = $form.target.getAttribute('data-gina-validator-rule').replace(/\-/g, '.');
        //
        //             if ( typeof(instance.rules[rule]) != 'undefined' ) {
        //                 $form['rule'] = instance.rules[rule]
        //             } else {
        //                 throw new Error('[ FormValidator::validateFormById(formId) ] using `data-gina-validator-rule` on form `'+$form.target+'`: no matching rule found')
        //             }
        //         } else {
        //             throw new Error('[ FormValidator::validateFormById(formId[, customRule]) ] `customRule` or `data-gina-validator-rule` attribute is missing')
        //         }
        //     } else {
        //         rule = customRule.replace(/\-/g, '.');
        //
        //         if ( typeof(instance.rules[rule]) != 'undefined' ) {
        //             $form['rule'] = instance.rules[rule]
        //         } else {
        //             throw new Error('[ FormValidator::validateFormById(formId, customRule) ] `'+customRule+'` is not a valid rule')
        //         }
        //     }
        //
        //     // binding form
        //     bindForm($form.target, customRule);
        //
        // } else {
        //     throw new Error('[ FormValidator::validateFormById(formId, customRule) ] `'+_id+'` not found')
        // }


        return $form || null;

    }

    var handleErrorsDisplay = function($form, errors) {

        if ( gina.options.env == 'dev' )
            var formsErrors = null;

        var name = null, errAttr = null;
        var $err = null, $msg = null;
        var $el = null, $parent = null, $target = null;
        var id  = $form.getAttribute('id');

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
            errAttr = $el.getAttribute('data-errors');

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

                    if ( gina.options.env == 'dev' ) {
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

                            if ( gina.options.env == 'dev' ) {
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


        if ( formsErrors ) {

            triggerEvent(gina, $form, 'error.' + id, errors)

            if ( typeof(window.ginaToolbar) == 'object' ) {
                // update toolbar
                if (!gina.forms.errors)
                    gina.forms.errors = {};

                gina.forms.errors = formsErrors;

                window.ginaToolbar.update('forms', gina.forms);
            }

        } else {
            triggerEvent(gina, $form, 'success.' + id, errors)
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
            _id = this.getAttribute('id');
            $form = instance.$forms[_id]
        } else if ( typeof($form) == 'string' ) {
            _id = $form;
            _id = _id.replace(/\#/, '');

            if ( typeof(instance.$forms[_id]) == 'undefined') {
                throw new Error('[ FormValidator::resetErrorsDisplay([formId]) ] `'+$form+'` not found')
            }

            $form = instance.$forms[_id]
        }
        //console.log('reseting error display ', $form.id, $form);
        handleErrorsDisplay($form['target'], [])
    }

    // TODO - efreshErrorsDisplay
    // var refreshErrorsDisplay = function ($form) {
    //
    // }

    var submit = function () {

        var $form = null, _id = null, $target = null;

        if ( this.getAttribute ) {
            _id = this.getAttribute('id');
            $target = this;
        } else if ( typeof(this.target) && this.target.getAttribute ) {
            _id = this.target.getAttribute('id');
            $target = this.target
        }

        if ( typeof(instance.$forms[_id]) == 'undefined') {
            throw new Error('[ FormValidator::submit() ] not `$form` binded. Use `FormValidator::getFormById(id)` or `FormValidator::validateFormById(id)` first ')
        }

        var $form = instance.$forms[_id];
        var rule = $form.rule || instance.rules[_id.replace(/\-/g, '.')] || null;

        // getting fields & values
        var $fields     = {}
            , fields    = { '_length': 0 }
            , name      = null
            // e.g: name="item[cat][]" <- gina will add the index
            , index     = { checkbox: 0, radio: 0 };


        for (var i = 0, len = $target.length; i<len; ++i) {
            name = $target[i].getAttribute('name');

            if (!name) continue;

            if ( typeof($target[i].type) != 'undefined' && ($target[i].type == 'radio' || $target[i].type == 'checkbox') ) {
                if ( $target[i].checked == true ) {
                    $target[i].setAttribute('checked', 'checked');

                    if ( /\[\]/.test(name) ) {
                        name = name.replace(/\[\]/, '['+ index[ $target[i].type ] +']');
                        ++index[ $target[i].type ]
                    }

                    fields[name] = $target[i].value;
                }


            } else {

                if ( /\[\]/.test(name) ) {
                    name = name.replace(/\[\]/, '['+ fields['_length'] +']');
                    ++index
                }

                fields[name] = $target[i].value;
            }
            $fields[name]   = $target[i];
            // reset filed error data attributes
            $fields[name].setAttribute('data-errors', '');

            ++fields['_length']
        }


        if ( fields['_length'] == 0 ) { // nothing to validate
            delete fields['_length'];
            var result = {
                'errors'    : [],
                'isValid'   : function() { return true },
                'data'      : fields
            };

            triggerEvent(gina, $target, 'validate.' + _id, result)

        } else {
            validate($target, fields, $fields, rule, function onValidation(result){
                triggerEvent(gina, $target, 'validate.' + _id, result)
            })
        }

        return this;
    }


    /**
     * send
     * N.B.: no validation here; if you want to validate against rules, use `.submit()` before
     *
     *
     * @param {object} data
     * @param {object} [ options ]
     * */
    var send = function(data, options) {

        var $target = this.target , id = $target.getAttribute('id');
        var $form = instance.$forms[id];

        // forward callback to HTML attribute
        listenToXhrEvents($form);

        if (options) {
            var options = merge(options, xhrOptions);
        } else {
            var options = xhrOptions;
        }

        var url         = $target.getAttribute('action') || options.url;
        var method      = $target.getAttribute('method') || options.method;
        method          = method.toUpperCase();
        options.method  = method;
        options.url     = url;

        // to upload, use `multipart/form-data` for `enctype`
        var enctype = $target.getAttribute('enctype');

        //console.log('options ['+$form.id+'] -> ', options);

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
                var result = 'CORS not supported: the server is missing the header `"Access-Control-Allow-Credentials": true` ';
                triggerEvent(gina, $target, 'error.' + id, result);

                return
            }

            xhr.withCredentials = true;
        } else {
            if (options.isSynchrone) {
                xhr.open(options.method, options.url, options.isSynchrone)
            } else {
                xhr.open(options.method, options.url)
            }
        }

        // setting up headers
        for (var hearder in options.headers) {
            if ( hearder == 'Content-Type' && typeof (enctype) != 'undefined' && enctype != null && enctype != '') {
                options.headers[hearder] = enctype
            }

            xhr.setRequestHeader(hearder, options.headers[hearder]);
        }

        if (xhr) {
            // catching ready state cb
            xhr.onreadystatechange = function (event) {

                if (xhr.readyState == 4) {
                    // 200, 201, 201' etc ...
                    if( /^2/.test(xhr.status) ) {

                        try {
                            var result = xhr.responseText;
                            if ( /json$/.test( xhr.getResponseHeader("Content-Type") ) ) {
                                result = JSON.parse(xhr.responseText)
                            }

                            $form.eventData.success = result;
                            //console.log('sending response ...');
                            //console.log('event is ', 'success.' + id);
                            //console.log('making response ' + JSON.stringify(result, null, 4));

                            var XHRData = result;
                            if ( gina && typeof(window.ginaToolbar) == "object" && XHRData ) {
                                try {

                                    if ( typeof(XHRData) != 'undefined' ) {
                                        window.ginaToolbar.update("data-xhr", XHRData);
                                    }

                                } catch (err) {
                                    throw err
                                }
                            }

                            triggerEvent(gina, $target, 'success.' + id, result)

                        } catch (err) {
                            var result = {
                                'status':  422,
                                'error' : err.description
                            };

                            $form.eventData.error = result;

                            // // update toolbar
                            // var XHRData = result;
                            // if ( gina && typeof(window.ginaToolbar) == "object" && XHRData ) {
                            //     try {
                            //
                            //         // forward backend appplication errors to forms.errors when available
                            //         if ( XHRData.error && typeof(XHRData.error) == 'object' && $form.fields ) {
                            //             var formsErrors = {}, errCount = 0;
                            //             for (var e in XHRData.error) {
                            //                 if ( typeof($form.fields[e]) != 'undefined' ) {
                            //                     ++errCount;
                            //                     formsErrors[e] = XHRData.error[e];
                            //
                            //                     if ( typeof(XHRData.stack) != 'undefined' )
                            //                         formsErrors[e].stack = XHRData.stack;
                            //                 }
                            //             }
                            //
                            //             if (errCount > 0) {
                            //                 handleErrorsDisplay($form.target, formsErrors);
                            //             }
                            //         }
                            //         // update toolbar
                            //         ginaToolbar.update("data-xhr", XHRData );
                            //
                            //     } catch (err) {
                            //         throw err
                            //     }
                            // }

                            var XHRData = result;
                            if ( gina && typeof(window.ginaToolbar) == "object" && XHRData ) {
                                try {

                                    if ( typeof(XHRData) != 'undefined' ) {
                                        window.ginaToolbar.update("data-xhr", XHRData);
                                    }

                                } catch (err) {
                                    throw err
                                }
                            }

                            triggerEvent(gina, $target, 'error.' + id, result)
                        }

                    } else if ( xhr.status != 0) {

                        var result = { 'status': xhr.status };

                        if ( /^(\{|\[).test( xhr.responseText ) /) {

                            try {
                                result = JSON.parse(xhr.responseText);
                            } catch (err) {
                                result = merge(result, err)
                            }

                        } else if ( typeof(xhr.responseText) == 'object' ) {
                            result = xhr.responseText
                        } else {
                            result.message = xhr.responseText
                        }

                        $form.eventData.error = result;

                        // update toolbar
                        var XHRData = result;
                        if ( gina && typeof(window.ginaToolbar) == "object" && XHRData ) {
                            try {

                                // forward backend appplication errors to forms.errors when available
                                if ( XHRData.error && typeof(XHRData.error) == 'object' && $form.fields ) {
                                    var formsErrors = {}, errCount = 0;
                                    for (var e in XHRData.error) {
                                        if ( typeof($form.fields[e]) != 'undefined' ) {
                                            ++errCount;
                                            formsErrors[e] = XHRData.error[e];

                                            if ( typeof(XHRData.stack) != 'undefined' )
                                                formsErrors[e].stack = XHRData.stack;
                                        }
                                    }

                                    if (errCount > 0) {
                                        handleErrorsDisplay($form.target, formsErrors);
                                    }
                                }
                                // update toolbar
                                ginaToolbar.update("data-xhr", XHRData );

                            } catch (err) {
                                throw err
                            }
                        }

                        triggerEvent(gina, $target, 'error.' + id, result)
                    }
                }
            };

            // catching request progress
            xhr.onprogress = function(event) {
                // console.log(
                //    'progress position '+ event.position,
                //    '\nprogress total size '+ event.totalSize
                // );

                var percentComplete = (event.position / event.totalSize)*100;
                var result = {
                    'status': 100,
                    'progress': percentComplete
                };

                $form.eventData.onprogress = result;

                triggerEvent(gina, $target, 'progress.' + id, result)
            };

            // catching timeout
            xhr.ontimeout = function (event) {
                var result = {
                    'status': 408,
                    'error': 'Request Timeout'
                };

                $form.eventData.ontimeout = result;

                triggerEvent(gina, $target, 'error.' + id, result)
            };


            // sending
            var data = event.detail.data;
            if (data) {
                if ( typeof(data) == 'object' ) {
                    try {
                        data = JSON.stringify(data)
                    } catch (err) {
                        triggerEvent(gina, $target, 'error.' + id, err)
                    }
                }
                //console.log('sending -> ', data);
                //try {
                    xhr.send(data)
                // } catch (err) {
                //     var XHRData = result;
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
                xhr.send()
            }
            $form.sent = true;


        }
    }

    var listenToXhrEvents = function($form) {

        //$form['plugin'] = $validator.plugin;
        //$form['on']     = $validator.on;


        //data-on-submit-success
        var htmlSuccesEventCallback =  $form.target.getAttribute('data-on-submit-success') || null;
        if (htmlSuccesEventCallback != null) {

            if ( /\((.*)\)/.test(htmlSuccesEventCallback) ) {
                eval(htmlSuccesEventCallback)
            } else {
                $form.on('success',  window[htmlSuccesEventCallback])
            }
        }

        //data-on-submit-error
        var htmlErrorEventCallback =  $form.target.getAttribute('data-on-submit-error') || null;
        if (htmlErrorEventCallback != null) {
            if ( /\((.*)\)/.test(htmlErrorEventCallback) ) {
                eval(htmlErrorEventCallback)
            } else {
                $form.on('error', window[htmlErrorEventCallback])
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
            _id = $target.getAttribute('id') || 'form.'+uuid.v1();

            $target.setAttribute('id', _id);// just in case

        } else {
            throw new Error('[ FormValidator::destroy(formId) ] `formId` should be a `string`');
        }

        if ( typeof(instance['$forms'][_id]) != 'undefined' ) {
            $form = instance['$forms'][_id]
        }

        if ($form) {
            // remove existing listeners

            // form events
            removeListener(gina, $form, 'success.' + _id);
            removeListener(gina, $form, 'validate.' + _id);
            removeListener(gina, $form, 'submit.' + _id);
            removeListener(gina, $form, 'error.' + _id);

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
                    if ( $elTMP[i].attributes.getNamedItem('data-submit') || /^click\./.test( $elTMP[i].attributes.getNamedItem('id') ) )
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

            addListener(gina, instance['$forms'][_id].target, 'destroy.' + _id, function(event) {

                cancelEvent(event);

                delete instance['$forms'][_id];
                removeListener(gina, event.currentTarget, event.type);
                removeListener(gina, event.currentTarget,'destroy');
            });

            triggerEvent(gina, instance['$forms'][_id].target, 'destroy.' + _id);

        } else {
            throw new Error('[ FormValidator::destroy(formId) ] `'+_id+'` not found');
        }

    }

    var checkForRulesImports = function (rules) {
        // check if rules has imports & replace
        var rulesStr = JSON.stringify(rules, null, 4);
        var importedRules = rulesStr.match(/(\"@import\s+[a-z A-Z 0-9/.]+\")/g);
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
                        console.warn('[formValidator:rules] <@import error> on `'+importedRules[r]+'`: rule `'+ruleArr[i]+'` not found. Ignoring.')
                    }
                }
                //console.log('replacing ', importedRules[r]);
                rulesStr = rulesStr.replace(importedRules[r], JSON.stringify(rule));
                instance.rules = JSON.parse( JSON.stringify(instance.rules).replace( new RegExp(importedRules[r], 'g'), JSON.stringify(rule)) );
                //console.log('str ', rulesStr);
                rule = {}

            }

            if (!instance.rules) {
                instance.rules = {}
            }

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
                    parseRules(rules, '');
                    checkForRulesImports(rules);
                }

                $validator.setOptions           = setOptions;
                $validator.getFormById          = getFormById;
                $validator.validateFormById     = validateFormById;
                $validator.resetErrorsDisplay   = resetErrorsDisplay;
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
                        id = $allForms[f].getAttribute('id') || 'form.' + uuid.v1();
                        if ( id !== $allForms[f].getAttribute('id') ) {
                            $allForms[f].setAttribute('id', id)
                        }
                    } else {
                        id = 'form.' + uuid.v1();
                        $allForms[f].setAttribute('id', id)
                    }

                    $allForms[f]['id'] = $validator.id = id;

                    if ( typeof($allForms[f].id) != 'undefined' && $allForms[f].id != 'null' && $allForms[f].id != '') {

                        $validator.target = $allForms[f];
                        instance.$forms[$allForms[f].id] = merge({}, $validator);

                        var customRule = $allForms[f].getAttribute('data-gina-validator-rule');

                        if (customRule) {
                            customRule = customRule.replace(/\-/g, '.');
                            if ( typeof(instance.rules[customRule]) == 'undefined' ) {
                                throw new Error('['+$allForms[f].id+'] no rule found with key: `'+customRule+'`');
                                customRule = null
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

                                var _id = $allForms[f].attributes.getNamedItem('id').nodeValue || 'form.'+uuid.v1();

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
                gina.forms.rules = instance.rules;
                triggerEvent(gina, instance.target, 'ready.' + instance.id, instance);
            });

        }

        instance.initialized = true;
        return instance
    }

    var parseRules = function(rules, tmp) {

        for (var r in rules) {

            if ( typeof(rules[r]) == 'object' && typeof(instance.rules[tmp + r]) == 'undefined' ) {
                instance.rules[tmp + r] = rules[r];
                parseRules(rules[r], tmp + r+'.');
            }
        }
    }


    var validate = function($form, fields, $fields, rules, cb) {
        delete fields['_length']; //cleaning

        var id = null;
        if (isGFFCtx) {
            id = $form.getAttribute('id') || $form.id;
            instance.$forms[id].fields = fields;
        }
        //console.log(fields, $fields);

        var d = new FormValidator(fields, $fields), args = null;
        var fieldErrorsAttributes = {};
        var re = null, flags = null;


        var forEachField = function($form, fields, $fields, rules, cb, i) {
            var hasCase = false, conditions = null;
            var caseValue = null, caseType = null;
            var localRules = null;

            //console.log('parsing ', fields, $fields, rules);

            for (var field in fields) {

                hasCase = ( typeof(rules['_case_' + field]) != 'undefined' ) ? true : false;
                if (hasCase) {

                    conditions = rules['_case_' + field]['conditions'];
                    //console.log('found case on `'+field +'`');
                    //console.log('conditions ', conditions);

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

                            for (var f in conditions[c]['rules']) {
                                //console.log('F: ', f, '\nrule: '+ JSON.stringify(conditions[c]['rules'][f], null, 2));
                                if ( /^\//.test(f) ) { // RegExp found

                                    re      = f.match(/\/(.*)\//).pop();
                                    flags   = f.replace('/'+ re +'/', '');
                                    re      = new RegExp(re, flags);

                                    for (var localField in $fields) {
                                        if ( re.test(localField) ) {
                                            if ( /^\//.test(conditions[c]['case']) ) {
                                                re      = conditions[c]['case'].match(/\/(.*)\//).pop();
                                                flags   = conditions[c]['case'].replace('/'+ re +'/', '');
                                                re      = new RegExp(re, flags);

                                                if ( re.test(caseValue) ) {
                                                    localRules[localField] = conditions[c]['rules'][f]
                                                }

                                            } else {
                                                localRules[localField] = conditions[c]['rules'][f]
                                            }
                                        }
                                    }

                                } else {
                                    if ( /^\//.test(conditions[c]['case']) ) {
                                        re      = conditions[c]['case'].match(/\/(.*)\//).pop();
                                        flags   = conditions[c]['case'].replace('/'+ re +'/', '');
                                        re      = new RegExp(re, flags);

                                        if ( re.test(caseValue) ) {
                                            localRules[f] = conditions[c]['rules'][f]
                                        }

                                    } else {
                                        localRules[f] = conditions[c]['rules'][f]
                                    }
                                }
                            }
                            //console.log('parsing ', localRules, fields);
                            if (isGFFCtx)
                                forEachField($form, fields, $fields, localRules, cb, i+1)
                            else
                                return forEachField($form, fields, $fields, localRules, cb, i+1);
                        }
                    }

                }


                if ( typeof(rules[field]) == 'undefined' ) continue;


                // check against rule
                for (var rule in rules[field]) {
                    // check for rule params
                    try {

                        if ( Array.isArray(rules[field][rule]) ) { // has args
                            //convert array to arguments
                            args = rules[field][rule];
                            d[field][rule].apply(d[field], args);
                        } else {
                            d[field][rule](rules[field][rule]);
                        }

                    } catch (err) {
                        if (rule == 'conditions') {
                            throw new Error('[ ginaFormValidator ] could not evaluate `'+field+'->'+rule+'()` where `conditions` must be a `collection` (Array)')
                        } else {
                            throw new Error('[ ginaFormValidator ] could not evaluate `'+field+'->'+rule+'()`')
                        }
                    }

                }
            }


            --i;

            if (i < 0) {
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
                        $fields[field].setAttribute('data-errors', fieldErrorsAttributes[field].substr(0, fieldErrorsAttributes[field].length-1))
                }

                //console.log('data => ',  d['toData']());

                //calling back
                if ( typeof(cb) != 'undefined' && typeof(cb) === 'function' ) {
                    cb({
                        'isValid'   : d['isValid'],
                        'errors'    : errors,
                        'data'      : d['toData']()
                    })
                } else {
                    return {
                        'isValid'   : d['isValid'],
                        'errors'    : errors,
                        'data'      : d['toData']()
                    }
                }
            }
        }

        if (isGFFCtx)
            forEachField($form, fields, $fields, rules, cb, 0);
        else
            return forEachField($form, fields, $fields, rules, cb, 0);
    }

    /**
     * bindForm
     *
     * @param {object} target - DOM element
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

        // binding input: checkbox, radio
        var $inputs = $target.getElementsByTagName('input'), type = null, id = null;

        var updateCheckBox = function($el) {

            var checked     = $el.checked;

            if ( !checked || checked == 'null' || checked == 'false' || checked == '' ) {

                $el.checked = false;
                $el.removeAttribute('checked');
                $el.value = 'false';

            } else {

                $el.setAttribute('checked', 'checked');
                //boolean exception handling
                $el.value = 'true';
                $el.checked = true;

            }
        };

        var updateRadio = function($el, isInit) {
            var checked = $el.checked;

            // loop if radio group
            if (!isInit) {
                var radioGroup = document.getElementsByName($el.name);
                //console.log('found ', radioGroup.length, radioGroup)
                for (var r = 0, rLen = radioGroup.length; r < rLen; ++r) {
                    if (radioGroup[r].id !== $el.id) {
                        radioGroup[r].checked = false;
                        radioGroup[r].removeAttribute('checked')
                    }
                }
            }

            if ( !checked || checked == 'null' || checked == 'false' || checked == '' ) {

                $el.checked = false;
                $el.removeAttribute('checked');

            } else {

                $el.setAttribute('checked', 'checked');
                $el.checked = true;
            }
        }

        evt = 'click';

        procced = function () {
            // click proxy
            addListener(gina, $target, 'click', function(event) {

                if ( typeof(event.target.id) == 'undefined' ) {
                    event.target.setAttribute('id', 'click.' + uuid.v1() );
                    event.target.id = event.target.getAttribute('id')
                }


                if (/^click\./.test(event.target.id) || withRules) {

                    var _evt = event.target.id;
                    if ( ! /^click\./.test(_evt)  ) {
                        _evt = 'click.' + event.target.id
                    }

                    triggerEvent(gina, event.target, _evt, event.detail);
                }

            })
        }

        //if ( typeof(gina.events[evt]) != 'undefined' && gina.events[evt] == _id ) {
            //removeListener(gina, element, name, callback)
        //    removeListener(gina, $form, evt, procced)
        //} else {
            procced()
        //}

        for (var i=0, len = $inputs.length; i<len; ++i) {
            type    = $inputs[i].getAttribute('type');

            if ( typeof($inputs[i].id) == 'undefined' || $inputs[i].id == '' ) {
                $inputs[i]['id'] = type +'-'+ uuid.v1();
                $inputs[i].setAttribute('id', $inputs[i]['id'])
            }


            if ( typeof(type) != 'undefined' && type == 'checkbox' ) {

                evt = 'click.' + $inputs[i].id;


                procced = function ($el, evt) {

                    // recover default state only on value === true || false
                    addListener(gina, $el, evt, function(event) {

                        //cancelEvent(event);

                        if ( /(true|false)/.test(event.target.value) ) {
                            updateCheckBox(event.target);
                        }
                    });

                    if ( /(true|false)/.test($el.value) )
                        updateCheckBox($el);

                }

                if ( typeof(gina.events[evt]) != 'undefined' && gina.events[evt] == $inputs[i].id ) {
                    removeListener(gina, $inputs[i], evt, function(event){
                        procced(event.target, evt)
                    })
                } else {
                    procced($inputs[i], evt)
                }

            } else if ( typeof(type) != 'undefined' && type == 'radio' ) {
                evt = 'click.' + $inputs[i].id;

                procced = function ($el, evt) {
                    addListener(gina, $el, evt, function(event) {
                        //cancelEvent(event);
                        updateRadio(event.target);

                    });

                    updateRadio($el, true)
                }

                if ( typeof(gina.events[evt]) != 'undefined' && gina.events[evt] == $inputs[i].id ) {
                    removeListener(gina, $inputs[i], evt, function(event){
                        procced(event.target, evt)
                    })
                } else {
                    procced($inputs[i], evt)
                }
            }
        }


        if (withRules) {

            evt = 'validate.' + _id;
            //console.log('[ bind() ] : before attaching `'+evt+'` ->  `withRules`: '+withRules, '\n'+self.events[evt]+' VS '+_id, '\nevents ', self.events);

            procced = function () {
                //self.events[evt] = _id;
                //console.log('attaching ', evt);

                // attach form event
                addListener(gina, $target, evt, function(event) {
                    cancelEvent(event);


                    var result = event['detail'] || $form.eventData.validation;
                    //console.log('$form[ '+_id+' ] validation done !!!\n isValid ? ', result['isValid'](), '\nErrors -> ', result['errors'], '\nData -> ', result['data']);

                    handleErrorsDisplay(event['target'], result['errors']);

                    var _id = event.target.getAttribute('id');

                    if ( result['isValid']() ) { // send if valid
                        // now sending to server
                        if ( !gina.events['submit.'+ _id] ) {
                            instance.$forms[_id].send(result['data']);
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
                        , name      = null
                        , value     = 0
                        , type      = null
                        // e.g: name="item[cat][]" <- gina will add the index
                        , index     = { checkbox: 0, radio: 0 };

                    for (var i = 0, len = $target.length; i<len; ++i) {
                        name = $target[i].getAttribute('name');

                        if (!name) continue;

                        // TODO - add switch cases against tagName (checkbox/radio)

                        if ( typeof($target[i].type) != 'undefined' && ($target[i].type == 'radio' || $target[i].type == 'checkbox') ) {
                            //console.log('radio ', name, $form[i].checked, $form[i].value);
                            if ( $target[i].checked == true ) {

                                $target[i].setAttribute('checked', 'checked');

                                if ( /\[\]/.test(name) ) {
                                    name = name.replace(/\[\]/, '['+ index[ $target[i].type ] +']');
                                    ++index[ $target[i].type ]
                                }

                                fields[name] = $target[i].value;
                            }


                        } else {

                            if ( /\[\]/.test(name) ) {
                                name = name.replace(/\[\]/, '['+ fields['_length'] +']');
                                ++index
                            }

                            fields[name]    = $target[i].value;
                        }
                        $fields[name]   = $target[i];
                        // reset filed error data attributes
                        $fields[name].setAttribute('data-errors', '');

                        ++fields['_length']
                    }

                    //console.log('$fields =>\n' + $fields);

                    //instance.$forms[ $target.getAttribute('id') ].sent = false;

                    if ( fields['_length'] == 0 ) { // nothing to validate
                        delete fields['_length'];
                        var result = {
                            'errors'    : [],
                            'isValid'   : function() { return true },
                            'data'      : fields
                        };

                        triggerEvent(gina, $target, 'validate.' + _id, result)

                    } else {
                        //console.log('testing rule [ '+_id.replace(/\-/g, '.') +' ]\n'+ JSON.stringify(rule, null, 4));
                        //console.log('validating ', $form, fields, rule);
                        validate($target, fields, $fields, rule, function onValidation(result){
                            //console.log('validation result ', 'validate.' + _id, JSON.stringify(result.data, null, 2));
                            //console.log('events ', 'validate.' + _id, self.events )
                            triggerEvent(gina, $target, 'validate.' + _id, result)
                        })
                    }

                });
            }


            // binding submit button
            var $submit = null, $buttons = [], $buttonsTMP = [], buttonId = null;
            $buttonsTMP = $target.getElementsByTagName('button');
            if ( $buttonsTMP.length > 0 ) {
                for(var b = 0, len = $buttonsTMP.length; b < len; ++b) {
                    if ($buttonsTMP[b].type == 'submit')
                        $buttons.push($buttonsTMP[b])
                }
            }

            $buttonsTMP = $target.getElementsByTagName('a');
            if ( $buttonsTMP.length > 0 ) {
                for(var b = 0, len = $buttonsTMP.length; b < len; ++b) {
                    if ( $buttonsTMP[b].attributes.getNamedItem('data-submit'))
                        $buttons.push($buttonsTMP[b])
                }
            }


            var onclickAttribute = null;
            for (var b=0, len=$buttons.length; b<len; ++b) {

                $submit = $buttons[b];

                if ($submit.tagName == 'A') { // without this test, XHR callback is ignored
                    //console.log('a#$buttons ', $buttonsTMP[b]);
                    onclickAttribute = $submit.getAttribute('onclick');

                    if ( !onclickAttribute ) {
                        $submit.setAttribute('onclick', 'return false;')
                    } else if ( !/return false/) {
                        if ( /\;$/.test(onclickAttribute) ) {
                            onclickAttribute += 'return false;'
                        } else {
                            onclickAttribute += '; return false;'
                        }
                    }
                }

                if (!$submit['id']) {

                    evt = 'click.'+ uuid.v1();
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
        //console.log('adding submit event ', evt, _id, self.events);
        // submit proxy
        addListener(gina, $target, evt, function(e) {
            //console.log('adding submit event ', evt, self.events['submit.'+_id]);
            var $target     = e.target
                , id        = $target.getAttribute('id')
                , isBinded  = instance.$forms[id].binded
            ;

            if (withRules || isBinded) cancelEvent(e);


            // just collect data for over forms
            // getting fields & values
            var $fields     = {}
                , fields    = { '_length': 0 }
                , name      = null
                , value     = 0
                , type      = null
                // e.g: name="item[cat][]" <- gina will add the index
                , index     = { checkbox: 0, radio: 0 };

            for (var i = 0, len = $target.length; i<len; ++i) {
                name = $target[i].getAttribute('name');

                if (!name) continue;

                // TODO - add switch cases against tagName (checkbox/radio)

                if ( typeof($target[i].type) != 'undefined' && ($target[i].type == 'radio' || $target[i].type == 'checkbox') ) {
                    //console.log('name : ', name, '\ntype ', $form[i].type, '\nchecked ? ', $form[i].checked, '\nvalue', $form[i].value);
                    if ( $target[i].checked === true ) {
                        $target[i].setAttribute('checked', 'checked');

                        if ( /\[\]/.test(name) ) {
                            name = name.replace(/\[\]/, '['+ index[ $target[i].type ] +']');
                            ++index[ $target[i].type ]
                        }

                        fields[name] = $target[i].value;
                    }
                } else {

                    if ( /\[\]/.test(name) ) {
                        name = name.replace(/\[\]/, '['+ fields['_length'] +']');
                        ++index
                    }

                    fields[name]    = $target[i].value;
                }

                $fields[name]       = $target[i];

                ++fields['_length']
            }



            if ( fields['_length'] == 0 ) { // nothing to validate

                delete fields['_length'];
                var result = {
                    'errors'    : [],
                    'isValid'   : function() { return true },
                    'data'      : fields
                };

                triggerEvent(gina, $target, 'submit.' + _id, result)

            } else {
                validate($target, fields, $fields, rule, function onValidation(result){
                    triggerEvent(gina, $target, 'submit.' + _id, result)
                })
            }

        });


        //self.$forms[_id]['rule']   = rules[_id] || {};
        instance.$forms[_id]['binded']  = true;
    }

    var setupInstanceProto = function() {

        instance.setOptions             = setOptions;
        instance.getFormById            = getFormById;
        instance.validateFormById       = validateFormById;
        instance.target                 = document;
        instance.validateFormById       = validateFormById;
        instance.resetErrorsDisplay     = resetErrorsDisplay;
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
    define('gina/validator', function(){ return ValidatorPlugin })
}