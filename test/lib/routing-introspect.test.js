var path = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var introspect = require(path.join(require('../fw'), 'lib/routing-introspect/src/main'));


// 01 — parseUrls
describe('01 - parseUrls', function () {

    it('returns [] for undefined input', function () {
        assert.deepEqual(introspect.parseUrls(undefined), []);
    });

    it('returns [] for empty string', function () {
        assert.deepEqual(introspect.parseUrls(''), []);
    });

    it('handles a simple string URL', function () {
        assert.deepEqual(introspect.parseUrls('/user/:id'), [
            { openApiPath: '/user/{id}', mcpPath: '/user/:id', params: ['id'] }
        ]);
    });

    it('strips trailing slash except on root', function () {
        assert.equal(introspect.parseUrls('/user/')[0].openApiPath, '/user');
        assert.equal(introspect.parseUrls('/')[0].openApiPath, '/');
    });

    it('splits comma-separated URLs', function () {
        var result = introspect.parseUrls('/a, /a/:b');
        assert.equal(result.length, 2);
        assert.deepEqual(result[0].params, []);
        assert.deepEqual(result[1].params, ['b']);
        assert.equal(result[0].mcpPath, '/a');
        assert.equal(result[1].mcpPath, '/a/:b');
    });

    it('accepts an array shape', function () {
        var result = introspect.parseUrls(['/one', '/two/:x']);
        assert.equal(result.length, 2);
        assert.deepEqual(result[1].params, ['x']);
    });

    it('collects multiple named segments in order', function () {
        var result = introspect.parseUrls('/a/:first/b/:second/c/:third');
        assert.deepEqual(result[0].params, ['first', 'second', 'third']);
        assert.equal(result[0].openApiPath, '/a/{first}/b/{second}/c/{third}');
    });

    it('ignores empty segments from trailing commas', function () {
        var result = introspect.parseUrls('/a, ');
        assert.equal(result.length, 1);
    });

    it('preserves mcpPath verbatim (no trailing-slash strip)', function () {
        // mcpPath is useful when a runtime server needs to match incoming URLs —
        // stripping it would break suffix-sensitive matching.
        assert.equal(introspect.parseUrls('/user/')[0].mcpPath, '/user/');
    });

});


// 02 — parseMethods
describe('02 - parseMethods', function () {

    it('defaults to ["get"] on undefined', function () {
        assert.deepEqual(introspect.parseMethods(undefined), ['get']);
    });

    it('defaults to ["get"] on empty string', function () {
        assert.deepEqual(introspect.parseMethods(''), ['get']);
    });

    it('defaults to ["get"] on non-string', function () {
        assert.deepEqual(introspect.parseMethods(null), ['get']);
        assert.deepEqual(introspect.parseMethods(123), ['get']);
    });

    it('lowercases', function () {
        assert.deepEqual(introspect.parseMethods('GET'), ['get']);
        assert.deepEqual(introspect.parseMethods('Post'), ['post']);
    });

    it('splits comma-separated', function () {
        assert.deepEqual(introspect.parseMethods('GET, POST'), ['get', 'post']);
    });

    it('trims whitespace', function () {
        assert.deepEqual(introspect.parseMethods('  put , delete '), ['put', 'delete']);
    });

    it('drops empty tokens', function () {
        assert.deepEqual(introspect.parseMethods('GET,,POST'), ['get', 'post']);
    });

});


