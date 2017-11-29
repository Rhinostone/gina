var reporter    = require('nodeunit').reporters.default;
var fs          = require('fs');
var Collection  = require('../src/main');// Not needed if the framework installed
var collectionName = 'hotel';
var data = {
    hotels: JSON.parse(fs.readFileSync(__dirname + '/data/' + collectionName + '.json'))
} ;


var hotels = new Collection(data.hotels);
var result = null, mocks = null;


exports['[ find limit ] Hotel WHERE country === `France`\n    [ limit ] 2 '] = function(test) {

    result  = hotels
                .find({ country: 'France' })
                .limit(2)
                .toRaw();

    mocks   = JSON.parse(fs.readFileSync(__dirname + '/data/result/' + collectionName +'/find/findHotelWhereCountryIsFrance.json'))
                .splice(0, 2);
    
    test.equal(Array.isArray(result), true );
    test.equal(result.length, mocks.length);
    test.deepEqual(result, mocks);

    test.done()
}

exports['[ find notIn filters ] Hotel WHERE country NOTIN `United Kingdom` OR NOTIN `United States`'] = function(test) {

    result  = hotels
                .notIn({ country: 'United Kingdom' }, { country: 'United States' })
                .toRaw();

    mocks   = JSON.parse(fs.readFileSync(__dirname + '/data/result/' + collectionName + '/find/findHotelWhereCountryNotInUkOrNotInUsa.json'));

    test.equal(Array.isArray(result), true);
    test.equal(result.length, mocks.length);
    test.deepEqual(result, mocks);

    test.done()
}

exports['[ find notIn Array ] Hotel WHERE country == `United Kingdom` AND city NOTIN `[ "Orange" ]`'] = function(test) {

    var excludedCity = hotels.find({ country: 'France', city: 'Orange' });

    result = hotels
                .find({ country: 'France', state: "Provence-Alpes-Côte d'Azur" })
                .notIn(excludedCity, 'id') // can be written as : .notIn({ country: 'France', city: 'Orange' })
                .toRaw();

    mocks = JSON.parse(fs.readFileSync(__dirname + '/data/result/' + collectionName + '/find/findHotelWhereCountryIsFranceAndStateIsPacaAndCityNotInOrange.json'));

    test.equal(Array.isArray(result), true);
    test.equal(result.length, mocks.length);
    test.deepEqual(result, mocks);

    test.done()
}

exports['[ find within ] Hotel WHERE country == Uk AND pets_ok == true AND country == `United Kingdom` AND reviews[*].Cleanliness >= 4'] = function(test) {

    result = hotels
        .find({ country: 'United Kingdom', pets_ok: true, 'reviews[*].ratings.Cleanliness': '>= 4' })
        //.limit(9)
        .toRaw();

    mocks = JSON.parse(fs.readFileSync(__dirname + '/data/result/' + collectionName + '/find/findHotelWhereCountryIsUkAndPetsOkAndReviewsCleanlinessRanksMoreThan4.json'));
            //.splice(0, 9);

    test.equal(Array.isArray(result), true);
    test.equal(result.length, mocks.length);
    test.deepEqual(result, mocks);

    test.done()
}

// for debug purpose
if (reporter)
    reporter.run(['test/01-find.js']);