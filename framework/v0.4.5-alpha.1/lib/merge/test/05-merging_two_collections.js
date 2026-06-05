var helpers     = require(__dirname +'/../../../helpers');
var reporter    = null;
try {
    reporter    = require('nodeunit').reporters.default;
} catch (reporterErr) {
    reporter    = null
}

var merge       = require(__dirname + '/../src/main');// Not needed if the framework installed
var filename    = __filename;
var file        = filename.split(/\//g).slice(-1);

var a = null;
var b = null;
var c = null;
var d = null;

var originalA = [];
var originalB = [
    {
        id: 1,
        value: 'apple'
    },
    {
        id: 2,
        value: 'orange'
    },
    {
        id: 3,
        value: 'mango'
    }
];
var originalC = [
    {
        id: 1,
        value: 'green'
    },
    {
        id: 4,
        value: 'yellow'
    },
    {
        id: 3,
        value: 'mango'
    },
    {
        id: 5,
        value: 'lemon',
        createdAt: '2018-01-01T00:00:00'
    }
];
var originalD = [
    {
        id: 1,
        value: 'apple'
    },
    {
        id: 2,
        value: 'mint'
    },
    {
        id: 3,
        value: 'mango'
    }
];

var terms           = null;
var terms2          = null;
var settingTerms    = null;
var design          = null;
var newFonts        = null;
var designNew       = null;
var template        = null;

var originalTerms           = [
    {
        _comment: "force update 1",
        _uuid: "208e4cb0-1b07-4a07-8d90-c020493f7173",
        createdAt: "2017-01-01T00:00:00",
        details: "- Generic document clause one.\n- Generic document clause two.\n- Generic document clause three.",
        hasChanged: false,
        hasCopyrights: false,
        id: "mock-estimate-1",
        isFlagged: false,
        isDefault: true,
        isPassedOnAmendments: true,
        isPassedOnInvoices: false,
        title: "Generic document section",
        type: "estimate"
    },
    {
        _uuid: "ce112986-659a-431b-964c-f0516b963fb4",
        createdAt: "2017-01-01T00:00:00",
        details: "- Generic payment clause one.\n- Generic payment clause two.\n- Generic payment clause three.",
        hasChanged: false,
        hasCopyrights: false,
        id: "mock-estimate-2",
        isFlagged: false,
        isDefault: true,
        isPassedOnAmendments: true,
        isPassedOnInvoices: false,
        title: "Generic legal-reference section",
        type: "estimate"
    },
    {
        _uuid: "e81328a4-0109-4b12-803e-7f2e091eaf60",
        createdAt: "2017-01-01T00:00:00",
        details: "- Generic external-body clause one.\n- Generic external-body clause two.",
        hasChanged: false,
        hasCopyrights: false,
        id: "mock-estimate-3",
        isFlagged: true,
        isDefault: true,
        isPassedOnAmendments: true,
        isPassedOnInvoices: true,
        title: "Generic external-body section",
        type: "estimate"
    },
    {
        _uuid: "b42de67b-2469-41cb-958f-94b0ccc36e59",
        createdAt: "2017-01-01T00:00:00",
        details: "- Generic rights clause one.\n- Generic rights clause two.\n- Generic rights clause three.",
        hasChanged: false,
        hasCopyrights: true,
        id: "mock-estimate-5",
        isFlagged: true,
        isDefault: true,
        isPassedOnAmendments: true,
        isPassedOnInvoices: true,
        title: "Generic rights section",
        type: "estimate"
    },
    {
        _uuid: "08b058f1-ce80-4cf8-98bc-35a6ee9b7585",
        createdAt: "2017-01-01T00:00:00",
        details: "- Generic invoice clause one.\n- Generic invoice clause two.\n- Generic invoice clause three.",
        hasChanged: false,
        hasCopyrights: false,
        id: "mock-invoice-1",
        isFlagged: false,
        isDefault: true,
        isPassedOnAmendments: false,
        isPassedOnInvoices: false,
        title: "Generic legal-reference section",
        type: "invoice"
    },
    {
        _uuid: "8d871f6e-8dfa-4c95-b475-b4abfb98f237",
        createdAt: "2017-12-04T15:42:34",
        details: "- poupou",
        hasChanged: false,
        hasCopyrights: false,
        id: "8911b6e0-7f41-4909-b725-e6498e422bea",
        isFlagged: false,
        isDefault: false,
        isPassedOnInvoices: true,
        title: "Generic draft section 5",
        type: "estimate"
    },
    {
        _uuid: "b6ec2817-e89f-4175-9b89-e77b7470aea1",
        createdAt: "2017-12-04T15:53:31",
        details: "- bla 2",
        hasChanged: true,
        hasCopyrights: false,
        id: "75758512-00d7-4426-bb44-7b417939b57b",
        isFlagged: false,
        isDefault: false,
        isPassedOnAmendments: true,
        isPassedOnInvoices: true,
        title: "Generic draft section 7",
        type: "estimate"
    }
];
var originalTerms2          = [
    {
        _comment: "force update 1",
        _uuid: "36841783-9744-4cd6-9386-22b6662b0ac9",
        createdAt: "2017-01-01T00:00:00",
        details: "- Generic document clause one.\n- Generic document clause two.\n- Generic document clause three.",
        hasChanged: false,
        hasCopyrights: false,
        id: "mock-estimate-1",
        isFlagged: false,
        isDefault: true,
        isPassedOnAmendments: true,
        isPassedOnInvoices: false,
        title: "Generic document section",
        type: "estimate"
    },
    {
        _uuid: "c5d8db7f-1c05-4b08-9ae6-4d27b9d80b6e",
        createdAt: "2017-01-01T00:00:00",
        details: "- Generic payment clause one.\n- Generic payment clause two.\n- Generic payment clause three.",
        hasChanged: false,
        hasCopyrights: false,
        id: "mock-estimate-2",
        isFlagged: false,
        isDefault: true,
        isPassedOnAmendments: true,
        isPassedOnInvoices: false,
        title: "Generic legal-reference section",
        type: "estimate"
    },
    {
        _uuid: "b081239a-cc03-463f-b53b-2b8183604e11",
        createdAt: "2017-01-01T00:00:00",
        details: "- Generic invoice clause one.\n- Generic invoice clause two.\n- Generic invoice clause three.",
        hasChanged: false,
        hasCopyrights: false,
        id: "mock-invoice-1",
        isFlagged: false,
        isDefault: true,
        isPassedOnAmendments: false,
        isPassedOnInvoices: false,
        title: "Generic legal-reference section",
        type: "invoice"
    },
    {
        _uuid: "cbf8e3ff-06fb-4d8b-8aef-69aed7f80e1d",
        createdAt: "2017-12-04T15:42:34",
        details: "- poupou",
        hasChanged: false,
        hasCopyrights: false,
        id: "8911b6e0-7f41-4909-b725-e6498e422bea",
        isFlagged: false,
        isDefault: false,
        isPassedOnInvoices: true,
        title: "Generic draft section 5",
        type: "estimate"
    },
    {
        _uuid: "bb14d227-170b-48ff-b70a-b6d8153f26fe",
        createdAt: "2017-12-04T15:53:31",
        details: "- bla 2",
        hasChanged: true,
        hasCopyrights: false,
        id: "75758512-00d7-4426-bb44-7b417939b57b",
        isFlagged: false,
        isDefault: false,
        isPassedOnAmendments: true,
        isPassedOnInvoices: true,
        title: "Generic draft section 7",
        type: "estimate"
    }
];
var originalSettingTerms    = [
    {
        _comment: "force update 1",
        createdAt: "2017-01-01T00:00:00",
        details: "- Generic document clause one.\n- Generic document clause two.\n- Generic document clause three.",
        hasChanged: false,
        hasCopyrights: false,
        id: "mock-estimate-1",
        isFlagged: false,
        isDefault: true,
        isPassedOnAmendments: true,
        isPassedOnInvoices: false,
        title: "Generic document section",
        type: "estimate"
    },
    {
        createdAt: "2017-01-01T00:00:00",
        details: "- Generic payment clause one.\n- Generic payment clause two.\n- Generic payment clause three.",
        hasChanged: false,
        hasCopyrights: false,
        id: "mock-estimate-2",
        isFlagged: false,
        isDefault: true,
        isPassedOnAmendments: true,
        isPassedOnInvoices: false,
        title: "Generic legal-reference section",
        type: "estimate"
    },
    {
        createdAt: "2017-01-01T00:00:00",
        details: "- Generic external-body clause one.\n- Generic external-body clause two.",
        hasChanged: false,
        hasCopyrights: false,
        id: "mock-estimate-3",
        isFlagged: true,
        isDefault: true,
        isPassedOnAmendments: true,
        isPassedOnInvoices: true,
        title: "Generic external-body section",
        type: "estimate"
    },
    {
        createdAt: "2017-01-01T00:00:00",
        details: "- Generic rights clause one.\n- Generic rights clause two.\n- Generic rights clause three.",
        hasChanged: false,
        hasCopyrights: true,
        id: "mock-estimate-5",
        isFlagged: true,
        isDefault: true,
        isPassedOnAmendments: true,
        isPassedOnInvoices: true,
        title: "Generic rights section",
        type: "estimate"
    },
    {
        createdAt: "2017-01-01T00:00:00",
        details: "- Generic invoice clause one.\n- Generic invoice clause two.\n- Generic invoice clause three.",
        hasChanged: false,
        hasCopyrights: false,
        id: "mock-invoice-1",
        isFlagged: false,
        isDefault: true,
        isPassedOnAmendments: false,
        isPassedOnInvoices: false,
        title: "Generic legal-reference section",
        type: "invoice"
    }
];
var originalDesign          = {
    id: "mock-desing-1",
    fonts: [
        {
            id: "font-1",
            name: "Titles",
            value: "Poiret One",
            weight: 400
        },
        {
            id: "font-2",
            name: "Text",
            value: "Open Sans",
            weight: 400
        }
    ]
};
var originalDesignNew       = {
    id: "mock-desing-1",
    fonts: [
        {
            id: "font-1",
            name: "Titles",
            value: "Open Sans",
            weight: 300
        }
    ]
};
var originalNewFonts        = {
    fonts: [
        {
            id: "font-3",
            name: "Text Bold",
            value: "Open Sans",
            weight: 600
        }
    ]
};

var originalTemplate        = {
    "_common": {
      "routeNameAsFilenameEnabled": true,
      "http-metas": {
        "content-type": "text/html"
      },
      "stylesheets": [
        {
          "name": "default",
          "media": "screen",
          "url": "/css/dashboard.css"
        }
      ]
    },
    "home": {
        "stylesheets": [],
        "javascripts": [
            "/handlers/home.js"
        ]
    },
    "contact": {
        "javascripts": [
            "/handlers/contact.js"
        ]
    }
};


var setVariable = function () {
    a = JSON.clone(originalA);
    b = JSON.clone(originalB);
    c = JSON.clone(originalC);
    d = JSON.clone(originalD);


    terms           = JSON.clone(originalTerms);
    terms2          = JSON.clone(originalTerms2);
    settingTerms    = JSON.clone(originalSettingTerms);
    design          = JSON.clone(originalDesign);
    designNew       = JSON.clone(originalDesignNew);
    newFonts        = JSON.clone(originalNewFonts);
    template        = JSON.clone(originalTemplate);

};

// setVariable();
// var AtoBwithOverride    = merge(a, b, true);
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
setVariable();
var CtoBwithoutOverride = merge(c, b);
setVariable();
var BtoDwithoutOverride = merge(b, d);

setVariable();
var TermstoSettingTermsWithoutOverride = merge(terms, settingTerms);
setVariable();
var Terms2toSettingTermsWithoutOverride = merge(terms2, settingTerms);

setVariable();
var NewFontsToDesignWithoutOverride = merge(design, newFonts)
setVariable();
var NewFontsFontsToDesignNewFontsWithoutOverride = merge(design.fonts, newFonts.fonts);
setVariable();
var DesignNewToDesignWithoutOverride = merge(designNew, design);
setVariable();
var DesignToDesignNewWithOverride = merge(design, designNew, true);

setVariable();
var Template_commonToTemplateHomeWithOverride = merge.setKeyComparison('url')(template._common, template.home, true);
setVariable();
var Template_commonToTemplateContactWithOverride = merge.setKeyComparison('url')(template._common, template.contact, true);

exports['Merge : A<-B with override'] = function(test) {

    setVariable();
    var AtoBwithOverride    = merge(a, b, true);

    var res = [
        {
            id: 1,
            value: 'apple'
        },
        {
            id: 2,
            value: 'orange'
        },
        {
            id: 3,
            value: 'mango'
        }
    ];

    test.equal( Array.isArray(AtoBwithOverride), true );
    test.deepEqual(AtoBwithOverride, res);

    test.deepEqual(originalA, a);
    test.deepEqual(originalB, b);

    test.done()
};

exports['Merge : B<-A with override'] = function(test) {

    setVariable();
    var BtoAwithOverride    = merge(b, a, true);

    var res = [];

    test.equal( Array.isArray(BtoAwithOverride), true );
    test.deepEqual(BtoAwithOverride, res);

    test.deepEqual(originalA, a);
    test.deepEqual(originalB, b);

    test.done()
};

exports['Merge : B<-C with override'] = function(test) {

    setVariable();
    var BtoCwithOverride    = merge(b, c, true);

    var res = [
        {
            id: 1,
            value: 'green'
        },
	    {
            id: 2,
            value: 'orange'
        },
        {
            id: 3,
            value: 'mango'
        },
        {
            id: 4,
            value: 'yellow'
        },
        {
            id: 5,
            value: 'lemon',
            createdAt: '2018-01-01T00:00:00'
        }
    ];

    test.equal(Array.isArray(BtoCwithOverride), true );
    test.deepEqual(BtoCwithOverride, res);

    test.deepEqual(originalB, b);
    test.deepEqual(originalC, c);

    test.done()
};


exports['Merge : A<-B without override'] = function(test) {

    setVariable();
    var AtoBwithoutOverride = merge(a, b);

    var res = [
        {
            id: 1,
            value: 'apple'
        },
        {
            id: 2,
            value: 'orange'
        },
        {
            id: 3,
            value: 'mango'
        }
    ];

    test.equal(Array.isArray(AtoBwithoutOverride), true );
    test.deepEqual(AtoBwithoutOverride, res);

    test.notDeepEqual(originalA, a);
    test.deepEqual(originalB, b);

    test.done()
};

exports['Merge : B<-A without override'] = function(test) {

    setVariable();
    var BtoAwithoutOverride = merge(b, a);

    var res = [
        {
            id: 1,
            value: 'apple'
        },
        {
            id: 2,
            value: 'orange'
        },
        {
            id: 3,
            value: 'mango'
        }
    ];

    test.equal(Array.isArray(BtoAwithoutOverride), true );
    test.deepEqual(BtoAwithoutOverride, res);

    test.deepEqual(originalA, a);
    test.deepEqual(originalB, b);

    test.done()
};

exports['Merge : B<-C without override'] = function(test) {

    setVariable();
    var BtoCwithoutOverride = merge(b, c);

    var res = [
        {
            id: 1,
            value: 'apple'
        },
        {
            id: 2,
            value: 'orange'
        },
        {
            id: 3,
            value: 'mango'
        },
        {
            id: 4,
            value: 'yellow'
        },
        {
            id: 5,
            value: 'lemon',
            createdAt: '2018-01-01T00:00:00'
        }
    ];

    test.equal(Array.isArray(BtoCwithoutOverride), true );
    test.deepEqual(BtoCwithoutOverride, res);

    test.deepEqual(originalB, b);
    test.deepEqual(originalC, c);

    test.done()
};

exports['Merge : C<-B without override'] = function(test) {
    var res = [
        {
            id: 1,
            value: 'green'
        },
        {
            id: 4,
            value: 'yellow'
        },
        {
            id: 3,
            value: 'mango'
        },
        {
            id: 5,
            value: 'lemon',
            createdAt: '2018-01-01T00:00:00'
        },
        {
            id: 2,
            value: 'orange'
        }
    ];

    test.equal(Array.isArray(CtoBwithoutOverride), true);
    test.deepEqual(CtoBwithoutOverride, res);

    test.done()
};

exports['Merge : B<-D without override'] = function(test) {
    var res = [
        {
            id: 1,
            value: 'apple'
        },
        {
            id: 2,
            value: 'orange'
        },
        {
            id: 3,
            value: 'mango'
        }
    ];

    test.equal(Array.isArray(BtoDwithoutOverride), true);
    test.deepEqual(BtoDwithoutOverride, res);

    test.done()
};

exports['Merge : terms<-settingTerms without override'] = function(test) {
    var res = [
        {
            _comment: "force update 1",
            _uuid: "208e4cb0-1b07-4a07-8d90-c020493f7173",
            createdAt: "2017-01-01T00:00:00",
            details: "- Generic document clause one.\n- Generic document clause two.\n- Generic document clause three.",
            hasChanged: false,
            hasCopyrights: false,
            id: "mock-estimate-1",
            isFlagged: false,
            isDefault: true,
            isPassedOnAmendments: true,
            isPassedOnInvoices: false,
            title: "Generic document section",
            type: "estimate"
        },
        {
            _uuid: "ce112986-659a-431b-964c-f0516b963fb4",
            createdAt: "2017-01-01T00:00:00",
            details: "- Generic payment clause one.\n- Generic payment clause two.\n- Generic payment clause three.",
            hasChanged: false,
            hasCopyrights: false,
            id: "mock-estimate-2",
            isFlagged: false,
            isDefault: true,
            isPassedOnAmendments: true,
            isPassedOnInvoices: false,
            title: "Generic legal-reference section",
            type: "estimate"
        },
        {
            _uuid: "e81328a4-0109-4b12-803e-7f2e091eaf60",
            createdAt: "2017-01-01T00:00:00",
            details: "- Generic external-body clause one.\n- Generic external-body clause two.",
            hasChanged: false,
            hasCopyrights: false,
            id: "mock-estimate-3",
            isFlagged: true,
            isDefault: true,
            isPassedOnAmendments: true,
            isPassedOnInvoices: true,
            title: "Generic external-body section",
            type: "estimate"
        },
        {
            _uuid: "b42de67b-2469-41cb-958f-94b0ccc36e59",
            createdAt: "2017-01-01T00:00:00",
            details: "- Generic rights clause one.\n- Generic rights clause two.\n- Generic rights clause three.",
            hasChanged: false,
            hasCopyrights: true,
            id: "mock-estimate-5",
            isFlagged: true,
            isDefault: true,
            isPassedOnAmendments: true,
            isPassedOnInvoices: true,
            title: "Generic rights section",
            type: "estimate"
        },
        {
            _uuid: "08b058f1-ce80-4cf8-98bc-35a6ee9b7585",
            createdAt: "2017-01-01T00:00:00",
            details: "- Generic invoice clause one.\n- Generic invoice clause two.\n- Generic invoice clause three.",
            hasChanged: false,
            hasCopyrights: false,
            id: "mock-invoice-1",
            isFlagged: false,
            isDefault: true,
            isPassedOnAmendments: false,
            isPassedOnInvoices: false,
            title: "Generic legal-reference section",
            type: "invoice"
        },
        {
            _uuid: "8d871f6e-8dfa-4c95-b475-b4abfb98f237",
            createdAt: "2017-12-04T15:42:34",
            details: "- poupou",
            hasChanged: false,
            hasCopyrights: false,
            id: "8911b6e0-7f41-4909-b725-e6498e422bea",
            isFlagged: false,
            isDefault: false,
            isPassedOnInvoices: true,
            title: "Generic draft section 5",
            type: "estimate"
        },
        {
            _uuid: "b6ec2817-e89f-4175-9b89-e77b7470aea1",
            createdAt: "2017-12-04T15:53:31",
            details: "- bla 2",
            hasChanged: true,
            hasCopyrights: false,
            id: "75758512-00d7-4426-bb44-7b417939b57b",
            isFlagged: false,
            isDefault: false,
            isPassedOnAmendments: true,
            isPassedOnInvoices: true,
            title: "Generic draft section 7",
            type: "estimate"
        }
    ];

    test.equal(Array.isArray(TermstoSettingTermsWithoutOverride), true);
    test.deepEqual(TermstoSettingTermsWithoutOverride, res);

    test.done()
};

exports['Merge : terms2<-settingTerms without override'] = function(test) {
    var res = [{
        _comment: 'force update 1',
        _uuid: '36841783-9744-4cd6-9386-22b6662b0ac9',
        createdAt: '2017-01-01T00:00:00',
        details: '- Generic document clause one.\n- Generic document clause two.\n- Generic document clause three.',
        hasChanged: false,
        hasCopyrights: false,
        id: 'mock-estimate-1',
        isFlagged: false,
        isDefault: true,
        isPassedOnAmendments: true,
        isPassedOnInvoices: false,
        title: 'Generic document section',
        type: 'estimate'
    },
    {
        _uuid: 'c5d8db7f-1c05-4b08-9ae6-4d27b9d80b6e',
        createdAt: '2017-01-01T00:00:00',
        details: '- Generic payment clause one.\n- Generic payment clause two.\n- Generic payment clause three.',
        hasChanged: false,
        hasCopyrights: false,
        id: 'mock-estimate-2',
        isFlagged: false,
        isDefault: true,
        isPassedOnAmendments: true,
        isPassedOnInvoices: false,
        title: 'Generic legal-reference section',
        type: 'estimate'
    },
    {
        _uuid: 'b081239a-cc03-463f-b53b-2b8183604e11',
        createdAt: '2017-01-01T00:00:00',
        details: '- Generic invoice clause one.\n- Generic invoice clause two.\n- Generic invoice clause three.',
        hasChanged: false,
        hasCopyrights: false,
        id: 'mock-invoice-1',
        isFlagged: false,
        isDefault: true,
        isPassedOnAmendments: false,
        isPassedOnInvoices: false,
        title: 'Generic legal-reference section',
        type: 'invoice'
    },
    {
        _uuid: 'cbf8e3ff-06fb-4d8b-8aef-69aed7f80e1d',
        createdAt: '2017-12-04T15:42:34',
        details: '- poupou',
        hasChanged: false,
        hasCopyrights: false,
        id: '8911b6e0-7f41-4909-b725-e6498e422bea',
        isFlagged: false,
        isDefault: false,
        isPassedOnInvoices: true,
        title: 'Generic draft section 5',
        type: 'estimate'
    },
    {
        _uuid: 'bb14d227-170b-48ff-b70a-b6d8153f26fe',
        createdAt: '2017-12-04T15:53:31',
        details: '- bla 2',
        hasChanged: true,
        hasCopyrights: false,
        id: '75758512-00d7-4426-bb44-7b417939b57b',
        isFlagged: false,
        isDefault: false,
        isPassedOnAmendments: true,
        isPassedOnInvoices: true,
        title: 'Generic draft section 7',
        type: 'estimate'
    },
    {
        createdAt: '2017-01-01T00:00:00',
        details: '- Generic external-body clause one.\n- Generic external-body clause two.',
        hasChanged: false,
        hasCopyrights: false,
        id: 'mock-estimate-3',
        isFlagged: true,
        isDefault: true,
        isPassedOnAmendments: true,
        isPassedOnInvoices: true,
        title: 'Generic external-body section',
        type: 'estimate'
    },
    {
        createdAt: '2017-01-01T00:00:00',
        details: '- Generic rights clause one.\n- Generic rights clause two.\n- Generic rights clause three.',
        hasChanged: false,
        hasCopyrights: true,
        id: 'mock-estimate-5',
        isFlagged: true,
        isDefault: true,
        isPassedOnAmendments: true,
        isPassedOnInvoices: true,
        title: 'Generic rights section',
        type: 'estimate'
    }];

    test.equal(Array.isArray(Terms2toSettingTermsWithoutOverride), true);
    test.deepEqual(Terms2toSettingTermsWithoutOverride, res);

    test.done()
};

exports['Merge : design<-newFonts without override'] = function(test) {
    var res = {
        id: "mock-desing-1",
        fonts: [
            {
                id: "font-1",
                name: "Titles",
                value: "Poiret One",
                weight: 400
            },
            {
                id: "font-2",
                name: "Text",
                value: "Open Sans",
                weight: 400
            },
            {
                id: "font-3",
                name: "Text Bold",
                value: "Open Sans",
                weight: 600
            }
        ]
    };

    test.equal(typeof (NewFontsToDesignWithoutOverride), 'object');
    test.deepEqual(NewFontsToDesignWithoutOverride, res);

    test.done()
};

exports['Merge : design.fonts<-newFonts.fonts without override'] = function(test) {
    var res = [
        {
            id: "font-1",
            name: "Titles",
            value: "Poiret One",
            weight: 400
        },
        {
            id: "font-2",
            name: "Text",
            value: "Open Sans",
            weight: 400
        },
        {
            id: "font-3",
            name: "Text Bold",
            value: "Open Sans",
            weight: 600
        }
    ];

    test.equal( Array.isArray(NewFontsFontsToDesignNewFontsWithoutOverride), true);
    test.deepEqual(NewFontsFontsToDesignNewFontsWithoutOverride, res);

    test.done()
};


exports['Merge : designNew<-design without override'] = function(test) {
    var res = {
        id: "mock-desing-1",
        fonts: [
            {
                id: "font-1",
                name: "Titles",
                value: "Open Sans",
                weight: 300
            },
            {
                id: "font-2",
                name: "Text",
                value: "Open Sans",
                weight: 400
            }
        ]
    };

    test.equal(typeof (DesignNewToDesignWithoutOverride), 'object');
    test.deepEqual(DesignNewToDesignWithoutOverride, res);

    test.done()
};

exports['Merge : design<-designNew with override'] = function(test) {
    var res = {
        "id": "mock-desing-1",
        "fonts": [
            {
                "id": "font-1",
                "name": "Titles",
                "value": "Open Sans",
                "weight": 300
            },
            {
                "id": "font-2",
                "name": "Text",
                "value": "Open Sans",
                "weight": 400
            }
        ]
    };

    test.equal(typeof (DesignToDesignNewWithOverride), 'object');
    test.deepEqual(DesignToDesignNewWithOverride, res);

    test.done()
};

exports['Merge : template._common<-template.home with override'] = function(test) {
    var res = {
        "routeNameAsFilenameEnabled": true,
        "http-metas": {
            "content-type": "text/html"
        },
        "stylesheets": [],
        "javascripts": [
            "/handlers/home.js"
        ]
    };

    test.equal(typeof(Template_commonToTemplateHomeWithOverride), 'object');
    test.deepEqual(Template_commonToTemplateHomeWithOverride, res);

    test.done()
};

exports['Merge : template._common<-template.contact with override'] = function(test) {
    var res = {
        "routeNameAsFilenameEnabled": true,
        "http-metas": {
            "content-type": "text/html"
        },
        "stylesheets": [
            {
                "name": "default",
                "media": "screen",
                "url": "/css/dashboard.css"
            }
        ],
        "javascripts": [
            "/handlers/contact.js"
        ]
    };

    test.equal(typeof(Template_commonToTemplateContactWithOverride), 'object');
    test.deepEqual(Template_commonToTemplateContactWithOverride, res);

    test.done()
};


exports['Compare : A<-B with override & B<-A without override'] = function(test) {

    setVariable();
    var AtoBwithOverride    = merge(a, b, true);

    setVariable();
    var BtoAwithoutOverride = merge(b, a);

    test.deepEqual(AtoBwithOverride, BtoAwithoutOverride);

    test.done()
};


// for debug purpose
if (reporter)
    reporter.run(['test/'+file]);