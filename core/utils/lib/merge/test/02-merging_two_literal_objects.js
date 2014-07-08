var merge = require('../index');// Not needed if the framework installed

var aNO = {
    name: 'Julia Roberts',
    job: 'actress',
    getName: function () {
        return this.name
    },
    getJob: function () {
        return this.job
    }
}

var bNO = {
    name: 'Michael Jackson',
    age: 46,
    job: 'singer',
    getAge: function () {
        return this.age
    },
    getJob: function () {
        return 'Job : '+this.job
    }
}

var resultNO = merge(aNO, bNO);

exports['Merge without override occured'] = function(test) {
    test.equal( typeof(resultNO), 'object' );
    test.equal( resultNO.getName(), 'Julia Roberts');
    test.deepEqual(resultNO.getAge(), 46);
    test.deepEqual(resultNO.getJob(), 'actress');

    test.done()
}


var a = {
    name: 'Julia Roberts',
    job: 'actress',
    getName: function () {
        return this.name
    },
    getJob: function () {
        return this.job
    }
}

var b = {
    name: 'Michael Jackson',
    age: 46,
    job: 'singer',
    getAge: function () {
        return this.age
    },
    getJob: function () {
        return 'Job : '+this.job
    }
}

var result = merge(true, a, b);

exports['Merge with override occured'] = function(test) {
    test.equal( typeof(result), 'object' );
    test.equal( result.getName(), 'Michael Jackson' );
    test.deepEqual(result.getAge(), 46);
    test.deepEqual(result.getJob(), 'Job : singer');

    test.done()
}

