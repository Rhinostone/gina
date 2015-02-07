/**
 * Merging 2 objects
 * */
'use strict';
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

console.log('result: ', JSON.stringify(result, null, 4));