// 03 — requirementToPattern
describe('03 - requirementToPattern', function () {

    it('returns .* pattern for non-string', function () {
        assert.deepEqual(introspect.requirementToPattern(undefined), { type: 'pattern', value: '.*' });
        assert.deepEqual(introspect.requirementToPattern(null), { type: 'pattern', value: '.*' });
        assert.deepEqual(introspect.requirementToPattern(42), { type: 'pattern', value: '.*' });
    });

    it('treats validator:: as opaque .* pattern', function () {
        assert.deepEqual(
            introspect.requirementToPattern('validator::email'),
            { type: 'pattern', value: '.*' }
        );
    });

    it('strips slash delimiters and flags from regex form', function () {
        assert.deepEqual(
            introspect.requirementToPattern('/^[0-9a-f]+$/i'),
            { type: 'pattern', value: '^[0-9a-f]+$' }
        );
    });

    it('handles UUID regex from real-world routing.json', function () {
        var r = introspect.requirementToPattern('/^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[0-9A-Za-z]{6})$/i');
        assert.equal(r.type, 'pattern');
        assert.ok(r.value.startsWith('^(['), 'pattern body preserved');
        assert.ok(!r.value.endsWith('/i'),   'flags stripped');
    });

    it('recognises simple pipe alternatives as enum', function () {
        assert.deepEqual(
            introspect.requirementToPattern('admin|user|guest'),
            { type: 'enum', value: ['admin', 'user', 'guest'] }
        );
    });

    it('does NOT treat pipes inside regex meta as enum', function () {
        var r = introspect.requirementToPattern('(^foo|bar$)');
        assert.equal(r.type, 'pattern');
        // wrapping parens stripped
        assert.equal(r.value, '^foo|bar$');
    });

    it('strips wrapping parens for bare regex bodies', function () {
        assert.equal(
            introspect.requirementToPattern('([a-z]+)').value,
            '[a-z]+'
        );
    });

});


// 04 — humanise
describe('04 - humanise', function () {

    it('returns empty string for empty input', function () {
        assert.equal(introspect.humanise(''), '');
        assert.equal(introspect.humanise(undefined), '');
    });

    it('splits hyphens and underscores', function () {
        assert.equal(introspect.humanise('user-get-profile'), 'User get profile');
        assert.equal(introspect.humanise('user_get_profile'), 'User get profile');
    });

    it('splits camelCase boundaries (preserving subsequent capitals)', function () {
        // Subsequent capitals are preserved — matches pre-refactor openapi.js behaviour.
        assert.equal(introspect.humanise('getUserProfile'), 'Get User Profile');
    });

    it('capitalises the first letter', function () {
        assert.equal(introspect.humanise('alpha'), 'Alpha');
    });

});


// 05 — toolName
describe('05 - toolName', function () {

    it('returns namespace.control when both present', function () {
        assert.equal(
            introspect.toolName('homepage', { namespace: 'content', param: { control: 'home' } }),
            'content.home'
        );
    });

    it('falls back to control when namespace absent', function () {
        assert.equal(
            introspect.toolName('homepage', { param: { control: 'home' } }),
            'home'
        );
    });

    it('falls back to routeName when neither present', function () {
        assert.equal(
            introspect.toolName('fallback', { param: {} }),
            'fallback'
        );
        assert.equal(
            introspect.toolName('fallback', {}),
            'fallback'
        );
    });

});


// 06 — buildCacheHeader
describe('06 - buildCacheHeader', function () {

    it('returns null for null/undefined', function () {
        assert.equal(introspect.buildCacheHeader(null), null);
        assert.equal(introspect.buildCacheHeader(undefined), null);
    });

    it('formats string shorthand', function () {
        assert.equal(introspect.buildCacheHeader('memory'), 'private, cached (memory)');
    });

    it('formats object with visibility', function () {
        assert.equal(
            introspect.buildCacheHeader({ visibility: 'public', ttl: 60 }),
            'public, max-age=60'
        );
    });

    it('defaults visibility to private', function () {
        assert.equal(
            introspect.buildCacheHeader({ ttl: 10 }),
            'private, max-age=10'
        );
    });

});


// 07 — isFrameworkInternal
describe('07 - isFrameworkInternal', function () {

    it('detects /_gina/ prefix', function () {
        assert.equal(introspect.isFrameworkInternal({ url: '/_gina/inspector' }), true);
        assert.equal(introspect.isFrameworkInternal({ url: '/_gina' }), true);
    });

    it('returns false for regular routes', function () {
        assert.equal(introspect.isFrameworkInternal({ url: '/' }), false);
        assert.equal(introspect.isFrameworkInternal({ url: '/api/users' }), false);
    });

    it('returns false for null / missing url', function () {
        assert.equal(introspect.isFrameworkInternal(null), false);
        assert.equal(introspect.isFrameworkInternal({}), false);
    });

    it('checks only the first URL in a comma-separated list', function () {
        // Mixed-internal-external cases are disallowed by convention — the
        // first URL determines classification. Documented behaviour.
        assert.equal(
            introspect.isFrameworkInternal({ url: '/_gina/x, /public' }),
            true
        );
    });

});


