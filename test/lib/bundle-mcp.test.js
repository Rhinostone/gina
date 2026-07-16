'use strict';
/**
 * lib/cmd/bundle/mcp.js — the `bundle:mcp` DTO emit (#DTO1c).
 *
 * `buildTools` / `buildTool` / `buildInputSchema` are private closures, so this
 * suite follows the gina cmd-handler house style (minion-list.test.js): SOURCE
 * PINS lock the wiring, and a SOURCE-LOCKED pure-logic REPLICA of the DTO branches
 * is driven through the REAL `lib.dto` + `lib.routingIntrospect`.
 *
 * The full end-to-end (a real offline `gina bundle:mcp` against a scaffold bundle
 * with a factory DTO) was run during the build and confirmed a real draft-07
 * inputSchema.body + outputSchema + un-collapsed param.
 */
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW      = require('../fw');
var SRC     = fs.readFileSync(path.join(FW, 'lib/cmd/bundle/mcp.js'), 'utf8');
var dto     = require(path.join(FW, 'lib/dto/src/main.js'));
var introspect = require(path.join(FW, 'lib/routing-introspect/src/main.js'));

dto.register('MCP_Create', dto.object({
    email: dto.string().email().required(),
    age:   dto.integer().min(0).max(120),
    role:  dto.enum(['admin', 'user']).required()
}));
dto.register('MCP_View', dto.object({
    id:    dto.string().required(),
    email: dto.string().email()
}));
dto.register('MCP_ViewExcl', dto.object({
    id:           dto.string().required(),
    email:        dto.string().email(),
    passwordHash: dto.string().required().exclude()
}));

/** Source-locked replica of mcp.js `buildInputSchema` (locked by §01 pins). */
function emitInputSchema(route, method, srcPath) {
    var param     = route.param || {};
    var reqs      = route.requirements || {};
    var urlParams = route._urlParams || [];
    var schema = { type: 'object', properties: {}, required: [], additionalProperties: true };

    for (var i = 0; i < urlParams.length; i++) {
        var name = urlParams[i];
        var prop = { type: 'string' };
        if (typeof reqs[name] !== 'undefined') {
            var rawReq = reqs[name];
            if (typeof rawReq === 'string' && rawReq.indexOf('validator::') === 0) {
                var frag = introspect.requirementToSchema(rawReq);
                for (var fk in frag) { if (frag.hasOwnProperty(fk)) { prop[fk] = frag[fk]; } }
            } else {
                var p = introspect.requirementToPattern(rawReq);
                if (p.type === 'pattern') { prop.pattern = p.value; }
                else if (p.type === 'enum') { prop.enum = p.value; }
            }
        }
        schema.properties[name] = prop;
        schema.required.push(name);
    }

    if (method !== 'get') {
        var bodyDto = null;
        if (param && param.dto) { bodyDto = dto.load(srcPath, param.dto); }
        schema.properties.body = bodyDto
            ? bodyDto.toJsonSchema('draft-07')
            : {
                type: 'object',
                description: 'Request body. Shape is controller-defined and not described in routing.json.',
                additionalProperties: true
            };
    }

    if (!schema.required.length) { delete schema.required; }
    return schema;
}

/** Source-locked replica of mcp.js buildTool's outputSchema branch. */
function emitOutputSchema(route, srcPath) {
    var param = route.param || {};
    if (param.responseDto) {
        var respDto = dto.load(srcPath, param.responseDto);
        if (respDto) { return respDto.toJsonSchema('draft-07', { dropExcluded: true }); }
    }
    return undefined;
}


describe('bundle:mcp §01 — source pins (DTO wiring)', function () {
    it('01.1 - requires the dto builder from the lib registry', function () {
        assert.ok(SRC.indexOf('var dto         = lib.dto;') > -1);
    });
    it('01.2 - threads srcPath through buildTools (definition + call)', function () {
        assert.ok(SRC.indexOf('var buildTools = function(bundle, routing, bundleNames, srcPath)') > -1);
        assert.ok(SRC.indexOf('buildTools(bundle, routing, bundleNames, srcPath)') > -1);
    });
    it('01.3 - threads srcPath through buildTool (definition + call)', function () {
        assert.ok(SRC.indexOf('var buildTool = function(toolId, routeName, route, urlInfo, method, srcPath)') > -1);
        assert.ok(SRC.indexOf('buildTool(finalId, routeName, route, urlInfo, method, srcPath)') > -1);
    });
    it('01.4 - buildInputSchema receives param + srcPath (definition + call)', function () {
        assert.ok(SRC.indexOf('var buildInputSchema = function(urlParams, reqs, method, param, srcPath)') > -1);
        assert.ok(SRC.indexOf('buildInputSchema(urlInfo.params, reqs, method, param, srcPath)') > -1);
    });
    it('01.5 - the non-GET body is the resolved param.dto schema (draft-07), else the lenient placeholder', function () {
        assert.ok(SRC.indexOf('bodyDto = dto.load(srcPath, param.dto)') > -1);
        assert.match(SRC, /bodyDto\.toJsonSchema\('draft-07'\)/);
        assert.ok(SRC.indexOf('Request body. Shape is controller-defined') > -1, 'lenient placeholder retained');
    });
    it('01.6 - outputSchema comes from a resolved param.responseDto (draft-07)', function () {
        assert.ok(SRC.indexOf('if ( param.responseDto ) {') > -1);
        assert.ok(SRC.indexOf('respDto = dto.load(srcPath, param.responseDto)') > -1);
        assert.match(SRC, /tool\.outputSchema = respDto\.toJsonSchema\('draft-07', \{ dropExcluded: true \}\)/);
    });
    it('01.7 - a validator:: requirement is un-collapsed via requirementToSchema; pattern/enum kept', function () {
        assert.match(SRC, /rawReq\.indexOf\('validator::'\) === 0/);
        assert.ok(SRC.indexOf('introspect.requirementToSchema(rawReq)') > -1);
        assert.ok(SRC.indexOf('introspect.requirementToPattern(rawReq)') > -1);
    });
});


