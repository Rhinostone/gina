require('geena').utils.helpers;

var fs = require('fs');

var GeenaSSI =  function(appName, inputPath, file){

    // Get Source and Destination path.
    var _this = this,
        rootPath = _(getPath('templates.'+appName))+'/',
        outputPath = _(getPath('tmp.'+appName))+'/';

    recurse = function(path, currentFile, parent, callback){

        try{
            var _this = this,
                contentFile = fs.readFileSync(currentFile, 'utf8'),
                countRecurse = 0,
                occurrence = contentFile.match(/<!--#include file=".*" -->/g);  // Get all include's occurrence.
        } catch(err) {
            throw err;
        }

        if (occurrence != null) {
            var len = occurrence.length;

            // For each inclde's occurrence.
            for (var i=0; i < len; i++) {
                // Get File to include and Clone the parent array.
                var file = occurrence[i].replace(/<!--#include file="(.*)" -->/,"$1"),
                    tmpParent = parent.slice(0);

                // if a include's file is already on the parent array, it is an include's loop, throw error.
                if (parent.indexOf(file) != -1 ) throw "loop include";

                // Read file.
                tmpParent[tmpParent.length] = file;

                // Recursive call with this include content.
                _this.recurse(path, path+file, tmpParent, function(data){
                    contentFile = contentFile.replace(
                                    occurrence[i],
                                    data
                                );
                    ++countRecurse;
                    // When we have done all include, exit.
                    if (countRecurse == len) {
                        callback(contentFile);
                    }
                });
            }
        } else {
            // no include, exit.
            callback(contentFile);
        }
    };

    recurse(rootPath, rootPath+inputPath+file, [file], function(data){
        // Create folder if it doesn't exist.
        if (!fs.existsSync(outputPath+inputPath)) {
            fs.mkdirSync(outputPath+inputPath);
        }
        // create/rewrite file with output data.
        fs.writeFileSync(outputPath+inputPath+file, data);
    });
};
module.exports = GeenaSSI;