'use strict';
/**
 * lib/cmd/bundle/openapi.js — the `bundle:openapi` DTO emit (#DTO1c).
 *
 * `buildSpec` / `buildOperation` are private closures (the file exports only the
 * command ctor), so this suite follows the gina cmd-handler house style
 * (minion-list.test.js): SOURCE PINS lock the wiring, and a SOURCE-LOCKED
 * pure-logic REPLICA of the DTO-emission branches is driven through the REAL
 * `lib.dto` + `lib.routingIntrospect` to prove the emit is not inert.
 *
 * The full end-to-end (a real offline `gina bundle:openapi` against a scaffold
 * bundle with a factory DTO) was run during the build and confirmed a real
 * requestBody / responses / un-collapsed param schema — a scaffold boot is too
 * heavy for the unit suite, so the replica is the automated proxy.
 */
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW      = require('../fw');
var SRC     = fs.readFileSync(path.join(FW, 'lib/cmd/bundle/openapi.js'), 'utf8');
var dto     = require(path.join(FW, 'lib/dto/src/main.js'));
var introspect = require(path.join(FW, 'lib/routing-introspect/src/main.js'));

// Register the DTOs the replica resolves (srcPath=null -> dto.load registry fallback;
// the file/factory resolution path is covered by dto.test.js §08).
dto.register('OA_Create', dto.object({
    email: dto.string().email().required(),
    age:   dto.integer().min(0).max(120),
    role:  dto.enum(['admin', 'user']).required()
}));
dto.register('OA_View', dto.object({
    id:    dto.string().required(),
    email: dto.string().email()
}));
dto.register('OA_ViewExcl', dto.object({
    id:           dto.string().required(),
    email:        dto.string().email(),
    passwordHash: dto.string().required().exclude()
}));

/**
 * A source-locked replica of openapi.js `buildOperation`'s DTO-emission branches
 * (the non-redirect path). Mirrors the shipped logic line-for-line; §01 pins keep
 * it from drifting from the real source.
 */
function emitOperation(route, method, srcPath) {
    var param     = route.param || {};
    var reqs      = route.requirements || {};
    var urlParams = route._urlParams || [];
    var operation = { operationId: 'op', responses: {} };

    if (urlParams.length > 0) {
        operation.parameters = [];
        for (var i = 0; i < urlParams.length; i++) {
            var pName = urlParams[i];
            var paramObj = { name: pName, in: 'path', required: true, schema: { type: 'string' } };
            if (typeof reqs[pName] !== 'undefined') {
                var rawReq = reqs[pName];
                if (typeof rawReq === 'string' && rawReq.indexOf('validator::') === 0) {
                    var frag = introspect.requirementToSchema(rawReq);
                    for (var fk in frag) { if (frag.hasOwnProperty(fk)) { paramObj.schema[fk] = frag[fk]; } }
                } else {
                    var p = introspect.requirementToPattern(rawReq);
                    if (p.type === 'pattern') { paramObj.schema.pattern = p.value; }
                    else if (p.type === 'enum') { paramObj.schema.enum = p.value; }
                }
            }
            operation.parameters.push(paramObj);
        }
    }

    var reqDto = null;
    if (param.dto && /^(post|put|patch)$/i.test(method)) {
        reqDto = dto.load(srcPath, param.dto);
        if (reqDto) {
            operation.requestBody = {
                required: true,
                content: { 'application/json': { schema: reqDto.toJsonSchema('2020-12') } }
            };
        }
    }

    operation.responses['200'] = { description: 'Successful response' };
    if (param.responseDto) {
        var respDto = dto.load(srcPath, param.responseDto);
        if (respDto) {
            operation.responses['200'].content = {
                'application/json': { schema: respDto.toJsonSchema('2020-12', { dropExcluded: true }) }
            };
        }
    }
    if (reqDto) { operation.responses['422'] = { description: 'Validation failed' }; }

    return operation;
}


