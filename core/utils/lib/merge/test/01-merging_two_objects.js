var merge = require('../index');// Not needed if the framework installed

var a = {
    status: 'ok',
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
    var res = {
        "status": "ko",
            "msg": "hello Jane !",
            "page": {
            "content": "home.html",
                "list": [
                "apple",
                "orange",
                "mango"
            ],
                "action": "home",
                "ext": ".html"
        }
    };
    var page = {
        "action": "home",
        "content": "home.html",
        "ext": ".html",
        "list" : ['apple', 'orange', 'mango']
    };
    test.deepEqual(result, res);

    test.done()
}

