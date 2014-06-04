var inherits = require('../index');

var A = function() {
    var _this = this;
    this.name = 'Michael Jackson';
    this.getName = function () {
        return _this.name
    };

    this.say('some song on the juke box')// => playing some song on the juke box
};


var B = function(gender) {//Super Class
    var _this = this;
    //var self = {}; for private
    this.gender = gender || 'female';
    this.name = 'Julia Roberts';
    this.age = 46;


    this.getAge = function () {
        return _this.age;
    }

    this.getGender = function() {
        return _this.gender
    }

    this.protected = { // exposed to derived
        say : function(song) {
            return 'playing ' + song
        },
        getAge : _this.getAge,
        getGender : _this.getGender
    }

};

var a = new ( inherits(A, B) )('male');

exports['Can access protected members'] = function(test) {
    test.equal(a.name, 'Michael Jackson');
    test.equal(a.getAge(), 46);
    test.done()
}

exports['Public members from Super are forbidden'] = function(test) {
    test.equal(a.age, undefined);
    test.done()
}

exports['Got arguments from child'] = function(test) {
    test.equal(a.getGender(), 'male');
    var lyric = 'some song on the juke box';
    test.equal(a.say(lyric), 'playing ' + lyric);
    test.done()
}