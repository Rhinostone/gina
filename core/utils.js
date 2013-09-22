var extend          = require('geena.utils').extend,
    fs              = require('fs'),
    Utils = {
        init : function(){

        },
        refToObj : function (arr){
            var tmp = null,
                curObj = {},
                obj = {},
                count = 0,
                data = {},
                last = null;
            //console.info('arr is --------------------------\n', arr);
            for(r in arr){
                tmp = r.split(".");
                //console.info('len ', r,tmp);
                //Creating structure - Adding sub levels
                for(o in tmp){
                    //console.info('ooo ', o, tmp[o], arr[r]);
                    count++;
                    if(last && typeof(obj[last]) == "undefined"){
                        curObj[last] = {};
                        //console.info("count is ", count);
                        if(count >= tmp.length){
                            //Assigning
                            //console.info('assigning ', arr[r], ' to ',tmp[o]);
                            curObj[last][tmp[o]] = (arr[r]) ? arr[r] : "undefined"; // !!! if null or undefined, it will be ignored while extending
                            last = null;
                            count = 0;
                            break;
                        }else{
                            curObj[last][tmp[o]] = {};
                        }
                    }else if(tmp.length === 1){ //Just one root var
                        //console.info('assigning ', arr[r], ' to ',tmp[o]);
                        curObj[tmp[o]] = (arr[r]) ? arr[r] : "undefined";
                        //last = null;
                        //count = 0;
                        obj = curObj;
                        break;
                    }
                    obj = curObj;
                    last = tmp[o];
                }
                //console.info('current obj ',obj);
                data = extend(true, data, obj);
                //console.info('merged ', data);
                obj = {};
                curObj = {};
            }
            return data;
        },
        /**
        * Extend this with that
        **/
        extend : function(deep, obj, objWithInterestingProperties){
            var deep = (deep) ? deep : false;
            return extend(deep, obj, objWithInterestingProperties);
        },
        /**
        * Clean files on directory read
        * Mac os Hack
        * @deprecated
        * @note use PathHelperObj.clean()
        **/
        cleanFiles : function(files){
            for(f=0; f< files.length; f++){
                if(files[f].substring(0,1) == '.')
                    files.splice(0,1);
            }
            return files;
        },
        /**
         * Delete a folder and all its subdirectories recursively
         * @param path  the directory path you want to delete recursively
         * @note thx to http://stackoverflow.com/questions/12627586/is-node-js-rmdir-recursive-will-it-work-on-non-empty-directories#answer-12761924
         **/
        deleteFolderRecursive : function(path){
            var files = [];
            if( fs.existsSync(path) ) {
                files = fs.readdirSync(path);
                files.forEach(function(file,index){
                    var curPath = path + "/" + file;
                    if(fs.statSync(curPath).isDirectory()) { // recurse
                        Utils.deleteFolderRecursive(curPath);
                    } else { // delete file
                        fs.unlinkSync(curPath);
                    }
                });
                fs.rmdirSync(path);
            }
        }
};

module.exports = Utils;