describe('bundle:mcp §02 — replica: DTO emit is real (not the placeholder)', function () {
    it('02.1 - non-GET + param.dto sets body to a real draft-07 DTO schema', function () {
        var s = emitInputSchema({ param: { dto: 'MCP_Create' } }, 'post', null);
        var body = s.properties.body;
        assert.equal(body.properties.email.format, 'email');
        assert.equal(body.properties.age.minimum, 0);
        assert.deepEqual(body.properties.role.enum, ['admin', 'user']);
        assert.equal(body.additionalProperties, false);
        assert.ok(String(JSON.stringify(body)).indexOf('controller-defined') < 0, 'not the lenient placeholder');
    });
    it('02.2 - SUBTRACT: non-GET with no param.dto keeps the lenient placeholder body', function () {
        var s = emitInputSchema({ param: { control: 'x' } }, 'post', null);
        assert.equal(s.properties.body.additionalProperties, true);
        assert.ok(String(JSON.stringify(s.properties.body)).indexOf('controller-defined') > -1);
    });
    it('02.3 - SUBTRACT: an unresolved param.dto falls back to the lenient placeholder', function () {
        var s = emitInputSchema({ param: { dto: 'MCP_Nope' } }, 'post', null);
        assert.equal(s.properties.body.additionalProperties, true);
    });
    it('02.4 - a GET tool has no body property at all', function () {
        var s = emitInputSchema({ param: { dto: 'MCP_Create' } }, 'get', null);
        assert.equal(s.properties.body, undefined);
    });
    it('02.5 - param.responseDto produces a real draft-07 outputSchema', function () {
        var out = emitOutputSchema({ param: { responseDto: 'MCP_View' } }, null);
        assert.equal(out.type, 'object');
        assert.deepEqual(Object.keys(out.properties), ['id', 'email']);
    });
    it('02.6 - SUBTRACT: no responseDto -> no outputSchema', function () {
        assert.equal(emitOutputSchema({ param: {} }, null), undefined);
        assert.equal(emitOutputSchema({ param: { responseDto: 'MCP_Nope' } }, null), undefined);
    });
    it('02.7 - a validator:: URL-param requirement is un-collapsed', function () {
        var s = emitInputSchema({ _urlParams: ['id'], requirements: { id: 'validator::{ isString: [3, 40] }' } }, 'get', null);
        assert.equal(s.properties.id.minLength, 3);
        assert.equal(s.properties.id.maxLength, 40);
        assert.equal(s.properties.id.pattern, undefined);
    });
    it('02.8 - a regex / pipe requirement still uses pattern / enum', function () {
        var re = emitInputSchema({ _urlParams: ['x'], requirements: { x: '/^[0-9]+$/' } }, 'get', null);
        assert.equal(re.properties.x.pattern, '^[0-9]+$');
        var en = emitInputSchema({ _urlParams: ['y'], requirements: { y: 'a|b' } }, 'get', null);
        assert.deepEqual(en.properties.y.enum, ['a', 'b']);
    });
    it('02.9 - #B110: an `.exclude()`d field leaves the outputSchema (properties + required[]) but STAYS in the inputSchema body', function () {
        var out = emitOutputSchema({ param: { responseDto: 'MCP_ViewExcl' } }, null);
        assert.equal(out.properties.passwordHash, undefined);
        assert.deepEqual(Object.keys(out.properties), ['id', 'email']);
        assert.deepEqual(out.required, ['id'], 'required+excluded left required[] too');
        var input = emitInputSchema({ param: { dto: 'MCP_ViewExcl' } }, 'post', null);
        assert.ok(input.properties.body.properties.passwordHash, 'request body keeps the declared field');
        assert.ok(input.properties.body.required.indexOf('passwordHash') > -1);
    });
});
