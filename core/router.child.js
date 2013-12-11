// TEST ONLY
var Router = {};

process.parent.ready(function(){
  console.log('[ Comms Ready, sending message!]\n\n');
  process.parent.emit('child::message', 'I am alive!');  
  process.parent.emit('child::method', 'ready');  
  //process.parent.emit('parent::method', process.pid);  
});

process.parent.on('parent::message', function(text) {
  console.log('The parent says: ', text);
  process.nextTick(function() {
    process.parent.emit('child::quit');
  });
});

process.parent.on('parent::method', function(action, params) {
    //console.info("ready to eval ", action, '\n', params); 
    switch(action){
        case 'route':
            Router = params.obj;
            
            //Router.parent = params.obj.parent;
            //console.info('utis = ', Router.parent.utils);
            Router.merde = 'merdouille !';
            //Router.init();
            //Router.parent.utils = Utils.extend(true,  Router.parent.utils);
            //Router.Server = Router.parent.Server;
            //Router.Controller = Router.parent.Controller
            //console.info('conf = ', Router.parent.Server.conf);
            Router.route(params.request, params.response, params.params);
            break;
    };
    
    //sp.ctrl.redefineThis(sp.ctrlr);
    //sp.ctrlr.parent = sp.params.app.parent;
    //sp.ctrlr.handleResponse(sp.params.app, sp.params.request, sp.params.response);
  //eval(cmd);  
  //process.parent.emit('child::method');
  //route.action();
  //console.info('laSP ', sp);
  process.nextTick(function() {
    process.parent.emit('child::quit');
  });
}); 