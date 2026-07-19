'use strict';
/**
 * lib/dto — the native Gina schema/DTO builder (#DTO1).
 *
 * A DTO is JSON-Schema-canonical internally and exposes three projections:
 *   .toJsonSchema(dialect) — draft-07 | 2020-12 (identity / canonical)
 *   .toRules()             — the LIVE form-validator rules-object (server + client)
 *   .name                  — stable id for the type generator + routing param.dto
 *
 * Shape of this suite:
 *   §01 source pins — the module's structural contract (registry on process.gina._dtos,
 *       DIALECTS, module.exports namespace) + the behavioural guarantee that the emit
 *       NEVER produces `toFloat` / `query` (asserted behaviourally, not by a source-word
 *       negative pin, because the module JSDoc names them to document the exclusion —
 *       the own-comment trap, jsdoc.md).
 *   §02 toJsonSchema — both dialects, standalone $schema/$id, required[],
 *       additionalProperties, VALUE bounds carried in the schema.
 *   §03 toRules — the exact derived rule shape for each vocabulary field.
 *   §04 behavioural — drive the derived rules through the REAL ValidatorPlugin
 *       (valid/invalid/coercion/exclude/enum error) — the measured contract #DTO2 uses.
 *   §05 value-range — schema holds minimum/maximum, but the runtime does NOT enforce it
 *       in this cut (documented deviation) + a subtract proving the omission is real.
 *   §06 build-time guards (throw-on-invalid config).
 *   §07 registry.
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
setContext('bundle', 'dtoTestBundle');

var DTO_PATH  = path.join(FW, 'lib/dto/src/main.js');
var DTO_SRC   = fs.readFileSync(DTO_PATH, 'utf8');
var dto       = require(DTO_PATH);
var Validator = require(path.join(FW, 'core/plugins/lib/validator/src/main.js')); // gina.plugins.Validator

/** Drive a DTO's derived rules through the REAL engine; fresh rules per call (parseRules mutates). */
function validate(d, data) {
    return Validator(JSON.parse(JSON.stringify(d.toRules())), data, 'dto-test');
}
function isValid(res) { return (typeof res.isValid === 'function') ? res.isValid() : res.isValid; }


describe('lib/dto §01 — source pins (structural contract)', function () {

    it('01.1 - the named-DTO registry lives on process.gina._dtos (survives refreshCore hot-reload)', function () {
        assert.match(DTO_SRC, /process\.gina\._dtos/,
            'the registry must persist on process.gina, not module scope');
    });

    it('01.2 - both JSON Schema dialects are declared', function () {
        assert.match(DTO_SRC, /'draft-07'\s*:/);
        assert.match(DTO_SRC, /'2020-12'\s*:/);
    });

    it('01.3 - module.exports is the dto namespace with the vocabulary factories', function () {
        assert.equal(typeof dto.object, 'function');
        ['string', 'integer', 'number', 'boolean', 'date', 'register', 'get', 'names', 'isDto']
            .forEach(function (k) { assert.equal(typeof dto[k], 'function', k + ' factory present'); });
        assert.equal(typeof dto['enum'], 'function', 'enum factory present');
        assert.ok(dto.DIALECTS && dto.DIALECTS['draft-07'] && dto.DIALECTS['2020-12']);
    });

    it('01.4 - BEHAVIOURAL: the emit NEVER produces `toFloat` or `query` (curated vocabulary)', function () {
        // Build one field of every kind + every chained option, and assert no emitted
        // rule key is a forbidden rule. (A source-word negative pin would trip on the
        // module JSDoc, which names toFloat/query to document their exclusion.)
        var everything = dto.object({
            s:  dto.string().email().required().trim().exclude(),
            s2: dto.string().minLength(1).maxLength(9),
            i:  dto.integer().min(0).max(9),
            n:  dto.number().min(0).max(9),
            b:  dto.boolean(),
            e:  dto['enum'](['a', 'b']),
            d:  dto.date()
        });
        var rules = everything.toRules();
        var forbidden = { toFloat: 1, query: 1, isFloat: 1 };
        Object.keys(rules).forEach(function (field) {
            Object.keys(rules[field]).forEach(function (rule) {
                assert.equal(forbidden[rule], undefined,
                    'field ' + field + ' emitted forbidden rule ' + rule);
            });
        });
    });
});


