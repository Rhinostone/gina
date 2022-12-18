var reporter = require('nodeunit').reporters.default;
var merge = require('../src/main');// Not needed if the framework installed

var a = null;
var b = null;
var c = null;



var setVariable = function () {
    a = [
        {
            media: 'screen',
            name: 'default',
            rel: 'stylesheet',
            type: 'text/css',
            url: '/js/vendor/gina/gina.min.css'
        }
    ];
    b = [
        {
            media: 'screen',
            name: 'public',
            rel: 'stylesheet',
            type: 'text/css',
            url: '/js/css/public.min.css'
        }
    ];
    c = [
        {
            media: 'print',
            name: 'pdf',
            rel: 'stylesheet',
            type: 'text/css',
            url: '/js/vendor/gina/gina.min.css'
        }
    ];

};

setVariable();    
merge.setKeyComparison('url');
var BtoAwithoutOverride    = merge(a, b);

setVariable();
// you can also write it this way
var AtoBwithoutOverride    = merge.setKeyComparison('url')(b, a);

setVariable();
merge.setKeyComparison('url');
var CtoAwithoutOverride    = merge(a, c);


setVariable();
merge.setKeyComparison('url');
var CtoAwithOverride    = merge(a, c, true);


// setVariable();
// var BtoAwithOverride    = merge(b, a, true);
// setVariable();
// var BtoCwithOverride    = merge(b, c, true);
// setVariable();
// var AtoBwithoutOverride = merge(a, b);
// setVariable();
// var BtoAwithoutOverride = merge(b, a);
// setVariable();
// var BtoCwithoutOverride = merge(b, c);
// setVariable();
// var CtoBwithoutOverride = merge(c, b);
// setVariable();
// var BtoDwithoutOverride = merge(b, d);

// setVariable();
// var TermstoSettingTermsWithoutOverride = merge(terms, settingTerms);
// setVariable();
// var Terms2toSettingTermsWithoutOverride = merge(terms2, settingTerms);

// setVariable();
// var NewFontsToDesignWithoutOverride = merge(design, newFonts)
// setVariable();
// var NewFontsFontsToDesignNewFontsWithoutOverride = merge(design.fonts, newFonts.fonts);
// setVariable();
// var DesignNewToDesignWithoutOverride = merge(designNew, design);
// setVariable();
// var DesignToDesignNewWithOverride = merge(design, designNew, true);


exports['Merge : B<-A without override using key `url`'] = function(test) {
    var res = [
        {
            media: 'screen',
            name: 'default',
            rel: 'stylesheet',
            type: 'text/css',
            url: '/js/vendor/gina/gina.min.css'
        },
        {
            media: 'screen',
            name: 'public',
            rel: 'stylesheet',
            type: 'text/css',
            url: '/js/css/public.min.css'
        }
    ];

    test.equal( Array.isArray(BtoAwithoutOverride), true );
    test.deepEqual(BtoAwithoutOverride, res);

    test.done()
}

exports['Merge : A<-B without override using key `url`'] = function(test) {
    var res = [
        {
            media: 'screen',
            name: 'public',
            rel: 'stylesheet',
            type: 'text/css',
            url: '/js/css/public.min.css'
        },
        {
            media: 'screen',
            name: 'default',
            rel: 'stylesheet',
            type: 'text/css',
            url: '/js/vendor/gina/gina.min.css'
        }
    ];

    test.equal( Array.isArray(AtoBwithoutOverride), true );
    test.deepEqual(AtoBwithoutOverride, res);

    test.done()
}


exports['Merge : A<-C without override using key `url`'] = function(test) {
    var res = [
        {
            media: 'screen',
            name: 'default',
            rel: 'stylesheet',
            type: 'text/css',
            url: '/js/vendor/gina/gina.min.css'
        }
    ];

    test.equal( Array.isArray(CtoAwithoutOverride), true );
    test.deepEqual(CtoAwithoutOverride, res);

    test.done()
}

exports['Merge : A<-C with override using key `url`'] = function(test) {
    var res = [
        {
            media: 'print',
            name: 'pdf',
            rel: 'stylesheet',
            type: 'text/css',
            url: '/js/vendor/gina/gina.min.css'
        }
    ];

    test.equal( Array.isArray(CtoAwithOverride), true );
    test.deepEqual(CtoAwithOverride, res);

    test.done()
}


// for debug purpose
if (reporter)
    reporter.run(['test/06-merging_two_collections_with_custom_key_comparison.js']);