/**
 * Operations on selectors
 * */

function insertAfter(referenceNode, newNode) {
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