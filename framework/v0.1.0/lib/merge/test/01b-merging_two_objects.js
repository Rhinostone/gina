var merge = require('../src/main');// Not needed if the framework installed

var a = null;
var b = null;
var setVariable = function () {

    a = {
        "page":{
            "view":{
                "params":{
                    "section":"urssaf"
                }
            }
        }
    };

    b = {
        "page": {
            "view": {
                "file": "factsheets"
            }
        }
    }
};

setVariable();
var AtoBwithoutOverride = merge(a, b);

// setVariable();
// var AtoBwithOverride    = merge(a, b, true);

exports['Merge : A<-B without override'] = function(test) {
    var res = {
        "page":{
            "view":{
                "params":{
                    "section":"urssaf"
                },
                "file": "factsheets"
            }
        }
    };
    test.equal( typeof(AtoBwithoutOverride), 'object' );
    test.deepEqual(AtoBwithoutOverride, res);

    test.done()
}

// exports['Merge : A<-B with override'] = function(test) {
//     var res = {
//         "page":{
//             "view": {
//                 "file": "factsheets"
//             }
//         }
//     };
//     test.equal( typeof(AtoBwithOverride), 'object' );
//     test.deepEqual(AtoBwithOverride, res);
//
//     test.done()
// }
