/**
 * Extending 2 litteral objects
 * */
'use strict';
var extend = require('../index');// Not needed if the framework installed

var A = {
    name: 'Julia Roberts',
    getName: function () {
        return this.name;
    }
}

var B = {
    name: 'Michael Jackson',
    age: 46,
    getAge: function () {
        return this.age;
    }
}

var AB = extend(A, B); // A extend B.
var a = AB;
console.log('Name: ', a.getName());  // Julia Robert
console.log('Age: ', a.getAge());   // 46