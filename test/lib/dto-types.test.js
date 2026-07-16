'use strict';
/**
 * lib/dto-types — the #DTO3 DTO -> TypeScript declaration emitter.
 *
 * A DTO is authored once and already drives runtime validation (#DTO2) and the
 * OpenAPI / MCP schemas (#DTO1c). This module adds the fourth projection: static types.
 *
 * Shape of this suite:
 *   §01 source pins — the structural contract (pure, deterministic, sorted, no clock;
 *       reads the SHAPE not toRules(); the CLI is a thin wrapper).
 *   §02 the scalar mapping — MEASURED against the live validator engine, because the
 *       emitted type must describe the COERCED payload the pipe hands the action, not
 *       the raw wire string. Includes the date -> string (not Date) case.
 *   §03 required vs optional.
 *   §04 `.exclude()` -> the TWO-type split, with a SUBTRACT proving a single
 *       schema-derived type would LIE about req.dto.
 *   §05 `.passthrough()` -> a TS index signature.
 *   §06 enum -> a literal union (string / numeric / boolean / mixed).
 *   §07 key quoting + DTO-name validation (throw-on-invalid, the framework convention).
 *   §08 TOTALITY — a DTO whose toRules() THROWS (an authored dollar sign) must still
 *       emit types. This is the reason the emitter reads the shape, not the rules.
 *   §09 determinism — the artifact is drift-checkable only if the emit is pure.
 *   §10 the `bundle:types` CLI — source pins (sorted readdir, fail-fast on a broken DTO).
 */
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW = require('../fw');

// lib/dto-types is PURE — no framework globals, no fs, no clock. It needs no bootstrap.
var DTOTYPES_PATH = path.join(FW, 'lib/dto-types/src/main.js');
var DTOTYPES_SRC  = fs.readFileSync(DTOTYPES_PATH, 'utf8');
var dtoTypes      = require(DTOTYPES_PATH);
var dto           = require(path.join(FW, 'lib/dto/src/main.js'));

var CLI_PATH = path.join(FW, 'lib/cmd/bundle/types.js');
var CLI_SRC  = fs.readFileSync(CLI_PATH, 'utf8');

var LIBIDX_SRC = fs.readFileSync(path.join(FW, 'lib/index.js'), 'utf8');

/** Emit one DTO and return the source. */
function emit1(d) { return dtoTypes.emit([ d ], { bundle: 'b' }); }


