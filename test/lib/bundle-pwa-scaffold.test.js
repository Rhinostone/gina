/**
 * PWA scaffold (#R6) — boilerplate assets and default-layout wiring.
 *
 * #R6 adds a starter Progressive Web App setup to the bundle scaffold:
 *   - core/template/boilerplate/bundle_public/manifest.webmanifest
 *   - core/template/boilerplate/bundle_public/sw.js
 *   - the manifest link + theme-color meta + apple-touch-icon link + an
 *     inline service-worker registration script in
 *     core/template/boilerplate/bundle_templates/html/layouts/main.html
 *
 * These files reach a bundle's public/ and templates/ directories together
 * via `gina view:add` (lib/cmd/view/add.js copyFolder() copies bundle_public/
 * to <bundle>/public/ and bundle_templates/ to <bundle>/templates/). They are
 * static — view:add does not token-substitute anything under bundle_public/,
 * so the shipped bytes are what a scaffolded bundle receives.
 *
 * Scaffolding the CLI for real is heavy (project registry, port scan, globals
 * injected by gna.js); these assertions instead prove the source structure of
 * the shipped boilerplate, the same style as connector-add.test.js.
 */

'use strict';

var fs   = require('fs');
var path = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var FW = require('../fw');

var MANIFEST_PATH = path.join(FW, 'core/template/boilerplate/bundle_public/manifest.webmanifest');
var SW_PATH       = path.join(FW, 'core/template/boilerplate/bundle_public/sw.js');
var README_PATH   = path.join(FW, 'core/template/boilerplate/bundle_public/readme.md');
var LAYOUT_PATH   = path.join(FW, 'core/template/boilerplate/bundle_templates/html/layouts/main.html');
var VIEW_ADD_PATH = path.join(FW, 'lib/cmd/view/add.js');

var manifestRaw = fs.readFileSync(MANIFEST_PATH, 'utf8');
var manifest    = JSON.parse(manifestRaw);
var swSrc       = fs.readFileSync(SW_PATH, 'utf8');
var readmeSrc   = fs.readFileSync(README_PATH, 'utf8');
var layoutSrc   = fs.readFileSync(LAYOUT_PATH, 'utf8');
var viewAddSrc  = fs.readFileSync(VIEW_ADD_PATH, 'utf8');


// ---------------------------------------------------------------------------
// 01 — manifest.webmanifest exists and is a valid web app manifest
// ---------------------------------------------------------------------------

