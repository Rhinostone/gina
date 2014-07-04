var merge = require('../index');// Not needed if the framework installed

var a = {
    status: 'ko',
    msg: 'hello world !',
    page: {
        content: 'index.html',
        list: ['apple', 'orange', 'mango']
    }
};

var b = {
    "status": "ko",
    "msg": "hello Jane !",
    "page": {
        "action": "home",
        "ext": ".html",
        "content": "home.html"
    }
};

var result = merge(true, a, b);

exports['b overrides a'] = function(test) {
    test.equal( typeof(result), 'object' );
    test.equal( result.msg, 'hello Jane !');
    test.equal( result.status, 'ko');
    test.done()
}

exports['Deep override occured'] = function(test) {
    var page = {
        "action": "home",
        "content": "index.html",
        "ext": ".html",
        "list" : ['apple', 'orange', 'mango']
    };
    test.deepEqual(result.page, page);

    test.done()
}

