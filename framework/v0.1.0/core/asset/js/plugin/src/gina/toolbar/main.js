define('gina/toolbar', [ 'require', 'jquery', 'vendor/uuid','utils/merge', 'utils/collection', 'gina/storage' ], function (require) {

    var $           = require('jquery');
    var merge       = require('utils/merge');
    var Collection  = require('utils/collection');
    var Storage     = require('gina/storage');

    function Toolbar() {

        //console.log('Toolbar jquery is ', $.fn.jquery);

        var self = {
            version         : '1.0.2',
            foldingPaths    : {},
            foldingClass    : null,
            isUnfolded      : null
        };

        var bucket      = new Storage({bucket: 'gina'}) // <Bucket>
            , plugins   = bucket.Collection('plugin'); // <Collection>

        var $toolbar             = null
            , settings           = null
            , isCollapsed        = false
            , $tabs              = null
            , $logo              = null
            , $panelsContainer   = null
            , $panels            = null
            , $currentPanel      = null
            , panelId            = ''
            , $verticalPos       = null
            , $horizontalPos     = null
            , $toolbarPos        = null
            , position           = ''
            , $toolbarWidth      = null
            , width              = 0
            , $toolbarHeight     = null
            , toolbarHeight      = 0
            , contentHeight      = 0
            , keynum             = ''
            , lastPressedKey     = {}
            , coockie            = null
            , $json              = null
            , $ginaJson          = null
            , $jsonRAW           = null
            , originalData       = null
            , jsonObject         = null
            , ginaJsonObject     = null
            , forms              = null
            , formsIgnored       = '.gina-toolbar-options, .gina-toolbar-content'
            , $htmlConfigurationEnvironment = null
            , $htmlData          = null
            , $htmlView          = null
            , $htmlForms         = null
            , $codeFoldingToggle = null
            , codeFolding        = true
            , timeoutId          = null
            , $copyCache         = null
            , copyValue          = null
            ;

        var init = function () {
            // Get elements
            $toolbar           = $('#gina-toolbar');
            $tabs              = $toolbar.find('.gina-toolbar-tab > a');
            $logo              = $('#gina-toolbar-toggle');
            $panelsContainer   = $('#gina-toolbar-panels');
            $panels            = $panelsContainer.find('.gina-toolbar-panel');
            $verticalPos       = $('#gina-toolbar-vposition');
            $horizontalPos     = $('#gina-toolbar-hposition');
            $toolbarPos        = $verticalPos.add($horizontalPos);
            $toolbarWidth      = $('#gina-toolbar-width');
            $toolbarHeight     = $toolbar.find('.gina-toolbar-main');
            $json              = $('#gina-toolbar-json');
            $ginaJson          = $('#gina-toolbar-gina-json');
            $jsonRAW           = $('#gina-toolbar-toggle-code-raw');
            $forms             = $('form:not('+ formsIgnored +')');
            $htmlData          = $('#gina-toolbar-data-html');
            $htmlView          = $('#gina-toolbar-view-html');
            $htmlForms         = $('#gina-toolbar-forms-html');
            $htmlConfigurationEnvironment = $('#gina-toolbar-configuration-environment-html')
            $codeFoldingToggle = $('#gina-toolbar-code-toggle');

            // Append textarea for copy/paste then select it
            $toolbar.prepend('<textarea class="gina-toolbar-copy"></textarea>');
            $copyCache         = $toolbar.find('.gina-toolbar-copy');

            // Get toolbar settings
            settings = plugins.findOne({_name: 'toolbar'});

            if ( !settings ) {
                // default settings
                settings = {
                    _name           : 'toolbar',
                    _version        : self.version,
                    _description    : 'Toolbar settings',
                    _licence        : 'MIT',
                    _author         : [
                        {name: 'Fabrice Delaneau', company: 'Freelancer'},
                        {name: 'Martin-Luther Etouman', company: 'Rhinostone'}
                    ],
                    position        : 'top-right',
                    width           : '30',
                    panelId         : '#gina-toolbar-data',
                    isCollapsed     : true,
                    isUnfolded      : []
                };
                // saving default settings
                plugins.insert(settings);
                settings = plugins.findOne({_name: 'toolbar'});

            }

            // in case of local storage schema update;
            if (settings._version != self.version) {
                checkSchemaUpdate();
            }

            position    = settings.position;
            width       = settings.width;
            panelId     = settings.panelId;
            isCollapsed = settings.isCollapsed;

            $toolbar.removeClass('gina-toolbar-hidden');
            handle() // Bind behaviors
        };


        var checkSchemaUpdate = function () {
            // Run every update from your current version up to the head

            if (settings._version < '1.0.1') {
                if (!settings.isUnfolded ) {
                    settings.isUnfolded = [];
                }
                if (settings.codeFolding != undefined) {
                    delete settings.codeFolding;
                }
            }

            if ( typeof(settings.isUnfolded) != 'undefined' && !Array.isArray(settings.isUnfolded) ) {
                settings.isUnfolded = [];
            }

            // update version number
            settings._version = self.version;

            // save all changes
            settings.save(true);
        }

        /**
         * loadData
         *
         * @param {object} [section]
         * @param {object} [data]
         * @param {object} [ginaData]
         *
         * */
        var loadData = function (section, data, ginaData) {

            var $currentForms = null;

            try {
                var txt = $json.text();
                if (txt == '' || txt == 'null' ) {
                    $json.text('Empty')
                } else {
                    jsonObject = JSON.parse(txt);
                    ginaJsonObject = JSON.parse($ginaJson.text());
                    $json.text('');

                    // backing up document data
                    if (!originalData) {
                        originalData = {
                            jsonObject      : JSON.parse(JSON.stringify(jsonObject)),
                            ginaJsonObject  : JSON.parse(JSON.stringify(ginaJsonObject))
                        }
                    }
                }

            } catch (err) {
                $json.text('Could not load data');
            }

            if (jsonObject) {

                if (data && !ginaData) {
                    if ( !jsonObject[section] )
                        jsonObject[section] = {};

                    jsonObject[section] = ginaJsonObject[section] = data;

                } else if ( section == 'data-xhr' && !data && jsonObject['data-xhr'] ) {
                    // reset xhr
                    delete jsonObject['data-xhr'];
                } else if (ginaData) {
                    jsonObject      = data;
                    ginaJsonObject  = ginaData;
                }


                // Make folding paths
                makeFoldingPaths(jsonObject, '');

                // Create DOM from JSON
                // -> Configuration::environment
                $htmlConfigurationEnvironment.html(parseObject(jsonObject.environment, ginaJsonObject.environment));


                var userObject   = { data: jsonObject.data, view: jsonObject.view, forms: jsonObject.forms }
                    , ginaObject  = { data: ginaJsonObject.data, view: ginaJsonObject.view, forms: ginaJsonObject.forms } ;


                // xhr mode
                if ( /^(view-xhr)$/.test(section) ) {
                    userObject.view = jsonObject[section];
                    ginaObject.view = ginaJsonObject[section];

                    userObject.data = jsonObject['data-xhr'];
                    ginaObject.data = ginaJsonObject['data-xhr'];
                }


                if ( !section || /^(data)$/.test(section) || /^(view-xhr)$/.test(section) ) {


                    // -> Data
                    $htmlData.html('<ul class="gina-toolbar-code">' + parseObject(userObject.data, ginaObject.data) +'</ul>');

                    // -> View
                    // init view
                    var htmlProp =  '<div class="gina-toolbar-section" id="gina-toolbar-view-html-properties">\n' +
                                    '    <h2 class="gina-toolbar-section-title">properties</h2>\n' +
                                    '    <ul class="gina-toolbar-properties">\n' +
                                    '    </ul>\n' +
                                    '</div>';

                    $htmlView.html(htmlProp);
                    $htmlView.html( parseView(userObject.view, ginaObject.view, null, $htmlView) );

                    // -> Forms
                    $currentForms = $forms;
                    $htmlForms.html('');
                    $htmlForms.html( parseForms(userObject.forms, ginaObject.forms, $htmlForms, 0, $currentForms, $currentForms.length) );

                    //$htmlForms.html( parseView(jsonObject.forms, ginaJsonObject.forms, null, $htmlForms) );
                } else if ( /^(data-xhr)$/.test(section) ) {
                    // -> XHR Data
                    $htmlData.html('<ul class="gina-toolbar-code">' + parseObject(jsonObject[section], ginaJsonObject[section]) +'</ul>');
                } else if ( /^(el-xhr)$/.test(section) ) {
                    // -> XHR Forms
                    $currentForms = $('#' + jsonObject[section]).find('form:not('+ formsIgnored +')');
                    $htmlForms.html('');
                    $htmlForms.html( parseForms(userObject.forms, ginaObject.forms, $htmlForms, 0, $currentForms, $currentForms.length) );
                }


                // Manage folding state
                settings.currentFile = jsonObject.file;
                if (!settings.currentFile) {
                    // Init currentFile if none exists
                    settings.currentFile = jsonObject.file;
                }

                if (jsonObject.file == settings.currentFile) {
                    // If current page is the same as the previous page, unfold code as neede
                    $(document).ready(function () {
                        setTimeout(function () {
                            if ( settings.isUnfolded.length > 0)
                                initFoldingState(settings.isUnfolded, settings.isUnfolded.length, 0);
                        }, 150)
                    })
                }
            }
        }


        var initFoldingState = function (unfolded, len, i) {

            if (i == len) return false;

            var key = unfolded[i];

            if ( unfolded.indexOf(key) > -1 ) {

                toggleCodeFolding( $('.gina-toolbar-folding-state-'+ key), function onCodeToggled() {
                    i += 1;
                    initFoldingState(unfolded, len, i)
                });

            } else {
                i += 1;
                initFoldingState(unfolded, len, i)
            }
        }

        var handle = function () {


            // Add folding behavior
            $htmlData.add($htmlView, $htmlForms).off('click', 'a').on('click', 'a', function(event) {
                event.preventDefault();

                toggleCodeFolding($(this))
            });

            // Expand/collapse all code
            $codeFoldingToggle.off('click').on('click', function(event) {
                event.preventDefault();

                toggleCodeFolding('all')
            });

            // Add value to the clipboard
            $htmlData.add($htmlView, $htmlForms).off('click', '.gina-toolbar-value').on('click', '.gina-toolbar-value', function(event) {
                event.preventDefault();
                try {
                    copyValue = $(this).text();
                    $copyCache.text(copyValue);
                    $copyCache.select();
                    document.execCommand('copy', false, null);
                    $copyCache.blur();
                } catch(err) {
                    alert('Please press Ctrl/Cmd+C to copy the value');
                    // throw err;
                }

            });

            // display RAW
            $jsonRAW.off('click').on('click', function(event){
                if (jsonObject) {
                    var jsonOut = window.open("", "JSON RAW", "width=400,height=100");
                    //jsonOut.document.write( '<pre>' + JSON.stringify(jsonObject, null, 2) + '</pre>' );
                    jsonOut.document.write( JSON.stringify(jsonObject.data) );
                }
            });

            // Tabs
            $tabs.off('click').on('click', function(event) {
                event.preventDefault();

                // Hide all panels
                $tabs.removeClass('gina-toolbar-active');
                $panels.removeClass('gina-toolbar-active');

                // Show selected tab
                $(this).addClass('gina-toolbar-active');

                // Show selected panel
                panelId = $(this).attr('href');
                $currentPanel = $(panelId).addClass('gina-toolbar-active');

                // Save current active tab to coockie
                settings.panelId = panelId;
                settings.save()
            });

            // Show/hide Toolbar
            $logo.off('click').on('click', function(event) {
                event.preventDefault();

                $toolbar.toggleClass('gina-toolbar-collapsed');

                // Save current visibility state to coockie
                isCollapsed = $toolbar.hasClass('gina-toolbar-collapsed')
                settings.isCollapsed = isCollapsed;
                settings.save()
            });

            // Toolbar position
            $toolbarPos.off('change').on('change', function(event) {
                event.preventDefault();

                // Get selected option value
                var vposition = $verticalPos.val();
                var hposition = $horizontalPos.val();
                position = vposition + '-' + hposition
                changeToolbarPosition(position);

                // Save new position to coockie
                settings.position = position;
                settings.save()
            });

            // Toolbar width
            $toolbarWidth.off('change').on('change', function(event) {
                event.preventDefault();

                // Get selected option value
                width = $toolbarWidth.val();
                changeToolbarWidth(width);

                // Save new width to coockie
                settings.width = width;
                settings.save()
            });

            // Toolbar height
            $(window).off('resize').on('resize', function() {
                changeToolbarHeight();
            });

            // Show/hide toolbar using gg shorcut
            $('body').off('keypress').on('keypress', function(event) {
                // console.log('event', event);
                if(event.keyCode) {
                    // IE
                    keynum = event.keyCode;
                } else if(event.which) {
                    // Netscape/Firefox/Opera
                    keynum = event.which;
                } else {
                    // Chrome/Safari
                    keynum = event.charCode;
                }
                var now = new Date();
                if (
                    typeof lastPressedKey.keynum != "undefined"
                    && lastPressedKey.keynum == keynum
                    && typeof lastPressedKey.pressTime != "undefined"
                    && now.getTime() - lastPressedKey.pressTime < 500
                ) {
                    switch (keynum) {
                        case 103: //This is the "g" key
                            $toolbar.toggle();
                            // variousTools.setCookie("gina-toolbar[hub]", params.display.hub, 365);
                            break;
                    }
                }
                lastPressedKey.pressTime = now.getTime();
                lastPressedKey.keynum = keynum;
            });


            // Updates Toolbar with current values

            // Select the current tab
            $tabs.filter('[href="' + panelId +'"]').trigger('click');

            // Open toolbar if needed
            if (!isCollapsed) {
                $('#gina-toolbar-toggle').trigger('click');
            }

            // Change Toolbar Position and init selects
            changeToolbarPosition(position);

            var positions = position.split('-');
            $verticalPos.val(positions[0]);
            $horizontalPos.val(positions[1]);

            // Change Toolbar Width and init select
            changeToolbarWidth(width);

            $toolbarWidth.val(width);

            // Change Toolbar max-Height;
            changeToolbarHeight();

            // Parse JSON
            var txt = $json.text();
            // dev only - allows HTML 5 mock
            if ( /^\{\{ (.*) \}\}/.test(txt) ) {
                // loading mock
                //var url = document.location.protocol + '//' + document.location.pathname.replace('index.html', '');
                //url + 'mock.json';
                loadJSON(txt, loadData); //parse

            } else {
                loadData()
            }
        }


        var changeToolbarPosition = function (position) {
            $toolbar
                .removeClass('gina-toolbar-top-left gina-toolbar-top-right gina-toolbar-bottom-left gina-toolbar-bottom-right')
                .addClass('gina-toolbar-'+ position);
        }

        var changeToolbarWidth = function (width) {
            $toolbar
                .removeClass('gina-toolbar-auto gina-toolbar-100 gina-toolbar-80 gina-toolbar-60 gina-toolbar-50 gina-toolbar-40 gina-toolbar-30')
                .addClass('gina-toolbar-'+ width);
        }

        var changeToolbarHeight = function () {
            // Use window height - 32px for the header
            toolbarHeight = window.innerHeight - 32;
            $toolbar
                .find('.gina-toolbar-main')
                .css('max-height', toolbarHeight +'px');

            checkContentHeight()
        }

        var checkContentHeight = function () {
            // check toolbar content against window height
            var $currentMain = $currentPanel.find('.gina-toolbar-main');
            var $currentContent = $currentMain.find('.gina-toolbar-content');
            contentHeight = $currentMain.height();
            if (contentHeight == toolbarHeight) {
                $currentContent.addClass('gina-toolbar-content-end')
            } else {
                $currentContent.removeClass('gina-toolbar-content-end')
            }
        }

        var toggleCodeFolding = function ($el, cb) {

            if ($el != undefined && $el.length && $el != 'all') {

                $el.next('ul').slideToggle('fast');
                $el.toggleClass('gina-toolbar-unfolded');

                // Check container height after animation
                // if (timeoutId != null) {
                //     window.clearTimeout(timeoutId)
                // }
                // timeoutId = window.setTimeout(checkContentHeight, 300);

                // Save element folding state
                self.foldingClass = $el.attr('class');
                self.foldingClass = self.foldingClass.match(/gina-toolbar-folding-state-([-a-z]+)/)[1]

                if ($el.hasClass('gina-toolbar-unfolded')) {
                    if ( settings.isUnfolded.indexOf(self.foldingClass) < 0 )
                        settings.isUnfolded.push(self.foldingClass);

                    //settings.isUnfolded[self.foldingClass] = true;
                    settings.save()
                } else {
                    //delete settings.isUnfolded[self.foldingClass];
                    if ( settings.isUnfolded.indexOf(self.foldingClass) > -1 )
                        settings.isUnfolded.splice( settings.isUnfolded.indexOf(self.foldingClass) );

                    settings.save(true)
                }

                if ( typeof(cb) != 'undefined' )
                    cb()
            }
        }

        var orderKeys = function(obj) {

            var newObj  = {}
                , k     = null
                , keys  = []
                , i     = 0
                , len   = null
                ;

            for (k in obj) {
                if ( obj.hasOwnProperty(k) ){
                    keys[i] = k;
                    ++i
                }
            }

            len = keys.length;
            keys.sort();

            for (i = 0; i < len; ++i) {
                k = keys[i];
                newObj[k] = obj[k];
            }

            return newObj
        }

        var parseObject = function(obj, ginaObj, id) {

            var html = '';
            var id = id || '';
            var count = '';
            var objType = '';

            obj     = orderKeys(obj);
            ginaObj = orderKeys(ginaObj);

            for (var i in obj) {
                //console.log('i', i);
                //if ( /^(_uuid)$/.test(i) ) continue;

                if ( typeof(obj[i]) == 'object' && !Array.isArray(obj[i]) && obj[i] !== null ) { // parse
                    id += i + '-';
                    html += '<li class="gina-toolbar-object">';
                    html +=  '<a href="#" class="gina-toolbar-key gina-toolbar-folding-state-'+ id.substr(0, id.length - 1) +'">'+ i +' <span>{ }</span></a>';
                    html +=  '<ul class="gina-toolbar-object">'+ parseObject(obj[i], ginaObj[i], id) +'</ul>';
                    html += '</li>';
                    // clear one level
                    id = id.substr(0, id.length - i.length - 1);
                } else if ( Array.isArray(obj[i]) ) {
                    id += i + '-';
                    html += '<li class="gina-toolbar-collection">';
                    html +=  '<a href="#" class="gina-toolbar-key gina-toolbar-folding-state-'+ id.substr(0, id.length - 1) +'">'+ i +' <span>['+ obj[i].length +']</span></a>';
                    html +=  '<ul class="gina-toolbar-collection">'+ parseCollection(obj[i], ginaObj[i], id)  +'</ul>';
                    html += '</li>';
                    // clear one level
                    id = id.substr(0, id.length - i.length - 1);
                } else {
                    objType = (ginaObj[i] === null) ? 'null' : typeof(ginaObj[i]);
                    if ( objType == 'undefined' ) { // new key  declaration added by user
                        html += '<li class="gina-toolbar-key-value">';
                        html +=     '<span class="gina-toolbar-key gina-toolbar-key-added">'+ i +':</span> <span class="gina-toolbar-value gina-toolbar-value-type-is-'+ objType +'">'+ obj[i] +'</span>';
                        html += '</li>';
                    } else {

                        if (/^_comment/.test(i) ) continue;

                        if (obj[i] !== ginaObj[i] ) {
                            html += '<li class="gina-toolbar-key-value gina-toolbar-is-overridden">';
                            html +=     '<span class="gina-toolbar-key">'+ i +':</span> <span class="gina-toolbar-value">'+ ginaObj[i] +'</span>';
                            html += '</li>';

                            html += '<li class="gina-toolbar-key-value">';
                            html +=     '<span class="gina-toolbar-key">'+ i +':</span> <span class="gina-toolbar-value gina-toolbar-value-type-is-'+ objType +'">'+ obj[i] +'</span>';
                            html += '</li>';
                        } else {
                            html += '<li class="gina-toolbar-key-value">';
                            html +=     '<span class="gina-toolbar-key">'+ i +':</span> <span class="gina-toolbar-value gina-toolbar-value-type-is-'+ objType +'">'+ obj[i] +'</span>';
                            html += '</li>';
                        }
                    }
                }
            }
            return html
        }

        var parseCollection = function (arr, ginaArr, id) {
            var html = '';
            var id = id || '';
            for (var i = 0, len = arr.length; i<len; ++i) {
                if ( typeof(arr[i]) == 'object' && !Array.isArray(arr[i]) ) {
                    id   += i + '-';
                    html += '<li class="gina-toolbar-object">';
                    html +=   '<a href="#" class="gina-toolbar-key gina-toolbar-folding-state-'+ id.substr(0, id.length - 1) +'">'+ i +' <span>{ }</span></a>';
                    html +=   '<ul class="gina-toolbar-object">' + parseObject(arr[i], ginaArr[i], id) +'</ul>';
                    html += '</li>';
                    // clear one level
                    id = id.substr(0, id.length - i.toString().length - 1);

                } else if ( Array.isArray(arr[i]) ) {
                    id   += i + '-';
                    html += '<li class="gina-toolbar-collection">';
                    html +=   '<a href="#" class="gina-toolbar-key gina-toolbar-folding-state-'+ id.substr(0, id.length - 1) +'"">'+ i +'<span>[ ]</span></a>';
                    html +=   '<ul class="gina-toolbar-collection">' + parseCollection(arr[i], ginaArr[i], id)  +'</ul>';
                    html += '</li>';
                    // clear one level
                    id = id.substr(0, id.length - i.toString().length - 1);
                } else {
                    html += '<li class="gina-toolbar-key-value"><span class="gina-toolbar-key">'+ i +':</span> <span class="gina-toolbar-value">'+ arr[i] +'</span></li>';
                }
            }
            return html
        }

        var parseView = function (obj, ginaObj, id, $html, $root) {

            var id          = (id != null) ? id : '';
            var count       = '';
            var objType     = '';
            var hasParent   = false;
            var $parent     = null;
            var parentId    = null;

            obj     = orderKeys(obj);
            ginaObj = orderKeys(ginaObj);

            if (!$root)
                $root = $html;

            for (var i in obj) {

                if ( typeof(obj[i]) == 'object' && !Array.isArray(obj[i]) && obj[i] !== null ) { // parse

                    $parent = $('#gina-toolbar-view-' + id.substr(0, id.length - 1));
                    hasParent = ( $parent.length ) ? true : false;

                    if (!hasParent) {
                        id += i + '-';

                        if (i == 'params') { // force to top
                            var htmlParams =    '<ul id="gina-toolbar-view-'+ id.substr(0, id.length - 1) +'">' +
                                                    '<li>' +
                                                        '<span>'+ id.substr(0, id.length - 1) +'</span>' +
                                                    '</li>' +
                                                    '<li class="'+ id.substr(0, id.length - 1) +'">' +
                                                        '<ul></ul>' +
                                                    '</li>' +
                                                '</ul>';
                            $('#gina-toolbar-view-html-properties')
                                .before(htmlParams);
                        } else {
                            var htmlOther = '<ul id="gina-toolbar-view-'+ id.substr(0, id.length - 1) +'">' +
                                                '<li>' +
                                                    '<span>'+ id.substr(0, id.length - 1) +'</span>' +
                                                '</li>' +
                                                '<li class="'+ id.substr(0, id.length - 1) +'">' +
                                                    '<ul></ul>' +
                                                '</li>' +
                                            '</ul>';
                            $html
                                .append();
                        }

                        parseView(obj[i], ginaObj[i], id, $html.find('li.'+ id.substr(0, id.length - 1) + ' ul'), $root );


                    } else {

                        parentId = id + i + '-';

                        $parent
                            .find('li.'+ id.substr(0, id.length - 1) +' ul')
                            .append('<li class="gina-toolbar-key-value"><a href="#" class="gina-toolbar-key">'+ i +' <span>{ }</span></a><ul id="gina-toolbar-view-'+ parentId.substr(0, parentId.length - 1) +'"><li class="'+ parentId.substr(0, parentId.length - 1) +'"></li></ul></li>');

                        parseView(obj[i], ginaObj[i], parentId, $parent.find('li.'+ id.substr(0, id.length - 1)), $root );

                        id += i + '-';
                    }


                    // clear one level
                    id = id.substr(0, id.length - i.length - 1);


                } else if ( Array.isArray(obj[i]) ) {

                    $parent = $('#gina-toolbar-view-' + id.substr(0, id.length - 1));
                    hasParent = ( $parent.length ) ? true : false;

                    if (!hasParent) {

                        $root
                            .find('.gina-toolbar-properties')
                            .append('<li class="gina-toolbar-collection"><a class="gina-toolbar-key">'+ i +' <span>['+ obj[i].length +']</span></a><ul>'+ parseCollection(obj[i], ginaObj[i], parentId, $root.find('.gina-toolbar-properties')) +'</ul></li>');


                    } else {

                        parentId = id + i + '-';

                        $parent
                            .find('li.'+ id.substr(0, id.length - 1) +' ul')
                            .append('<li class="gina-toolbar-collection"><a class="gina-toolbar-key">'+ i +' <span>['+ obj[i].length +']</span></a><ul>'+ parseCollection(obj[i], ginaObj[i], parentId, $parent.find('li ul.'+ id.substr(0, id.length - 1)) ) +'</ul></li>');

                        id += i + '-';
                    }


                    // html += '<li class="gina-toolbar-collection">';
                    // html +=  '<a href="#" class="gina-toolbar-key gina-toolbar-folding-state-'+ id.substr(0, id.length - 1) +'">'+ i +' <span>['+ obj[i].length +']</span></a>';
                    // html +=  '<ul class="gina-toolbar-collection">'+ parseCollection(obj[i], ginaObj[i], id)  +'</ul>';
                    // html += '</li>';


                    // $html
                    //     .find('tbody.' + id)
                    //     .append('<tr class="gina-toolbar-key-value"><td class="gina-toolbar-key">'+ i +'</td><td class="gina-toolbar-value gina-toolbar-value-type-is-'+ objType +'">'+ obj[i] +'</td></tr>')

                    //parseView(obj[i], ginaObj[i], i, $html.find('tbody.'+ i), $html );
                    // clear one level
                    id = id.substr(0, id.length - i.length - 1);
                } else {
                    objType = (ginaObj[i] === null) ? 'null' : typeof(ginaObj[i]);
                    if ( objType == 'undefined' ) { // new key  declaration added by user
                        // html += '<li class="gina-toolbar-key-value">';
                        // html +=     '<span class="gina-toolbar-key gina-toolbar-key-added">'+ i +':</span> <span class="gina-toolbar-value gina-toolbar-value-type-is-'+ objType +'">'+ obj[i] +'</span>';
                        // html += '</li>';

                        $html
                            .find('li.' + id + ' ul')
                            .append('<li class="gina-toolbar-key-value"><span class="gina-toolbar-key gina-toolbar-key-added">'+ i +':</span> <span class="gina-toolbar-value gina-toolbar-value-type-is-'+ objType +'">'+ obj[i]+'</span></li>');

                    } else {

                        if (/^_comment/.test(i) ) continue;

                        if (obj[i] !== ginaObj[i] ) {

                            $html
                                .find('li.' + id +' ul')
                                .append('<li class="gina-toolbar-key-value gina-toolbar-is-overridden"><span class="gina-toolbar-key">'+ i +':</span> <span class="gina-toolbar-value">'+ ginaObj[i] +'</span></li>');

                            $html
                                .find('li.' + id +' ul')
                                .append('<li class="gina-toolbar-key-value"><span class="gina-toolbar-key">'+ i +':</span> <span class="gina-toolbar-value gina-toolbar-value-type-is-'+ objType +'">'+ obj[i] +'</span></li>')

                        } else {

                            if (!id) {
                                $root
                                    .find('.gina-toolbar-properties')
                                    .append('<li class="gina-toolbar-key-value"><span class="gina-toolbar-key">'+ i +':</span> <span class="gina-toolbar-value gina-toolbar-value-type-is-'+ objType +'">'+ obj[i] +'</span></li>')
                            } else {
                                $root
                                    .find('li.' + id.substr(0, id.length - 1) +' ul')
                                    .append('<li class="gina-toolbar-key-value"><span class="gina-toolbar-key">'+ i +':</span> <span class="gina-toolbar-value gina-toolbar-value-type-is-'+ objType +'">'+ obj[i] +'</span></li>')
                            }
                        }
                    }
                }
            }

            return $root.html()
        }

        var parseRules = function (rules, id) {

            return parseObject(rules, rules, id)
        }

        var parseForms = function (obj, ginaObj, $html, i, $forms, len) {

            var attributes  = $forms[i].attributes;
            var attrClass   = 'gina-toolbar-form-attributes';
            var id          = $forms[i].getAttribute('id');

            var $form = $('<table id="gina-toolbar-form-html-properties">\n' +
                '                        <thead>\n' +
                '                            <tr>\n' +
                '                                <td colspan="2">'+ id +'</td>\n' +
                '                            </tr>\n' +
                '                        </thead>\n' +
                '                        <tbody class="'+ attrClass +'"></tbody>\n' +
                '                    </table>');

            var key         = null
                , val       = null
                , content   = null
                , hasEvents = false
            ;

            // adding for attributes
            for ( var a = 0, aLen = attributes.length; a < aLen; ++a ) {

                key     = attributes[a].name;
                val     = attributes[a].nodeValue;

                // filters
                if ( /^method$/.test(key) )
                    val = val.toUpperCase();

                if ( /^class$/.test(key) && /\s+/.test(val) )
                    val = '<ul><li>'+ val.replace(/\s+/g, '</li><li>') +'</li></ul>';

                content = val;


                if ( /^data-gina-form-event/.test(key) ) {

                    hasEvents = ( $form
                                    .find('.'+ attrClass)
                                    .find('td.gina-toolbar-key-events').length ) ? true : false;





                    if (!hasEvents) {

                        $form
                            .find('.'+ attrClass)
                            .append('<tr>' +
                                '       <td class="gina-toolbar-key gina-toolbar-key-events">events</td>' +
                                '       <td class="gina-toolbar-value-events"><table><tbody></tbody></table></td>' +
                                '</tr>');

                    }

                    key = key.replace(/^data-gina-form-event-/, '');
                    content = '<tr>' +
                        '           <td class="gina-toolbar-key-event">'+ key +'</td>' +
                        '           <td class="gina-toolbar-value gina-toolbar-value-event">'+ val +'</td>' +
                        '</tr>';


                    $form
                        .find('.'+ attrClass)
                        .find('.gina-toolbar-value-events > table > tbody')
                        .append(content)


                } else { // normal case
                    $form
                        .find('.'+ attrClass)
                        .append('<tr>' +
                            '       <td class="gina-toolbar-key">'+ key +'</td>' +
                            '       <td class="gina-toolbar-value">'+ content +'</td>' +
                            '</tr>')
                }


            }

            // adding form rules

            var rules = null;

            try {
                rules = eval('gina.forms.rules.' + id.replace(/-/g, '.'))
            } catch (err) {}

            if ( rules ) {

                $form
                    .find('.'+ attrClass)
                    .append('<tr>' +
                        '       <td class="gina-toolbar-key gina-toolbar-key-rules">rule</td>' +
                        '       <td class="gina-toolbar-value-rules"><ul class="gina-toolbar-code">'+ parseRules( rules, id ) +'</ul></td>' +
                '</tr>');

            }



            $html.append($form);

            ++i;

            if (i < len) {
                parseForms(obj, ginaObj, $html, i, $forms, len)
            }
        }

        var createInputFile = function(id, label) {

            var html = null;

            html  = '<label class="gina-toolbar-input-file">';
            html += '<input type="file" multiple id="' + id +'">';
            html += label;
            html += '</label>';

            return html
        }

        var loadJSON = function(txt, cb) {

            var html = createInputFile('mock', 'Select your JSON file');

            $htmlData.html(html);
            $json.text('');

            $htmlData.find('input').off('change').on('change', function(e) {

                var files   = $(this)[0].files;
                var file    = null;


                if (files.length == 1) {
                    file        = $(this)[0].files[0]; // jQuery way
                    var reader  = new FileReader();
                    reader.addEventListener('load', function(){
                        // user
                        $json.text(reader.result);
                        // gina <- being duplicated to prevent bugs
                        $ginaJson.text(reader.result);
                        cb();
                    }, false);

                    reader.readAsBinaryString(file)
                } else {
                    var done = 0;
                    var complete = function (done) {

                        if (done == files.length) {
                            cb()
                        }
                    };
                    var reader  = [];

                    for (var i = 0, len = files.length; i < len; ++i) {
                        file = files[i];
                        switch (true) {
                            case /user/.test(file.name):

                                reader[i]  = new FileReader();
                                reader[i].addEventListener('load', function(e){

                                    // user
                                    $json.text(e.currentTarget.result);
                                    ++done;
                                    complete(done)
                                }, false);

                                reader[i].readAsBinaryString(file);

                                break;

                            case /gina/.test(file.name):
                                //console.log(file);
                                reader[i]  = new FileReader();
                                reader[i].addEventListener('load', function(e){
                                    // gina
                                    $ginaJson.text(e.currentTarget.result);
                                    ++done;
                                    complete(done)
                                }, false);

                                reader[i].readAsBinaryString(file);

                                break;
                        }
                    }
                }

            });

            return false;
        }

        var makeFoldingPaths = function(obj, tmp) {
            for (var r in obj) {
                if ( typeof(obj[r]) == 'object' ) {
                    self.foldingPaths[tmp + r] = tmp + r;
                    makeFoldingPaths(obj[r], tmp + r+'-');
                }
            }
        }

        this.update = function (section, data) {
            loadData(section, data);
        }

        this.restore = function () {
            loadData('data', originalData.jsonObject, originalData.ginaJsonObject);
        }

        init();
    };

    return Toolbar
})