describe('bundle:openapi §01 — source pins (DTO wiring)', function () {
    it('01.1 - requires the dto builder from the lib registry', function () {
        assert.ok(SRC.indexOf('var dto         = lib.dto;') > -1, 'var dto = lib.dto');
    });
    it('01.2 - threads srcPath through buildSpec (definition + call)', function () {
        assert.ok(SRC.indexOf('var buildSpec = function(bundle, routing, settings, portInfo, srcPath)') > -1);
        assert.ok(SRC.indexOf('buildSpec(bundle, routing, settings, portInfo, srcPath)') > -1);
    });
    it('01.3 - threads method + srcPath through buildOperation (definition + call)', function () {
        assert.ok(SRC.indexOf('var buildOperation = function(routeName, route, urlParams, namespace, multiMethod, method, srcPath)') > -1);
        assert.ok(SRC.indexOf('buildOperation(routeName, route, urlInfo.params, namespace, methods.length > 1, method, srcPath)') > -1);
    });
    it('01.4 - requestBody is gated on a mutating method + param.dto, resolved via dto.load, emitted as 2020-12', function () {
        assert.match(SRC, /if \( param\.dto && \/\^\(post\|put\|patch\)\$\/i\.test\(method\) \)/);
        assert.ok(SRC.indexOf('reqDto = dto.load(srcPath, param.dto)') > -1);
        assert.ok(SRC.indexOf('operation.requestBody = {') > -1);
        assert.match(SRC, /schema: reqDto\.toJsonSchema\('2020-12'\)/);
    });
    it('01.5 - responses carry a responseDto 200 schema and a 422 when a request DTO exists', function () {
        assert.ok(SRC.indexOf('if ( param.responseDto ) {') > -1);
        assert.ok(SRC.indexOf('respDto = dto.load(srcPath, param.responseDto)') > -1);
        assert.match(SRC, /operation\.responses\['200'\]\.content = \{/);
        assert.match(SRC, /operation\.responses\['422'\] = \{ description: 'Validation failed' \}/);
    });
    it('01.6 - a validator:: requirement is un-collapsed via requirementToSchema; pattern/enum kept for the rest', function () {
        assert.match(SRC, /rawReq\.indexOf\('validator::'\) === 0/);
        assert.ok(SRC.indexOf('introspect.requirementToSchema(rawReq)') > -1);
        assert.ok(SRC.indexOf('introspect.requirementToPattern(rawReq)') > -1, 'regex/enum path retained');
    });
    it('01.7 - the 200 schema is the RESPONSE projection (dropExcluded); the requestBody keeps the declared shape (#B110)', function () {
        assert.match(SRC, /schema: respDto\.toJsonSchema\('2020-12', \{ dropExcluded: true \}\)/);
        assert.match(SRC, /schema: reqDto\.toJsonSchema\('2020-12'\)/, 'request emission unchanged — no drop');
    });
});


describe('bundle:openapi §02 — replica: DTO emit is real (not inert)', function () {
    it('02.1 - POST + param.dto emits a real 2020-12 requestBody', function () {
        var op = emitOperation({ param: { dto: 'OA_Create' } }, 'post', null);
        var s = op.requestBody && op.requestBody.content['application/json'].schema;
        assert.ok(op.requestBody && op.requestBody.required === true);
        assert.equal(s.properties.email.format, 'email');
        assert.equal(s.properties.age.minimum, 0);
        assert.equal(s.properties.age.maximum, 120);
        assert.deepEqual(s.properties.role.enum, ['admin', 'user']);
        assert.ok(s.required.indexOf('email') > -1 && s.required.indexOf('role') > -1);
        assert.equal(s.additionalProperties, false);
    });
    it('02.2 - a request DTO adds a 422 response', function () {
        var op = emitOperation({ param: { dto: 'OA_Create' } }, 'put', null);
        assert.ok(op.responses['422']);
    });
    it('02.3 - param.responseDto emits a real 200 response schema', function () {
        var op = emitOperation({ param: { dto: 'OA_Create', responseDto: 'OA_View' } }, 'post', null);
        var r = op.responses['200'].content['application/json'].schema;
        assert.deepEqual(Object.keys(r.properties), ['id', 'email']);
        assert.deepEqual(r.required, ['id']);
    });
    it('02.4 - SUBTRACT: a GET with param.dto emits NO requestBody (method gate)', function () {
        var op = emitOperation({ param: { dto: 'OA_Create' } }, 'get', null);
        assert.equal(op.requestBody, undefined);
        assert.equal(op.responses['422'], undefined);
    });
    it('02.5 - SUBTRACT: a POST with no param.dto emits NO requestBody', function () {
        var op = emitOperation({ param: { control: 'x' } }, 'post', null);
        assert.equal(op.requestBody, undefined);
        assert.equal(op.responses['422'], undefined);
    });
    it('02.6 - SUBTRACT: an unresolved param.dto emits NO requestBody (fail-soft)', function () {
        var op = emitOperation({ param: { dto: 'OA_DoesNotExist' } }, 'post', null);
        assert.equal(op.requestBody, undefined);
    });
    it('02.7 - a validator:: URL-param requirement is un-collapsed to a real schema fragment', function () {
        var op = emitOperation({
            param: { dto: null }, _urlParams: ['id'],
            requirements: { id: 'validator::{ isString: [3, 40] }' }
        }, 'get', null);
        var idSchema = op.parameters[0].schema;
        assert.equal(idSchema.type, 'string');
        assert.equal(idSchema.minLength, 3);
        assert.equal(idSchema.maxLength, 40);
        assert.equal(idSchema.pattern, undefined, 'not collapsed to a pattern');
    });
    it('02.8 - a regex / pipe requirement still uses pattern / enum (unchanged path)', function () {
        var re = emitOperation({ _urlParams: ['x'], requirements: { x: '/^[0-9]+$/' } }, 'get', null);
        assert.equal(re.parameters[0].schema.pattern, '^[0-9]+$');
        var en = emitOperation({ _urlParams: ['y'], requirements: { y: 'a|b|c' } }, 'get', null);
        assert.deepEqual(en.parameters[0].schema.enum, ['a', 'b', 'c']);
    });
    it('02.9 - #B110: an `.exclude()`d field leaves the 200 schema (properties + required[]) but STAYS in the requestBody', function () {
        var op  = emitOperation({ param: { dto: 'OA_ViewExcl', responseDto: 'OA_ViewExcl' } }, 'post', null);
        var req = op.requestBody.content['application/json'].schema;
        var res = op.responses['200'].content['application/json'].schema;
        // request side: the client DOES send it — declared shape kept
        assert.ok(req.properties.passwordHash, 'requestBody keeps the excluded field');
        assert.ok(req.required.indexOf('passwordHash') > -1);
        // response side: the wire can never carry it (apply() deletes it)
        assert.equal(res.properties.passwordHash, undefined);
        assert.deepEqual(Object.keys(res.properties), ['id', 'email']);
        assert.deepEqual(res.required, ['id'], 'required+excluded left required[] too');
    });
});