describe('lib/dto §02 — toJsonSchema (canonical / identity projection)', function () {

    var D = dto.object({
        email: dto.string().email().required().description('User email'),
        name:  dto.string().minLength(2).maxLength(40),
        age:   dto.integer().min(0).max(120),
        role:  dto['enum'](['admin', 'user']).required()
    }).as('S02User').title('User');

    it('02.1 - draft-07: type/properties/required, value bounds carried, strict by default', function () {
        var s = D.toJsonSchema('draft-07');
        assert.equal(s.type, 'object');
        assert.equal(s.properties.email.type, 'string');
        assert.equal(s.properties.email.format, 'email');
        assert.equal(s.properties.email.description, 'User email');
        assert.equal(s.properties.name.minLength, 2);
        assert.equal(s.properties.name.maxLength, 40);
        assert.equal(s.properties.age.minimum, 0,   'VALUE bound minimum carried in the schema');
        assert.equal(s.properties.age.maximum, 120, 'VALUE bound maximum carried in the schema');
        assert.deepEqual(s.properties.role.enum, ['admin', 'user']);
        assert.equal(s.properties.role.type, 'string', 'homogeneous enum infers type');
        assert.deepEqual(s.required.sort(), ['email', 'role']);
        assert.equal(s.additionalProperties, false, 'strict by default');
        assert.equal(s.title, 'User');
    });

    it('02.2 - 2020-12 standalone adds $schema + $id', function () {
        var s = D.toJsonSchema('2020-12', { standalone: true });
        assert.equal(s.$schema, 'https://json-schema.org/draft/2020-12/schema');
        assert.equal(s.$id, 'https://gina.io/schema/dto/S02User.json');
        assert.equal(s.type, 'object');
    });

    it('02.3 - default dialect is draft-07; unknown dialect throws', function () {
        assert.equal(dto.object({ x: dto.string() }).toJsonSchema().$schema, undefined, 'non-standalone has no $schema');
        assert.throws(function () { D.toJsonSchema('draft-04'); }, /unknown JSON Schema dialect/);
    });

    it('02.4 - .passthrough() flips additionalProperties to true', function () {
        assert.equal(dto.object({ x: dto.string() }).passthrough().toJsonSchema().additionalProperties, true);
    });

    it('02.5 - toJsonSchema returns a fresh object (no shared-reference leak)', function () {
        var a = D.toJsonSchema('draft-07');
        a.properties.email.type = 'MUTATED';
        assert.equal(D.toJsonSchema('draft-07').properties.email.type, 'string', 'internal schema not mutated');
    });
});


