/**
 * Router Class
 *
 * @package     Gna
 * @author      Rhinostone
 * @error       ROUTER:CONF:ERR
 * @warning     ROUTER:CONF:WARN
 * @message     ROUTER:CONF:MESS 
 */
var url             = require("url"),
    fs              = require("fs"),
    Utils           = require('./utils.js'),
    Router          = { 
    request : {},    
    init : function(){},
    hasParams : function(pathname){
        var patt = /:/;
        return (patt.test(pathname)) ? true : false;
    },
            
    compareUrls : function(params, urlRouting){
        
        var uRe = params.url.split(/\//),
            uRo = urlRouting.split(/\//),
            score = 0,
            r = {};
            
        if (uRe.length === uRo.length) {
            var maxLen = uRo.length;
            //console.info("-----------------FOUND MATCHING SCORE", uRe.length, uRo.length);
            //console.info(uRe, uRo);
            for (var i=0; i<maxLen; ++i) {
                
                if (uRe[i] === uRo[i])
                    ++score;
                else if (this.hasParams(uRo[i]) && this.fitsWithRequirements(uRo[i], uRe[i], params))
                    ++score;

            }            
        }
        r.passed = (score === maxLen) ? true : false;
        r.request = this.request;
        return r;
    },
    /**
     * http://en.wikipedia.org/wiki/Regular_expression
     *
     * */
    fitsWithRequirements : function(urlVar, urlVal, params){
        
        urlVar = urlVar.replace(/:/,"");        
        var matched = false, 
            v = null;
        //console.info("ROUTE !!! ", urlVar, params.requirements); 
        if( typeof(params.requirements) != "undefined" && typeof(params.requirements[urlVar] != "undefined")){            
            v = urlVal.match(params.requirements[urlVar]);            
            //console.info('does it match ?', v);
            //works with regex like "([0-9]*)"
            //console.log("PARAMMMMM !!! ", urlVar, params.requirements[urlVar], params.requirements);
            if(v != null && v[0] !== ""){
                this.request.params[urlVar] = v[0];
            }
            
        }
        return (v != null && v[0] == urlVal && v[0] !="") ? true : false;
    },
    
    setRequest : function(request){
        this.request = request;
    },
    
    loadHandler : function(path, action){
        var handler = path +'/'+ action + '.js',//CONFIGURATION : settings.script_ext
            cacheless = (this.parent.conf[this.parent.appName].env == "dev") ? true : false;

        //console.info('!!about to add handler ', handler);

        try {
            if (cacheless) delete require.cache[handler];

            return {obj : fs.readFileSync(handler), file : action + '.js', name : action + 'Handler'};
        } catch (err) {
            return null;
        }

    },
    
    /**
    * Building route on the fly
    */
    route : function(request, response, params, next){
        //console.log("Request for " + pathname + " received : ", request.url, params);

        //Routing.
        var pathname        = url.parse(request.url).pathname,
            AppController   = {},
            AppModel        = {},
            app             = {},
            appName         = params.param.app,
            action          = params.param.action,
            Config          = require("./config"),
            Controller      = require("./controller"),
            Server          = this.parent,
            _this           = this;

        //Middleware Filters when declared.
        var resHeders = Config.Env.getConf(appName, Config.Env.get()).server.response.header;
        /** to be tested */
        if (resHeders.count() > 0) {
            for (h in resHeders)
                response.header(h, resHeders[h]);
        }

        //console.log("ACTION ON  ROUTING IS : " + action);
        var controllerFile  = Server.conf[appName].appsPath +'/'+ appName + '/controllers/controllers.js',
            handlersPath    = Server.conf[appName].appsPath  +'/'+ appName + '/handlers';

        console.log("About to route a request for " + pathname,'\n', '....with execution path : ', Server.executionPath );
        console.info('routing ==> ', pathname, appName);  
        
        Server.actionRequest = require(controllerFile);
        
        Controller.request = request;
        Controller.response = response;
        
        //console.log("get conf env ", Config.Env.get() );
                

        try {

            //Server.actionResponse = AppController[action]();
            //console.info('hum 3');
            Server.actionHandler = _this.loadHandler(handlersPath, action);   
            //console.info('hum 4');

            //Two places in this file to change these kind of values

            Controller.app = {
                instance        : Server.instance,
                appName         : appName,//module
                appPath         : Server.conf[appName].appsPath +'/'+ appName,
                webPath         : Server.executionPath,
                action          : action,
                handler         : Server.actionHandler,
                view            : (typeof(Server.conf[appName].view) != "undefined") ? Server.conf[appName].view : null,
                //to remove later
                templateEngine  : (typeof(Server.conf.templateEngine) != "undefined") ? Server.conf.templateEngine : null,
                ext             : (Server.conf[appName].template) ? Server.conf[appName].template.ext : Config.Env.getDefault().ext
            };

            console.log('ok ..... ', Controller.app.action);



            AppController = Utils.extend(false, Server.actionRequest, Controller); 


            /**
             * TypeError: Property 'xxxxxx' of object #<Object> is not a function
             * Either the controllers.js is empty, either you haven't created the method xxxxxx
             * */
            Server.actionResponse = AppController[action]();
            AppController.handleResponse(request, response, next);
            Server.actionResponse = null;
            action = null;

        } catch (err) {
            error = {
                "warning" : {
                    "code" : "1",
                    "message" : "ROUTER:CONF:WARN:1",
                    "explicit" : err
                }
            };
            Log.error(
                'geena',
                'ROUTER:ERR:1',
                err,
                __stack
            );
            AppController = Utils.extend(false, Server.actionRequest, Controller);
            Server.actionResponse = AppController[action]();

            Server.actionHandler = _this.loadHandler(handlersPath, action);
            var routeObj = Server.routing;
            app = {
                instance    : Server.instance,
                appName     : appName,//module
                appPath     : Server.conf[appName].appsPath +'/'+ appName,
                webPath     : Server.executionPath,
                action      : action,
                handler     : Server.actionHandler,
                view        : (typeof(Server.conf[appName].view) != "undefined") ? Server.conf[appName].view : null,
                route       : routeObj,
                ext         : (Server.conf[appName].template) ? Server.conf[appName].template.ext : Config.Env.getDefault().ext
            };
            Controller.app = app;

            //handle response.
            AppController.handleResponse(request, response);

            Server.actionResponse = null;
            action = null;
            app = null;
        }
    }
    
};
  
module.exports = Router;