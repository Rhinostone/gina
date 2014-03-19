var Helper;


var fs = require('fs');

Helper = function(){

    var self = this;

    var createFileFromTemplate = function(source, target){

        var data = fs.readFileSync(source);

        try {
            fs.writeFileSync(target, data);
            fs.chmodSync(target, 0755);
            return target
        } catch (err) {
            throw err.stack;
            process.exit(1)
        }
    }

    this.loadProjectConfiguration = function(home){

    };

    this.createSettingsFileSync = function(source, target){

        try {
            return createFileFromTemplate(source, target)
        } catch (err) {
            console.log('geena: ' + err.stack);
            process.exit(1)
        }
    };

    this.createListFileSync = function(source, target){
        var filename = createFileFromTemplate(source, target);
        // feed the file with infos you can find from the ~/.geena structure


        return filename;
    }
};

module.exports = Helper