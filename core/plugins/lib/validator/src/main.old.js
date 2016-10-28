/**
 * Validator
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
function Validator(rules, data, formId) {

    var isGFFCtx        = ( ( typeof(module) !== 'undefined' ) && module.exports ) ? false : true;
    if (isGFFCtx) {
        require('utils/events');
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



    //console.log('rules -> ', rules);
    var self = {
        rules   : {},
        $forms  : {},
        eventData: {},
        events: {},
        currentTarget: null
    };

    /**
     * validator event handler
     * */
    var events      = ['ready', 'error', 'progress', 'submit', 'success', 'change'];
    var $validator  = null;

    // add input type=hidden to the <body> for form events handling
    var evtHandler  = null;

    /**
     * XML Request
     * */
    var xhr = null;
    var xhrOptions = {
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

    var on = function(event, cb) {

        if ( events.indexOf(event) < 0 ) {
            cb(new Error('Event `'+ event +'` not handled by ginaValidatorEventHandler'))
        } else {

            if ( !$validator ) {
                evtHandler      = document.createElement('input');
                evtHandler.type = 'hidden';
                evtHandler.id   = uuid.v1();
                document.getElementsByTagName('body')[0].appendChild(evtHandler);

                $validator = evtHandler;
            }

            var $target = ( typeof(this.tagName) != 'undefined' && this.tagName === 'FORM' ) ? this : $validator;
            var id      = $target.getAttribute('id');

            event += '.' + id;

            var registerEvent = function (event, $target) {
                //register event
                self.events[event] = event;
                self.currentTarget = $target;

                // bind
                addListener(gina, $target, event, function(e) {
                    cancelEvent(e);

                    var data = null;
                    if (e['detail']) {
                        data = e['detail'];
                    } else if ( typeof(self.eventData.submit) != 'undefined' ) {
                        data = self.eventData.submit
                    } else if ( typeof(self.eventData.error) != 'undefined' ) {
                        data = self.eventData.error
                    } else if ( typeof(self.eventData.success) != 'undefined' ) {
                        data = self.eventData.success;
                    }

                    // do it once
                    if ( typeof(self.events[e.type]) != 'undefined' && cb) {
                        //console.log('calling back from .on("'+e.type+'", cb) ', e);
                        delete self.events[e.type];
                        cb(e, data);
                    }
                });

                init(rules);
            }

            if ( typeof(self.events[event]) != 'undefined' && self.events[event] == id ) {
                // unbind existing
                removeListener(gina, $target, event, function () {
                    registerEvent(event, $target)
                })
            } else {
                registerEvent(event, $target)
            }
        }

        return proto
    };


    var getFormById = function(formId) {

        if ( !this['$forms'] )
            throw new Error('`$forms` collection not found');

        if ( typeof(formId) == 'undefined') {
            throw new Error('[ FormValidator::getFormById(formId) ] `formId` is missing')
        }

        formId = formId.replace(/\#/, '');

        if ( typeof(this['$forms'][formId]) != 'undefined' )
            return this['$forms'][formId];

        return null
    }

    var destroy = function(formId) {
        var $form = null;


        if ( !self['$forms'] )
            throw new Error('`$forms` collection not found');


        if ( typeof(formId) == 'undefined') {
            if ( typeof(this.id) != 'undefined' && this.id != '' && this.id != null ) {
                var formId  = this.id
            } else {
                throw new Error('[ FormValidator::destroy(formId) ] `formId` is missing')
            }
        }

        if ( typeof(formId) == 'string') {
            formId = formId.replace(/\#/, '')
        } else if ( typeof(formId) == 'object' ) { // weird exception
            var $target = formId.form;
            var _id = $target.getAttribute('id') || 'form.'+uuid.v1();

            $target.setAttribute('id', _id);// just in case
            self.$forms[_id] = merge({}, formProto);

            self.$forms[_id]['target'] = $target;
            self.$forms[_id]['target']['id'] = _id;
            self.$forms[_id]['id'] = _id;
            if (self.$forms[formId['id']])
                delete self.$forms[formId['id']];


            formId = _id;
        } else {
            throw new Error('[ FormValidator::destroy(formId) ] `formId` should be a `string`');
        }

        if ( typeof(self['$forms'][formId]) == 'undefined' || self['$forms'][formId]['id'] != formId ) {

            var $el = document.getElementById(formId);

            self.$forms[formId]             = merge({}, formProto);
            self.$forms[formId]['id']       = formId;
            self.$forms[formId]['target']   = $el;

            $form = self.$forms[formId];

        } else {
            $form = self['$forms'][formId] || null;
        }


        if ($form) {
            // remove existing listeners

            // form events
            removeListener(gina, $validator, 'success.' + formId);
            removeListener(gina, $form, 'validate.' + formId);
            removeListener(gina, $validator, 'error.' + formId);
            delete self.events['validate.' + formId];
            delete self.events['success.' + formId];
            delete self.events['error.' + formId];

            // submit
            var $submit = null, evt = null, $buttons = [], $buttonsTMP = [];

            $buttonsTMP = $form.target.getElementsByTagName('button');
            if ( $buttonsTMP.length > 0 ) {
                for(var b = 0, len = $buttonsTMP.length; b < len; ++b) {
                    if ($buttonsTMP[b].type == 'submit')
                        $buttons.push($buttonsTMP[b])
                }
            }

            $buttonsTMP = $form.target.getElementsByTagName('a');
            if ( $buttonsTMP.length > 0 ) {
                for(var b = 0, len = $buttonsTMP.length; b < len; ++b) {
                    if ($buttonsTMP[b].attributes.getNamedItem('data-submit'))
                        $buttons.push($buttonsTMP[b])
                }
            }

            for (var b=0, len=$buttons.length; b<len; ++b) {

                $submit = $buttons[b];
                //console.log( $submit['id'] );
                if ( typeof(self.events[$submit['id']]) != 'undefined' ) {
                    console.log('removing ', self.events[$submit['id']]);
                    removeListener(gina, $submit, self.events[$submit['id']]);
                    delete self.events[$submit['id']];
                }

            }

            delete self['$forms'][formId];

        } else {
            throw new Error('[ FormValidator::destroy(formId) ] `'+formId+'` not found')
        }

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
        var $form = null;


        if ( !this['$forms'] )
            throw new Error('`$forms` collection not found');

        if ( typeof(formId) == 'undefined') {
            if ( typeof(this.id) != 'undefined' && this.id != '' && this.id != null ) {
                var formId  = this.id
            } else {
                throw new Error('[ FormValidator::validateFormById(formId, customRule) ] `formId` is missing')
            }
        }

        if ( typeof(formId) == 'string') {
            formId = formId.replace(/\#/, '')
        } else if ( typeof(formId) == 'object' ) { // weird exception

            var $target = formId.form;
            var _id = $target.getAttribute('id') || 'form.'+uuid.v1();

            $target.setAttribute('id', _id);// just in case
            self.$forms[_id] = merge({}, formProto);

            self.$forms[_id]['target'] = $target;
            self.$forms[_id]['target']['id'] = _id;
            self.$forms[_id]['id'] = _id;
            if (self.$forms[formId['id']])
                delete self.$forms[formId['id']];


            formId = _id;
        } else {
            throw new Error('[ FormValidator::validateFormById(formId[, customRule]) ] `formId` should be a `string`');
        }

        if ( typeof(this['$forms'][formId]) == 'undefined' || this['$forms'][formId]['id'] != formId ) {

            var $el = document.getElementById(formId);

            self.$forms[formId]             = merge({}, formProto);
            self.$forms[formId]['id']       = formId;
            self.$forms[formId]['target']   = $el;

            $form = self.$forms[formId];

        } else {
            $form = this['$forms'][formId] || null;
        }


        if ($form) {
            var rule = null;
            if ( typeof(customRule) == 'undefined') {
                rule = formId.replace(/\-/g, '.');

                if ( typeof(self.rules[rule]) != 'undefined' ) {
                    $form['rule'] = customRule = self.rules[rule];
                } else if ( $form.target.getAttribute('data-gina-validator-rule') ) {
                    rule = $form.target.getAttribute('data-gina-validator-rule').replace(/\-/g, '.');

                    if ( typeof(self.rules[rule]) != 'undefined' ) {
                        $form['rule'] = self.rules[rule]
                    } else {
                        throw new Error('[ FormValidator::validateFormById(formId) ] using `data-gina-validator-rule` on form `'+$form.target+'`: no matching rule found')
                    }
                } else {
                    throw new Error('[ FormValidator::validateFormById(formId[, customRule]) ] `customRule` or `data-gina-validator-rule` attribute is missing')
                }
            } else {
                rule = customRule.replace(/\-/g, '.');

                if ( typeof(self.rules[rule]) != 'undefined' ) {
                    $form['rule'] = self.rules[rule]
                } else {
                    throw new Error('[ FormValidator::validateFormById(formId, customRule) ] `'+customRule+'` is not a valid rule')
                }
            }
            //console.log("events list ", self.events);
            // binding form
            bindForm($form.target, customRule);

        } else {
            throw new Error('[ FormValidator::validateFormById(formId, customRule) ] `'+formId+'` not found')
        }

        $form['resetErrorsDisplay'] = resetErrorsDisplay;

        return $form || null;
    }

    var handleErrorsDisplay = function($form, errors) {

        var name = null, errAttr = null;
        var $err = null, $msg = null;
        var $el = null, $parent = null, $target = null;

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
                    $msg = document.createElement('p');
                    //console.log('txt => ', errors[name][e], e);
                    $msg.appendChild( document.createTextNode(errors[name][e]) );
                    $err.appendChild($msg)
                }

                if ($target.type != 'hidden')
                    insertAfter($target, $err);

            } else if ( typeof(errors[name]) == 'undefined' && /form\-item\-error/.test($parent.className) ) {
                // reset when not in error
                // remove child elements
                var $children = $parent.getElementsByTagName('div');
                for (var c = 0, cLen = $children.length; c<cLen; ++c) {
                    if ( /form\-item\-error\-message/.test($children[c].className) ) {
                        $parent.removeChild($children[c]);
                        break
                    }
                }

                $parent.className = $parent.className.replace(/(\s+form\-item\-error|form\-item\-error)/, '');

            } else if ( typeof(errors[name]) != 'undefined' && errAttr) {
                // refreshing already displayed error on msg update
                var $divs = $parent.getElementsByTagName('div');
                for (var d = 0, dLen = $divs.length; d<dLen; ++d) {
                    if ($divs[d].className == 'form-item-error-message') {

                        $parent.removeChild($divs[d]);
                        $err = document.createElement('div');
                        $err.setAttribute('class', 'form-item-error-message');

                        // injecting error messages
                        for (var e in errors[name]) {
                            $msg = document.createElement('p');
                            $msg.appendChild( document.createTextNode(errors[name][e]) );
                            $err.appendChild($msg)
                        }

                        break;
                    }
                }

                if ($target.type != 'hidden')
                    insertAfter($target, $err);
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
        var $form = $form;
        if ( typeof($form) == 'undefined' ) {
            $form = self.$forms[this.id]
        } else if ( typeof($form) == 'string' ) {
            $form = $form.replace(/\#/, '');

            if ( typeof(self.$forms[$form]) == 'undefined') {
                throw new Error('[ FormValidator::resetErrorsDisplay([formId]) ] `'+$form+'` not found')
            }

            $form = self.$forms[$form]
        }
        //console.log('reseting error display ', $form.id, $form);
        handleErrorsDisplay($form['target'], [])
        // getting fields & values
        // var $fields     = {}
        //     , fields    = { '_length': 0 }
        //     , name      = null
        //     , value     = 0
        //     , type      = null;
        //
        // for (var i = 0, len = $form['target'].length; i<len; ++i) {
        //     name = $form['target'][i].getAttribute('name');
        //     if (!name) continue;
        //
        //     if ( typeof($form['target'][i].type) != 'undefined' && $form['target'][i].type == 'radio' ) {
        //         //console.log('radio ', name, $form[i].checked, $form[i].value);
        //         if ( $form['target'][i].checked == true ) {
        //             fields[name] = $form['target'][i].value;
        //         }
        //
        //
        //     } else {
        //         fields[name]    = $form['target'][i].value;
        //     }
        //     $fields[name]   = $form['target'][i];
        //     // reset filed error data attributes
        //     $fields[name].setAttribute('data-errors', '');
        //
        //     ++fields['_length']
        // }

        //console.log('$fields =>\n' + $fields);

        // if ( fields['_length'] == 0 ) { // nothing to validate
        //     delete fields['_length'];
        //     var result = {
        //         'errors'    : [],
        //         'isValid'   : function() { return true },
        //         'data'      : fields
        //     };
        //
        //     handleErrorsDisplay($form['target'], result['errors'])
        //
        // } else {
        //     // console.log('testing rule [ '+$form.id.replace(/\-/g, '.') +' ]\n'+ JSON.stringify(rule, null, 4));
        //     //console.log('validating !! ', self.rules[$form.id.replace(/-/g, '.')]);
        //     validate($form['target'], fields, $fields, self.rules[$form.id.replace(/-/g, '.')], function onValidation(result){
        //         handleErrorsDisplay($form['target'], result['errors']);
        //     });
        //
        // }
    }
    
    var refreshErrorsDisplay = function ($form) {
        
    }

    var submit = function () {

        var id   = this.id;

        if ( typeof(self.$forms[id]) == 'undefined') {
            throw new Error('[ FormValidator::submit() ] not `$form` binded. Use `FormValidator::getFormById(id)` or `FormValidator::validateFormById(id)` first ')
        }

        var $form = this.target;
        var rule = this.rule || self.rules[id.replace(/\-/g, '.')] || null;

        // getting fields & values
        var $fields     = {}
            , fields    = { '_length': 0 }
            , name      = null;


        for (var i = 0, len = $form.length; i<len; ++i) {
            name = $form[i].getAttribute('name');
            if (!name) continue;

            if ( typeof($form[i].type) != 'undefined' && $form[i].type == 'radio' ) {
                if ( $form[i].checked == true ) {
                    fields[name] = $form[i].value;
                }


            } else {
                fields[name] = $form[i].value;
            }
            $fields[name]   = $form[i];
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

            triggerEvent(gina, $form, 'validate.' + id, result)

        } else {
            validate($form, fields, $fields, rule, function onValidation(result){
                triggerEvent(gina, $form, 'validate.' + id, result)
            })
        }

        return this;
    }

    var setOptions = function (options) {
        var options = merge(options, xhrOptions);
        xhrOptions = options;
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

        var $form   = this.target;
        var id      = $form.getAttribute('id');

        // forward callback to HTML attribute
        listenToXhrEvents($form);

        if (options) {
            var options = merge(options, xhrOptions);
        } else {
            var options = xhrOptions;
        }

        var url         = $form.getAttribute('action') || options.url;
        var method      = $form.getAttribute('method') || options.method;
        method          = method.toUpperCase();
        options.method  = method;
        options.url     = url;

        // to upload, use `multipart/form-data` for `enctype`
        var enctype = $form.getAttribute('enctype');

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
                triggerEvent(gina, $form, 'error.' + id, result)
            }
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

                            self.eventData.success = result;
                            //console.log('sending response ...');
                            //console.log('event is ', 'success.' + id);
                            //console.log('making response ' + JSON.stringify(result, null, 4));

                            triggerEvent(gina, $form, 'success.' + id, result)

                        } catch (err) {
                            var result = {
                                'status':  422,
                                'error' : err.description
                            };

                            self.eventData.error = result;

                            triggerEvent(gina, $form, 'error.' + id, result)
                        }

                    } else {
                        //console.log('error event triggered ', event.target, $form);
                        var result = {
                            'status':  xhr.status,
                            'error' : xhr.responseText
                        };

                        self.eventData.error = result;

                        triggerEvent(gina, $form, 'error.' + id, result)
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

                self.eventData.onprogress = result;

                triggerEvent(gina, $form, 'progress.' + id, result)
            };

            // catching timeout
            xhr.ontimeout = function (event) {
                var result = {
                    'status': 408,
                    'error': 'Request Timeout'
                };

                self.eventData.ontimeout = result;

                triggerEvent(gina, $form, 'error.' + id, result)
            };


            // sending
            if (data) {
                if ( typeof(data) == 'object' ) {
                    try {
                        data = JSON.stringify(data)
                        //data = encodeURIComponent(JSON.stringify(data))
                    } catch (err) {
                        triggerEvent(gina, $form, 'error.' + id, err)
                    }
                }
                //console.log('sending -> ', data);
                xhr.send(data)
            } else {
                xhr.send()
            }


        }
    }

    var listenToXhrEvents = function($form) {

        $form['on'] = formProto['on'];

        //data-on-submit-success
        var htmlSuccesEventCallback =  $form.getAttribute('data-on-submit-success') || null;
        if (htmlSuccesEventCallback != null) {

            if ( /\((.*)\)/.test(htmlSuccesEventCallback) ) {
                eval(htmlSuccesEventCallback)
            } else {
                $form.on('success',  window[htmlSuccesEventCallback])
            }
        }

        //data-on-submit-error
        var htmlErrorEventCallback =  $form.getAttribute('data-on-submit-error') || null;
        if (htmlErrorEventCallback != null) {
            if ( /\((.*)\)/.test(htmlErrorEventCallback) ) {
                eval(htmlErrorEventCallback)
            } else {
                $form.on('error', window[htmlErrorEventCallback])
            }
        }
    }


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

    var proto = {
        'on'                : on,
        'getFormById'       : getFormById,
        'resetErrorsDisplay': resetErrorsDisplay,
        'rules'             : self.rules,
        'setOptions'        : setOptions,
        'validateFormById'  : validateFormById,
        'handleErrorsDisplay': handleErrorsDisplay
    };

    var formProto = {
        'destroy'   : destroy,
        'on'        : on,
        'send'      : send,
        'submit'    : submit
    };

    /**
     * Backend init
     *
     * @param {object} rules
     * @param {object} [customRule]
     * */
    var backendInit = function (rules, data, formId) {
        // parsing rules
        if ( typeof(rules) != 'undefined' ) {
            parseRules(rules, '');
            checkForRulesImports(rules);
        }

        var $form = ( typeof(formId) != 'undefined' ) ? { 'id': formId } : null;
        var fields = {};

        for (var field in data) {
            fields[field] = data[field]
        }

        return validate($form, fields, null, self.rules)
    }

    var init = function (rules) {

        // parsing rules
        if ( typeof(rules) != 'undefined' ) {
            parseRules(rules, '');
            checkForRulesImports(rules);
        }

        var id          = null
            , i         = 0
            , $forms    = []
            , $allForms = document.getElementsByTagName('form');


        // has rule ?
        for (var f=0, len = $allForms.length; f<len; ++f) {
            // preparing prototype (need at least an ID for this)

            $allForms[f]['id'] = ($allForms[f].getAttribute) ? $allForms[f].getAttribute('id') : null;
            if ( typeof($allForms[f].id) != 'undefined' && $allForms[f].id != 'null' && $allForms[f].id != '') {

                self.$forms[$allForms[f].id] = merge({}, formProto);
                self.$forms[$allForms[f].id]['id'] = $allForms[f].id;
                self.$forms[$allForms[f].id]['target'] = $allForms[f];

                var customRule = $allForms[f].getAttribute('data-gina-validator-rule');

                if (customRule) {
                    customRule = customRule.replace(/\-/g, '.');
                    if ( typeof(self.rules[customRule]) == 'undefined' ) {
                        throw new Error('['+$allForms[f].id+'] no rule found with key: `'+customRule+'`');
                        customRule = null
                    } else {
                        customRule = self.rules[customRule]
                    }
                }

                // finding forms handled by rules
                if ( typeof($allForms[f].id) == 'string' && typeof(self.rules[$allForms[f].id.replace(/\-/g, '.')]) != 'undefined' ) {

                    if (customRule) {
                        bindForm($allForms[f], customRule)
                    } else {
                        bindForm($allForms[f])
                    }

                    ++i
                } else {
                    // weird exception when having in the form an element with name="id"
                    if ( typeof($allForms[f].id) == 'object' ) {
                        delete self.$forms[$allForms[f].id];

                        var _id = $allForms[f].attributes.getNamedItem('id').nodeValue || 'form.'+uuid.v1();

                        $allForms[f].setAttribute('id', _id);
                        $allForms[f]['id'] = _id;

                        self.$forms[_id] = merge({}, formProto);
                        self.$forms[_id]['target'] = $allForms[f];
                        self.$forms[_id]['id'] = _id;

                        if (customRule) {
                            bindForm($allForms[f], customRule)
                        } else {
                            bindForm($allForms[f])
                        }
                    } else {

                        if (customRule) {
                            bindForm($allForms[f], customRule)
                        } else {
                            bindForm($allForms[f])
                        }
                    }
                }
            }

        }

        //console.log('selected forms ', self.$forms);
        proto['$forms'] = self.$forms;

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

        // trigger validator ready event
        triggerEvent(gina, $validator, 'ready.' + $validator.id, proto);
    }

    var parseRules = function(rules, tmp) {

        for (var r in rules) {

            if ( typeof(rules[r]) == 'object' && typeof(self.rules[tmp + r]) == 'undefined' ) {
                self.rules[tmp + r] = rules[r];
                parseRules(rules[r], tmp + r+'.');
            }
        }
    }

    var checkForRulesImports = function (rules) {
        // check if rules has imports & replace
        var rulesStr = JSON.stringify(rules, null, 4);
        var importedRules = rulesStr.match(/(\"@import\s+[a-z A-Z 0-9/.]+\")/g);
        if (importedRules.length > 0) {
            var ruleArr = [], rule = {}, tmpRule = null;
            for (var r = 0, len = importedRules.length; r<len; ++r) {
                ruleArr = importedRules[r].replace(/(@import\s+|\"|\')/g, '').split(/\s/g);
                // [""@import client/form", ""@import project26/edit demo/edit"]
                //console.log('ruleArr -> ', ruleArr, importedRules[r]);
                for (var i = 0, iLen = ruleArr.length; i<iLen; ++i) {
                    tmpRule = ruleArr[i].replace(/\//g, '.');
                    //console.log('-> ', ruleArr[i], self.rules[ ruleArr[i] ], self.rules);
                    if ( typeof(self.rules[ tmpRule ]) != 'undefined' ) {
                        rule = merge(rule, self.rules[ tmpRule ])
                    } else {
                        console.warn('[formValidator:rules] <@import error> on `'+importedRules[r]+'`: rule `'+ruleArr[i]+'` not found. Ignoring.')
                    }
                }
                //console.log('replacing ', importedRules[r]);
                rulesStr = rulesStr.replace(importedRules[r], JSON.stringify(rule));
                //console.log('str ', rulesStr);
                rule = {}

            }
            self.rules = {}, rules = JSON.parse(rulesStr);
            parseRules(rules, '');

            if (isGFFCtx) {
                proto.rules = self.rules
            } else {
                backendProto.rules = self.rules
            }

            //self.rules = JSON.parse(rulesStr);
            //console.log('->\n'+ JSON.stringify(rules.project.edit, null, 4));
        }
    }

    var bindForm = function($form, customRule) {
        var _id = $form.getAttribute('id');
        if ( typeof(_id) != 'string' ) {
            try {
                _id = $form.getAttribute('id') || 'form.'+uuid.v1();
                $form.setAttribute('id', _id);
                $form.id = _id; // won't override :( ...
            } catch(err) {
                throw new Error('Validator::bindForm($form, customRule) could not bind form `'+ $form +'`\n'+err.stack )
            }
        }

        if ( typeof(self.$forms[_id]) == 'undefined'){
            self.$forms[_id] = $form;
        }

        if ( typeof(self.$forms[_id]) != 'undefined' && self.$forms[_id]['binded']) {
            return false
        }

        var withRules = false, rule = null, evt = '', procced = null;

        if ( typeof(customRule) != 'undefined' || typeof(_id) == 'string' && typeof(self.rules[_id.replace(/\-/g, '.')]) != 'undefined' ) {
            withRules = true;

            if ( customRule && typeof(customRule) == 'object' ) {
                rule = customRule
            } else if ( customRule && typeof(customRule) == 'string' && typeof(self.rules[customRule.replace(/\-/g, '.')]) != 'undefined') {
                rule = self.rules[customRule.replace(/\-/g, '.')]
            } else {
                rule = self.rules[_id.replace(/\-/g, '.')]
            }
        }

        // binding input: checkbox, radio
        var $inputs = $form.getElementsByTagName('input'), type = null, id = null;

        var updateCheckBox = function($el) {

            var checked = $el.checked;

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

                //console.log('name -> ', $el.name, $el.value);
            }
        }

        evt = 'click';

        procced = function () {
            // click proxy
            addListener(gina, $form, 'click', function(event) {

                // var isBinded = false, id = event.target.getAttribute('id');//self.events[event] = this.id;
                // if ( typeof(self.events['click.'+id]) != 'undefined' && self.events['click.'+id] == id ) {
                //     isBinded = true
                // }
                //
                // if (isBinded) cancelEvent(event);

                if ( typeof(event.target.id) == 'undefined' ) {
                    event.target.setAttribute('id', 'click.' + uuid.v1() );
                    event.target.id = event.target.getAttribute('id')
                }


                if (/^click\./.test(event.target.id) || withRules) {


                    var _evt = event.target.id;
                    if ( ! /^click\./.test(_evt)  ) {
                        _evt = 'click.' + event.target.id
                    }

                    triggerEvent(gina, event.target, _evt, event.detail)

                }




            })
        }

        if ( typeof(self.events[evt]) != 'undefined' && self.events[evt] == _id ) {
            //removeListener(gina, element, name, callback)
            removeListener(gina, $form, evt, procced)
        } else {
            procced()
        }

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

                if ( typeof(self.events[evt]) != 'undefined' && self.events[evt] == $inputs[i].id ) {
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

                if ( typeof(self.events[evt]) != 'undefined' && self.events[evt] == $inputs[i].id ) {
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
                self.events[evt] = _id;
                //console.log('attaching ', evt);

                // attach form event
                addListener(gina, $form, evt, function(event) {
                    cancelEvent(event);

                    var result = event['detail'] || self.eventData.validation;
                    //console.log('$form[ '+_id+' ] validation done !!!\n isValid ? ', result['isValid'](), '\nErrors -> ', result['errors'], '\nData -> ', result['data']);

                    handleErrorsDisplay(event['target'], result['errors']);

                    if ( result['isValid']() ) { // send if valid
                        // now sending to server
                        formProto['target'] = event['target'];
                        formProto['id']     = event['target'].getAttribute('id');

                        self.$forms[event.target.id] = formProto;
                        //console.log('sending ... ', result['data']);
                        //console.log('just before sending ', self.$forms[event.target.id]);
                        self.$forms[event.target.id].send(result['data']);

                    }

                });
            }

            if ( typeof(self.events[evt]) != 'undefined' && self.events[evt] == _id ) {
                //removeListener(gina, element, name, callback)
                removeListener(gina, $form, evt, procced)
            } else {
                procced()
            }

            // if ( typeof(self.events[evt]) == 'undefined' || self.events[evt] != _id ) {
            //     self.events[evt] = _id;
            //     procced(evt, $form)
            // }



            // binding submit button
            var $submit = null, $buttons = [], $buttonsTMP = [], buttonId = null;
            $buttonsTMP = $form.getElementsByTagName('button');
            if ( $buttonsTMP.length > 0 ) {
                for(var b = 0, len = $buttonsTMP.length; b < len; ++b) {
                    if ($buttonsTMP[b].type == 'submit')
                        $buttons.push($buttonsTMP[b])
                }
            }

            $buttonsTMP = $form.getElementsByTagName('a');
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

                procced = function (evt, $submit) {
                    // attach submit events
                    addListener(gina, $submit, evt, function(event) {
                        //console.log('submiting ', evt, $submit);
                        // start validation
                        cancelEvent(event);
                        // getting fields & values
                        var $fields     = {}
                            , fields    = { '_length': 0 }
                            , name      = null
                            , value     = 0
                            , type      = null;

                        for (var i = 0, len = $form.length; i<len; ++i) {
                            name = $form[i].getAttribute('name');
                            if (!name) continue;

                            // TODO - add switch cases against tagName (checkbox/radio)

                            if ( typeof($form[i].type) != 'undefined' && $form[i].type == 'radio' ) {
                                //console.log('radio ', name, $form[i].checked, $form[i].value);
                                if ( $form[i].checked == true ) {
                                    fields[name] = $form[i].value;
                                }


                            } else {
                                fields[name]    = $form[i].value;
                            }
                            $fields[name]   = $form[i];
                            // reset filed error data attributes
                            $fields[name].setAttribute('data-errors', '');

                            ++fields['_length']
                        }

                        //console.log('$fields =>\n' + $fields);

                        if ( fields['_length'] == 0 ) { // nothing to validate
                            delete fields['_length'];
                            var result = {
                                'errors'    : [],
                                'isValid'   : function() { return true },
                                'data'      : fields
                            };

                            triggerEvent(gina, $form, 'validate.' + _id, result)

                        } else {
                            //console.log('testing rule [ '+_id.replace(/\-/g, '.') +' ]\n'+ JSON.stringify(rule, null, 4));
                            //console.log('validating ', $form, fields, rule);
                            validate($form, fields, $fields, rule, function onValidation(result){
                                //console.log('validation result ', 'validate.' + _id, JSON.stringify(result.data, null, 2));
                                //console.log('events ', 'validate.' + _id, self.events )
                                triggerEvent(gina, $form, 'validate.' + _id, result)
                            })
                        }

                    });
                }


                if ( typeof(self.events[evt]) == 'undefined' || self.events[evt] != $submit.id ) {
                    self.events[evt] = $submit.id;
                    procced(evt, $submit)
                }

            }
        }



        evt = 'submit';

        if ( typeof(self.events[evt]) != 'undefined' && self.events[evt] == _id ) {
            removeListener(gina, $form, evt)
        }

        //console.log('adding submit event ', evt, _id, self.events);
        // submit proxy
        addListener(gina, $form, evt, function(e) {

            //console.log('adding submit event ', evt, self.events['submit.'+_id]);
            var isBinded = false, id = e.target.getAttribute('id');//self.events[event] = this.id;
            if ( typeof(self.events['submit.'+id]) != 'undefined' && self.events['submit.'+id] == id ) {
                isBinded = true
            }

            if (withRules || isBinded) cancelEvent(e);

            var _id     = e.target.getAttribute('id');

            // just collect data for over forms
            // getting fields & values
            var $fields     = {}
                , fields    = { '_length': 0 }
                , name      = null
                , value     = 0
                , type      = null;

            for (var i = 0, len = $form.length; i<len; ++i) {
                name = $form[i].getAttribute('name');
                if (!name) continue;

                // TODO - add switch cases against tagName (checkbox/radio)

                if ( typeof($form[i].type) != 'undefined' && $form[i].type == 'radio' ) {
                    //console.log('name : ', name, '\ntype ', $form[i].type, '\nchecked ? ', $form[i].checked, '\nvalue', $form[i].value);
                    if ( $form[i].checked === true ) {
                        $form[i].setAttribute('checked', 'checked');
                        fields[name] = $form[i].value;
                    }
                } else {
                    fields[name]    = $form[i].value;
                }

                $fields[name]   = $form[i];

                ++fields['_length']
            }

            if ( fields['_length'] > 0 ) { // nothing to validate
                delete fields['_length'];
                self.eventData.submit = {
                    'data': fields,
                    '$fields': $fields
                }
            }

            var result = e['detail'] || self.eventData.submit;

            triggerEvent(gina, $form, 'submit.' + _id, result)
        });


        self.$forms[_id]['rule']   = rules[_id] || {};
        self.$forms[_id]['binded']  = true;
    }

    var validate = function($form, fields, $fields, rules, cb) {
        delete fields['_length']; //cleaning

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
                            if ($fields[field].value == "true")
                                caseValue = true;
                            else if ($fields[field].value == "false")
                                caseValue = false;
                        }

                        //console.log(caseValue +' VS '+ conditions[c]['case'], "->", (caseValue == conditions[c]['case'] || Array.isArray(conditions[c]['case']) && conditions[c]['case'].indexOf(caseValue) > -1) );
                        if ( conditions[c]['case'] === caseValue || Array.isArray(conditions[c]['case']) && conditions[c]['case'].indexOf(caseValue) > -1 ) {

                            //console.log('[fields ] ' + JSON.stringify(fields, null, 4));
                            localRules = {};

                            for (var f in conditions[c]['rules']) {
                                //console.log('F: ', f, '\nrule: '+ JSON.stringify(conditions[c]['rules'][f], null, 2));
                                if ( /^\//.test(f) ) { // RegExp found

                                    re      = f.match(/\/(.*)\//).pop();
                                    flags   = f.replace('/'+ re +'/', '');
                                    re      = new RegExp(re, flags);

                                    for (var localFiled in $fields) {
                                        if ( re.test(localFiled) ) {
                                            localRules[localFiled] = conditions[c]['rules'][f]
                                        }
                                    }

                                } else {
                                    localRules[f] = conditions[c]['rules'][f]
                                }
                            }
                            //console.log('parsing ', localRules, fields);

                            return forEachField($form, fields, $fields, localRules, cb, i+1)
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

        return forEachField($form, fields, $fields, rules, cb, 0)
    }

    if (isGFFCtx) {
        return proto
    } else {
        return backendInit(rules, data, formId)
    }

};

if ( ( typeof(module) !== 'undefined' ) && module.exports ) {
    // Publish as node.js module
    module.exports  = Validator
} else if ( typeof(define) === 'function' && define.amd) {
    // Publish as AMD module
    define('gina/validator', function() { return Validator })
}