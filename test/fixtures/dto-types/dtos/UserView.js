/**
 * Fixture DTO — a response shape (`param.responseDto`).
 *
 * Exercises: an object-level title + description, no required field at all, and an
 * excluded secret that must never reach the wire.
 */
module.exports = function (dto) {
    return dto.object({
        id           : dto.integer(),
        email        : dto.string().email(),
        role         : dto.enum(['admin', 'editor', 'viewer']),
        passwordHash : dto.string().exclude().description('Never serialised.')
    }, 'UserView')
        .title('A user, as the API returns it')
        .description('The password hash is declared so the shape is honest, and excluded so it cannot leave the process.');
};