describe('lib/dto §03 — toRules (derived form-validator projection)', function () {

    it('03.1 - each vocabulary field derives the measured rule shape', function () {
        var rules = dto.object({
            email:    dto.string().email().required(),
            name:     dto.string().minLength(2).maxLength(40).trim(),
            plain:    dto.string(),
            age:      dto.integer().min(0).max(120),
            price:    dto.number(),
            active:   dto.boolean(),
            role:     dto['enum'](['admin', 'user']).required(),
            dob:      dto.date(),
            honeypot: dto.string().exclude()
        }).toRules();

        assert.deepEqual(rules.email,  { isRequired: true, isEmail: true });
        assert.deepEqual(rules.name,   { isString: [2, 40], trim: true });
        assert.deepEqual(rules.plain,  { isString: true });
        assert.deepEqual(rules.age,    { isInteger: true }, 'value bounds are schema-only (not in rules)');
        assert.deepEqual(rules.price,  { isNumber: true });
        assert.deepEqual(rules.active, { isBoolean: true });
        assert.deepEqual(rules.role,   { isRequired: true, isInList: ['admin', 'user'] });
        assert.deepEqual(rules.dob,    { isDate: ['yyyy-mm-dd'] });
        assert.deepEqual(rules.honeypot, { isString: true, exclude: true });
    });

    it('03.2 - length bounds: min-only and max-only emit positional nulls', function () {
        assert.deepEqual(dto.object({ s: dto.string().minLength(3) }).toRules().s, { isString: [3, null] });
        assert.deepEqual(dto.object({ s: dto.string().maxLength(9) }).toRules().s, { isString: [null, 9] });
    });

    it('03.3 - email with length carries BOTH isEmail and isString', function () {
        assert.deepEqual(dto.object({ e: dto.string().email().minLength(7) }).toRules().e,
            { isEmail: true, isString: [7, null] });
    });

    it('03.4 - custom date mask threads through', function () {
        assert.deepEqual(dto.object({ d: dto.date().mask('dd/mm/yyyy') }).toRules().d, { isDate: ['dd/mm/yyyy'] });
    });
});


describe('lib/dto §04 — behavioural: derived rules through the REAL engine', function () {

    var D = dto.object({
        email:    dto.string().email().required(),
        name:     dto.string().minLength(2).maxLength(40).trim(),
        age:      dto.integer(),
        active:   dto.boolean(),
        role:     dto['enum'](['admin', 'user']).required(),
        honeypot: dto.string().exclude()
    });

    it('04.1 - valid input -> isValid() true, empty errors, values coerced, excluded stripped', function () {
        var res = validate(D, { email: 'a@b.com', name: '  Alice', age: '30', active: 'true', role: 'admin', honeypot: 'zzz' });
        assert.equal(isValid(res), true);
        assert.deepEqual(res.error, {});
        assert.equal(res.data.age, 30, 'integer coerced');
        assert.equal(res.data.active, true, 'boolean coerced');
        assert.ok(/^\S/.test(res.data.name), 'leading whitespace trimmed');
        assert.equal(res.data.honeypot, undefined, 'excluded field stripped from output');
        assert.equal(Object.prototype.hasOwnProperty.call(res.data, 'honeypot'), false);
    });

    it('04.2 - invalid input -> field->rule->message errors (the ready 422 body)', function () {
        var res = validate(D, { email: 'nope', name: 'a', age: '30', active: 'true', role: 'root', honeypot: 'z' });
        assert.equal(isValid(res), false);
        assert.equal(res.error.email.isEmail, 'A valid email is required');
        assert.equal(res.error.name.isStringLength, 'Should be at least 2 characters');
        assert.equal(res.error.role.isInList, 'Must be one of: admin, user');
    });

    it('04.3 - a PRESENT-but-empty required field fails isRequired', function () {
        var res = validate(D, { email: '', name: 'Bob', age: '1', active: 'false', role: 'user' });
        assert.equal(isValid(res), false);
        assert.equal(typeof res.error.email.isRequired, 'string');
    });

    it('04.3b - CHARACTERIZATION: an ENTIRELY-ABSENT required key is NOT caught by the engine', function () {
        // The engine validates fields PRESENT in the data; isRequired only fires on a
        // present-but-empty value, not a missing key. This is a #DTO2-pipe concern:
        // the pipe must ensure every DTO-declared field is present (inject empty
        // placeholders) before validating so isRequired can fire on an omitted field.
        var res = validate(D, { name: 'Bob', age: '1', active: 'false', role: 'user' });
        assert.equal(isValid(res), true, 'a missing required key currently passes — the pipe must normalise absent fields');
    });

    it('04.4 - enum is type-strict + membership', function () {
        var num = dto.object({ n: dto['enum']([1, 2, 3]) });
        assert.equal(isValid(validate(num, { n: 2 })), true, 'numeric member valid');
        assert.equal(isValid(validate(num, { n: 4 })), false, 'non-member invalid');
    });
});


