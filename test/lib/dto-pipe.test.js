'use strict';
/**
 * lib/dto-pipe — the #DTO2 default-on request-payload validation pipe.
 *
 * A route opts in with `routing.json` `param.dto`; core/server.js resolves + registers
 * the DTO at BOOT (fail-fast), and core/router.js runs the pipe before the controller
 * action at BOTH dispatch sites.
 *
 * Shape of this suite:
 *   §01 source pins — the two router.js call sites (before the reservedActions loop),
 *       the lib/index.js plain-require, the core/server.js boot registrar, and the
 *       render-json.js response-DTO transform (above the single JSON.stringify).
 *   §02 no-op — a route without `param.dto` is byte-identical to today.
 *   §03 valid payload — the coerced object reaches req[method] / req.body / req.dto.
 *   §04 invalid payload — a clean 422 carrying field -> rule -> message.
 *   §05 the absent-key gap — required-but-omitted keys are caught (+ a SUBTRACT proving
 *       the engine alone does NOT catch them: the silent-bypass this pipe exists to fix).
 *   §06 undeclared keys (URL params + extras) survive — the measured reason the pipe
 *       does not strip or reject them on req[method].
 *   §07 a fieldless DTO short-circuits (the engine's no-rules shape has no .error/.data).
 *   §08 an unregistered DTO is a loud 500, never a silent skip.
 */
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW = require('../fw');

process.env.NODE_ENV_IS_DEV = process.env.NODE_ENV_IS_DEV || 'false';
process.setMaxListeners(0);
require(path.join(FW, '../../utils/prototypes')); // Object.prototype.count() — backendInit needs it
require(path.join(FW, 'helpers'));                // getContext/setContext/_/requireJSON
/* global getContext, setContext */
if (typeof getContext('gina') === 'undefined') { setContext('gina', { forms: null }); }
setContext('bundle', 'dtoPipeTestBundle');

var PIPE_PATH   = path.join(FW, 'lib/dto-pipe/src/main.js');
var pipe        = require(PIPE_PATH);
var dto         = require(path.join(FW, 'lib/dto/src/main.js'));
var Validator   = require(path.join(FW, 'core/plugins/lib/validator/src/main.js'));

var ROUTER_SRC  = fs.readFileSync(path.join(FW, 'core/router.js'), 'utf8');
var LIBIDX_SRC  = fs.readFileSync(path.join(FW, 'lib/index.js'), 'utf8');
var SERVER_SRC  = fs.readFileSync(path.join(FW, 'core/server.js'), 'utf8');
var RJSON_SRC   = fs.readFileSync(path.join(FW, 'core/controller/controller.render-json.js'), 'utf8');

/** A controller stub whose throwError records what the pipe would have put on the wire. */
function ctl() {
    var c = { thrown: null };
    c.throwError = function (errObj) { c.thrown = errObj; return false; };
    return c;
}
/** A request shaped like the one router.js dispatches with. */
function req(method, dtoName, methodData, bodyData, culture) {
    var r = {
        method  : method,
        routing : { rule: 'test-route', param: {} },
        body    : bodyData
    };
    if (dtoName) { r.routing.param.dto = dtoName; }
    if (culture) { r.culture = culture; }
    r[String(method).toLowerCase()] = methodData;
    return r;
}
var res = {};

// The DTO every behavioural section drives.
var CreateUser = dto.object({
    email  : dto.string().email().required(),
    age    : dto.integer(),
    active : dto.boolean(),
    role   : dto.enum(['admin', 'user']).required(),
    secret : dto.string().exclude()
}, 'PipeCreateUser');


