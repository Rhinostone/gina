//var reporter    = require('nodeunit').reporters.default;
var fs          = require('fs');
var archiver    = require(__dirname+'/../src/main');// Not needed if the framework installed

var target      = __dirname + '/output/';
var filename    = __dirname + '/data/Porting to ARM 64-bit.pdf';
var dirname     = __dirname + '/data/Samples';
var options     = {};


// exports['[ compress from file ] `'+ filename +'` using [ Gzip ] with default options'] = function(test) {
    
//     archiver
//         .compress(filename, target)
//         .onComplete( function onCompressed(err, target) {
            
//             if (err) {
//                 throw err;
//             }
            
//             original    = fs.statSync(filename);
//             result      = fs.statSync(target);
//             var file    = target.substr(target.lastIndexOf('/') +1);
            
//             // is file
//             test.equal(result.isFile(), true);
//             // target crearted
//             test.equal( fs.existsSync(target) , true);
//             // size matches default options
//             test.equal( original.size > result.size, true);
            
//             // TODO - unzip & compare original source size vs unzipped target size
            
//             fs.unlinkSync(target);

//             test.done()
//         })
       
// }


//exports['[ compress from folder ] `'+ dirname +'` using [ Gzip ] with default options'] = function(test) {
    /**
    filename    = __dirname + '/data/Samples/humans.txt';    
    archiver
        .compress(filename, target)
        .onComplete( function onCompressed(err, target) {
            
            if (err) {
                throw err;
            }
            
            original    = fs.statSync(filename);
            result      = fs.statSync(target);
            var file    = target.substr(target.lastIndexOf('/') +1);
            
            // is file
            test.equal(result.isFile(), true);
            // target crearted
            test.equal( fs.existsSync(target) , true);
            // size matches default options
            test.equal( original.size > result.size, true);
            
            // TODO - unzip & compare original source size vs unzipped target size
            
            //fs.unlinkSync(target);

            test.done()
        })
        */
    
    archiver
        .compress(dirname, target)
        .onComplete( function onCompressed(err, target) {
            
            if (err) {
                throw err;
            }
            
            //original    = fs.statSync(filename);
            //result      = fs.statSync(target);
            //var file    = target.substr(target.lastIndexOf('/') +1);
            
            // is file
            //test.equal(result.isFile(), true);
            // target crearted
            //test.equal( fs.existsSync(target) , true);
            // size matches default options
            //test.equal( original.size > result.size, true);
            
            // TODO - unzip & compare original source size vs unzipped target size
            
            //fs.unlinkSync(target);

            
            //test.done()
        });   
        
       
//}


// for debug purpose
// if (reporter)
//     reporter.run(['test/01-gzip.js']);