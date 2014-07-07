/**
 * Merging 2 litteral objects
 * */
'use strict';
var merge = require('../index');// Not needed if the framework installed

var aNO = {
    name: 'Julia Roberts',
    age: 47,
    getName: function () {
        return this.name;
    }
}

var bNO = {
    name: 'Michael Jackson',
    age: 46,
    getAge: function () {
        return this.age;
    }
}

var resultNO = merge(aNO, bNO);

console.log('Name: ', resultNO.getName());  // Julia Robert
console.log('Age: ', resultNO.getAge());   // 47


var a = {
    name: 'Julia Roberts',
    age: 47,
    getName: function () {
        return this.name;
    }
}

var b = {
    name: 'Michael Jackson',
    age: 46,
    getAge: function () {
        return this.age;
    }
}

var result = merge(true, a, b);

console.log('Name: ', result.getName());  // Michael Jackson
console.log('Age: ', result.getAge());   // 46