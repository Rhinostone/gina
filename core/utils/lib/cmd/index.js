/*!
 * Geena.Utils.Cmd
 * Copyright (c) 2013 Rhinostone <geena@rhinostone.com>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, extend, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

var Cmd = {},
    count = process.argv.length - 2;

Cmd.option = [];
Cmd.setOption = function(option){
    if (option instanceof Array) {
        for (var i=0; i<option.length; ++i) {
            Cmd.option[option[i].name] = option[i].content;
        }
    } else {
        Cmd.option[options.name] = option.content;
    }
};
Cmd.getString = function() {
    var cmd = process.argv.toString()
            .replace(/,/g,' ')
            .replace(/node/g, 'geena');
    var cmdArr = cmd.split('/');
    cmd = cmdArr[cmdArr.length-1];
    return cmd;
};
Cmd.getOption = function(name) {
    return Cmd.option[name];
};

Cmd.getOptions = function() {
    return Cmd.option;
};

Cmd.onExec = function() {

    Cmd.msg = require( _(__dirname + '/msg.json') );

    var _this = this, ignore = function(){
        log(_this.msg.default[0].replace("%command%", Cmd.getString()));
        return;
    };

    if (count <= 0) {
        log("Command geena must have argument(s) !"
                +"\nTry this to get help: geena -h");
    } else if (count == 1) {
        var p = _(__dirname + '/basic.js');
        Cmd.Basic = require(p).run(Cmd.getOptions(), Cmd.msg);
    } else if (count >= 2 && count <4 || count == 4) {
        var longCmd = (count>2) ? true : false;
        if (
            count == 2 && process.argv[2] == '-a'
            || count == 2 && process.argv[2] == '--add'
        ) {
            log("geena: argument(s) mismatch !"
                    +"\nTry this to get help: geena -h");
        } else if (count == 4 && process.argv[2] != '-s' && process.argv[2] != '--start') {
            ignore();
        } else {
            var p = _(__dirname + '/app.js');
            Cmd.App = require(p).run( Cmd.getOptions(), Cmd.msg, longCmd );

        }

    } else {
        ignore();
    }
};

module.exports = Cmd;