/**
 * Fixture DTO — no excluded field.
 *
 * Exercises the branch where the projection is a plain alias of the declared shape
 * (`type PingProjected = Ping;`) rather than an `Omit<...>`.
 */
module.exports = function (dto) {
    return dto.object({
        nonce : dto.string().required()
    }, 'Ping');
};
