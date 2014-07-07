var merge = require('../index');// Not needed if the framework installed

var aNO = {
    "actress": "julia roberts",
    "job": "actress",
    "films": [
        "pretty woman",
        "mirror, mirror"
    ]
};
var bNO = {
    "actor": "tom hanks",
    "job": "actor",
    "films": [
        "philadelphia",
        "forrest gump"
    ]
};
var cNO = {
    "singer": "michael jackson",
    "job": "singer",
    "films": [
        "captain eo",
        "The Wiz"
    ]
};
var resultNO = merge(aNO, bNO, cNO);
exports['Merge without override occured'] = function(test) {
    var res = {
        "actress": "julia roberts",
        "job": "actress",
        "films": [
            "pretty woman",
            "mirror, mirror"
        ],
        "actor": "tom hanks",
        "singer": "michael jackson"
    }
    test.equal( typeof(resultNO), 'object' );
    test.deepEqual(resultNO, res);

    test.done()
}


var a = {
    "actress": "julia roberts",
    "job": "actress",
    "films": [
        "pretty woman",
        "mirror, mirror"
    ]
};
var b = {
    "actor": "tom hanks",
    "job": "actor",
    "films": [
        "philadelphia",
        "forrest gump"
    ]
};
var c = {
    "singer": "michael jackson",
    "job": "singer",
    "films": [
        "captain eo",
        "The Wiz"
    ]
};
var result = merge(true, a, b, c);
exports['Merge with override occured'] = function(test) {
    var res = {
        "actress": "julia roberts",
        "job": "singer",
        "films": [
            "captain eo",
            "The Wiz"
        ],
        "actor": "tom hanks",
        "singer": "michael jackson"
    }
    test.equal( typeof(result), 'object' );
    test.deepEqual(result, res);

    test.done()
}