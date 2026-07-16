/**
 * Fixture DTO — the canonical request shape.
 *
 * Exercises: required + optional, every scalar kind, an email format, value bounds
 * (schema-only), length bounds, a string enum, a date, a per-field description, and a
 * required-AND-excluded field (accepted from the client, validated, then stripped — the
 * case a schema-only type generator would get wrong).
 */
module.exports = function (dto) {
    return dto.object({
        email    : dto.string().email().required().description('The account email.'),
        age      : dto.integer().min(0).max(120),
        active   : dto.boolean(),
        role     : dto.enum(['admin', 'editor', 'viewer']).required(),
        joinedOn : dto.date(),
        nickname : dto.string().minLength(2).maxLength(24),
        token    : dto.string().required().exclude().description('Accepted and validated, then stripped.')
    }, 'CreateUser');
};
