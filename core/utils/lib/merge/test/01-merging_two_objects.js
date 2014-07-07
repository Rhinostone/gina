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
exports['Merge with override occured'] = function(test) {
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
    test.equal( typeof(result), 'object' );
    test.deepEqual(result, res);

    test.done()
}

var aNO = {
    status: 'ok',
    msg: 'hello world !',
    page: {
        content: 'index.html',
        list: ['apple', 'orange', 'mango']
    }
};

var bNO= {
    "status": "ko",
    "msg": "hello Jane !",
    "page": {
        "action": "home",
        "ext": ".html",
        "content": "home.html"
    }
};
var resultNO = merge(aNO, bNO);

exports['Merge without override occured'] = function(test) {
    var res = {
        "status": "ok",
        "msg": "hello world !",
        "page": {
            "content": "index.html",
            "list": [
                "apple",
                "orange",
                "mango"
            ],
            "action": "home",
            "ext": ".html"
        }
    };
    test.equal( typeof(resultNO), 'object' );
    test.deepEqual(resultNO, res);

    test.done()
}