describe('lib/dto-pipe §01 — source pins (the seams)', function () {

    it('01.1 - router.js calls the pipe at BOTH dispatch sites', function () {
        var calls = ROUTER_SRC.match(/dtoPipe\.validateRequestPayload\(controller, request, response\)/g) || [];
        assert.equal(calls.length, 2,
            'the with-middleware (onDone) site AND the no-middleware site must both run the pipe');
    });

    it('01.2 - each call short-circuits the action on a falsy return', function () {
        var guards = ROUTER_SRC.match(/if \( !dtoPipe\.validateRequestPayload\(controller, request, response\) \) \{\s*return;\s*\}/g) || [];
        assert.equal(guards.length, 2, 'a 422/500 must never reach controller[action]');
    });

    it('01.3 - the pipe runs BEFORE the reservedActions loop at both sites (onReady must not fire on a rejected request)', function () {
        // Structural, not char-distance: for each pipe call, the NEXT reservedActions loop
        // must come after it, and no controller[action] dispatch may intervene.
        var re = /dtoPipe\.validateRequestPayload/g, m, seen = 0;
        while ((m = re.exec(ROUTER_SRC)) !== null) {
            var after    = ROUTER_SRC.slice(m.index);
            var loopIdx  = after.indexOf('reservedActions.length');
            var dispatch = after.indexOf('controller[action](');
            assert.ok(loopIdx > -1, 'a reservedActions loop must follow the pipe call');
            assert.ok(loopIdx < dispatch, 'the pipe must precede the reservedActions loop, which precedes the action');
            seen++;
        }
        assert.equal(seen, 2);
    });

    it('01.4 - lib/index.js plain-requires dto-pipe (no per-request require -> no dead-children tail, #B32-residual)', function () {
        assert.match(LIBIDX_SRC, /dtoPipe\s*:\s*require\('\.\/dto-pipe'\)/,
            'must be require(), never _require()');
        assert.doesNotMatch(LIBIDX_SRC, /dtoPipe\s*:\s*_require\(/);
    });

    it('01.5 - core/server.js registers route DTOs at BOOT, before the `configured` emit', function () {
        var regIdx  = SERVER_SRC.indexOf('lib.dto.load(_dtoSrcPath');
        var emitIdx = SERVER_SRC.indexOf("self.emit('configured'");
        assert.ok(regIdx > -1, 'the boot registrar must resolve DTOs via lib.dto.load');
        assert.ok(emitIdx > regIdx, 'registration must precede the configured emit (hence onInitialize)');
    });

    it('01.6 - a missing / unresolvable route DTO THROWS at boot (never a silent skip)', function () {
        var blk = SERVER_SRC.slice(SERVER_SRC.indexOf('var _dtoRouting'), SERVER_SRC.indexOf("self.emit('configured'"));
        assert.match(blk, /if \( !_dtoObj \) \{[\s\S]{0,400}?throw new Error/,
            'an unresolved DTO must refuse the boot');
        assert.match(blk, /_dtoObj\.toRules\(\)/,
            'a request DTO must be dry-run-compiled at boot so a `$`-bearing DTO dies at deploy');
    });

    it('01.7 - render-json applies the response DTO ABOVE the single JSON.stringify and BELOW the sidecars', function () {
        var flowIdx   = RJSON_SRC.indexOf('jsonObj.__ginaFlow');
        var applyIdx  = RJSON_SRC.indexOf('_respDto.apply(jsonObj)');
        var strIdx    = RJSON_SRC.indexOf('var data = JSON.stringify(jsonObj)');
        assert.ok(flowIdx > -1 && applyIdx > -1 && strIdx > -1);
        assert.ok(applyIdx > flowIdx, 'the transform must run after the __gina* sidecars attach');
        assert.ok(applyIdx < strIdx, 'the transform must run before the ONE stringify that feeds every body-write + the cache');
        assert.equal((RJSON_SRC.match(/JSON\.stringify\(jsonObj\)/g) || []).length, 1,
            'there must remain exactly ONE stringify — that is what makes a single transform point sufficient');
    });

    it('01.8 - the response DTO is 2xx-gated (an error payload is never mangled by a success DTO)', function () {
        assert.match(RJSON_SRC, /response\.statusCode >= 200\s*&&\s*response\.statusCode < 300/);
    });
});


describe('lib/dto-pipe §02 — no-op when the route declares no DTO', function () {

    it('02.1 - a route without param.dto continues untouched', function () {
        var c = ctl();
        var r = req('POST', null, { anything: 'goes' }, { anything: 'goes' });
        assert.equal(pipe.validateRequestPayload(c, r, res), true);
        assert.equal(c.thrown, null);
        assert.deepEqual(r.post, { anything: 'goes' }, 'the payload must not be touched');
        assert.equal(typeof r.dto, 'undefined', 'no req.dto is attached');
    });

    it('02.2 - a request with no routing / no param continues untouched', function () {
        var c = ctl();
        assert.equal(pipe.validateRequestPayload(c, { method: 'GET' }, res), true);
        assert.equal(pipe.validateRequestPayload(c, { method: 'GET', routing: {} }, res), true);
        assert.equal(c.thrown, null);
    });
});


describe('lib/dto-pipe §03 — a valid payload reaches the action COERCED', function () {

    it('03.1 - declared fields are coerced on req[method]', function () {
        var c = ctl();
        var body = { email: 'a@b.co', age: '30', active: 'true', role: 'admin' };
        var r = req('POST', 'PipeCreateUser', Object.assign({}, body), Object.assign({}, body));
        assert.equal(pipe.validateRequestPayload(c, r, res), true);
        assert.equal(c.thrown, null);
        assert.equal(r.post.age, 30);
        assert.equal(typeof r.post.age, 'number', "'30' must reach the action as a number");
        assert.equal(r.post.active, true);
        assert.equal(typeof r.post.active, 'boolean');
    });

    it('03.2 - an .exclude()d field never reaches the action', function () {
        var c = ctl();
        var body = { email: 'a@b.co', role: 'user', secret: 'shh' };
        var r = req('POST', 'PipeCreateUser', Object.assign({}, body), Object.assign({}, body));
        pipe.validateRequestPayload(c, r, res);
        assert.equal(typeof r.post.secret, 'undefined', 'exclude:true strips it from req[method]');
        assert.equal(typeof r.body.secret, 'undefined', 'and from req.body');
    });

    it('03.3 - req.dto is the STRICT projection (declared fields only)', function () {
        var c = ctl();
        var r = req('POST', 'PipeCreateUser',
            { email: 'a@b.co', role: 'user', age: '7', utm: 'campaign' },
            { email: 'a@b.co', role: 'user', age: '7', utm: 'campaign' });
        pipe.validateRequestPayload(c, r, res);
        assert.deepEqual(r.dto, { email: 'a@b.co', age: 7, role: 'user' });
        assert.equal(typeof r.dto.utm, 'undefined', 'req.dto is where strictness lives');
    });

    it('03.4 - req.body is coerced in place for the keys it already carries', function () {
        var c = ctl();
        var r = req('POST', 'PipeCreateUser',
            { email: 'a@b.co', role: 'user', age: '30' },
            { email: 'a@b.co', role: 'user', age: '30' });
        pipe.validateRequestPayload(c, r, res);
        assert.equal(r.body.age, 30);
        assert.equal(typeof r.body.age, 'number');
    });
});


describe('lib/dto-pipe §04 — an invalid payload is a clean 422', function () {

    it('04.1 - 422, and the action is never reached', function () {
        var c = ctl();
        var r = req('POST', 'PipeCreateUser', { email: 'not-an-email', role: 'admin' }, {});
        assert.equal(pipe.validateRequestPayload(c, r, res), false, 'false = the pipe answered');
        assert.equal(c.thrown.status, 422);
    });

    it('04.2 - the body carries the engine field -> rule -> message map', function () {
        var c = ctl();
        var r = req('POST', 'PipeCreateUser', { email: 'nope', role: 'wizard' }, {});
        pipe.validateRequestPayload(c, r, res);
        assert.equal(typeof c.thrown.fields.email.isEmail, 'string', 'field -> rule -> message');
        assert.equal(typeof c.thrown.fields.role.isInList, 'string');
        assert.match(c.thrown.error, /Validation failed/);
    });

    it('04.3 - a rule-level failure does not mutate req[method] into the coerced shape', function () {
        var c = ctl();
        var r = req('POST', 'PipeCreateUser', { email: 'nope', role: 'admin', age: '30' }, {});
        pipe.validateRequestPayload(c, r, res);
        assert.equal(r.post.age, '30', 'a rejected request is never handed a coerced payload');
        assert.equal(typeof r.dto, 'undefined');
    });
});


describe('lib/dto-pipe §05 — the absent-key gap (the silent bypass this pipe exists to fix)', function () {

    it('05.1 - a REQUIRED key the client simply OMITTED is caught', function () {
        var c = ctl();
        var r = req('POST', 'PipeCreateUser', { age: '30' }, { age: '30' }); // email + role absent
        assert.equal(pipe.validateRequestPayload(c, r, res), false);
        assert.equal(c.thrown.status, 422);
        assert.equal(typeof c.thrown.fields.email.isRequired, 'string');
        assert.equal(typeof c.thrown.fields.role.isRequired, 'string');
    });

    it('05.2 - SUBTRACT: the engine ALONE does not catch it (this is why the pipe normalises)', function () {
        // Exactly what the pipe would do WITHOUT the ''-injection step.
        var rules = JSON.parse(JSON.stringify(CreateUser.toRules()));
        var out   = Validator(rules, { age: '30' }, 'dto-test');
        assert.equal(out.isValid(), true,
            'MEASURED: isRequired only fires on a PRESENT-but-empty value — an omitted key sails through');
        assert.deepEqual(out.error, {}, 'and the error map is empty: a silent bypass, not a visible failure');
    });

    it('05.3 - an OPTIONAL absent field is NOT injected (no spurious empty string in the payload)', function () {
        var c = ctl();
        var r = req('POST', 'PipeCreateUser',
            { email: 'a@b.co', role: 'user' },      // age + active omitted, both optional
            { email: 'a@b.co', role: 'user' });
        assert.equal(pipe.validateRequestPayload(c, r, res), true);
        assert.equal(typeof r.post.age, 'undefined', "an omitted optional field must not land as ''");
        assert.equal(typeof r.post.active, 'undefined');
    });
});


describe('lib/dto-pipe §06 — undeclared keys survive (URL params are undeclared keys)', function () {

    it('06.1 - URL params merged into req[method] are preserved verbatim', function () {
        var c = ctl();
        // At the dispatch site req[method] carries the URL params alongside the body.
        var r = req('POST', 'PipeCreateUser',
            { email: 'a@b.co', role: 'user', id: '42', slug: 'x' },  // id/slug = URL params
            { email: 'a@b.co', role: 'user' });                      // req.body has only the body
        assert.equal(pipe.validateRequestPayload(c, r, res), true);
        assert.equal(r.post.id, '42', 'stripping undeclared keys would delete every route param');
        assert.equal(r.post.slug, 'x');
    });

    it('06.2 - an undeclared BODY key is passed through, not rejected', function () {
        var c = ctl();
        var r = req('POST', 'PipeCreateUser',
            { email: 'a@b.co', role: 'user', utm: 'campaign' },
            { email: 'a@b.co', role: 'user', utm: 'campaign' });
        assert.equal(pipe.validateRequestPayload(c, r, res), true, 'additionalProperties:false is an OpenAPI statement, not a runtime gate');
        assert.equal(r.post.utm, 'campaign');
    });

    it('06.3 - a URL param is NEVER injected into req.body (they are different objects here)', function () {
        var c = ctl();
        var r = req('POST', 'PipeCreateUser',
            { email: 'a@b.co', role: 'user', age: '9' },   // `age` arrives as a URL param
            { email: 'a@b.co', role: 'user' });            // ... and is NOT in the body
        pipe.validateRequestPayload(c, r, res);
        assert.equal(r.post.age, 9, 'coerced on req[method]');
        assert.equal(typeof r.body.age, 'undefined', 'req.body must not gain a key it never had');
    });
});


describe('lib/dto-pipe §07 — a fieldless DTO short-circuits', function () {

    it('07.1 - a DTO declaring nothing continues without touching the payload', function () {
        dto.object({}, 'PipeEmpty');
        var c = ctl();
        var r = req('POST', 'PipeEmpty', { a: 1 }, { a: 1 });
        assert.equal(pipe.validateRequestPayload(c, r, res), true);
        assert.equal(c.thrown, null);
        assert.deepEqual(r.post, { a: 1 });
    });

    it('07.2 - SUBTRACT: the engine returns a DIFFERENT shape for empty rules (no .error / no .data)', function () {
        var out = Validator({}, { a: 1 }, 'dto-test');
        assert.equal(typeof out.error, 'undefined', 'this is why the pipe short-circuits rather than trust it');
        assert.equal(typeof out.data, 'undefined');
        assert.equal(out.isValid(), true, 'and it answers `true` while having validated nothing');
    });
});


describe('lib/dto-pipe §08 — an unregistered DTO is loud, never silent', function () {

    it('08.1 - a route naming a DTO nobody registered 500s (it must never skip validation)', function () {
        var c = ctl();
        var r = req('POST', 'PipeNeverRegistered', { email: 'x' }, {});
        assert.equal(pipe.validateRequestPayload(c, r, res), false);
        assert.equal(c.thrown.status, 500);
        assert.match(c.thrown.error, /PipeNeverRegistered/, 'the error names the missing DTO');
    });
});
