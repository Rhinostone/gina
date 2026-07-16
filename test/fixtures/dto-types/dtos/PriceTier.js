/**
 * Fixture DTO — a DTO that CANNOT be compiled to validator rules, but must still be typed.
 *
 * An authored dollar sign anywhere in the emitted rules sends the validator engine down a
 * client-only branch that dereferences the null server-side `$fields` and throws from
 * above its own try/catch — so `toRules()` deliberately REJECTS it (see lib/dto). A
 * currency-style enum is the plausible way that happens.
 *
 * `toJsonSchema()` is not guarded (a dollar sign is perfectly valid in a JSON Schema
 * enum), so such a DTO still documents and still serves as a `param.responseDto`. The
 * type emitter must therefore be TOTAL where `toRules()` is not — which is exactly why it
 * reads the shape rather than the compiled rules to find the excluded fields.
 */
module.exports = function (dto) {
    return dto.object({
        tier   : dto.enum(['$ 10', '$ 25', '$ 50']).required(),
        amount : dto.number().min(0)
    }, 'PriceTier');
};