// 08 — eachRoute
describe('08 - eachRoute', function () {

    it('skips the $schema key', function () {
        var seen = [];
        introspect.eachRoute(
            { '$schema': 'https://...', home: { url: '/', method: 'GET', param: { control: 'home' } } },
            function (name) { seen.push(name); }
        );
        assert.deepEqual(seen, ['home']);
    });

    it('skips non-object values', function () {
        var seen = [];
        introspect.eachRoute(
            { note: 'some string', home: { url: '/', method: 'GET', param: { control: 'home' } } },
            function (name) { seen.push(name); }
        );
        assert.deepEqual(seen, ['home']);
    });

    it('is a no-op for null / non-object routing', function () {
        var seen = [];
        introspect.eachRoute(null,      function (n) { seen.push(n); });
        introspect.eachRoute(undefined, function (n) { seen.push(n); });
        introspect.eachRoute('nope',    function (n) { seen.push(n); });
        assert.deepEqual(seen, []);
    });

    it('stops iteration when callback returns false', function () {
        var seen = [];
        introspect.eachRoute(
            {
                a: { url: '/a', method: 'GET', param: { control: 'a' } },
                b: { url: '/b', method: 'GET', param: { control: 'b' } },
                c: { url: '/c', method: 'GET', param: { control: 'c' } }
            },
            function (name) { seen.push(name); if (name === 'a') return false; }
        );
        assert.deepEqual(seen, ['a']);
    });

});


// 09 — real-world routing.json smoke
describe('09 - real-world routing.json', function () {

    it('parses a real-world password-reset route cleanly', function () {
        var route = {
            namespace: 'account',
            url: '/account/password-reset/:id/:pubkey',
            method: 'GET',
            requirements: {
                id: '/^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[0-9A-Za-z]{6})$/i',
                pubkey: '/^pk\\_/i'
            },
            param: { control: 'passwordReset', id: ':id', pubkey: ':pubkey' }
        };

        var urls    = introspect.parseUrls(route.url);
        var methods = introspect.parseMethods(route.method);
        var name    = introspect.toolName('password-reset', route);

        assert.equal(urls.length, 1);
        assert.deepEqual(urls[0].params, ['id', 'pubkey']);
        assert.equal(urls[0].openApiPath, '/account/password-reset/{id}/{pubkey}');
        assert.deepEqual(methods, ['get']);
        assert.equal(name, 'account.passwordReset');

        var idPattern = introspect.requirementToPattern(route.requirements.id);
        assert.equal(idPattern.type, 'pattern');
        assert.ok(idPattern.value.indexOf('{12}') !== -1);
    });

    it('parses the multi-url account-password-update-xml route', function () {
        // Real shape from a consumer-app auth bundle — comma-separated URL
        var urls = introspect.parseUrls('/account/password-update/:id/:pubkey, /account/password-update/:id');
        assert.equal(urls.length, 2);
        assert.deepEqual(urls[0].params, ['id', 'pubkey']);
        assert.deepEqual(urls[1].params, ['id']);
    });

    it('parses the push route with GET, POST', function () {
        var methods = introspect.parseMethods('GET, POST');
        assert.deepEqual(methods, ['get', 'post']);
    });

});


