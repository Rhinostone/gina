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
 *
 * §03/§04 cover the authorization contract (securitySchemes + per-operation
 * security + 401/403 on gated routes): §03 pins the wiring, §04 EXECUTES the
 * shipped helper bytes (control-gated extraction — no replica to drift).
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


/**
 * Extracts a self-contained `var <name> = function(...) {...}` expression from
 * SRC by brace-matching and compiles those exact bytes. Control-gated: the
 * caller asserts the declaration exists exactly once before trusting the
 * extraction (an extraction that cannot fail is not a control). Only safe for
 * bodies with no braces inside string literals — true for both auth helpers.
 */
function extractFn(src, decl) {
    var declIdx = src.indexOf(decl);
    assert.ok(declIdx > -1, 'declaration found: ' + decl);
    assert.equal(src.indexOf(decl, declIdx + 1), -1, 'declaration appears exactly once');
    var braceIdx = declIdx + decl.length - 1;           // the trailing `{` of the decl string
    assert.equal(src[braceIdx], '{', 'decl string ends at the opening brace');
    var depth = 1, i = braceIdx + 1;
    for (; i < src.length && depth > 0; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') depth--;
    }
    assert.equal(depth, 0, 'braces balanced');
    var fnSrc = src.slice(src.indexOf('function', declIdx), i);
    assert.equal(fnSrc[fnSrc.length - 1], '}', 'extraction ends at the close brace');
    var fn = new Function('return (' + fnSrc + ');')();
    assert.equal(typeof fn, 'function', 'extraction compiles');
    return fn;
}


