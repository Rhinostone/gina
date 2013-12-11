/*
 * This file is part of the geena package.
 * Copyright (c) 2009-2013 Rhinostone <geena@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * ConsoleHelper
 *
 * @package     Geena.Utils.Helpers
 * @namespace   Geena.Utils.Helpers.ConsoleHelper
 * @author      Rhinostone <geena@rhinostone.com>
 * */

module.exports = function(){
    /**
     * @log
     * @param {string} log content to be printed by the terminal
     * */
    log = function(){

        var args = arguments, content = "";
        //console.log("arg: ", args);
        //To handle loggin with coma speparated arguments.

        for (var i=0; i<args.length; ++i) {

            if (args[i] instanceof Object) {
                //console.log("\n...", args[i], args[i].toString());
                content += JSON.stringify(args[i], null, '\t');
            } else {
                content += args[i];
            }
        }

        //console.log("hum ? ", content);
        if (content != '')
            process.stdout.write(content + '\n');
    };
    return false;
};//EO ConsoleHelper.