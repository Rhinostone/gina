define('gina/link', [ 'require', 'lib/domain', 'lib/loading-state', 'lib/merge', 'lib/uuid', 'utils/events' ], function (require) {

    var Domain          = require('lib/domain');
    var domainInstance  = null;
    var loadingState    = require('lib/loading-state');
    var merge           = require('lib/merge');
    var uuid            = require('lib/uuid');

    require('utils/events'); // events

    /**
     * Gina Link Handler
     *
     * Activate binding with: `data-gina-link`
     * Optional, if your a.href is empty or with another value than the targeted action : `data-gina-link-url`
     *
     * @param {object} options
     * */
    function Link(options) {

        this.plugin = 'link';

        var events  = ['loaded', 'ready', 'open', 'close', 'destroy', 'success', 'error', 'progress'];
        registerEvents(this.plugin, events);

        var self = { // local use only
            'options' : {
                'url' : undefined,
                'class': 'gina-link-default'
            },
            authorizedEvents : ['ready', 'success', 'error'],
            events: {}
        };

        var instance        = {
            plugin          : this.plugin,
            id              : 'gina-links-' + uuid(),
            on              : on,
            eventData       : {},

            '$links'       : {},
            target          : document, // by default
            isReady         : false,
            initialized     : false
        };

        // link proto
        var $link          = { // is on main `gina-links` container (first level)
            'plugin'            : this.plugin,
            'on'                : on,
            'eventData'         : {},
            'target'            : document, // by default

            'url'               : null,
            'request'           : null,
            '$forms'            : []
        };



        // XML Request — the request currently in flight, plus a monotonic sequence.
        //
        // These replace a single module-scope `xhr` that every link click reused.
        // That is the #B175 class popin already fixed and nav deliberately avoids:
        // calling `open()` on an object that is still carrying a request implicitly
        // ABORTS it, and an aborted request reaches readyState 4 with status 0 —
        // which `handleXhr` has no branch for. So the first click's completion never
        // arrived at all, and anything waiting on it waited forever.
        //
        // The sequence exists because aborting is not enough on its own: the
        // superseded request may already have reached readyState 4 and queued its
        // handler. `_linkSeq` lets that stale response be dropped rather than acted
        // upon, so a slow first response can never overwrite a newer one.
        var _linkXhr = null;
        var _linkSeq = 0;

        /**
         * Build a fresh transport for a single request.
         *
         * Was inlined in the `init` handler, which created ONE object for the whole
         * page lifetime. Per-request construction is what makes concurrent link
         * clicks independent.
         *
         * @returns {object} a new XHR-like object, or `null` when the browser has none
         *
         * @example
         * var xhr = createXhr(); // fresh per request — never shared
         *
         * @inner
         */
        var createXhr = function() {
            if (window.XMLHttpRequest) { // Mozilla, Safari, ...
                return new XMLHttpRequest();
            }
            if (window.ActiveXObject) { // IE
                try {
                    return new ActiveXObject("Msxml2.XMLHTTP");
                } catch (e) {
                    try {
                        return new ActiveXObject("Microsoft.XMLHTTP");
                    }
                    catch (e) {}
                }
            }
            return null;
        };

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

        var registeredLinks = [];



        var proxyClick = function($childNode, $el, evt) {

            addListener(gina, $childNode, 'click', function(e) {
                cancelEvent(e);

                triggerEvent(gina, $el, evt);
            });
        }

        var getLinkById = function(id) {
            return ( typeof(instance.$links[id]) != 'undefined' ) ? instance.$links[id] : null;
        }

        var getLinkByUrl = function(url) {
            var $link = null;

            for (var p in gina.link.$links) {
                if ( typeof(gina.link.$links[p].url) != 'undefined' && gina.link.$links[p].url == url ) {
                    $link = gina.link.$links[p];
                    break;
                }
            }

            return $link;
        }



        /**
         * linkRequest
         *
         * Builds and sends the request for a bound link. Every entry point funnels
         * through here — the direct click, the `proxyClick` child delegation and the
         * public `gina.link.request()` — which is why the loading state is armed here
         * rather than in the click handlers: `$el` is already the anchor at this point,
         * so no click target ever has to be walked back up to it.
         *
         * Side effects: supersedes any request still in flight, arms `data-gina-loading`
         * on the anchor for the duration of this one, and releases it from a `loadend`
         * listener. An indefinite hang is the single outcome that never releases, because
         * no `xhr.timeout` is set.
         *
         * @param {string} url - URL to request
         * @param {object} [options] - XHR options, merged over the link's own
         *
         * @returns {void}
         *
         * @example
         * gina.link.request('/some/route'); // arms the bound anchor, releases on loadend
         *
         * @inner
         * */
        function linkRequest(url, options) {

            // One transport per request, and a sequence taken BEFORE the abort so a
            // supersede-abort is stale by construction — its handler sees
            // `seq !== _linkSeq` and drops out, which is what keeps the abort from
            // being mistaken for a real network failure.
            var seq = ++_linkSeq;
            if ( _linkXhr && _linkXhr.readyState !== 4 ) {
                try {
                    _linkXhr.abort();
                } catch (abortErr) { /* already dead — nothing to unwind */ }
            }
            var xhr = createXhr();
            _linkXhr = xhr;

            // link object
            var $link      = getLinkByUrl(url);
            var id         = $link.id;


            // link element
            var $el         = document.getElementById(id) || null;

            var hLinkIsRequired = null;
            // forward callback to HTML data event attribute through `hlink` status
            hLinkIsRequired = ( $el.getAttribute('data-gina-link-event-on-success') || $el.getAttribute('data-gina-link-event-on-error') ) ? true : false;
            // success -> data-gina-link-event-on-success
            // error -> data-gina-link-event-on-error
            if (hLinkIsRequired)
                listenToXhrEvents($link, 'link');

            // if ( $el == null ) {

            //     //var className   = $link.options.class +' '+ id;
            //     $el             = document.createElement('a');
            //     $el.setAttribute('id', id);
            //     //$el.setAttribute('class', className);
            //     instance.target.firstChild.appendChild($el);
            // }

            if ( typeof(options) == 'undefined' ) {
                options = xhrOptions;
            } else {
                options = merge(options, xhrOptions);
            }

            if ( /^(http|https)\:/.test(url) && !new RegExp('^' + window.location.protocol + '//'+ window.location.host).test(url) ) {
                // is request from same domain ?
                //options.headers['Origin']   = window.protocol+'//'+window.location.host;
                //options.headers['Origin']   = '*';
                //options.headers['Host']     = 'https://myproject.local:3154';
                var hostRootDomain  = domainInstance.getRootDomain(window.location.hostname).value;
                var urlRootDomain   = domainInstance.getRootDomain(url).value;
                var isSameDomain    = (hostRootDomain === urlRootDomain) ? true : false;
                // var isSameDomain    = ( new RegExp(window.location.hostname).test(url) ) ? true : false;

                if (gina.config.envIsDev) {
                    console.debug('Checking CORS from Popin plugin...\TODO - local CORS Proxy');
                    console.debug('Is request from same domain ? ', isSameDomain);
                }
                if (!isSameDomain) {
                    // Cross-origin request: drop credentials by default — the target
                    // server must opt in via `Access-Control-Allow-Origin` (+ `Vary: Origin`).
                    // If forced by user options, it is restored by the `$link.options` merge.
                    //
                    // SECURITY: the previous code rewrote the URL through an external CORS
                    // proxy (`corsacme.herokuapp.com`) — an unmaintained third party that
                    // would have routed user traffic (and any credentials) through it, and
                    // which no longer resolves. Removed; cross-origin requests now go direct
                    // and rely on the server's own CORS headers.
                    options.withCredentials = false;
                }
            }
            options.url     = url;
            // updating link options
            if ($link && typeof($link.options) != 'undefined')
                options  = merge($link.options, options);


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



            if (!xhr)
                throw new Error('No `xhr` object initiated');


            options.$link = $link;
            // The CORS branches above can swap the transport (XDomainRequest) or drop
            // it entirely, so re-point the in-flight tracker at whatever will actually run.
            _linkXhr = xhr;
            //xhr = handleXhr(xhr, $el, options);
            handleXhr(xhr, $el, options, require);

            // Sequence guard, applied by WRAPPING the handler `handleXhr` just installed
            // rather than by teaching `handleXhr` about link's sequence. `handleXhr` is
            // shared and the sequence belongs to the plugin that owns the clicks, so the
            // guard lives here and `utils/events.js` stays untouched.
            //
            // Only `onreadystatechange` needs wrapping: an aborted request fires
            // `onabort` (which `handleXhr` does not install), never `onerror`, so a
            // superseded request has exactly one way back into the completion path.
            var onSettled = xhr.onreadystatechange;
            xhr.onreadystatechange = function(event) {
                if ( seq !== _linkSeq ) {
                    return; // superseded by a newer click — drop the stale response
                }
                if ( typeof(onSettled) == 'function' ) {
                    onSettled.call(this, event);
                }
            };

            // #B247 — loading state for the link the user actually clicked.
            //
            // Armed HERE rather than in the click handlers because `$el` is already the
            // anchor at this point (`getElementById($link.id)` above), and because this
            // is the one funnel every entry reaches: the direct click, the `proxyClick`
            // child delegation — which dispatches its custom event ON the anchor, so the
            // handler's `e.target` is never the inner node — and the public
            // `gina.link.request()`. Arming below the `!xhr` throw also means a transport
            // that never materialises can not leave a trigger lit.
            //
            // Released on `loadend`, the same fail-safe the validator uses: a LISTENER
            // emits no events of its own, so it covers success, error, abort AND the
            // readyState-4/status-0 network failure `handleXhr` has no branch for —
            // without any of the consumer-visible surface that adding such a branch
            // would carry (#B282). One listener per transport, and transports are built
            // per request, so nothing accumulates.
            //
            // Never arm what can not be released: the CORS branch above can swap in a
            // legacy `XDomainRequest`, which has no `addEventListener` and so no
            // `loadend` to release on. An armed trigger with no release is exactly the
            // permanent strand this feature exists to prevent.
            //
            // Deliberately NOT sequence-guarded, unlike the response wrapper above. The
            // sequence drops a stale RESPONSE; a superseded request must still RELEASE
            // its trigger. It releases before the newer click arms, because `abort()`
            // fires `loadend` synchronously — inside the abort at the top of this
            // function, which runs before this line. Guarding here would strand the
            // trigger it was meant to protect.
            //
            // Residual: a request that never terminates never fires `loadend`, so an
            // indefinite hang still strands the trigger. That is #B283 (no `xhr.timeout`
            // is set, which is also why the `ontimeout` handleXhr installs is dead code)
            // — a separate, consumer-visible behaviour change, NOT covered here.
            if ( typeof(xhr.addEventListener) == 'function' ) {
                loadingState.arm($el);
                xhr.addEventListener('loadend', function onLinkSettled() {
                    loadingState.disarm($el);
                });
            }

            // sending
            try {
                xhr.send();
            } catch (sendErr) {
                // A synchronous throw out of `send()` (a cross-origin synchronous
                // request, a transport already in an invalid state) means no request ran,
                // so no `loadend` is ever coming. Release, then let the error out
                // unchanged — the caller's contract is untouched.
                if ( loadingState.isArmed($el) ) {
                    loadingState.disarm($el);
                }
                throw sendErr;
            }
        }

        function registerLink($link, options) {

            if ( typeof(options) != 'object' ) {
                throw new Error('`options` must be an object')
            }

            $link.options = merge(options, self.options);

            // link element
            var id  = $link.id;
            var $el = document.getElementById(id) || null;

            if ( typeof(instance.$links[$link.id]) == 'undefined' ) {



                if ( registeredLinks.indexOf($link.id) > -1 ) {
                    throw new Error('`link '+$link.id+'` already exists !')
                }


                if (!gina.events[evt]) {



                    // attach click events
                    addListener(gina, $el, evt, function(e) {
                        cancelEvent(e);

                        var $localLink = getLinkById(e.target.id)
                        // loading & binding link
                        var localUrl = $localLink.url;

                        // Non-Preflighted requests
                        if ( typeof($localLink.options.isSynchrone) == 'undefined' ) {
                            $localLink.options.isSynchrone = false;
                        }
                        if ( typeof($localLink.options.withCredentials) == 'undefined' ) {
                            $localLink.options.withCredentials = false
                        }

                        linkRequest(localUrl, $localLink.options);

                        //delete gina.events[ $localLink.id ];
                        //removeListener(gina, event.target, event.type)
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




                $link.request       = linkRequest;
                $link.getLinkById   = getLinkById;
                $link.getLinkByUrl  = getLinkByUrl;

                instance.$links[$link.id] = $link;



            }
        }

        /**
         * bindLinks
         *
         * @param {object} $target - DOM element
         * @param {object} [options]
         * */
        var bindLinks = function($target, options) {

            var id = null;
            if ( typeof($target) == 'undefined' ) {
                $target = instance.target;
                id = instance.id;
            }

            // binding form elements
            var found               = null
                , $el               = null
                , props             = null
                , $newLink          = null
                , url               = null
                , elId              = null
                , onEvent           = null
                // a
                , $a                = $target.getElementsByTagName('a')
                // buttons
                //, $button   = $target.getElementsByTagName('button')
            ;

            var i = 0, len = $a.length;
            for (; i < len; ++i) {
                found = $a[i].getAttribute('data-gina-link');

                if (!found && found != "" || /^false$/i.test(found) ) continue;

                $el     = $a[i];
                props   = {
                    type: 'a',
                    method: 'GET'
                };


                url = $el.getAttribute('data-gina-link-url');
                if ( typeof(url) != 'undefined' && url != null ) {
                    props.url = url
                } else {
                    props.url = $el.getAttribute('href')
                }




                elId = $el.getAttribute('id');
                if ( typeof(elId) == 'undefined' || elId == null || elId == '' || /popin\.link/.test(elId) ) {

                    // unbind popin link
                    // if ( /popin\.link/.test(elId) ) {

                    // }

                    elId = 'link.click.'+ 'gina-link-' + instance.id +'-'+ uuid();
                }
                $el['id']   = elId;
                props.id    = elId;
                evt         = elId;
                $el.setAttribute('id', evt);

                // [CSP] Suppress the link's default action via a click listener instead of an
                // inline onclick="return false;" attribute — the inline handler tripped CSP
                // script-src-attr under nonce-based policies. preventDefault (NOT cancelEvent —
                // its stopPropagation would block the document-level delegation that fires the
                // AJAX request) covers direct AND child clicks while leaving the delegation intact.
                addListener(gina, $el, 'click', function(e) { e.preventDefault(); });

                $newLink = null;

                if ( typeof(instance.$links[props.id]) == 'undefined' ) {
                    props.target = $el;
                    $newLink = merge(props, $link);
                    registerLink($newLink, options);
                }


            }

        }

        var init = function(options) {

            setupInstanceProto();
            instance.on('init', function(event) {

                // AJAX setup used to happen HERE, building one transport for the whole
                // page lifetime. It moved to `createXhr()`, called per request from
                // `linkRequest`, so two link clicks no longer share one object — see the
                // `_linkXhr` / `_linkSeq` comment at the top of this closure.

                // proxies
                // click on main document
                evt = 'click';// click proxy
                // for proxies, use linkInstance.id as target is always `document`
                addListener(gina, instance.target, evt, function(event) {

                    if ( typeof(event.target.id) == 'undefined' ) {
                        event.target.setAttribute('id', evt +'.'+ uuid() );
                        event.target.id = event.target.getAttribute('id')
                    }



                    if ( /^link\.click\./.test(event.target.id) ) {
                        cancelEvent(event);
                        var _evt = event.target.id;

                        if ( new RegExp( '^link.click.gina-link-' + instance.id).test(_evt) )
                            triggerEvent(gina, event.target, _evt, event.detail);

                    }
                });

                if ( typeof(options) == 'undefined' ) {
                    options = {}
                }
                instance.options = options;

                bindLinks(instance.target, options);
                gina.linkIsBinded = true;

                instance.isReady = true;
                gina.hasLinkHandler = true;
                gina.link = merge(gina.link, instance);
                // trigger link ready event
                triggerEvent(gina, instance.target, 'ready.' + instance.id, instance);
            });




            instance.initialized = true;

            return instance
        }

        var setupInstanceProto = function() {

            instance.bindLinks      = bindLinks;
            instance.request        = linkRequest;
            instance.getLinkById    = getLinkById;
            instance.getLinkByUrl   = getLinkByUrl;
        }

        if (!domainInstance) {
            new Domain( function onReady(err, _domainInstance) {
                if (err) {
                    throw err
                }

                domainInstance = _domainInstance;
            });
        }

        return init(options)
    }

    return Link
});