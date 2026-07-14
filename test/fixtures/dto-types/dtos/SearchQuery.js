/**
 * Fixture DTO — an open (`.passthrough()`) shape.
 *
 * Exercises: `additionalProperties: true` -> a TS index signature, a field name that is
 * NOT a bare TS identifier (must be quoted in the emitted interface), a numeric enum, a
 * boolean enum, and a regex pattern (documentation-only in this cut).
 */
module.exports = function (dto) {
    return dto.object({
        q           : dto.string().minLength(1).maxLength(128).required(),
        'page-size' : dto.integer().min(1).max(100),
        sort        : dto.enum(['asc', 'desc']),
        limit       : dto.enum([10, 25, 50]),
        exact       : dto.enum([true, false]),
        slug        : dto.string().pattern('^[a-z0-9-]+$')
    }, 'SearchQuery').passthrough();
};
