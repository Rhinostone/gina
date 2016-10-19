define('gina/popin', [ 'require', 'jquery', 'vendor/uuid','utils/merge', 'utils/collection' ], function (require) {

    var uuid = require('vendor/uuid');

    /**
     * Gina Popin Handler
     * */
    function Popin(options) {

        var $ = require('jquery');

        //console.log('jquery ', $.fn.jquery);

        var popinInstance   = { 'id': uuid.v1() };
        var $popin          = null; // is on main `gina-popins` container (first level)

        var self = {
            'options' : {
                'name' : undefined,
                'class': 'gina-popin-default'
            },
            events: {},
            eventData: {}
        };


        // XML Request
        var xhr = null;

        var registeredPopins = [];

        var events = ['loaded', 'ready', 'open', 'close', 'destroy', 'success', 'error', 'progress'];

        var on = function(event, cb) {

            if ( events.indexOf(event) < 0 ) {
                cb(new Error('Event `'+ event +'` not handled by ginaPopinEventHandler'))
            } else {


                var $target = this;
                var id = $target.id;

                event += '.' + id;

                var procced = function () {
                    //register event
                    self.events[event] = $target.id;
                    self.currentTarget = $target;

                    // bind
                    addListener(instance, $popin, event, function(e) {
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

                        cb(e, data)

                    })
                }


                if ( typeof(self.events[event]) != 'undefined' && self.events[event] == id ) {
                    // unbind existing
                    removeListener(instance, $popin, event, procced)
                } else {
                    procced()
                }

            }

            return this
        };

        var proto = {
            'on'            : on,
            'popin'         : undefined,
            'load'          : popinLoad,
            'loadContent'   : popinLoadContent,
            'open'          : popinOpen,
            'isOpen'        : popinIsOpen,
            'close'         : popinClose
        };

        var init = function(options) {


            if ( typeof(options) != 'object' ) {
                throw new Error('`options` must be an object')
            }

            self.options    = merge(options, self.options);

            if ( typeof(self.options['name']) != 'string' || self.options['name'] == '' ) {
                throw new Error('`options.name` can not be left `empty` or `undefined`')
            }

            if ( registeredPopins.indexOf(self.options['name']) > -1 ) {
                throw new Error('`popin '+self.options['name']+'` already exists !')
            }

            self.options['class'] = 'gina-popin-container ' + self.options['class'];

            var popinName  = self.options['name'];

            popinInstance['popin'] = popinName;
            popinInstance = merge(popinInstance, proto);

            if ( !instance.hasPopinHandler ) {
                popinCreateContainer();
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

            // binding `open` triggers
            bindOpen()
        }

        /**
         * popinCreateContainer
         *
         * Creates HTML container and add it to the DOM
         *
         *
         * */
        var popinCreateContainer = function() {

            // creating template
            // <div class="gina-popins">
            //     <div class="gina-popins-overlay gina-popin-is-active"></div>
            // </div>
            var $container = document.createElement('div');
            var id = 'gina-popins-'+ uuid.v1();
            $container.setAttribute('id', id);
            $container.setAttribute('class', 'gina-popins');

            self.$target = $popin = $container;
            self.id = id;

            var $overlay = document.createElement('div');
            $overlay.setAttribute('id', 'gina-popins-overlay');
            $overlay.setAttribute('class', 'gina-popins-overlay');


            $container.appendChild( $overlay );

            // adding to DOM
            document.body.appendChild($container);

            instance.hasPopinHandler = true;
        }

        var bindOpen = function() {
            var attr    = 'data-gina-popin-name';
            var $els    = getElementsByAttribute(attr);
            var $el     = null, name = null;
            var url     = null;
            var procced = null, evt = null;


            for (var i = 0, len = $els.length; i < len; ++i) {
                $el     = $els[i];
                name    = $el.getAttribute(attr);
                if ( $el.tagName == 'A' ) {
                    url = $el.getAttribute('href');
                    if (url == '' || url =='#' || /\#/.test(url) ) {
                        url = null
                    }
                }

                if ( !url && typeof( $el.getAttribute('data-gina-popin-url') ) != 'undefined') {
                    url = $el.getAttribute('data-gina-popin-url');

                }

                if (!url) {
                    throw new Error('Found `data-gina-popin-name` without `url` !')
                }

                if ( !$el['url'] ) {
                    $el['url'] = url;
                }

                if ( !$el['popinName'] ) {
                    $el['popinName'] = name;
                }

                if ( !$el['id'] ) {
                    evt = 'popin.click.'+ uuid.v1();
                    $el['id'] = evt;
                    $el.setAttribute( 'id', evt);
                } else {
                    evt = 'popin.click.'+ $el['id'];
                }

                procced = function () {
                    // attach submit events
                    addListener(instance, $el, evt, function(e) {
                        cancelEvent(e);
                        // loading & binding popin
                        popinLoad(e.target.popinName, e.target.url);
                        popinOpen(e.target.popinName);
                    });
                }


                if ( typeof(self.events[evt]) != 'undefined' && self.events[evt] == $el.id ) {
                    removeListener(instance, $el, evt, procced)
                } else {
                    procced()
                }

            }

            // proxies
            // click on main document
            evt = 'click';
            procced = function () {
                // click proxy
                addListener(instance, document, evt, function(event) {

                    if ( typeof(event.target.id) == 'undefined' ) {
                        event.target.setAttribute('id', evt+'.' + uuid.v1() );
                        event.target.id = event.target.getAttribute('id')
                    }


                    if ( /^popin\.click\./.test(event.target.id) ) {
                        cancelEvent(event);
                        //console.log('popin.click !!');
                        var _evt = event.target.id;
                        if ( ! /^popin\.click\./.test(_evt)  ) {
                            _evt = 'popin.click.' + event.target.id
                        }

                        triggerEvent(instance, event.target, _evt, event.detail)
                    }


                })
            }

            if ( typeof(self.events[evt]) != 'undefined' && self.events[evt] == $popin.id ) {
                removeListener(instance, document, evt, procced)
            } else {
                procced()
            }

        }



        /**
         * XML Request options
         * */
        var xhrOptions = {
            'url'           : '',
            'method'        : 'GET',
            'isSynchrone'   : false,
            'withCredentials': true, // if should be enabled under a trusted env
            'headers'       : {
                // cross domain is enabled by default, but you need to setup `Access-Control-Allow-Origin`
                'X-Requested-With': 'XMLHttpRequest' // in case of cross domain origin

            }
        };

        /**
         * popinLoad
         *
         * @param {string} name
         * @param {string} url
         * @param {object} [options]
         * */
        function popinLoad(name, url, options) {

            var id          = 'gina-popin-' + name;
            // popin element
            var $el         = document.getElementById(id) || null;

            if ( $el == null ) {

                var className   = self.options.class +' '+ id;
                $el             = document.createElement('div');
                $el.setAttribute('id', id);
                $el.setAttribute('class', className);
                self.$target.firstChild.appendChild($el);
            }


            if ( typeof($el['on']) == 'undefined' )
                $el['on']       = proto['on'];


            if ( typeof(options) != 'undefined' ) {
                var options = merge(options, xhrOptions);
            } else {
                var options = xhrOptions;
            }

            options.url     = url;


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
                    triggerEvent(instance, $el, 'error.' + id, result)
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
                                //console.log('making response ' + JSON.stringify(result, null, 4));

                                triggerEvent(instance, $el, 'loaded.' + id, result)

                            } catch (err) {
                                var result = {
                                    'status':  422,
                                    'error' : err.description
                                };

                                self.eventData.error = result;

                                triggerEvent(instance, $el, 'error.' + id, result)
                            }

                        } else {
                            //console.log('error event triggered ', event.target, $form);
                            var result = {
                                'status':  xhr.status,
                                'error' : xhr.responseText
                            };

                            self.eventData.error = result;

                            triggerEvent(instance, $el, 'error.' + id, result)
                        }
                    }
                };

                // catching request progress
                // xhr.onprogress = function(event) {
                //     //console.log(
                //     //    'progress position '+ event.position,
                //     //    '\nprogress total size '+ event.totalSize
                //     //);
                //
                //     var percentComplete = (event.position / event.totalSize)*100;
                //     var result = {
                //         'status': 100,
                //         'progress': percentComplete
                //     };
                //
                //     self.eventData.onprogress = result;
                //
                //     triggerEvent(instance, $el, 'progress.' + id, result)
                // };

                // catching timeout
                // xhr.ontimeout = function (event) {
                //     var result = {
                //         'status': 408,
                //         'error': 'Request Timeout'
                //     };
                //
                //     self.eventData.ontimeout = result;
                //
                //     triggerEvent(instance, $el, 'error.' + id, result)
                // };


                // sending
                xhr.send();

                return {
                    'open': function () {
                        popinOpen(name)
                    }
                }
            }

        }

        function popinLoadContent() {

        }

        /**
         * popinOpen
         *
         * Opens a popin by name
         *
         * @parama {string} name
         *
         * */
        function popinOpen(name) {

            // bind overlay on click
            var $overlay = $popin.childNodes[0];

            addListener(instance, $overlay, 'click', function(event) {

                // don't cancel here, it will corrupt child elements behaviors such as checkboxes and radio buttons

                if ( /gina-popin-is-active/.test(event.target.className) ) {
                    popinClose(name);
                    removeListener(instance, event.target, 'click')
                }
            });


            var id = null, $el = null;
            if ( typeof(name) == 'string' && name != '' ) {
                id = 'gina-popin-' + name;
            } else {
                id = 'gina-popin-' + this.popin;
            }

            $el = document.getElementById(id);

            $el.on('loaded', function(e, content){
                e.preventDefault();

                e.target.innerHTML = content;


                // bind with formValidator if forms are found
                if ( /<form/i.test(e.target.innerHTML) && typeof(ginaFormValidator) != 'undefined' ) {
                    var _id = null;
                    self['$forms'] = [];
                    var $forms = e.target.getElementsByTagName('form');
                    for (var i = 0, len = $forms.length; i < len; ++i) {

                        if ( !$forms[i]['id'] || typeof($forms[i]) != 'string' ) {
                            _id = $forms[i].getAttribute('id') || 'form.' + uuid.v1();
                            $forms[i].setAttribute('id', _id);// just in case
                            $forms[i]['id'] = _id
                        } else {
                            _id = $forms[i]['id']
                        }

                        //console.log('pushing ', _id, $forms[i]['id'], typeof($forms[i]['id']), $forms[i].getAttribute('id'));
                        self['$forms'].push(_id);

                        ginaFormValidator.validateFormById($forms[i]['id'])
                    }
                }

                if ( !/gina-popin-is-active/.test(e.target.className) )
                    e.target.className += ' gina-popin-is-active';

                if ( !/gina-popin-is-active/.test(self.$target.firstChild.className) )
                    self.$target.firstChild.className += ' gina-popin-is-active';



                // so it can be forwarded to the handler who is listening
                triggerEvent(instance, $popin, 'ready.'+ popinInstance.id, null);

                popinInstance.target = self.$target;
                // trigger gina `popinReady` event
                triggerEvent(instance, $gina, 'popinReady', popinInstance);
            })
        }

        function popinIsOpen(name) {

        }

        /**
         * popinClose
         *
         * Closes a popin by `name` or all `is-active`
         *
         * @parama {string} [name]
         *
         * */
        function popinClose(name) {
            var id = null, $el = null;
            if ( typeof(name) == 'string' && name != '' ) {
                id = 'gina-popin-' + name;
            } else {
                id = 'gina-popin-' + this.popin;
            }

            $el = document.getElementById(id) || null;

            if ( $el != null && /gina-popin-is-active/.test($el.className) ) {
                self.$target.firstChild.className  = self.$target.firstChild.className.replace(/\sgina-popin-is-active|gina-popin-is-active|gina-popin-is-active\s/, '');
                $el.className           = $el.className.replace(/\sgina-popin-is-active|gina-popin-is-active|gina-popin-is-active\s/, '');
                $el.innerHTML = '';

                // removing from FormValidator instance
                var i = 0, formsLength = self['$forms'].length;
                if (self['$forms'] && self['$forms'].length > 0) {
                    for (; i < formsLength; ++i) {
                        ginaFormValidator['$forms'][ self['$forms'][i] ].destroy()
                    }
                }

                triggerEvent(instance, $el, 'close.' + id);
            }
        }

        /**
         * popinDestroy
         *
         * Destroyes a popin by name
         *
         * @parama {string} name
         *
         * */
        function popinDestroy(name) {
            var id = 'gina-popin-' + name;
        }

        init(options);

        return popinInstance
    };

    return Popin
})