describe('lib/dto-types §01 — source pins (structural contract)', function () {

    it('01.1 - the excluded set is read off the SHAPE, never off toRules()', function () {
        // toRules() also reports `exclude: true`, but it THROWS on an authored dollar sign
        // (§08). Reading the shape is what keeps the emitter total.
        assert.match(DTOTYPES_SRC, /d\._shape\[f\]\._excluded/,
            'excludedFields() must walk the shape');
        var body = DTOTYPES_SRC.slice(DTOTYPES_SRC.indexOf('var excludedFields'),
                                      DTOTYPES_SRC.indexOf('var emitDto'));
        assert.doesNotMatch(body, /\.toRules\(/,
            'excludedFields() must NOT call toRules() — it throws on a dollar sign');
    });

    it('01.2 - the canonical schema is the 2020-12 identity projection', function () {
        assert.match(DTOTYPES_SRC, /d\.toJsonSchema\('2020-12'\)/);
    });

    it('01.3 - the emit is deterministic: DTOs sorted by name, nothing volatile embedded', function () {
        assert.match(DTOTYPES_SRC, /\.sort\(function \(a, b\)/, 'DTOs must be sorted by name');
        // A timestamp / version / absolute path in the banner would make the committed
        // artifact undriftable.
        assert.doesNotMatch(DTOTYPES_SRC, /Date\.now\(|new Date\(|toISOString\(/,
            'the emitter must embed no clock');
    });

    it('01.4 - it is registered on the lib registry (the CLI daemon cannot bare-require it)', function () {
        assert.match(LIBIDX_SRC, /dtoTypes\s*:\s*_require\('\.\/dto-types'\)/);
    });

    it('01.5 - module.exports exposes emit()', function () {
        assert.equal(typeof dtoTypes.emit, 'function');
    });
});


describe('lib/dto-types §02 — the scalar mapping (measured against the coerced payload)', function () {

    it('02.1 - integer and number both map to `number` (the engine coerces "30" -> 30)', function () {
        var src = emit1(dto.object({ a: dto.integer(), b: dto.number() }, 'M'));
        assert.match(src, /a\?: number;/);
        assert.match(src, /b\?: number;/);
    });

    it('02.2 - boolean maps to `boolean` (the engine coerces "true" -> true)', function () {
        assert.match(emit1(dto.object({ a: dto.boolean() }, 'M2')), /a\?: boolean;/);
    });

    it('02.3 - string maps to `string`', function () {
        assert.match(emit1(dto.object({ a: dto.string() }, 'M3')), /a\?: string;/);
    });

    it('02.4 - date maps to `string`, NOT `Date` — isDate coerces to an ISO string', function () {
        var src = emit1(dto.object({ a: dto.date() }, 'M4'));
        assert.match(src, /a\?: string;/, 'a date field is a string on both the wire and after coercion');
        assert.doesNotMatch(src, /a\?: Date;/);
        assert.match(src, /@format date/, 'the JSON Schema format is preserved in the doc');
    });

    it('02.5 - an email is still a `string`, with the format carried as documentation', function () {
        var src = emit1(dto.object({ a: dto.string().email() }, 'M5'));
        assert.match(src, /a\?: string;/);
        assert.match(src, /@format email/);
    });

    it('02.6 - value bounds are documented AND labelled schema-only (not runtime-enforced)', function () {
        var src = emit1(dto.object({ a: dto.integer().min(0).max(9) }, 'M6'));
        assert.match(src, /@minimum 0 \(schema-only — not enforced at runtime\)/);
        assert.match(src, /@maximum 9 \(schema-only — not enforced at runtime\)/);
    });
});


describe('lib/dto-types §03 — required vs optional', function () {

    it('03.1 - a required field is non-optional; an unmarked one carries `?`', function () {
        var src = emit1(dto.object({ a: dto.string().required(), b: dto.string() }, 'R'));
        assert.match(src, /\n    a: string;/,  'required -> no `?`');
        assert.match(src, /\n    b\?: string;/, 'optional -> `?`');
    });
});


describe('lib/dto-types §04 — .exclude() and the TWO-type split', function () {

    var D = dto.object({
        id     : dto.integer(),
        secret : dto.string().required().exclude()
    }, 'X');
    var src = emit1(D);

    it('04.1 - the DECLARED interface keeps the excluded field (the client does send it)', function () {
        assert.match(src, /export interface X \{[\s\S]*?secret: string;[\s\S]*?\}/);
    });

    it('04.2 - the PROJECTED type drops it via Omit — this is what req.dto actually is', function () {
        assert.match(src, /export type XProjected = Omit<X, "secret">;/);
    });

    it('04.3 - a DTO with no exclusion projects to a plain alias', function () {
        assert.match(emit1(dto.object({ a: dto.string() }, 'Y')), /export type YProjected = Y;/);
    });

    it('04.4 - several exclusions become a union inside Omit', function () {
        var src2 = emit1(dto.object({
            a: dto.string(), b: dto.string().exclude(), c: dto.string().exclude()
        }, 'Z'));
        assert.match(src2, /export type ZProjected = Omit<Z, "b" \| "c">;/);
    });

    it('04.5 - SUBTRACT: the excluded field IS in the canonical schema, so a schema-only ' +
        'generator would have emitted it into the projection and LIED about req.dto', function () {
        // The measured reason the two-type split exists at all.
        var schema = D.toJsonSchema('2020-12');
        assert.ok(schema.properties.secret, 'the schema declares it...');
        assert.ok(schema.required.indexOf('secret') > -1, '...and even requires it');
        // ...yet the runtime drops it:
        assert.equal(typeof D.apply({ id: 1, secret: 's' }).secret, 'undefined',
            'apply() deletes it — so the projected TYPE must not carry it');
    });
});


describe('lib/dto-types §05 — .passthrough()', function () {

    it('05.1 - an open DTO emits a TS index signature; a strict one does not', function () {
        var open   = emit1(dto.object({ a: dto.string() }, 'O').passthrough());
        var strict = emit1(dto.object({ a: dto.string() }, 'S'));
        assert.match(open, /\[key: string\]: any;/);
        assert.doesNotMatch(strict, /\[key: string\]: any;/);
    });
});


describe('lib/dto-types §06 — enum -> a literal union', function () {

    it('06.1 - a string enum', function () {
        assert.match(emit1(dto.object({ a: dto['enum'](['admin', 'user']) }, 'E1')),
            /a\?: "admin" \| "user";/);
    });

    it('06.2 - a numeric enum', function () {
        assert.match(emit1(dto.object({ a: dto['enum']([10, 25]) }, 'E2')), /a\?: 10 \| 25;/);
    });

    it('06.3 - a boolean enum', function () {
        assert.match(emit1(dto.object({ a: dto['enum']([true, false]) }, 'E3')), /a\?: true \| false;/);
    });

    it('06.4 - a mixed enum (the schema sets no `type`) still unions the literals', function () {
        assert.match(emit1(dto.object({ a: dto['enum'](['x', 1]) }, 'E4')), /a\?: "x" \| 1;/);
    });

    it('06.5 - a quote inside an enum value is escaped, not emitted raw', function () {
        assert.match(emit1(dto.object({ a: dto['enum'](['it"s']) }, 'E5')), /a\?: "it\\"s";/);
    });
});


describe('lib/dto-types §07 — key quoting and name validation', function () {

    it('07.1 - a field name that is not a bare TS identifier is quoted', function () {
        var src = emit1(dto.object({ 'page-size': dto.integer() }, 'Q'));
        assert.match(src, /"page-size"\?: number;/);
    });

    it('07.2 - a bare identifier is NOT quoted', function () {
        assert.match(emit1(dto.object({ pageSize: dto.integer() }, 'Q2')), /\n    pageSize\?: number;/);
    });

    it('07.3 - a DTO name that is not a valid TS identifier THROWS (it cannot be an interface)', function () {
        var bad = dto.object({ a: dto.string() }, 'Not-An-Identifier');
        assert.throws(function () { dtoTypes.emit([ bad ]); },
            /not a valid TypeScript identifier/);
    });

    it('07.4 - an unnamed DTO THROWS (the name is the interface name)', function () {
        assert.throws(function () { dtoTypes.emit([ dto.object({ a: dto.string() }) ]); },
            /every DTO must be named/);
    });
});


describe('lib/dto-types §08 — TOTALITY: a DTO that cannot be compiled to rules still types', function () {

    // An authored dollar sign anywhere in the emitted rules is server-fatal in the
    // validator engine, so toRules() rejects it. toJsonSchema() is deliberately NOT
    // guarded — such a DTO still documents and still serves as a param.responseDto.
    var Priced = dto.object({ tier: dto['enum'](['$ 10', '$ 25']).required() }, 'Priced');

    it('08.1 - toRules() throws on it (the guard is real — this is the precondition)', function () {
        assert.throws(function () { Priced.toRules(); }, /emits a \$ character/);
    });

    it('08.2 - ...and the emitter still produces its types', function () {
        var src = emit1(Priced);
        assert.match(src, /export interface Priced \{/);
        assert.match(src, /tier: "\$ 10" \| "\$ 25";/);
        assert.match(src, /export type PricedProjected = Priced;/);
    });
});


describe('lib/dto-types §09 — determinism (the artifact must be drift-checkable)', function () {

    var a = dto.object({ x: dto.string() }, 'Aa');
    var b = dto.object({ y: dto.string() }, 'Bb');

    it('09.1 - the same DTOs emit byte-identical source across calls', function () {
        assert.equal(dtoTypes.emit([ a, b ], { bundle: 'k' }),
                     dtoTypes.emit([ a, b ], { bundle: 'k' }));
    });

    it('09.2 - input ORDER does not matter (readdir order is filesystem-dependent)', function () {
        assert.equal(dtoTypes.emit([ a, b ], { bundle: 'k' }),
                     dtoTypes.emit([ b, a ], { bundle: 'k' }));
    });

    it('09.3 - the emit does not mutate the DTOs it is handed', function () {
        var before = JSON.stringify(a.toJsonSchema('2020-12'));
        dtoTypes.emit([ a ], { bundle: 'k' });
        assert.equal(JSON.stringify(a.toJsonSchema('2020-12')), before);
    });
});


describe('lib/dto-types §10 — the bundle:types CLI (source pins)', function () {

    it('10.1 - it resolves DTOs through the shared offline resolver, like its siblings', function () {
        assert.match(CLI_SRC, /var dto\s+= lib\.dto;/);
        assert.match(CLI_SRC, /dto\.load\(srcPath, names\[n\]\)/);
    });

    it('10.2 - the dtos/ read is SORTED (readdir order is filesystem-dependent, and the ' +
        'artifact is drift-checked)', function () {
        var blk = CLI_SRC.slice(CLI_SRC.indexOf('fs.readdirSync(dtosPath)'),
                                CLI_SRC.indexOf('if ( !names.length )'));
        assert.match(blk, /\.sort\(\)/);
    });

    it('10.3 - a DTO that FAILS to load aborts the command — it is never skipped ' +
        '(a partial type surface would ship an incomplete contract silently)', function () {
        var blk = CLI_SRC.slice(CLI_SRC.indexOf('d = dto.load(srcPath, names[n]);'),
                                CLI_SRC.indexOf('if ( !d ) {'));
        assert.match(blk, /return end\( new Error\(/);
    });

    it('10.4 - it writes to <bundle>/dtos/index.d.ts by default, --output overrides', function () {
        assert.match(CLI_SRC, /self\.params\['output'\]/);
        assert.match(CLI_SRC, /_\(dtosPath \+ '\/index\.d\.ts', true\)/);
    });

    it('10.5 - a bundle with no dtos/ is skipped with a warning, not an error', function () {
        assert.match(CLI_SRC, /if \( !fs\.existsSync\(dtosPath\) \) \{[\s\S]{0,200}?console\.warn/);
    });
});