describe('01 - manifest.webmanifest', function () {

    it('ships in bundle_public/ and parses as JSON', function () {
        assert.ok(fs.existsSync(MANIFEST_PATH), 'manifest.webmanifest must ship in bundle_public/');
        assert.equal(typeof manifest, 'object');
    });

    it('declares non-empty name and short_name', function () {
        assert.equal(typeof manifest.name, 'string');
        assert.ok(manifest.name.length > 0);
        assert.equal(typeof manifest.short_name, 'string');
        assert.ok(manifest.short_name.length > 0);
    });

    it('start_url is "/"', function () {
        assert.equal(manifest.start_url, '/');
    });

    it('display is "standalone"', function () {
        assert.equal(manifest.display, 'standalone');
    });

    it('declares theme_color and background_color as hex colours', function () {
        assert.match(manifest.theme_color, /^#[0-9a-fA-F]{3,8}$/);
        assert.match(manifest.background_color, /^#[0-9a-fA-F]{3,8}$/);
    });

    it('icons is a non-empty array referencing the shipped favicon.ico baseline', function () {
        assert.ok(Array.isArray(manifest.icons));
        assert.ok(manifest.icons.length > 0);
        var hasFavicon = manifest.icons.some(function (icon) {
            return /favicon\.ico$/.test(icon.src);
        });
        assert.ok(hasFavicon, 'icons must reference /favicon.ico — the only icon binary the scaffold ships (D1: no fake PNGs)');
    });

    it('every icon entry has src, sizes and type', function () {
        manifest.icons.forEach(function (icon) {
            assert.equal(typeof icon.src, 'string');
            assert.equal(typeof icon.sizes, 'string');
            assert.equal(typeof icon.type, 'string');
        });
    });
});


// ---------------------------------------------------------------------------
// 02 — sw.js service worker stub
// ---------------------------------------------------------------------------

describe('02 - sw.js', function () {

    it('ships in bundle_public/', function () {
        assert.ok(fs.existsSync(SW_PATH), 'sw.js must ship in bundle_public/');
    });

    it('declares a versioned CACHE_NAME constant', function () {
        assert.match(swSrc, /var CACHE_NAME\s*=\s*'[^']+-v\d+'/);
    });

    it('declares a PRECACHE_URLS list', function () {
        assert.match(swSrc, /var PRECACHE_URLS\s*=\s*\[/);
    });

    it('registers install, activate and fetch handlers', function () {
        assert.match(swSrc, /addEventListener\(\s*'install'/);
        assert.match(swSrc, /addEventListener\(\s*'activate'/);
        assert.match(swSrc, /addEventListener\(\s*'fetch'/);
    });

    it('install pre-caches the app shell via caches.open + cache.addAll', function () {
        assert.match(swSrc, /caches\.open\(CACHE_NAME\)/);
        assert.match(swSrc, /\.addAll\(PRECACHE_URLS\)/);
    });

    it('activate purges stale cache buckets', function () {
        assert.match(swSrc, /caches\.keys\(\)/);
        assert.match(swSrc, /caches\.delete\(/);
    });

    it('fetch uses a cache-first strategy (caches.match before network fetch)', function () {
        assert.match(swSrc, /caches\.match\(event\.request\)/);
        assert.match(swSrc, /return fetch\(event\.request\)/);
        var matchIdx = swSrc.indexOf('caches.match(event.request)');
        var fetchIdx = swSrc.indexOf('return fetch(event.request)');
        assert.ok(matchIdx > 0 && fetchIdx > matchIdx, 'cache lookup must precede the network fetch');
    });

    it('fetch handler only handles GET requests', function () {
        assert.match(swSrc, /event\.request\.method\s*!==?\s*'GET'/);
    });

    it('falls back to the precached shell for offline navigations', function () {
        assert.match(swSrc, /\.catch\(/);
        assert.match(swSrc, /event\.request\.mode\s*===?\s*'navigate'/);
        assert.match(swSrc, /caches\.match\('\/'\)/);
    });
});


// ---------------------------------------------------------------------------
// 03 — readme.md documents the PWA assets and icon drop-in
// ---------------------------------------------------------------------------

describe('03 - readme.md', function () {

    it('preserves the original public-directory note', function () {
        assert.match(readmeSrc, /public.+directory/i);
    });

    it('documents manifest.webmanifest and sw.js', function () {
        assert.match(readmeSrc, /manifest\.webmanifest/);
        assert.match(readmeSrc, /sw\.js/);
    });

    it('tells the dev to drop in icon-192.png, icon-512.png and apple-touch-icon.png', function () {
        assert.match(readmeSrc, /icon-192\.png/);
        assert.match(readmeSrc, /icon-512\.png/);
        assert.match(readmeSrc, /apple-touch-icon\.png/);
    });

    it('references favicon.ico as the baseline icon (D1)', function () {
        assert.match(readmeSrc, /favicon\.ico/);
    });
});


// ---------------------------------------------------------------------------
// 04 — main.html layout wires the PWA tags
// ---------------------------------------------------------------------------

describe('04 - main.html layout', function () {

    it('links the web app manifest', function () {
        // Substring checks — tolerant of attribute order / extra attributes.
        assert.ok(layoutSrc.indexOf('rel="manifest"') > -1, 'main.html must carry a rel="manifest" link');
        assert.ok(layoutSrc.indexOf('href="/manifest.webmanifest"') > -1, 'the manifest link must point at /manifest.webmanifest');
    });

    it('declares a theme-color meta tag', function () {
        assert.ok(layoutSrc.indexOf('name="theme-color"') > -1, 'main.html must carry a theme-color meta tag');
    });

    it('links an apple-touch-icon', function () {
        assert.ok(layoutSrc.indexOf('rel="apple-touch-icon"') > -1, 'main.html must carry a rel="apple-touch-icon" link');
        assert.ok(layoutSrc.indexOf('href="/apple-touch-icon.png"') > -1, 'the apple-touch-icon link must point at /apple-touch-icon.png');
    });

    it('registers the service worker from an inline script', function () {
        assert.match(layoutSrc, /'serviceWorker' in navigator/);
        assert.match(layoutSrc, /navigator\.serviceWorker\.register\('\/sw\.js'\)/);
    });

    it('feature-detects serviceWorker before calling register()', function () {
        var guardIdx = layoutSrc.indexOf("'serviceWorker' in navigator");
        var regIdx   = layoutSrc.indexOf('navigator.serviceWorker.register');
        assert.ok(guardIdx > 0 && regIdx > guardIdx, 'the feature-detect guard must precede register()');
    });

    it('catches registration failure to keep the console clean', function () {
        assert.match(layoutSrc, /\.register\('\/sw\.js'\)\.catch\(/);
    });

    it('keeps all PWA tags inside <head>', function () {
        var headEnd     = layoutSrc.indexOf('</head>');
        var manifestIdx = layoutSrc.indexOf('rel="manifest"');
        var themeIdx    = layoutSrc.indexOf('name="theme-color"');
        var touchIdx    = layoutSrc.indexOf('rel="apple-touch-icon"');
        assert.ok(headEnd > 0, '</head> must exist');
        assert.ok(manifestIdx > 0 && manifestIdx < headEnd, 'manifest link must be in <head>');
        assert.ok(themeIdx > 0 && themeIdx < headEnd, 'theme-color meta must be in <head>');
        assert.ok(touchIdx > 0 && touchIdx < headEnd, 'apple-touch-icon link must be in <head>');
    });

    it('theme-color meta matches the manifest theme_color', function () {
        // Locate the theme-color meta tag (tolerant of attribute order), then
        // pull its content value out of the matched tag.
        var metaTag = layoutSrc.match(/<meta[^>]*name="theme-color"[^>]*>/);
        assert.ok(metaTag, 'theme-color meta must be present');
        var content = metaTag[0].match(/content="(#[0-9a-fA-F]{3,8})"/);
        assert.ok(content, 'theme-color meta must declare a hex content value');
        assert.equal(content[1], manifest.theme_color, 'layout theme-color must match manifest theme_color');
    });
});


// ---------------------------------------------------------------------------
// 05 — view:add is the delivery path for both bundle_public/ and bundle_templates/
// ---------------------------------------------------------------------------

describe('05 - view:add delivery path', function () {

    it('copyFolder() copies bundle_public/ to <bundle>/public/', function () {
        assert.match(viewAddSrc, /boilerplate\/bundle_public/);
        assert.match(viewAddSrc, /folderPublic\.cp\(target \+ '\/public'/);
    });

    it('copyFolder() copies bundle_templates/ to <bundle>/templates/', function () {
        assert.match(viewAddSrc, /boilerplate\/bundle_templates/);
        assert.match(viewAddSrc, /folder\.cp\(target \+ '\/templates'/);
    });
});