describe('bundle:openapi §03 — auth contract source pins', function () {
    it('03.1 - settings.json is read via requireJSON (comment-tolerant), never a plain require', function () {
        assert.ok(SRC.indexOf('settings = requireJSON(settingsPath)') > -1, 'requireJSON read');
        assert.ok(SRC.indexOf('settings = require(settingsPath)') === -1, 'plain-require form retired file-wide');
    });
    it('03.2 - hasMachineAuth mirrors the runtime fail-closed reading (strict enabled + a credential source)', function () {
        assert.ok(SRC.indexOf('var hasMachineAuth = function(settings) {') > -1);
        assert.ok(SRC.indexOf('machine.enabled !== true') > -1, 'strict boolean gate — a truthy string emits nothing');
        assert.match(SRC, /Object\.keys\(machine\.callers\)\.length > 0/, 'non-empty callers is a credential source');
        assert.match(SRC, /typeof\(machine\.authenticator\) == 'string'\s*&&\s*machine\.authenticator !== ''/, 'named authenticator is a credential source');
    });
    it('03.3 - applyAuthContract gates on the exact runtime authz predicate', function () {
        assert.ok(SRC.indexOf('var applyAuthContract = function(operation, param, machineAuth, defaultDeny) {') > -1);
        assert.ok(SRC.indexOf('param.requireAuth === true || hasRoles || hasPolicy') > -1, 'strict-true requireAuth, roles/policy imply');
        assert.match(SRC, /Array\.isArray\(param\.roles\) && param\.roles\.length > 0/);
        assert.match(SRC, /typeof\(param\.policy\) == 'string' && param\.policy !== ''/);
    });
    it('03.4 - the bearerAuth scheme is http/bearer and emitted only under the machine-auth gate', function () {
        assert.match(SRC, /bearerAuth:\s*\{\s*type:\s*'http',\s*scheme:\s*'bearer'/, 'contiguous scheme shape');
        assert.match(SRC, /var machineAuth = hasMachineAuth\(settings\);\s*if \(machineAuth\) \{\s*spec\.components = \{/, 'components assigned only inside the gate');
        assert.equal(SRC.match(/spec\.components/g).length, 1, 'no other components writer');
    });
    it('03.5 - the per-operation security requirement + the loop call site', function () {
        assert.ok(SRC.indexOf('operation.security = [ { bearerAuth: [] } ];') > -1);
        assert.ok(SRC.indexOf('applyAuthContract(operation, route.param || {}, machineAuth, defaultDeny);') > -1);
    });
    it('03.6 - 401 in both branches, 403 once; role/policy names never emitted as extensions', function () {
        assert.equal(SRC.match(/operation\.responses\['401'\]/g).length, 2, 'machine + session branches');
        assert.equal(SRC.match(/operation\.responses\['403'\]/g).length, 1);
        assert.ok(SRC.indexOf('x-required-roles') === -1, 'no vendor extension naming roles');
        assert.ok(SRC.indexOf('x-required-policy') === -1, 'no vendor extension naming the policy');
    });
});


describe('bundle:openapi §04 — auth contract behavior (executing the shipped bytes)', function () {
    var hasMachineAuthFn  = extractFn(SRC, 'var hasMachineAuth = function(settings) {');
    var applyAuthContract = extractFn(SRC, 'var applyAuthContract = function(operation, param, machineAuth, defaultDeny) {');

    var freshOp = function () {
        return { operationId: 'x', responses: { '200': { description: 'Successful response' } } };
    };

    it('04.1 - hasMachineAuth: fail-closed matrix', function () {
        assert.equal(hasMachineAuthFn(null), false, 'null settings');
        assert.equal(hasMachineAuthFn({}), false, 'no auth block');
        assert.equal(hasMachineAuthFn({ auth: null }), false, 'null auth');
        assert.equal(hasMachineAuthFn({ auth: {} }), false, 'no machine block');
        assert.equal(hasMachineAuthFn({ auth: { machine: { enabled: false, callers: { svc: { key: 'k' } } } } }), false, 'disabled');
        assert.equal(hasMachineAuthFn({ auth: { machine: { enabled: 'true', callers: { svc: { key: 'k' } } } } }), false, 'truthy STRING enabled emits nothing (fail-closed mirror)');
        assert.equal(hasMachineAuthFn({ auth: { machine: { enabled: true } } }), false, 'enabled but no credential source');
        assert.equal(hasMachineAuthFn({ auth: { machine: { enabled: true, callers: {} } } }), false, 'empty callers map');
        assert.equal(hasMachineAuthFn({ auth: { machine: { enabled: true, callers: {}, authenticator: '' } } }), false, 'empty authenticator string');
        assert.equal(hasMachineAuthFn({ auth: { machine: { enabled: true, callers: { svc: { key: 'k' } } } } }), true, 'one caller suffices');
        assert.equal(hasMachineAuthFn({ auth: { machine: { enabled: true, authenticator: 'jwt' } } }), true, 'authenticator-only suffices');
    });

    it('04.2 - a non-gated route is byte-untouched (with and without machine auth)', function () {
        var control = freshOp();
        var op1 = freshOp();
        applyAuthContract(op1, {}, true);
        assert.deepEqual(op1, control, 'empty param, machine on');
        var op2 = freshOp();
        applyAuthContract(op2, { control: 'home', dto: 'OA_Create' }, false);
        assert.deepEqual(op2, control, 'ungated param keys, machine off');
        var op3 = freshOp();
        applyAuthContract(op3, { requireAuth: 'true' }, true);
        assert.deepEqual(op3, control, 'a truthy-STRING requireAuth does not gate (matches the runtime === true test)');
        var op4 = freshOp();
        applyAuthContract(op4, { roles: [], policy: '' }, true);
        assert.deepEqual(op4, control, 'empty roles / empty policy do not gate');
    });

    it('04.3 - requireAuth + machine auth: security + 401, no 403, 200 preserved', function () {
        var op = freshOp();
        applyAuthContract(op, { requireAuth: true }, true);
        assert.deepEqual(op.security, [ { bearerAuth: [] } ]);
        assert.equal(op.responses['401'].description, 'Authentication required');
        assert.equal(op.responses['403'], undefined, 'authN-only route never advertises a 403');
        assert.equal(op.responses['200'].description, 'Successful response', 'existing responses preserved');
    });

    it('04.4 - requireAuth without machine auth: session-prose 401, NO security array', function () {
        var op = freshOp();
        applyAuthContract(op, { requireAuth: true }, false);
        assert.equal(op.security, undefined, 'no honest scheme to reference');
        assert.ok(op.responses['401'].description.indexOf('authenticated session') > -1, 'session prose carries the credential story');
        assert.equal(op.responses['403'], undefined);
    });

    it('04.5 - roles/policy add the 403 — and their NAMES never reach the spec', function () {
        var opRoles = freshOp();
        applyAuthContract(opRoles, { roles: ['admin', 'editor'] }, true);
        assert.deepEqual(opRoles.security, [ { bearerAuth: [] } ], 'roles imply requireAuth');
        assert.ok(opRoles.responses['401'], '401 present');
        assert.ok(opRoles.responses['403'], '403 present');
        var emitted = JSON.stringify(opRoles);
        assert.ok(emitted.indexOf('admin') === -1 && emitted.indexOf('editor') === -1, 'role names never emitted');

        var opPolicy = freshOp();
        applyAuthContract(opPolicy, { policy: 'ownsInvoice' }, false);
        assert.ok(opPolicy.responses['403'], 'policy implies the 403');
        assert.equal(opPolicy.security, undefined);
        assert.ok(JSON.stringify(opPolicy).indexOf('ownsInvoice') === -1, 'policy name never emitted');
    });

    it('04.6 - a gated redirect-branch operation gains the 401 alongside its 3xx', function () {
        var op = { operationId: 'r', responses: { '301': { description: 'Redirect to /next' } } };
        applyAuthContract(op, { requireAuth: true }, true);
        assert.ok(op.responses['301'], 'redirect response untouched');
        assert.ok(op.responses['401'], '401 added');
        assert.deepEqual(op.security, [ { bearerAuth: [] } ]);
    });
});


/* ------------------------------------------------------------------------- *
 * §05 — #COMPLY10: the spec follows the deny-by-default mode
 *
 * Under `auth.requireAuthByDefault` the runtime gates un-annotated routes, so a
 * spec that still described them as unauthenticated would be a published
 * contract lying about its own security. These execute the shipped bytes, so a
 * predicate that drifts from the runtime fails here.
 * ------------------------------------------------------------------------- */
describe('bundle:openapi §05 — deny-by-default (#COMPLY10)', function () {
    var hasDefaultDenyFn  = extractFn(SRC, 'var hasRequireAuthByDefault = function(settings) {');
    var applyAuthContract = extractFn(SRC, 'var applyAuthContract = function(operation, param, machineAuth, defaultDeny) {');

    var freshOp = function () {
        return { operationId: 'x', responses: { '200': { description: 'Successful response' } } };
    };

    it('05.1 - hasRequireAuthByDefault: fail-closed matrix (strict === true)', function () {
        assert.equal(hasDefaultDenyFn(null), false, 'null settings');
        assert.equal(hasDefaultDenyFn({}), false, 'no auth block');
        assert.equal(hasDefaultDenyFn({ auth: null }), false, 'null auth');
        assert.equal(hasDefaultDenyFn({ auth: {} }), false, 'key absent');
        assert.equal(hasDefaultDenyFn({ auth: { requireAuthByDefault: false } }), false, 'explicit false');
        assert.equal(hasDefaultDenyFn({ auth: { requireAuthByDefault: 'true' } }), false,
            'a truthy STRING does not enable the mode at runtime, so it must not enable it in the spec');
        assert.equal(hasDefaultDenyFn({ auth: { requireAuthByDefault: true } }), true);
    });

    it('05.2 - mode ON: an un-annotated route is described as gated', function () {
        var op = freshOp();
        applyAuthContract(op, { control: 'dashboard' }, false, true);
        assert.ok(op.responses['401'], 'the 401 the runtime would answer is published');
        assert.equal(typeof op.responses['403'], 'undefined',
            'no 403 — an un-annotated route carries no roles/policy, so 403 is unreachable');
    });

    it('05.3 - mode ON + `public: true`: the route stays described as open', function () {
        var op = freshOp();
        applyAuthContract(op, { control: 'home', public: true }, false, true);
        assert.deepEqual(Object.keys(op.responses), ['200'], 'untouched');
    });

    it('05.4 - mode OFF: byte-identical to today (the subtract-control)', function () {
        var off = freshOp(), absent = freshOp();
        applyAuthContract(off,    { control: 'dashboard' }, false, false);
        applyAuthContract(absent, { control: 'dashboard' }, false);          // arg omitted entirely
        assert.deepEqual(Object.keys(off.responses), ['200'], 'explicit false changes nothing');
        assert.deepEqual(off, absent, 'omitting the argument is identical to passing false');
    });

    it('05.5 - the mode never un-gates an explicitly gated route, and never adds a 403', function () {
        var op = freshOp();
        applyAuthContract(op, { control: 'x', roles: ['admin'] }, false, true);
        assert.ok(op.responses['401'], 'still gated');
        assert.ok(op.responses['403'], 'roles still add the 403');
        assert.ok(JSON.stringify(op).indexOf('admin') === -1, 'the role name never reaches the spec');
    });

    it('05.6 - mode ON + machine auth: the bearer requirement rides un-annotated routes too', function () {
        var op = freshOp();
        applyAuthContract(op, { control: 'dashboard' }, true, true);
        assert.deepEqual(op.security, [ { bearerAuth: [] } ]);
    });
});
