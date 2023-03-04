// var helpers     = require(__dirname +'/../../../helpers');
var filename    = __filename;
var file        = filename.split(/\//g).slice(-1);
var reporter    = null;
try {
    reporter    = require('nodeunit').reporters.default;
} catch (reporterErr) {
    reporter    = null
}
var jsonHelper  = require('../src/main')();// Not needed if the framework installed

var bodyString = __dirname + '/data/body_string.json';
var bodyString2 = __dirname + '/data/body_string2.json';

var setVariable = function (path) {
    return JSON.stringify(requireJSON(path));
};

// var bodyStringCase  = setVariable(bodyString2);
// var obj = parseBodyString(bodyStringCase);
// console.log(JSON.stringify(obj,null, 2));
// process.exit(0);

exports['parseBodyString: body_string.json case'] = function(test) {
    var bodyStringCase  = setVariable(bodyString);
    var obj = parseBodyString(bodyStringCase);
    // console.log(JSON.stringify(obj,null, 2));

    var res = {
        "design": [
          {
            "id": "original",
            "images": [
              {
                "id": "header",
                "layout": "half-margin",
                "widthForced": ""
              }
            ],
            "extras": {
              "isHidden": false
            },
            "colors": [
              {
                "id": "page-color",
                "name": "Page",
                "value": "#ffffff"
              },
              {
                "id": "text-primary-color",
                "name": "Texte (primaire)",
                "value": "#000000"
              },
              {
                "id": "text-secondary-color",
                "name": "Texte (secondaire)",
                "value": "#848484"
              },
              {
                "id": "accent-color",
                "name": "Bandeau",
                "value": "#cac8bf"
              },
              {
                "id": "accent-primary-color",
                "name": "Texte sur bandeau (primaire)",
                "value": "#000000"
              },
              {
                "id": "accent-secondary-color",
                "name": "Texte sur bandeau (secondaire)",
                "value": "#707070"
              },
              {
                "id": "lines-color",
                "name": "Ligne de séparation",
                "value": "#cac8bf"
              }
            ],
            "fonts": [
              {
                "value": "Comic Neue",
                "weight": "700",
                "id": "title",
                "name": "Titres",
                "file": "//fonts.gstatic.com/s/zillaslab/v11/dFa5ZfeM_74wlPZtksIFYuUe2HSjWlhzbaw.ttf"
              },
              {
                "value": "Comic Neue",
                "weight": "regular",
                "id": "text",
                "name": "Textes",
                "file": "undefined"
              },
              {
                "value": "Source Sans Pro",
                "weight": "italic",
                "id": "text-italic",
                "name": "Textes italique",
                "file": "undefined"
              },
              {
                "value": "Source Sans Pro",
                "weight": "600",
                "id": "text-bold",
                "name": "Textes gras",
                "file": "//fonts.gstatic.com/s/zillaslab/v11/dFa5ZfeM_74wlPZtksIFYuUe2HSjWlhzbaw.ttf"
              },
              {
                "value": "Source Sans Pro",
                "weight": "600italic",
                "id": "text-bold-italic",
                "name": "Textes gras italique",
                "file": "//fonts.gstatic.com/s/zillaslab/v11/dFa5ZfeM_74wlPZtksIFYuUe2HSjWlhzbaw.ttf"
              }
            ],
            "terms": {
              "isPageBreak": false,
              "layout": "cols-1"
            }
          }
        ]
      };

    test.equal( typeof(obj), 'object' );
    test.deepEqual( JSON.stringify(obj), JSON.stringify(res) );

    test.done()
}

exports['parseBodyString: body_string2.json case'] = function(test) {
  var bodyStringCase  = setVariable(bodyString2);
  var obj = parseBodyString(bodyStringCase);
  // console.log(JSON.stringify(obj,null, 2));

  var res = {
    "action": "",
    "company": {
      "selectedDesignId": "scooter"
    },
    "design": [
      null,
      {
        "id": "scooter",
        "images": [
          {
            "id": "header",
            "layout": "margin",
            "widthForced": ""
          }
        ],
        "extras": {
          "isHidden": false
        },
        "colors": [
          {
            "id": "page-color",
            "name": "Page",
            "value": "#ffffff"
          },
          {
            "id": "text-primary-color",
            "name": "Titre",
            "value": "#000000"
          },
          {
            "id": "text-secondary-color",
            "name": "Texte",
            "value": "#666666"
          },
          {
            "id": "accent-color",
            "name": "Fond coloré",
            "value": "#26b9d9"
          },
          {
            "id": "accent-primary-color",
            "name": "Textes sur fonds colorés (primaire)",
            "value": "#000000"
          },
          {
            "id": "accent-secondary-color",
            "name": "Textes sur fond colorés (secondaire)",
            "value": "#ffffff"
          },
          {
            "id": "lines-color",
            "name": "Ligne de séparation",
            "value": "#666666"
          }
        ],
        "fonts": [
          {
            "value": "Comic Neue",
            "weight": "700",
            "id": "title",
            "name": "Titres",
            "file": "//fonts.gstatic.com/s/zillaslabhighlight/v17/gNMUW2BrTpK8-inLtBJgMMfbm6uNVDvRxiP0TET4YmVF0Mb6.ttf"
          },
          {
            "value": "Comic Neue",
            "weight": "regular",
            "id": "text",
            "name": "Textes",
            "file": "undefined"
          },
          {
            "value": "Comic Neue",
            "weight": "italic",
            "id": "text-italic",
            "name": "Textes italique",
            "file": "undefined"
          },
          {
            "value": "Comic Neue",
            "weight": "700",
            "id": "text-bold",
            "name": "Textes gras",
            "file": "//fonts.gstatic.com/s/zillaslabhighlight/v17/gNMUW2BrTpK8-inLtBJgMMfbm6uNVDvRxiP0TET4YmVF0Mb6.ttf"
          },
          {
            "value": "Comic Neue",
            "weight": "700italic",
            "id": "text-bold-italic",
            "name": "Textes gras italique",
            "file": "//fonts.gstatic.com/s/zillaslabhighlight/v17/gNMUW2BrTpK8-inLtBJgMMfbm6uNVDvRxiP0TET4YmVF0Mb6.ttf"
          }
        ],
        "terms": {
          "isPageBreak": false,
          "layout": "cols-1"
        }
      }
    ]
  };

  test.equal( typeof(obj), 'object' );
  test.deepEqual( JSON.stringify(obj), JSON.stringify(res) );

  test.done()
}


// for debug purpose
if (reporter)
    reporter.run(['test/'+file]);