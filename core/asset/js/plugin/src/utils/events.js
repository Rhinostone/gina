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