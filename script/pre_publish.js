/*
 * This file is part of the geena package.
 * Copyright (c) 2009-2013 Rhinostone <geena@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

var Utils = require("geena.utils").Utils,
    PrePublish = {
    taskCount : 0,
    init : function(){
        var _this = this;
        //this.removeComment();
        //this.removeConsole();
        /**
        //Publish to git hub when everything is done
        this.onReady(function(taskCount){
            if(this.count() == 0){
                _this.postToGitHub();
            }
        });*/
    },
    count : function(){
        for(t in this){
            if(typeof(this[t]) == 'function' && t != 'init' && t != 'count' && t != 'onReady')
                ++this.taskCount;
        }
        return this.taskCount;
    },
    taskIsComplete : function(){},
    removeComment : function(){},
    removeConsole : function(){

    },
    postToGitHub : function(){}
};
PrePublish.init();