describe('lib/dto §05 — value-range is schema-only in this cut (measured deviation)', function () {

    var Age = dto.object({ age: dto.integer().min(0).max(120) });

    it('05.1 - the schema carries minimum/maximum (OpenAPI/MCP fidelity)', function () {
        var s = Age.toJsonSchema('2020-12');
        assert.equal(s.properties.age.minimum, 0);
        assert.equal(s.properties.age.maximum, 120);
    });

    it('05.2 - toRules() emits NO value-range rule (only the type check) and never a `$`', function () {
        var rules = Age.toRules();
        assert.deepEqual(rules.age, { isInteger: true });
        assert.equal(JSON.stringify(rules).indexOf('$'), -1,
            'toRules() must never emit a `$` (would trip the server-side $fields crash)');
    });

    it('05.3 - SUBTRACT: the runtime does NOT enforce the value bound (out-of-range passes the type check)', function () {
        var res = validate(Age, { age: '999' });
        assert.equal(isValid(res), true, 'age=999 passes: value bound is documented-in-schema, not runtime-enforced (cut 1)');
        assert.equal(res.data.age, 999);
    });
});


describe('lib/dto §06 — build-time guards (throw-on-invalid config)', function () {

    it('06.1 - .min()/.max() only on integer/number', function () {
        assert.throws(function () { dto.string().min(0); }, /not valid on a string/);
        assert.throws(function () { dto.boolean().max(9); }, /not valid on a boolean/);
    });
    it('06.2 - .email()/.minLength()/.trim() only on string', function () {
        assert.throws(function () { dto.integer().email(); }, /not valid on a integer/);
        assert.throws(function () { dto.number().minLength(2); }, /not valid on a number/);
        assert.throws(function () { dto.date().trim(); }, /not valid on a date/);
    });
    it('06.3 - dto.enum requires a non-empty array', function () {
        assert.throws(function () { dto['enum']([]); }, /non-empty array/);
        assert.throws(function () { dto['enum']('admin'); }, /non-empty array/);
    });
    it('06.4 - dto.object rejects a non-field in the shape', function () {
        assert.throws(function () { dto.object({ x: 'nope' }); }, /must be a dto field/);
    });
    it('06.5 - dto.register requires a dto.object', function () {
        assert.throws(function () { dto.register('X', dto.string()); }, /must be a dto\.object/);
    });
});


describe('lib/dto §07 — named registry (process.gina._dtos)', function () {

    it('07.1 - .as(name) registers; dto.get resolves the same instance', function () {
        var D = dto.object({ x: dto.string() }).as('S07A');
        assert.equal(D.name, 'S07A');
        assert.equal(dto.get('S07A'), D);
        assert.ok(dto.names().indexOf('S07A') > -1);
    });

    it('07.2 - dto.register(name, d) registers and stamps the name', function () {
        var D = dto.object({ y: dto.integer() });
        dto.register('S07B', D);
        assert.equal(D.name, 'S07B');
        assert.equal(dto.get('S07B'), D);
    });

    it('07.3 - dto.get returns null for an unknown name; isDto discriminates', function () {
        assert.equal(dto.get('nope-not-registered'), null);
        assert.equal(dto.isDto(dto.object({ z: dto.string() })), true);
        assert.equal(dto.isDto(dto.string()), false);
        assert.equal(dto.isDto({}), false);
    });

    it('07.4 - the registry is the process.gina._dtos object (persistence surface)', function () {
        dto.object({ q: dto.string() }).as('S07C');
        assert.ok(process.gina && process.gina._dtos && process.gina._dtos.S07C,
            'registered DTO is reachable on process.gina._dtos');
    });
});


