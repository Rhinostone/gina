var reporter    = require('nodeunit').reporters.default;

var Domain      = require('../src/main');// Not needed if the framework installed
var domainLib   = new Domain();


var setVariable = function (path) {
    return (requireJSON) ? requireJSON(path) : require(path);
};


// Getting cases results
var urlsOrHostnames     = __dirname + '/data/urls-or-hostnames.json';
var getRouteNameCases   = setVariable(urlsOrHostnames);

/**
 * runTest
 * Run test for each case
 *
 * @param {number} i - case index
 */
function runTests(i, exports) {
    let testCase        = getRouteNameCases[i]
        , request       = testCase.request
        , result        = testCase.expected
        , runningTest   = domainLib.getRootDomain(request, true)
    ;

    exports['Domain->getRootName(): `'+ request +'` case\n  Expecting: '+ result.rootDomain ] = function(test) {
        var res = result;

        test.equal( typeof(runningTest), 'object' );
        test.deepEqual(runningTest, res );

        test.done();
    }
    i++;
    if (i < getRouteNameCases.length) {
        runTests(i, exports);
    }
}

runTests(0, exports);

// for debug purpose
if (reporter)
    reporter.run(['test/01-get-root-domain.js']);