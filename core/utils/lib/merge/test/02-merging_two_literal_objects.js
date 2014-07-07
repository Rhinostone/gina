var merge = require('../index');// Not needed if the framework installed

var aNO = {
    name: 'Julia Roberts',
    age: 47,
    getName: function () {
        return this.name;
    },
    getAge: function () {
        return this.age+' years old';
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

exports['Merge without override occured'] = function(test) {
    test.equal( typeof(resultNO), 'object' );
    test.equal( resultNO.getName(), 'Julia Roberts');
    test.deepEqual(resultNO.getAge(), '47 years old');

    test.done()
}


var a = {
    name: 'Julia Roberts',
    age: 47,
    getName: function () {
        return this.name;
    },
    getAge: function () {
        return this.age+' years old';
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

exports['Merge with override occured'] = function(test) {
    test.equal( typeof(result), 'object' );
    test.equal( result.getName(), 'Michael Jackson' );
    test.deepEqual(result.getAge(), 46);

    test.done()
}