describe('lib/dto §08 — dto.load resolution (the offline-CLI + pipe resolver, #DTO1c)', function () {
    var os  = require('os');
    var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dto-load-'));
    var DTOS = path.join(TMP, 'dtos');
    fs.mkdirSync(DTOS, { recursive: true });

    // The offline-CLI-safe FACTORY shape — receives the builder, no require('gina').
    fs.writeFileSync(path.join(DTOS, 'L_Create.js'),
        'module.exports = function (dto) { return dto.object({ ' +
        'email: dto.string().email().required(), age: dto.integer().min(0).max(9) }, "L_Create"); };');
    // A module exporting a DtoObject directly (the runtime-only authoring shape; a real
    // bundle would use require("gina").dto, which throws offline — here we reach the
    // builder by absolute path purely to exercise dto.load's DtoObject branch).
    fs.writeFileSync(path.join(DTOS, 'L_Direct.js'),
        'var dto = require(' + JSON.stringify(DTO_PATH) + ');\n' +
        'module.exports = dto.object({ id: dto.string().required() }, "L_Direct");\n');
    // A file that exports neither a factory nor a DtoObject.
    fs.writeFileSync(path.join(DTOS, 'L_Bad.js'), 'module.exports = { not: "a dto" };');
    // A factory that throws.
    fs.writeFileSync(path.join(DTOS, 'L_Throws.js'),
        'module.exports = function (dto) { throw new Error("boom in factory"); };');

    it('08.1 - a FACTORY file resolves to a DtoObject; the reference name is stamped + registered', function () {
        var d = dto.load(TMP, 'L_Create');
        assert.ok(dto.isDto(d), 'returns a DtoObject');
        assert.equal(d.name, 'L_Create');
        assert.equal(dto.get('L_Create'), d, 'registered for subsequent get()');
        var s = d.toJsonSchema('2020-12');
        assert.equal(s.properties.email.format, 'email');
        assert.equal(s.properties.age.minimum, 0);
        assert.equal(s.properties.age.maximum, 9);
        assert.deepEqual(s.required, ['email']);
    });

    it('08.2 - a module exporting a DtoObject directly is used as-is', function () {
        var d = dto.load(TMP, 'L_Direct');
        assert.ok(dto.isDto(d));
        assert.equal(d.name, 'L_Direct'); // stamped to the reference name
    });

    it('08.3 - registry fallback: no bundle path (or no file) returns a pre-registered DTO', function () {
        var D = dto.object({ x: dto.string() });
        dto.register('L_Reg', D);
        assert.equal(dto.load(null, 'L_Reg'), D, 'null bundlePath -> registry');
        assert.equal(dto.load(TMP, 'L_Reg'), D, 'no dtos/L_Reg.js file -> registry');
    });

    it('08.4 - unresolved (no file, not registered) returns null', function () {
        assert.equal(dto.load(TMP, 'L_Missing'), null);
        assert.equal(dto.load(null, 'L_Missing'), null);
    });

    it('08.5 - a broken factory THROWS (the caller decides: CLI warns+skips, pipe fails fast)', function () {
        assert.throws(function () { dto.load(TMP, 'L_Throws'); }, /boom in factory/);
    });

    it('08.6 - a file that is neither a factory nor a DtoObject is unresolved (null)', function () {
        assert.equal(dto.load(TMP, 'L_Bad'), null);
    });

    it('08.7 - a non-string / empty name returns null (never throws)', function () {
        assert.equal(dto.load(TMP, ''), null);
        assert.equal(dto.load(TMP, null), null);
        assert.equal(dto.load(TMP, 42), null);
    });
});


