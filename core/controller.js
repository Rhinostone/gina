/*
 * This file is part of the geena package.
 * Copyright (c) 2013 Rhinostone <geena@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * @class Controller Super class
 *
 *
 * @package     Geena
 * @namespace   Geena.Controller
 * @author      Rhinostone <geena@rhinostone.com>
 * @api         Public
 */
var Fs              = require("fs"),
    Utils           = require("./utils"),
    Controller      = {
    data : {},
    app : {},
    request : {},
    rendered : false,
    init : function(){},
    /*
    * Handle Responses
    * @return {void}
    * @private
    **/
    handleResponse : function(request, response, next){


        console.log("web path !!", this.app.webPath);
        console.log('______action ', this.app.action);

        var action          = this.app.action,
            appName         = this.app.appName,
            content         = '',
            //conf            = this.app.conf,
            data            = {},
            ext             = this.app.ext,
            handler         = this.app.handler,
            instance        = this.app.instance,
            templateEngine  = this.app.templateEngine,
            viewConf        = this.app.view;

        //Only if templates are handled. Will handle swigg by default.
        if (templateEngine != null && viewConf != "undefined" && viewConf != null) {

            //Usefull or Useless not ?.
            instance.set('views', this.app.appPath +'/template');
            if(viewConf)
                this.setRessources(viewConf, action);//css & js.

            content = action + ext;
            //console.info('ACTION IS ', content);
            this.set('page.content', content);
            this.set('page.ext', ext);

            data = this.getData();

            if (this.rendered != true) {
                this.render(data);
                data = null;
            }
        } else {
            //Webservices handling.
            data = this.getData();
            if (this.rendered != true) {
                this.renderJson(data);
                data = null;
            }
        }

    },
    /**
     * Render Swigg by default
     * @param {object} data
     * */
    render : function(data){
        this.app.isXmlHttpRequest = (typeof(this.request) != "undefined" && this.request.xhr && this.app.isXmlHttpRequest || this.app.isXmlHttpRequest ) ? true : false;
        if(typeof(this.app.isXmlHttpRequest) == "undefined" || !this.app.isXmlHttpRequest ){
            data.page.handler = (this.app.handler != null) ? '<script type="text/javascript" src="/'+ this.app.appName + '/handlers/' + this.app.handler.file +'"></script>' : '';
            //console.log('HANDLER SRC _____',data.page.handler);

            if(data.page.content){
                //data.page.content = Fs.readFileSync(this.app.appPath + '/apps/'+ this.app.appName + '/templates/' + data.page.content);
                //data.page.content = ejs.compile(data.page.content);
                console.log('rendering datas...', data);
                this.response.render('layout' + data.page.ext, data);
            }
        }else{
            var response = this.response;
            response.setHeader("Content-Type", "application/json");
        }
        response.end();
        this.rendered = true;
    },
    /**
     * Render Json
     * */
    renderJson : function(jsonObj){
         var response = this.response;
         if(typeof(options) != "undefined" && typeof(options.charset) !="undefined"){
             response.setHeader("charset", options.charset);
         }
         response.setHeader("Content-Type", "application/json");
         response.end(JSON.stringify(jsonObj));
         this.rendered = true;
    },
    /**
     * Set data
     * @param {String} variable Data name to set
     * @param {String} value Data value to set
     * */
    set : function(variable, value){
        this.data[variable] = value;
    },
    /**
     * Get data
     * @param {String} variable Data name to set
     * @return {Object | String} data Data object or String
     * */
    get : function(variable){
        return this.data[variable];
    },

    setRessources : function(viewConf, localRessources){
        var res = '',
            tmpRes = {},
            css = {
                media   : "screen",
                rel     : "stylesheet",
                type    : "text/css",
                content : []
            },
            cssStr = '',
            js  = {
                type    : "text/javascript",
                content : []
            },
            jsStr = '';

        //intercept errors in case of malformed config
        //console.log('type of view conf ', typeof(viewConf));
        if(typeof(viewConf) != "object"){
            cssStr = viewConf;
            jsStr = viewConf;
        }

        //console.info('setting ressources for .... ', localRessources, viewConf);
        //Getting global/default css
        //Default will be completed OR overriden by locals - if options are set to "override_css" : "true" or "override" : "true"
        if(viewConf["default"]){
            //console.info('found default ', ["default"]);
            //Get css
            if(viewConf["default"]["stylesheets"]){
                tmpRes = this.getResNode('css', cssStr, viewConf["default"]["stylesheets"], css);
                cssStr = tmpRes.cssStr;
                css = tmpRes.css;
                tmpRes = null;
            }
            //Get js
            if(viewConf["default"]["javascripts"]){
                tmpRes = this.getResNode('js', jsStr, viewConf["default"]["javascripts"], js);
                jsStr = tmpRes.jsStr;
                js = tmpRes.js;
                tmpRes = null;
            }
        }

        //Check if local css exists
        if(viewConf[localRessources]){
            //Css override test
            if(viewConf[localRessources]["override_css"] && viewConf[localRessources]["override_css"] == true || viewConf[localRessources]["override"] && viewConf[localRessources]["override"] == true){
                cssStr = "";
                css.content = [];
            }
            //Get css
            if(viewConf[localRessources]["stylesheets"]){
                //console.info('case ', viewConf[localRessources]["stylesheets"], localRessources);
                tmpRes = this.getResNode('css', cssStr, viewConf[localRessources]["stylesheets"], css);
                cssStr = tmpRes.cssStr;
                css = tmpRes.css;
                tmpRes = null;
            }
            //js override test
            if(viewConf[localRessources]["override_js"] && viewConf[localRessources]["override_js"] == true || viewConf[localRessources]["override"] && viewConf[localRessources]["override"] == true){
                jsStr = "";
                js.content = [];
            }
            //Get js
            if(viewConf[localRessources]["javascripts"]){
                tmpRes = this.getResNode('js', jsStr, viewConf[localRessources]["javascripts"], js);
                jsStr = tmpRes.jsStr;
                js = tmpRes.js;
                tmpRes = null;
            }
        }
        this.set('page.stylesheets', cssStr);
        this.set('page.scripts', jsStr);
        //console.info('setting ressources !! ', cssStr, jsStr);
    },
    getResNode : function(type, resStr, resArr, resObj){
        //console.log('assigning ..... ', resStr);
        switch(type){
            case 'css':
                var css = resObj;
                for (var res in resArr) {
                    //means that you will find options.
                    if (typeof(resArr[res]) == "object") {
                        //console.info('found object ', resArr[res]);
                        css.media = (resArr[res].options.media) ? resArr[res].options.media : css.media;
                        css.rel = (resArr[res].options.rel) ? resArr[res].options.rel : css.rel;
                        css.type = (resArr[res].options.type) ? resArr[res].options.type : css.type;
                        if (!css.content[resArr[res]._]) {
                            css.content[resArr[res]._] = '<link href="'+ resArr[res]._ +'" media="'+ css.media +'" rel="'+ css.rel +'" type="'+ css.type +'">';
                            resStr += '\n\t' + css.content[resArr[res]._];
                        }

                    } else {
                        css.content[resArr[res]] = '<link href="'+ resArr[res] +'" media="screen" rel="'+ css.rel +'" type="'+ css.type +'">';
                        resStr += '\n\t' + css.content[resArr[res]];
                    }


                }
                return { css : css, cssStr : resStr };
            break;

            case 'js':
                var js = resObj;
                for (var res in resArr) {
                    //means that you will find options
                    if ( typeof(resArr[res]) == "object" ) {
                        js.type = (resArr[res].options.type) ? resArr[res].options.type : js.type;
                        if (!js.content[resArr[res]._]) {
                            js.content[resArr[res]._] = '<script type="'+ js.type +'" src="'+ resArr[res]._ +'"></script>';
                            resStr += '\n\t' + js.content[resArr[res]._];
                        }

                    } else {
                        js.content[resArr[res]] = '<script type="'+ js.type +'" src="'+ resArr[res] +'"></script>';
                        resStr += '\n\t' + js.content[resArr[res]];
                    }


                }
                return { js : js, jsStr : resStr};
            break;
        }
    },
    /**
     * TODO -  Controller.setMeta()
     * */
    setMeta : function(metaName, metacontent){

    },
    getData : function(){
        var data = {};
        data = Utils.refToObj(this.data);
        return data;
    },
    /**
     * TODO -  Controller.redirect()
     * */
    redirect : function(route){

    },
    /**
     * TODO -  Controller.forward404Unless()
     * */
    forward404Unless : function(condition){

    },
    /**
     * TODO -  Controller.getParameter()
     * */
    getParameter : function(paramName){
        var params = this.request.query;
        if ( typeof(params[paramName]) ){
            return params[paramName];
        }
    },
    /**
     * Get config
     *
     * @param {string} [name] - Conf name without extension.
     * @return {object} result
     *
     * TODO - Protect result
     * */
    getConfig : function(name){

        if ( typeof(name) != 'undefined' ) {
            try {
                return this.app.conf[name][this.app.appName];
            } catch (err) {
                return undefined;
            }
        } else {
            return this.app.conf;
        }
    }
};

//Allow protected methods to be overridden.
Controller.render.prototype.overridable = true;
Controller.renderJson.prototype.overridable = true;

module.exports = Controller;