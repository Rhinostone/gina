var libPath = document.getElementById('gina').getAttribute('data-lib');

requirejs.config({
    baseUrl: libPath,
    paths: {
        plugin: '../plugin'
    }
});

// Start loading the main plugin file. Put all of
requirejs(['plugin/main']);