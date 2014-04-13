# inherits()

**Package:** geena.utils   
**Name:** inherits   
**Version:** 0.0.1   
**Compatibility:** ECMA-262   
**Geena version:** 0.0.8p9   
**Status:** testing



## Summary

`inherits` uses `Object.create()` to allow a class **A** inherit properties from a class **B**  where **B** is the superclass.   
The superclass (B) will override the targeted class (A).   
The result of the operation will return a class with both properties.    
`inherits()` is a function from geena.utils. Althought, it can be required without having to install the [framework](https://github.com/rhinostone/geena).

## Syntax   
*inherits(ClassA, ClassB)*

> var a = new ( inherits(A, B) );   

or 

> var AB = inherits(A, B);   
> var a = new AB();   


**N.B.:** Inheritance will occur before instantiation

### Parameters

**ClassA**   
> Target class

**ClassB**   
> Super class

### Example


```javascript
var inherits = require('../inherits.js');// Not needed if the framework installed

var A = function() {
    var _this = this;
    this.name = 'Julia Roberts';
    this.getName = function () {
        return _this.name;
    };
};

var B = function() {
    var _this = this;
    this.name = 'Michael Jackson';
    this.age = 46;

    this.getAge = function () {
        return _this.age;
    };
};

var a = new ( inherits(A, B) );
console.log('is [ a ] instance of A ? ', a instanceof A);// true
console.log('is [ a ] instance of B ? ', a instanceof B);// true
console.log('Name: ', a.getName());// Michael Jackson
console.log('Age: ', a.getAge());// 46
```

**output:** 

```tty
is [ a ] instance of A ?  true
is [ a ] instance of B ?  true
Name:  Michael Jackson
Age:  46
```



