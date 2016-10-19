define('core/main', [ 'require', 'vendor/uuid', 'utils/merge', 'helpers/dateFormat' ], function (require) {
    var uuid            = require('vendor/uuid')
        , merge         = require('utils/merge')
        , dateFormat    = require('helpers/dateFormat')()

        , proto         = { 'isFrameworkLoaded': false, 'hasPopinHandler': false, 'options': {} }
        , events        = [ 'ready' ]
        ;

    /***
     * ready
     *
     * Equivalent of jQuery(document).ready(cb)
     *
     * No need to use it for `handlers`, it is automatically applied for each `handler`
     *
     * @callback {callback} cb
     * */



    /**
     * Imports & definitions
     * */

    var jQuery = (window['jQuery']) ? window['jQuery'] : null;

    if (!window.process ) {
        (function(window, nextTick, process, prefixes, i, p, fnc) {
            p = window[process] || (window[process] = {});
            while (!fnc && i < prefixes.length) {
                fnc = window[prefixes[i++] + 'equestAnimationFrame'];
            }
            p[nextTick] = p[nextTick] || (fnc && fnc.bind(window)) || window.setImmediate || window.setTimeout;
        })(window, 'nextTick', 'process', 'r webkitR mozR msR oR'.split(' '), 0);
    }

    if (!window.getComputedStyle) {
        /**
         * Returns the roster widget element.
         * @this {Window}
         * @return {ComputedStyle}
         */

        window.getComputedStyle = function(el, pseudo) {
            this.el = el;
            this.getPropertyValue = function(prop) {
                var re = /(\-([a-z]){1})/g;
                if (prop == 'float') {
                    prop = 'styleFloat'
                }
                if (re.test(prop)) {
                    prop = prop.replace(re, function () {
                        return arguments[2].toUpperCase()
                    })
                }
                return el.currentStyle[prop] ? el.currentStyle[prop] : null
            }
            return this
        }
    }

    /**
     * Custom object properties definition
     * */

    Object.defineProperty( Date.prototype, 'format', {
        writable:   false,
        enumerable: false,
        //If loaded several times, it can lead to an exception. That's why I put this.
        configurable: true,
        value: function(mask, utc){ return dateFormat.format(this, mask, utc) }
    });


    Object.defineProperty( Object.prototype, 'count', {
        writable: true,
        enumerable: false,
        //If loaded several times, it can lead to an exception. That's why I put this.
        configurable: true,
        value: function(){
            try {
                var self = this;
                if (this instanceof String) self = JSON.parse(this);
                var i = 0;
                for (var prop in this)
                    if (this.hasOwnProperty(prop)) ++i;

                return i
            } catch (err) {
                return i
            }
        }
    });

    /**
     * Events handling
     * */

    function cancelEvent(event) {
        if (typeof(event) != 'undefined' && event != null) {
            if (event.stopPropagation) {
                event.stopPropagation()
            }
            event.cancelBubble = true;
            if (event.preventDefault) {
                event.preventDefault()
            }
            event.returnValue = false
        }
    }

    function triggerEvent (target, element, name, args) {
        if (typeof(element) != 'undefined' && element != null) {
            var evt = null, isDefaultPrevented = false, isAttachedToDOM = false;

            // done separately because it can be listen at the same time by the user & by gina
            if ( jQuery ) { //thru jQuery if detected

                // Check if listener is in use: e.g $('#selector').on('eventName', cb)
                var $events = null; // attached events list
                // Before jQuery 1.7
                if (jQuery['fn']['jquery'].substr(0,3) <= '1.7') {
                    $events = jQuery(element)['data']('events')
                } else {// From 1.8 +
                    $events = jQuery['_data'](jQuery(element)[0], "events")
                }

                isAttachedToDOM = ( typeof($events) != 'undefined' && typeof($events[name]) != 'undefined' ) ? true : false;

                if (isAttachedToDOM) { // only trigger if attached
                    evt = jQuery.Event( name );
                    jQuery(element)['trigger'](evt, args);
                    isDefaultPrevented = evt['isDefaultPrevented']();
                }
            }

            if (window.CustomEvent || document.createEvent) {

                if (window.CustomEvent) { // new method from ie9
                    evt = new CustomEvent(name, {
                        'detail'    : args,
                        'bubbles'   : true,
                        'cancelable': true,
                        'target'    : element
                    })
                } else { // before ie9

                    evt = document.createEvent('HTMLEvents');
                    // OR
                    // evt = document.createEvent('Event');

                    evt['detail'] = args;
                    evt['target'] = element;
                    evt.initEvent(name, true, true);

                    evt['eventName'] = name;

                }

                if ( !isDefaultPrevented ) {
                    //console.log('dispatching ['+name+'] to ', element.id, isAttachedToDOM, evt.detail);
                    element.dispatchEvent(evt)
                }

            } else if (document.createEventObject) { // non standard
                evt = document.createEventObject();
                evt.srcElement.id = element.id;
                evt.detail = args;
                evt.target = element;
                element.fireEvent('on' + name, evt)
            }

        } else {
            target.customEvent.fire(name, args)
        }
    }

    function addListener(target, element, name, callback) {

        if ( typeof(target.event) != 'undefined' && target.event.isTouchSupported && /^(click|mouseout|mouseover)/.test(name) && target.event[name].indexOf(element) == -1) {
            target.event[name][target.event[name].length] = element
        }

        if (typeof(element) != 'undefined' && element != null) {
            if (element.addEventListener) {
                element.addEventListener(name, callback, false)
            } else if (element.attachEvent) {
                element.attachEvent('on' + name, callback)
            }
        } else {
            target.customEvent.addListener(name, callback)
        }
    }

    function removeListener(target, element, name, callback) {
        if (typeof(target.event) != 'undefined' && target.event.isTouchSupported && /^(click|mouseout|mouseover)/.test(name) && target.event[name].indexOf(element) != -1) {
            target.event[name].splice(target.event[name].indexOf(element), 1)
        }

        if (typeof(element) != 'undefined' && element != null) {
            if (element.removeEventListener) {
                element.removeEventListener(name, callback, false)
            } else if (element.attachEvent) {
                element.detachEvent('on' + name, callback)
            }
        } else {
            target.customEvent.removeListener(name, callback)
        }
    }

    /**
     * Operations on selectors
     * */

    function insertAfter(referenceNode, newNode) {
        //console.log('inserting after ',referenceNode, newNode, referenceNode.nextSibling);
        referenceNode.parentNode.insertBefore(newNode, referenceNode.nextSibling)

    }

    function getElementsByAttribute(attribute) {
        var matching = [], m = 0;
        var els = document.getElementsByTagName('*');

        for (var i = 0, n = els.length; i < n; ++i) {
            if (els[i].getAttribute(attribute) !== null) {
                // Element exists with attribute. Add to array.
                matching[m] = els[i];
                ++m
            }
        }

        return matching
    }


    /**
     * Constructor
     * */
    var $gina = document;

    function construct (options) {

        if ( typeof(this.initialized) != 'undefined') {
            return false
        }

        if (!$gina['id']) {
            var id = 'gina.'+ uuid.v1();
            $gina['id'] = id;
        }

        var _proto = {
            'on': on,
            'options': options,
            'setOptions': setOptions

        };

        proto = merge(proto, _proto);


        this.initialized = true;

        triggerEvent(self, $gina, 'ready');

        return proto
    }

    var on = function(event, cb) {

        if ( events.indexOf(event) < 0 ) {
            cb(new Error('Event `'+ event +'` not handled by gina EventHandler'))
        } else {
            addListener(instance, $gina, event, function(event) {
                cancelEvent(event);
                if (event['detail'])
                    var data = event['detail'];

                cb(false, data)
            })
        }
    };

    /**
     * setOptions
     * Override default options or add new options properties
     *
     * @param {object} options
     * */
    var setOptions = function (options) {
        proto.options = merge(proto.options, options, true)
    }





    return construct;
});