// requirementToSchema / rulesToSchemaFragment (#DTO — un-collapse the `.*`)
describe('requirementToSchema — un-collapses validator:: into a real JSON Schema', function () {

    it('un-collapses an inline validator:: rule object (the router-form parse)', function () {
        assert.deepEqual(
            introspect.requirementToSchema('validator::{ isEmail: true, isString: [7] }'),
            { type: 'string', format: 'email', minLength: 7 }
        );
    });

    it('maps isInList to a typed enum', function () {
        assert.deepEqual(
            introspect.requirementToSchema('validator::{ isInList: ["admin", "user"] }'),
            { type: 'string', enum: ['admin', 'user'] }
        );
    });

    it('maps isInteger / isNumber / isBoolean / isDate to schema types', function () {
        assert.deepEqual(introspect.requirementToSchema('validator::{ isInteger: true }'), { type: 'integer' });
        assert.deepEqual(introspect.requirementToSchema('validator::{ isNumber: true }'),  { type: 'number' });
        assert.deepEqual(introspect.requirementToSchema('validator::{ isBoolean: true }'), { type: 'boolean' });
        assert.deepEqual(introspect.requirementToSchema('validator::{ isDate: ["yyyy-mm-dd"] }'), { type: 'string', format: 'date' });
    });

    it('a bare NAMED validator degrades to { type: string } (unresolvable purely)', function () {
        assert.deepEqual(introspect.requirementToSchema('validator::email'), { type: 'string' });
    });

    it('malformed inline object falls back to { type: string } (never throws)', function () {
        assert.deepEqual(introspect.requirementToSchema('validator::{ not json !! }'), { type: 'string' });
    });

    it('a regex requirement becomes a string pattern; a pipe-enum becomes an enum', function () {
        assert.deepEqual(introspect.requirementToSchema('/^[0-9]+$/'), { type: 'string', pattern: '^[0-9]+$' });
        assert.deepEqual(introspect.requirementToSchema('admin|user|guest'), { type: 'string', enum: ['admin', 'user', 'guest'] });
    });

    it('non-string input is safe', function () {
        assert.deepEqual(introspect.requirementToSchema(undefined), { type: 'string' });
        assert.deepEqual(introspect.requirementToSchema(42), { type: 'string' });
    });

    it('rulesToSchemaFragment: isString bounds + trailing null placeholders', function () {
        assert.deepEqual(introspect.rulesToSchemaFragment({ isString: [2, 40] }), { type: 'string', minLength: 2, maxLength: 40 });
        assert.deepEqual(introspect.rulesToSchemaFragment({ isString: [null, 9] }), { type: 'string', maxLength: 9 });
        assert.deepEqual(introspect.rulesToSchemaFragment({}), { type: 'string' });
    });

    // #B201 — the three bound forms that were silently dropped
    it('#B201: the scalar isString form maps to minLength (engine arity: N === [N])', function () {
        assert.deepEqual(introspect.rulesToSchemaFragment({ isString: 8 }), { type: 'string', minLength: 8 });
    });

    it('#B201: isInteger digit bounds annotate — description + x-gina-digitBounds, NO value facets', function () {
        var frag = introspect.rulesToSchemaFragment({ isInteger: [2, 4] });
        assert.deepEqual(frag, {
            type: 'integer',
            description: '2-4 digits (string-form length; a negative sign counts)',
            'x-gina-digitBounds': { min: 2, max: 4 }
        });
        // the rejected mappings must NOT appear: minimum/maximum are wrong for
        // negatives (the sign counts), minLength is inert on a numeric type.
        assert.equal(typeof frag.minimum,   'undefined');
        assert.equal(typeof frag.maximum,   'undefined');
        assert.equal(typeof frag.minLength, 'undefined');
    });

    it('#B201: scalar / exact / max-only digit-bound arities', function () {
        assert.deepEqual(introspect.rulesToSchemaFragment({ isInteger: 5 }), {
            type: 'integer',
            description: 'at least 5 digits (string-form length; a negative sign counts)',
            'x-gina-digitBounds': { min: 5 }
        });
        assert.deepEqual(introspect.rulesToSchemaFragment({ isInteger: [3, 3] }), {
            type: 'integer',
            description: 'exactly 3 digits (string-form length; a negative sign counts)',
            'x-gina-digitBounds': { min: 3, max: 3 }
        });
        assert.deepEqual(introspect.rulesToSchemaFragment({ isNumber: [null, 6] }), {
            type: 'number',
            description: 'at most 6 digits (string-form length; a negative sign counts)',
            'x-gina-digitBounds': { max: 6 }
        });
    });

    it('#B201 CONTROL: the bare-true forms stay exactly as before (no annotation)', function () {
        assert.deepEqual(introspect.rulesToSchemaFragment({ isInteger: true }), { type: 'integer' });
        assert.deepEqual(introspect.rulesToSchemaFragment({ isNumber: true }),  { type: 'number' });
        assert.deepEqual(introspect.rulesToSchemaFragment({ isString: true }),  { type: 'string' });
    });

    it('#B201: the annotations flow through requirementToSchema (the consumer entry point)', function () {
        var frag = introspect.requirementToSchema('validator::{ isInteger: [2, 4] }');
        assert.equal(frag.type, 'integer');
        assert.deepEqual(frag['x-gina-digitBounds'], { min: 2, max: 4 });
        assert.match(frag.description, /2-4 digits/);
    });
});