describe('lib/dto §09 — the `$` guard on toRules (#DTO2, measured server-fatal)', function () {

    // MEASURED: the engine stringifies the whole rules object and, on ANY `$` in it,
    // takes a client-only dynamic-rules branch that derefs the null server-side
    // `$fields` (validate() -> `$fields.count()`) and throws a raw TypeError from ABOVE
    // its own try/catch. toRules() compiles no `$` of its own, but an AUTHORED `$` can
    // still reach it via an enum value, a field name or a date mask.

    it('09.1 - toRules() THROWS when an enum VALUE carries a `$`', function () {
        var D = dto.object({ amount: dto.enum(['$100', '$200']).required() }, 'GuardEnum');
        assert.throws(function () { D.toRules(); }, /\[dto\][\s\S]*\$/,
            'a `$` in an enum value must be rejected at build/boot, not at request time');
    });

    it('09.2 - toRules() THROWS when a FIELD NAME carries a `$`', function () {
        var D = dto.object({ 'a$b': dto.string() }, 'GuardField');
        assert.throws(function () { D.toRules(); }, /\[dto\]/);
    });

    it('09.3 - the error names the DTO so the boot failure is actionable', function () {
        var D = dto.object({ amount: dto.enum(['$1']) }, 'GuardNamed');
        assert.throws(function () { D.toRules(); }, /GuardNamed/);
    });

    it('09.4 - toJsonSchema() is deliberately NOT guarded (a `$` is valid in a JSON Schema enum)', function () {
        var D = dto.object({ amount: dto.enum(['$100', '$200']) }, 'GuardSchemaOk');
        var s = D.toJsonSchema('2020-12');
        assert.deepEqual(s.properties.amount.enum, ['$100', '$200'],
            'a currency-style DTO must still document + serve as a param.responseDto');
    });

    it('09.5 - a `$`-free DTO still compiles (the guard is not a blanket refusal)', function () {
        var D = dto.object({ amount: dto.enum(['100', '200']).required() }, 'GuardClean');
        assert.deepEqual(D.toRules(), { amount: { isRequired: true, isInList: ['100', '200'] } });
    });

    it('09.6 - SUBTRACT: the pre-guard rules object really does kill the engine', function () {
        // Hand the engine the exact rules the guard now refuses. If this ever stops
        // throwing, the engine was fixed and the guard can be revisited.
        // (Half-fired at #B127: the validate() single-element `$fields.count()` crash
        // was fixed, so `$` tokens that NAME FIELDS now validate server-side. A `$`
        // token that is NOT a field reference — an enum value like `$100` — still
        // crashes from getDynamisedRules' leftovers loop (`$fields[field].value`,
        // null server-side), so the guard's justification stands.)
        var poisoned = { amount: { isRequired: true, isInList: ['$100', '$200'] } };
        assert.throws(
            function () { Validator(poisoned, { amount: '$100' }, 'dto-test'); },
            /Cannot read properties of null/,
            'the guard exists because THIS throws — a null `$fields` deref inside the engine'
        );
        // control: the same shape without `$` validates cleanly, so the subtract can fail
        var clean = { amount: { isRequired: true, isInList: ['100', '200'] } };
        assert.equal(isValid(Validator(clean, { amount: '100' }, 'dto-test')), true);
    });
});


describe('lib/dto §10 — DtoObject.apply (the response-side projection, #DTO2)', function () {

    var User = dto.object({
        id           : dto.integer().required(),
        email        : dto.string().email().required(),
        passwordHash : dto.string().exclude()
    }, 'ApplyUser');

    it('10.1 - keeps declared fields and DROPS undeclared ones (strict is the default)', function () {
        var out = User.apply({ id: 7, email: 'a@b.co', internalNote: 'secret-ish' });
        assert.deepEqual(out, { id: 7, email: 'a@b.co' });
    });

    it('10.2 - .exclude() finally means "never serialise this"', function () {
        var out = User.apply({ id: 7, email: 'a@b.co', passwordHash: 'argon2id$...' });
        assert.equal(typeof out.passwordHash, 'undefined');
    });

    it('10.3 - the dev-Inspector sidecars survive a strict projection', function () {
        var out = User.apply({ id: 7, email: 'a@b.co', __ginaQueries: [1], __ginaFlow: [2] });
        assert.deepEqual(out.__ginaQueries, [1]);
        assert.deepEqual(out.__ginaFlow, [2]);
    });

    it('10.4 - a declared field absent from the payload is simply absent (no `undefined` key)', function () {
        var out = User.apply({ id: 7 });
        assert.deepEqual(Object.keys(out), ['id']);
    });

    it('10.5 - .passthrough() keeps undeclared keys (but still drops excluded ones)', function () {
        var P = dto.object({ id: dto.integer(), secret: dto.string().exclude() }, 'ApplyPass').passthrough();
        var out = P.apply({ id: 1, extra: 'kept', secret: 'dropped' });
        assert.deepEqual(out, { id: 1, extra: 'kept' });
    });

    it('10.6 - it is PURE — the input object is never mutated', function () {
        var input = { id: 7, email: 'a@b.co', passwordHash: 'x', extra: 1 };
        var out   = User.apply(input);
        assert.equal(input.passwordHash, 'x', 'the caller keeps its object intact');
        assert.equal(input.extra, 1);
        assert.notEqual(out, input, 'a NEW object is returned');
    });

    it('10.7 - a non-object / array payload passes through verbatim (nothing to project onto)', function () {
        assert.deepEqual(User.apply([1, 2]), [1, 2]);
        assert.equal(User.apply(null), null);
        assert.equal(User.apply('text'), 'text');
    });
});


