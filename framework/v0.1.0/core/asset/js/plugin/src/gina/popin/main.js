define('gina/popin', [ 'require', 'jquery', 'vendor/uuid','utils/merge', 'utils/events' ], function (require) {

    var $       = require('jquery');
    $.noConflict();
    var uuid    = require('vendor/uuid');
    var merge   = require('utils/merge');

    require('utils/events'); // events

    /**
     * Gina Popin Handler
     *
     * @param {object} options
     * */
    function Popin(options) {

        this.plugin = 'popin';

        var events  = ['loaded', 'ready', 'open', 'close', 'destroy', 'success', 'error', 'progress'];
        registerEvents(this.plugin, events);

        var self = { // local use only
            'options' : {
                'name' : undefined,
                'class': 'gina-popin-default'
            },
            authorizedEvents : ['ready', 'error'],
            events: {}
        };

        var instance        = {
            plugin          : this.plugin,
            id              : 'gina-popins-' + uuid.v4(),
            on              : on,
            eventData       : {},

            '$popins'       : {},
            activePopinId   : null, 
            getActivePopin  : null, // returns the active $popin
            target          : document, // by default
            isReady         : false,
            initialized     : false
        };

        // popin proto
        var $popin          = { // is on main `gina-popins` container (first level)
            'plugin'            : this.plugin,
            'on'                : on,
            'eventData'         : {},
            'target'            : document, // by default

            'name'              : null,
            'load'              : null,
            'loadContent'       : null,
            'open'              : null,
            'isOpen'            : false,
            'isRedirecting'     : false,
            'close'             : null,
            '$forms'            : [],
            'hasForm'           : false,
            '$headers'             : [] // head elements for this popin
        };

        // imopring other plugins
        var $validatorInstance   = null; // validator instance


        // XML Request
        var xhr = null;

        var registeredPopins = [];


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
            $container.id = instance.id;
            $container.setAttribute('id', instance.id);
            $container.setAttribute('class', 'gina-popins');

            var $overlay = document.createElement('div');
            $overlay.setAttribute('id', 'gina-popins-overlay');
            $overlay.setAttribute('class', 'gina-popins-overlay');


            $container.appendChild( $overlay );

            // adding to DOM
            document.body.appendChild($container);

            instance.target     = $container;
            instance.on         = on;

            gina.popinContainer  = instance.id;
            //gina.hasPopinHandler = true;
        }
        
        var popinGetContainer = function () {
            instance.target     = document.getElementById(gina.popinContainer);
            instance.on         = on;
        }

        var proxyClick = function($childNode, $el, evt) {

            addListener(gina, $childNode, 'click', function(e) {
                cancelEvent(e);

                triggerEvent(gina, $el, evt);
            });
        }
        
        var getPopinById = function(id) {            
            return ( typeof(instance.$popins[id]) != 'undefined' ) ? instance.$popins[id] : null;
        }
        
        var getPopinByName = function(name) {
            
            var $popin = null;
            
            for (var p in instance.$popins) {
                if ( instance.$popins[p].name === name ) {
                    $popin = instance.$popins[p];
                    break;
                }
            }
            
            return $popin;
        }  
         
        function getActivePopin() {            
            var $popin = null;
            
            for (var p in gina.popin.$popins) {
                if ( typeof(gina.popin.$popins[p].isOpen) != 'undefined' && gina.popin.$popins[p].isOpen ) {
                    $popin = gina.popin.$popins[p];
                    break;
                }
            }
            
            return $popin;
        }     
        

        var bindOpen = function($popin, isRouting) {
            
            isRouting = ( typeof(isRouting) != 'undefined' ) ? isRouting : false;
            
            var attr    = 'data-gina-popin-name';
            var $els    = getElementsByAttribute(attr);
            var $el     = null, name = null;
            var url     = null;            
            var proceed = null, evt = null;
            var i = null, len = null;

            i = 0; len = $els.length;
            for (;i < len; ++i) {
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

                if (name == $popin.name) {
                    evt = 'popin.click.'+ 'gina-popin-' + instance.id +'-'+ uuid.v4() +'-'+ name;
                    $el['id'] = evt;
                    $el.setAttribute( 'id', evt);

                    
                    if (!gina.events[evt]) {
                    
                        // attach click events
                        addListener(gina, $el, evt, function(e) {
                            cancelEvent(e);

                            var fired = false;
                            $popin.on('loaded', function (e) {
                                e.preventDefault();

                                if (!fired) {
                                    fired = true;
                                    
                                    popinBind(e, $popin);
                                    if (!$popin.isOpen) {                                        
                                        popinOpen($popin.name);
                                    }                                        
                                }
                            });

                            // loading & binding popin       
                            // Non-Preflighted requests
                            var options = {                            
                                isSynchrone: false,
                                withCredentials: false // by default
                            };                       
                            options = merge($popin.options, options);    
                            var url = this.getAttribute('data-gina-popin-url') || this.getAttribute('href');
                            if (!url) {
                                throw new Error('Popin `url` not defined, please check value for `data-gina-popin-url`');
                            }
                            popinLoad($popin.name, url, options);
                        });



                        // bind child elements
                        var childNodes = $el.childNodes;
                        var l = 0; lLen = childNodes.length;
                        if (lLen > 0) {
                            for(; l < lLen; ++l) {
                                if (typeof (childNodes[l].tagName) != 'undefined') {
                                    proxyClick(childNodes[l], $el, evt)
                                }
                            }
                        }
                    }
                }

            }

            // proxies
            // click on main document
            evt = 'click';// click proxy
            // for proxies, use popinInstance.id as target is always `document`
            addListener(gina, document, evt, function(event) {
                
                if ( event.target.getAttribute('disabled') != null && event.target.getAttribute('disabled') != 'false' ) {
                    return false;
                }

                if ( typeof(event.target.id) == 'undefined' ) {
                    event.target.setAttribute('id', evt +'.'+ uuid.v4() );
                    event.target.id = event.target.getAttribute('id')
                }

                if ( /^popin\.close\./.test(event.target.id) ) {
                    cancelEvent(event);

                    var _evt = event.target.id;
                    triggerEvent(gina, event.target, _evt, event.detail);
                }

                if ( /^popin\.click\./.test(event.target.id) ) {
                    cancelEvent(event);
                    //console.log('popin.click !! ', event.target);
                    var _evt = event.target.id;                    

                    if ( new RegExp( '^popin.click.gina-popin-' + instance.id).test(_evt) )
                        triggerEvent(gina, event.target, _evt, event.detail);

                }
            });

            gina.popinIsBinded = false
        }
        
        
        function popinBind(e, $popin) {
            
            var $el = e.target;
            var eventType = e.type;
                        
            if ( typeof(e.detail) != 'undefined' )
                $el.innerHTML = e.detail.trim();
            
            var register = function (type, evt, $element) {
                // attach submit events
                addListener(gina, $element, evt, function(event) {

                    cancelEvent(event);
                    
                    if (type != 'close') {
                        
                        var fired = false;
                        var _evt = 'loaded.' + $popin.id;
                        
                        if ( typeof(gina.events[_evt]) == 'undefined' ) {
                            addListener(gina, $el, _evt, function(e) {
                            
                                e.preventDefault();

                                if (!fired) {
                                    fired = true;                                                                     
                                    popinLoadContent(e.detail);   
                                }
                            });
                        }
                        
                        // Non-Preflighted requests
                        var options = {                            
                            isSynchrone: false,
                            withCredentials: false
                        };
                        //options = merge(options, $popin.options);                        
                        options = merge($popin.options, options);   
                        popinLoad($popin.name, $element.href, options);
                    }            
                            
                    removeListener(gina, event.target, event.type)
                });
                
                addListener(gina, $element, 'click', function(event) {
                    cancelEvent(event);
                    
                    if ( event.target.getAttribute('disabled') != null && event.target.getAttribute('disabled') != 'false' ) {
                        return false;
                    }
                    
                    if ( type == 'link' ) {
                        
                        if ( event.target.getAttribute('target') != null && event.target.getAttribute('target') != '' ) {
                            window.open(event.target.getAttribute('href'), event.target.getAttribute('target'));
                        } else { // else, inside viewbox
                            // TODO - Integrate https://github.com/box/viewer.js#loading-a-simple-viewer
                            
                            triggerEvent(gina, event.target, event.currentTarget.id, $popin);
                        }
                        
                    } else { // close
                        
                        if ( typeof(event.target.id) == 'undefined' ) {
                            event.target.setAttribute('id', evt +'.'+ uuid.v4() );
                            event.target.id = event.target.getAttribute('id')
                        }
        
                        if ( /^popin\.close\./.test(event.target.id) ) {
                            cancelEvent(event);
        
                            popinClose($popin.name);
                        }
        
                        if ( /^popin\.click\./.test(event.target.id) ) {
                            cancelEvent(event);
                            //console.log('popin.click !! ', event.target);
                            var _evt = event.target.id;
        
                            if ( new RegExp( '^popin.click.gina-popin-' + instance.id).test(_evt) )
                                triggerEvent(gina, event.target, _evt, event.detail);
        
                        }
                    }
                    
                });
                    
            };
            
            gina.popinIsBinded = true;
            
            var i       = null
                , b     = null
                , len   = null
            ;
            // bind overlay on click
            if (!$popin.isOpen) {                         
                     
                var $overlay = instance.target.childNodes[0];
                addListener(gina, $overlay, 'click', function(event) {

                    // don't cancel here, it will corrupt child elements behaviors such as checkboxes and radio buttons
                    if ( /gina-popin-is-active/.test(event.target.className) ) {

                        // remove listeners
                        removeListener(gina, event.target, 'click');
        
                        // binding popin close
                        var $close          = []
                            , $buttonsTMP   = []                            
                        ;
                        
                        i = 0;        
                        $buttonsTMP = $el.getElementsByTagName('button');
                        b = 0; len = $buttonsTMP.length;
                        if ( len > 0 ) {
                            for(; b < len; ++b) {
                                if ( /gina-popin-close/.test($buttonsTMP[b].className) ) {
                                    $close[i] = $buttonsTMP[b];
                                    ++i
                                }   
                            }
                        }
        
                        $buttonsTMP = $el.getElementsByTagName('div');
                        b = 0; len = $buttonsTMP.length;
                        if ( len > 0 ) {
                            for(; b < len; ++b) {
                                if ( /gina-popin-close/.test($buttonsTMP[b].className) ) {
                                    $close[i] = $buttonsTMP[b];
                                    ++i
                                }                                    
                            }
                        }
        
                        $buttonsTMP = $el.getElementsByTagName('a');
                        b = 0; len = $buttonsTMP.length;
                        if ( len > 0 ) {
                            for(; b < len; ++b) {
                                if ( /gina-popin-close/.test($buttonsTMP[b].className) ) {
                                    $close[i] = $buttonsTMP[b];
                                    ++i
                                }   
                            }
                        }
        
                        b = 0; len = $close.length;
                        for (; b < len; ++b) {
                            removeListener(gina, $close[b], $close[b].getAttribute('id') )
                        }
        
                        popinClose($popin.name);
                    }
                    
                });
            }

            // bind with formValidator if forms are found
            if ( /<form/i.test($el.innerHTML) && typeof($validatorInstance) != 'undefined' && $validatorInstance ) {
                var _id = null;
                var $forms = $el.getElementsByTagName('form');
                i = 0; len = $forms.length;
                for(; i < len; ++i) {

                    if ( !$forms[i]['id'] || typeof($forms[i]) != 'string' ) {
                        _id = $forms[i].getAttribute('id') || 'form.' + uuid.v4();
                        $forms[i].setAttribute('id', _id);// just in case
                        $forms[i]['id'] = _id
                    } else {
                        _id = $forms[i]['id']
                    }

                    //console.log('pushing ', _id, $forms[i]['id'], typeof($forms[i]['id']), $forms[i].getAttribute('id'));
                    if ($popin['$forms'].indexOf(_id) < 0)
                        $popin['$forms'].push(_id);

                    $forms[i].close = popinClose;
                    $validatorInstance.validateFormById($forms[i].getAttribute('id')); //$forms[i]['id']

                    removeListener(gina, $popin.target, eventType);
                }
                
                $popin.hasForm = true;
            }
            
            // binding popin close & links (& its target attributes)
            var $close          = []
                , $buttonsTMP   = []
                , $link         = []
            ;

            $buttonsTMP = $el.getElementsByTagName('button');
            i = 0; b = 0; len = $buttonsTMP.length;
            if ( $buttonsTMP.length > 0 ) {
                for(; b < len; ++b) {
                    if ( /gina-popin-close/.test($buttonsTMP[b].className) ) {
                        $close[i] = $buttonsTMP[b];
                        ++i
                    }                        
                }
            }

            $buttonsTMP = $el.getElementsByTagName('div');
            b = 0; len = $buttonsTMP.length;
            if ( len > 0 ) {
                for(; b < len; ++b) {
                    if ( /gina-popin-close/.test($buttonsTMP[b].className) ) {
                        $close[i] = $buttonsTMP[b];
                        ++i;
                    }                        
                }
            }

            $buttonsTMP = $el.getElementsByTagName('a');
            b = 0; len = $buttonsTMP.length;
            if ( len > 0 ) {
                for(; b < len; ++b) {
                    if ( /gina-popin-close/.test($buttonsTMP[b].className) ) {
                        $close[i] = $buttonsTMP[b];
                        ++i;
                        continue
                    }
                    
                    if ( 
                        typeof($buttonsTMP[b]) != 'undefined' 
                        && !/(\#|\#.*)$/.test($buttonsTMP[b].href) // ignore href="#"    
                        // ignore href already bindded byr formValidator or the user                    
                        && !$buttonsTMP[b].id
                        ||
                        typeof($buttonsTMP[b]) != 'undefined'
                        && !/(\#|\#.*)$/.test($buttonsTMP[b].href) // ignore href="#"    
                        && !/^(click\.|popin\.link)/.test($buttonsTMP[b].id)
                    ) {
                        $link.push($buttonsTMP[b]);
                        continue
                    }
                }
            }
            
            var onclickAttribute = null, evt = null;
            // close events
            b = 0; len = $close.length;
            for (; b < len; ++b) {
                if ($close[b].tagName == 'A') {
                    onclickAttribute = $close[b].getAttribute('onclick');
                }

                if ( !onclickAttribute ) {
                    $close[b].setAttribute('onclick', 'return false;')
                } else if ( typeof(onclickAttribute) != 'undefined' && !/return false/.test(onclickAttribute) ) {
                    if ( /\;$/.test(onclickAttribute) ) {
                        onclickAttribute += 'return false;'
                    } else {
                        onclickAttribute += '; return false;'
                    }
                }

                if (!$close[b]['id']) {

                    evt = 'popin.close.'+ uuid.v4();
                    $close[b]['id'] = evt;
                    $close[b].setAttribute( 'id', evt);

                } else {
                    evt = $close[b]['id'];
                }               


                if ( typeof(gina.events[evt]) == 'undefined' || gina.events[evt] != $close[b].id ) {
                    register('close', evt, $close[b])
                }
            }
            
            // link events
            i = 0; len = $link.length;
            var _form = null, f = null, fLen = null;
            var inheritedData = {}, _formData = null;
            var domParserObject = new DOMParser(), currentId = null, found = null;
            for(; i < len; ++i) {
                
                if (!$link[i]['id'] || !/^popin\.link/.test($link[i]['id']) ) {
                    evt = 'popin.link.'+ uuid.v4();                    
                    $link[i]['id'] =  $link[i].getAttribute('id') || evt;
                    if ( !/^popin\.link/.test($link[i]['id']) ) {
                        $link[i].setAttribute( 'data-gina-popin-link-id', evt);
                        evt = $link[i]['id'];
                    } else {
                        $link[i].setAttribute( 'id', evt);
                    }
                } else {
                    evt = $link[i]['id'];
                }
                // if is disabled, stop propagation
                if ( $link[i].getAttribute('disabled') != null ) {
                    continue;
                }
                
                if ( !/^(null|\s*)$/.test($link[i].getAttribute('href')) ) {
                    addListener(gina, $link[i], 'click', function(linkEvent) {
                        linkEvent.preventDefault();
                        
                        $popin.isRedirecting = true;
                        if ($popin.hasForm) {
                            // Experimental - inheritedData
                            // Inhertitance from previously request: merging datas with current form context
                            // TODO - Get the inhereted data from LMDB Database using the form CSRF
                            _form = $popin.target.getElementsByTagName('FORM');
                            f = 0; fLen = _form.length;
                            for (; f < fLen; ++f) {
                                // check if current link is in form
                                currentId = linkEvent.currentTarget.id;
                                found = domParserObject.parseFromString(_form.item(f).innerHTML, 'text/html').getElementById(currentId) || false;
                                if ( found ) {
                                    _formData = _form[f].getAttribute('data-gina-form-inherits-data') || null;
                                    // mergin GET data
                                    inheritedData = merge(inheritedData, JSON.parse(decodeURIComponent(_formData)));
                                }
                            }
                            
                            // has already params ?
                            if ( /\?/.test(linkEvent.currentTarget.href) ) {
                                linkEvent.currentTarget.href += '&inheritedData=' + encodeURIComponent(JSON.stringify(inheritedData));
                            } else {
                                linkEvent.currentTarget.href += '?inheritedData=' + encodeURIComponent(JSON.stringify(inheritedData));
                            }
                        }
                            
                    })
                }

                if ( typeof(gina.events[evt]) == 'undefined' || gina.events[evt] != $link[i].id ) {
                    register('link', evt, $link[i])
                }
            }          
            
            
        }
        
        function updateToolbar(result, resultIsObject) {
            // update toolbar errors
            var $popin = getActivePopin();
            
            if ( gina && typeof(window.ginaToolbar) == 'object' && typeof(result) != 'undefined' && typeof(resultIsObject) != 'undefined' && result ) {
                
                var XHRData = result;
                
                try {                    
                    var XHRDataNew = null;
                    if ( !resultIsObject && XHRData.error && /^(\{|\[)/.test(XHRData.error) )
                        XHRData.error = JSON.parse(XHRData.error);
                    
                    // bad .. should not happen
                    if ( typeof(XHRData.error) != 'undefined' && typeof(XHRData.error) == 'object' && typeof(XHRData.error) == 'object' ) {
                        // by default
                        XHRDataNew = { 'status' : XHRData.status };
                        // existing will be overriden by user
                        for (xErr in XHRData.error) {
                            if ( !/^error$/.test(xErr ) ) {
                                XHRDataNew[xErr] = XHRData.error[xErr];
                            }
                        }

                        XHRDataNew.error = XHRData.error.error;

                        XHRData = result = XHRDataNew
                    } else if ( typeof(XHRData.error) != 'undefined' && typeof(XHRData.error) == 'string' ) {
                        XHRData = result;
                    }
                        
                    XHRData.isXHRViewData = true;
                    ginaToolbar.update('data-xhr', XHRData );
                    return;
                } catch (err) {
                    throw err
                }
            }
            
            // update toolbar
            try {
                var $popin = getPopinById(instance.activePopinId);
                var $el = $popin.target;
            } catch (err) {
                ginaToolbar.update('data-xhr', err );
            }
            
            
            // XHRData
            var XHRData = null;            
            if ( typeof(result) == 'string' && /\<(.*)\>/.test(result) ) {
                // converting Element to DOM object
                XHRData = new DOMParser().parseFromString(result, 'text/html').getElementById('gina-without-layout-xhr-data');               
            } else {
                XHRData = document.getElementById('gina-without-layout-xhr-data');
            }
            
            if ( gina && typeof(window.ginaToolbar) == 'object' && XHRData ) {
                try {

                    if ( typeof(XHRData.value) != 'undefined' && XHRData.value ) {
                        XHRData = JSON.parse( decodeURIComponent( XHRData.value ) );
                        // reset data-xhr
                        XHRData.isXHRViewData = true;
                        ginaToolbar.update('data-xhr', XHRData);
                    }

                } catch (err) {
                    throw err
                }
            }

            // XHRView
            var XHRView = null;
            if ( typeof(result) == 'string' && /\<(.*)\>/.test(result) ) {                
                // converting Element to DOM object
                XHRView = new DOMParser().parseFromString(result, 'text/html').getElementById('gina-without-layout-xhr-view');                
            } else {
                XHRView = document.getElementById('gina-without-layout-xhr-view');
            }
            
            if ( gina && typeof(window.ginaToolbar) == 'object' && XHRView ) {
                try {

                    if ( typeof(XHRView.value) != 'undefined' && XHRView.value ) {
                        
                        XHRView = JSON.parse( decodeURIComponent( XHRView.value ) );                        
                        // reset data-xhr
                        //ginaToolbar.update("view-xhr", null);
                        ginaToolbar.update('view-xhr', XHRView);
                    }

                    // popin content
                    ginaToolbar.update('el-xhr', $popin.id);

                } catch (err) {
                    throw err
                }
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
                'X-Requested-With': 'XMLHttpRequest' // to set isXMLRequest == true && in case of cross domain origin

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
            // if no name defiend, get the current
            if ( typeof(name) == 'undefined' ) {
                if ( typeof(this.name) == 'undefined' ) {
                    throw new Error('`$popin.name` needs to be defined !')
                }
                name = this.name;
            }
            // popin object
            var $popin      = getPopinByName(name);
            var id          = $popin.id;
            
            
            // popin element
            var $el         = document.getElementById(id) || null;

            if ( $el == null ) {

                var className   = $popin.options.class +' '+ id;
                $el             = document.createElement('div');
                $el.setAttribute('id', id);
                $el.setAttribute('class', className);
                instance.target.firstChild.appendChild($el);
            }

            if ( typeof(options) == 'undefined' ) {
                options = xhrOptions;
            } else {
                // In order to inherit without overriding default xhrOptions
                var isWithCredentials = xhrOptions.withCredentials;
                options = merge(options, xhrOptions);
                
                options.withCredentials = isWithCredentials;
            }
            
            if ( 
                /^(http|https)\:/.test(url)
                && !new RegExp('^' + window.location.protocol + '//'+ window.location.host).test(url) 
            ) {
                // is request from same domain ?
                //options.headers['Origin']   = window.protocol+'//'+window.location.host;
                //options.headers['Origin']   = '*';
                //options.headers['Host']     = 'https://domain.local:3154';
                var isSameDomain = ( new RegExp(window.location.hostname).test(url) ) ? true : false;
                if (!isSameDomain) {
                    // proxy external urls
                    // TODO - instead of using `cors.io` or similar services, try to intégrate a local CORS proxy similar to : http://oskarhane.com/avoid-cors-with-nginx-proxy_pass/
                    //url = url.match(/^(https|http)\:/)[0] + '//cors.io/?' + url;
                    url = url.match(/^(https|http)\:/)[0] + '//corsacme.herokuapp.com/?'+ url;
                    //url = url.match(/^(https|http)\:/)[0] + '//cors-anywhere.herokuapp.com/' + url;
                    
                    //delete options.headers['X-Requested-With']
                    
                    // remove credentials on untrusted env
                    // if forced by user options, it will be restored with $popin.options merge
                    options.withCredentials = false;
                }
            }
            options.url     = url;
            // updating popin options
            $popin.options  = merge(options, $popin.options);


            if ( options.withCredentials ) { // Preflighted requests               
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
                    triggerEvent(gina, $el, 'error.' + id, result)
                }
            } else { // simple requests
                
                if (options.isSynchrone) {
                    xhr.open(options.method, options.url, options.isSynchrone)
                } else {
                    xhr.open(options.method, options.url)
                }
            }

            

            if (xhr) {
                // setting up headers
                xhr.withCredentials = ( typeof(options.withCredentials) != 'undefined' ) ? options.withCredentials : false;
                                
                xhr.onerror = function(event, err) {
                    
                    var error = 'Transaction error: might be due to the server CORS settings.\nPlease, check the console for more details.';
                    var result = {
                        'status':  xhr.status, //500,
                        'error' : error
                    };                    
                    
                    var resultIsObject = true;
                    instance.eventData.error = result +'/n'+ err;                                
                    updateToolbar(result, resultIsObject);
                    triggerEvent(gina, $el, 'error.' + id, result)
                }
                
                
                for (var header in options.headers) {
                    xhr.setRequestHeader(header, options.headers[header]);
                }
                
                
                // catching ready state cb
                xhr.onreadystatechange = function (event) {
                    if (xhr.readyState == 4) {
                        // 200, 201, 201' etc ...
                        if( /^2/.test(xhr.status) ) {

                            try {
                                var result          = xhr.responseText
                                    , contentType   = xhr.getResponseHeader("Content-Type")
                                    , isJsonContent = (/application\/json/.test( contentType )) ? true : false
                                    , isRedirecting = true // by default
                                ;
                                if ( isJsonContent ) {
                                    result = JSON.parse(xhr.responseText);
                                    result.status = xhr.status;
                                    result.contentType = contentType;
                                    isRedirecting = false;
                                }
                                

                                instance.eventData.success = result;
                                
                                if ( !isJsonContent && $popin.isOpen && !$popin.hasForm) {                                    
                                    popinLoadContent(result, isRedirecting)                                    
                                // } else if (isJsonContent && $popin.hasForm) {
                                //     //triggerEvent(gina, $el, 'success.' + id, result)
                                //     triggerEvent(gina, $form, 'success.' + id, result);
                                } else {
                                    
                                    if ( 
                                        isJsonContent && typeof(result.location) != 'undefined' 
                                        ||
                                        isJsonContent && typeof(result.reload) != 'undefined'
                                        // ||
                                        // isJsonContent && typeof(result.popin) != 'undefined'
                                    ) {
                                        if ( typeof(result.location) != 'undefined' ) {
                                            var _target = '_self'; // by default
                                            if ( typeof(result.target) != 'undefined' ) {
                                                if ( /^(blank|self|parent|top)$/ ) {
                                                    result.target = '_'+result.target;
                                                }
                                                _target = result.target
                                            }
                                            window.open(result.location, _target);
                                            return;
                                        }
                                        
                                        if ( typeof(result.reload) != 'undefined' ) {
                                            document.location.reload();
                                            return;
                                        }
                                        
                                        // if ( typeof(result.popin) != 'undefined' ) {
                                        //     if ( typeof(result.popin.close) != 'undefined' ) {
                                        //         popinClose($popin.name);
                                        //     }
                                        // }
                                    }
                                    
                                    if ( !isJsonContent && $popin.hasForm) {
                                        //$validatorInstance.handleXhrResponse(xhr, $forms[0], $forms[0].id, event, true);
                                        //handleXhr(xhr, $el, options, require)
                                        //return
                                    }
                                    if ( !isJsonContent ) {
                                        triggerEvent(gina, $el, 'loaded.' + id, result);
                                        return
                                    }
                                    
                                    triggerEvent(gina, $forms[0], 'success.' + id, result);
                                    
                                }
                                
                                
                                updateToolbar(result);

                            } catch (err) {
                                
                                var resultIsObject = false;
                                
                                var result = {
                                    'status':  422,
                                    'error' : err.description || err.stack
                                };
                                
                                if ( /application\/json/.test( xhr.getResponseHeader("Content-Type") ) ) {
                                    result.error = JSON.parse(xhr.responseText);
                                    resultIsObject = true
                                }

                                instance.eventData.error = result;
                                
                                updateToolbar(result, resultIsObject);

                                triggerEvent(gina, $el, 'error.' + id, result)
                            }

                        } else {
                            //console.log('error event triggered ', event.target, $form);
                            var resultIsObject = false;
                            var result = {
                                'status':  xhr.status,
                                'error' : xhr.responseText
                            };

                            if ( /application\/json/.test( xhr.getResponseHeader("Content-Type") ) ) {
                                result.error = JSON.parse(xhr.responseText);
                                resultIsObject = true
                            }

                            instance.eventData.error = result;                            
                            

                            // update toolbar
                            updateToolbar(result, resultIsObject);

                            triggerEvent(gina, $el, 'error.' + id, result)
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
                //     instance.eventData.onprogress = result;
                //
                //     triggerEvent(gina, $el, 'progress.' + id, result)
                // };

                // catching timeout
                // xhr.ontimeout = function (event) {
                //     var result = {
                //         'status': 408,
                //         'error': 'Request Timeout'
                //     };
                //
                //     instance.eventData.ontimeout = result;
                //
                //     triggerEvent(gina, $el, 'error.' + id, result)
                // };


                // sending
                //var data = JSON.stringify({ sample: 'data'});
                xhr.send();
                

                return {
                    'open': function () {
                        var fired = false;
                        addListener(gina, $el, 'loaded.' + id, function(e) {
                        
                            e.preventDefault();

                            if (!fired) {
                                fired = true;
                                
                                instance.activePopinId = $popin.id;
                                popinBind(e, $popin);
                                popinOpen($popin.name);
                            }
                        });

                    }
                }
            }

        }

        /**
         * popinLoadContent
         * 
         * @param {string} html - plain/text
         * @param {boolean} [isRedirecting] - to handle link inside popin without form
         */
        function popinLoadContent(stringContent, isRedirecting) {
            
            var $popin = getActivePopin(); 
            if ( !$popin.isOpen )
                throw new Error('Popin `'+$popin.name+'` is not open !');
            
            $popin.isRedirecting = ( typeof(isRedirecting) != 'undefined' ) ? isRedirecting : false;
            if ( $popin.isRedirecting ) {
                
            }
            
            var $el = $popin.target;
            $el.innerHTML = stringContent.trim(); 
            popinUnbind($popin.name, true);          
            popinBind({ target: $el, type: 'loaded.' + $popin.id }, $popin);
            
            if ( !$popin.isRedirecting ) {
                triggerEvent(gina, instance.target, 'open.'+ $popin.id, $popin);
            } 
        }
               
        function getScript($popin, source, callback) {
            // existing scripts
            var scripts  = document.head.getElementsByTagName('script');            
            // new script element
            var script = document.createElement('script');
            // index 0 is for the loader
            var prior = document.getElementsByTagName('script')[1];
            script.async = 0;
        
            script.onload = script.onreadystatechange = function( _, isAbort ) {
                if(isAbort || !script.readyState || /loaded|complete/.test(script.readyState) ) {
                    script.onload = script.onreadystatechange = null;
                    script = undefined;
        
                    if(!isAbort && callback) setTimeout(callback, 0);
                }
            };
        
            script.src = source;            
            
            var hostname = gina.config.hostname;
            if ( gina.config.webroot != '' ) {
                hostname += gina.config.webroot;
            }
            var s = 0
                , sLen = scripts.length
                , filename = source.substr( source.lastIndexOf(hostname)+hostname.length || 0)
                , re = null
            ;
            if (sLen == 0) {
                script.id = 'gina-popin-script-' + $popin.id;
                prior.parentNode.insertBefore(script, prior);
                $popin.$headers.push({ id: script.id});
            } else {
                var found = false;
                for (; s<sLen; ++s) {
                    if ( typeof(scripts[s].src) == 'undefined' || !scripts[s].src )
                        continue;
                    // insert only if not already loaded
                    re = new RegExp(filename+'$');                
                    if ( re.test(scripts[s].src) ) {
                        found = true;
                        break;
                    }                                    
                }
                if (!found) {
                    script.id = 'gina-popin-script-' + $popin.id;
                    prior.parentNode.insertBefore(script, prior);
                    // will be removed on close
                    $popin.$headers.push({ id: script.id});
                }
            }                
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

            var id = null, $el = null;
            var $popin = ( typeof(name) != 'undefined') ? getPopinByName(name) : getPopinById(this.id);
            if ( !$popin ) {
                throw new Error('Popin name `'+name+'` not found !')
            } 
            id = $popin.id;
            $el = document.getElementById(id);
            
            // load external ressources
            var globalScriptsList = document.getElementsByTagName('script');
            var ignoreList  = [], s = 0;
            var i = 0, len = globalScriptsList.length;
            var scripts = $el.getElementsByTagName('script');
                        
            i = 0; len = scripts.length;
            for (;i < len; ++i) {
                // don't load if already in the global context
                // if ( ignoreList.indexOf(scripts[i].src) > -1 )
                //     continue;
                
                getScript($popin, scripts[i].src);            
            }
            // then trigger scripts load
            // var xhr = new XMLHttpRequest();
            // xhr.open('GET', scripts[1].src, true);
            // xhr.setRequestHeader("Content-Type", "text/javascript");
            // xhr.onload = function () {
            //     // var vScript = doc.createElement('script')
            //     //     , vSrc = URL.createObjectURL(xhr.response)
            //     // ;
            //     // vScript.src = src;
            //     // doc.body.appendChild(script);
            //     eval(xhr.response);
            // };
            // xhr.send();
            
            popinBind({ target: $el, type: 'loaded.' + $popin.id }, $popin);
                       

            if ( !/gina-popin-is-active/.test($el.className) )
                $el.className += ' gina-popin-is-active';

            // overlay
            if ( !/gina-popin-is-active/.test(instance.target.firstChild.className) )
                instance.target.firstChild.className += ' gina-popin-is-active';    
            // overlay
            if ( /gina-popin-is-active/.test(instance.target.firstChild.className) ) {
                removeListener(gina, instance.target, 'open.'+ $popin.id)
            }

            $popin.isOpen = true;
            // so it can be forwarded to the handler who is listening
            $popin.target = $el;
            
            instance.activePopinId = $popin.id;

            // update toolbar
            updateToolbar();
            // var XHRData = document.getElementById('gina-without-layout-xhr-data');
            // if ( gina && typeof(window.ginaToolbar) == "object" && XHRData ) {
            //     try {

            //         if ( typeof(XHRData.value) != 'undefined' && XHRData.value ) {
            //             XHRData = JSON.parse( decodeURIComponent( XHRData.value ) );
            //             // reset data-xhr
            //             ginaToolbar.update("data-xhr", null);
            //             XHRData.isXHRViewData = true;
            //             ginaToolbar.update("data-xhr", XHRData);
            //         }

            //     } catch (err) {
            //         throw err
            //     }
            // }

            // var XHRView = document.getElementById('gina-without-layout-xhr-view');
            // if ( gina && typeof(window.ginaToolbar) == "object" && XHRView ) {
            //     try {

            //         if ( typeof(XHRView.value) != 'undefined' && XHRView.value ) {
            //             XHRView = JSON.parse( decodeURIComponent( XHRView.value ) );
            //             // reset data-xhr
            //             ginaToolbar.update("view-xhr", null);

            //             ginaToolbar.update("view-xhr", XHRView);
            //         }

            //         // popin content
            //         ginaToolbar.update("el-xhr", id);

            //     } catch (err) {
            //         throw err
            //     }
            // }

            triggerEvent(gina, instance.target, 'open.'+ $popin.id, $popin);
        }

        /**
         * popinUnbind
         *
         * Closes a popin by `name` or all `is-active`
         *
         * @parama {string} [name]
         *
         * */
        function popinUnbind(name, isRouting) {
            
            var $popin = ( typeof(name) != 'undefined') ? getPopinByName(name) : getActivePopin();
            var $el = null;
            if ( !$popin && typeof(name) != 'undefined' ) {
                throw new Error('Popin `'+name+'` not found !');
            }
            
            // by default
            if ( typeof($popin) != 'undefined' && $popin != null ) {
                $el = $popin.target;
                
                isRouting = ( typeof(isRouting) != 'undefined' ) ? isRouting : false;

                if ( $el != null && /gina-popin-is-active/.test($el.className) ) {
                    if (!isRouting) {
                        instance.target.firstChild.className    = instance.target.firstChild.className.replace(/\sgina-popin-is-active|gina-popin-is-active|gina-popin-is-active\s/, '');
                        $el.className                           = $el.className.replace(/\sgina-popin-is-active|gina-popin-is-active|gina-popin-is-active\s/, '');
                        $el.innerHTML                           = '';
                    }                    

                    // removing from FormValidator instance
                    if ($validatorInstance) {
                        var i = 0, formsLength = $popin['$forms'].length;
                        if ($validatorInstance['$forms'] && formsLength > 0) {
                            for (; i < formsLength; ++i) {
                                if ( typeof($validatorInstance['$forms'][ $popin['$forms'][i] ]) != 'undefined' )
                                    $validatorInstance['$forms'][ $popin['$forms'][i] ].destroy();

                                $popin['$forms'].splice( i, 1);
                            }
                        }
                    }
                    
                    gina.popinIsBinded = false;
                    
                    // remove listeners
                    removeListener(gina, $popin.target, 'loaded.' + $popin.id);
                }
            }                
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
            
            var $popin = ( typeof(name) != 'undefined') ? getPopinByName(name) : getActivePopin();
            var $el = null;
            if ( !$popin && typeof(name) != 'undefined' ) {
               throw new Error('Popin `'+name+'` not found !');
            }
            
            // by default
            if ( typeof($popin) != 'undefined' && $popin != null ) {
                
                // in case popinClose is called by the user e.g.: binding cancel/close with a <A> tag
                // but at the same time, the <A> href is not empty -> redirection wanted in the HTML
                // in this case, we want to ignore close
                if ( $popin.isRedirecting )
                    return;
                
                $el = $popin.target;
                
                removeListener(gina, $popin.target, 'ready.' + instance.id);
                
                if ( $popin.hasForm ) {
                    $popin.hasForm = false;
                }

                if ( $el != null && /gina-popin-is-active/.test($el.className) ) {
                    
                    popinUnbind(name);            
                    $popin.isOpen           = false;
                    gina.popinIsBinded      = false;                

                    // restore toolbar
                    if ( gina && typeof(window.ginaToolbar) == "object" )
                        ginaToolbar.restore();

                    instance.activePopinId  = null;
                    if ( $popin.$headers.length > 0) {
                        var s = 0
                            , sLen = $popin.$headers.length
                        ;
                        try {
                            for (; s<sLen; ++s) {
                                document.getElementById( $popin.$headers[s].id ).remove(); 
                            }
                        } catch(err){
                            console.warn('Could not remove script `'+ $popin.$headers[s].id +'`\n'+ err.stack)
                        }
                        $popin.$headers = [];                            
                    }
                    triggerEvent(gina, $popin.target, 'close.'+ $popin.id, $popin);
                }
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
            
            var $popin = ( typeof(name) != 'undefined') ? getPopinByName(name) : getActivePopin();
            var id = null, $el = null;
            if ( !$popin && typeof(name) != 'undefined' ) {
                throw new Error('Popin `'+name+'` not found !');
            }
            
            id = $popin.id;
        }
        
        function registerPopin($popin, options) {
            
            if ( typeof(options) != 'object' ) {
                throw new Error('`options` must be an object')
            }
            
            $popin.options = merge(options, self.options);
            $popin.id = 'gina-popin-' + instance.id +'-'+ $popin.options['name'];
            
            if ( typeof(instance.$popins[$popin.id]) == 'undefined' ) {               

                if ( typeof($popin.options['name']) != 'string' || $popin.options['name'] == '' ) {
                    throw new Error('`options.name` can not be left `empty` or `undefined`')
                }

                if ( registeredPopins.indexOf($popin.options['name']) > -1 ) {
                    throw new Error('`popin '+$popin.options['name']+'` already exists !')
                }

                // import over plugins
                if ( typeof($popin.options['validator']) != 'undefined' ) {
                    $validatorInstance = $popin.options['validator'];
                    $popin.validateFormById = $validatorInstance.validateFormById;
                }
                

                $popin.options['class'] = 'gina-popin-container ' + $popin.options['class'];

                
                $popin.name             = $popin.options['name'];        
                $popin.target           = instance.target;  
                $popin.load             = popinLoad;
                $popin.loadContent      = popinLoadContent;
                $popin.open             = popinOpen;
                $popin.close            = popinClose;
                $popin.updateToolbar    = updateToolbar;  
                
                instance.$popins[$popin.id] = $popin;

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
                
                
                
                bindOpen($popin);                
            }
        }

        var init = function(options) {
            
            setupInstanceProto();
            instance.on('init', function(event) {
                
                var $newPopin = null;
                var popinId = 'gina-popin-' + instance.id +'-'+ options['name'];
                if ( typeof(instance.$popins[popinId]) == 'undefined' ) {               
                    var $newPopin = merge({}, $popin);  
                    registerPopin($newPopin, options);
                }

                instance.isReady = true;
                gina.hasPopinHandler = true;
                gina.popin = merge(gina.popin, instance);
                // trigger popin ready event
                triggerEvent(gina, instance.target, 'ready.' + instance.id, $newPopin);
            });

            
                

            instance.initialized = true;

            return instance
        }
        
        var setupInstanceProto = function() {

            instance.load           = popinLoad;
            instance.loadContent    = popinLoadContent;
            instance.getActivePopin = getActivePopin;
            instance.open           = popinOpen;
            instance.close          = popinClose;
        }
        

        if ( !gina.hasPopinHandler ) {
            popinCreateContainer();
        } else {
            popinGetContainer()
        }

        return init(options)
    };

    return Popin
})