describe('lib/dto §11 — toJsonSchema({ dropExcluded }) — the response-side emit (#B110)', function () {

    var RespUser = dto.object({
        id           : dto.integer().required(),
        email        : dto.string().email().required(),
        token        : dto.string().required().exclude(),
        passwordHash : dto.string().exclude()
    }, 'RespUser');

    it('11.1 - dropExcluded omits `.exclude()`d fields from properties AND required[]', function () {
        var s = RespUser.toJsonSchema('2020-12', { dropExcluded: true });
        assert.deepEqual(Object.keys(s.properties), ['id', 'email']);
        assert.deepEqual(s.required, ['id', 'email'], 'the required+excluded field left required[] too');
    });

    it('11.2 - the DEFAULT emit still carries them (the declared / request-side contract)', function () {
        var s = RespUser.toJsonSchema('2020-12');
        assert.deepEqual(Object.keys(s.properties), ['id', 'email', 'token', 'passwordHash']);
        assert.deepEqual(s.required, ['id', 'email', 'token']);
    });

    it('11.3 - SUBTRACT: an opts bag WITHOUT the flag changes nothing (the flag is load-bearing)', function () {
        var s = RespUser.toJsonSchema('2020-12', {});
        assert.equal(typeof s.properties.token, 'object');
        assert.ok(s.required.indexOf('token') > -1);
    });

    it('11.4 - required[] emptied by the drop is deleted, not left as []', function () {
        var OnlyExcl = dto.object({
            secret : dto.string().required().exclude(),
            note   : dto.string()
        }, 'RespOnlyExcl');
        var s = OnlyExcl.toJsonSchema('draft-07', { dropExcluded: true });
        assert.equal(s.required, undefined);
        assert.deepEqual(Object.keys(s.properties), ['note']);
    });

    it('11.5 - shape-based: emits for a DTO whose toRules() throws on an authored `$` (stays total)', function () {
        var Price = dto.object({
            tier   : dto.enum(['$ 10', '$ 20']).required(),
            secret : dto.string().exclude()
        }, 'RespPrice');
        assert.throws(function () { Price.toRules(); }, /emits a \$ character/);
        var s = Price.toJsonSchema('2020-12', { dropExcluded: true });
        assert.deepEqual(Object.keys(s.properties), ['tier']);
    });

    it('11.6 - composes with standalone ($schema kept, excluded dropped)', function () {
        var s = RespUser.toJsonSchema('2020-12', { standalone: true, dropExcluded: true });
        assert.ok(/2020-12/.test(s.$schema));
        assert.equal(s.properties.passwordHash, undefined);
    });

    it('11.7 - passthrough survives: additionalProperties stays true, excluded still dropped', function () {
        var P = dto.object({ id: dto.integer(), secret: dto.string().exclude() }, 'RespPass').passthrough();
        var s = P.toJsonSchema('draft-07', { dropExcluded: true });
        assert.equal(s.additionalProperties, true);
        assert.deepEqual(Object.keys(s.properties), ['id']);
    });
});
