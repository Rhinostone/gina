/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2026 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */
'use strict';

/**
 * @module lib/storage/util
 * @description Pure helpers shared by the storage core and its adapters —
 * id generation, path confinement, size parsing and extension sanitisation.
 *
 * They live in their own module rather than in `src/main` so the adapter can
 * use them without requiring the core back (a cycle), and so each can be
 * unit-tested in isolation. Everything here is pure: no I/O, no globals, no
 * framework imports.
 */

var nodePath = require('path');
var crypto   = require('crypto');

/**
 * Crockford base32 alphabet (ULID) — excludes I, L, O and U so a transcribed
 * key cannot be misread.
 *
 * @inner
 * @constant
 * @type {string}
 */
var CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Generate a ULID: 10 characters of millisecond timestamp followed by 16
 * characters of cryptographic randomness, Crockford base32 throughout.
 *
 * Lexicographically sortable by creation time, which is what makes the
 * `sharded` date prefix cheap to scan; 80 bits of entropy make a
 * within-millisecond collision not worth guarding against.
 *
 * Implemented inline rather than via `lib/uuid` — that is a random base-62
 * generator with no time ordering, and importing it would breach the
 * framework-independence rule.
 *
 * @memberof module:lib/storage/util
 * @param {number} [now] - Epoch ms; defaults to `Date.now()`. Injectable for tests.
 * @returns {string} A 26-character ULID.
 * @example
 * ulid();  // => '01K2S9F3H7QF8ZB4M6N0YCVJ2X'
 * ulid(0); // => '0000000000' followed by 16 random characters
 */
function ulid(now) {
    var ts  = (typeof now === 'number') ? now : Date.now();
    var out = '';
    var i;

    // 48-bit timestamp, most-significant character first.
    for (i = 9; i >= 0; i--) {
        out = CROCKFORD.charAt(ts % 32) + out;
        ts = Math.floor(ts / 32);
    }

    // 16 characters x 5 bits = 80 bits of randomness. Mask to 5 bits rather
    // than taking a byte modulo 32 — 256 is not a multiple of 32, so the
    // modulo form would bias the low characters.
    var rnd = crypto.randomBytes(16);
    for (i = 0; i < 16; i++) {
        out += CROCKFORD.charAt(rnd[i] & 0x1f);
    }
    return out;
}

/**
 * Confine a resolved path to its intended base directory, rejecting traversal
 * escapes that would otherwise canonicalise to a sibling under a shared root.
 *
 * Lib-local copy of the `confineToBase` guard introduced by #B179 (Inspector
 * CWE-22, 0.6.1). The two engine copies live inside closures in
 * `core/server.js` and `core/server.isaac.js`, are unreachable from here, and
 * importing them would breach the framework-independence rule. Behaviourally
 * identical to both — keep it that way.
 *
 * Note the PathObject helper normalises `..` rather than rejecting it, so a
 * naive join is the exploit shape this guard exists to close.
 *
 * Purely lexical: no symlink resolution. A root that can contain
 * attacker-placed symlinks is NOT confined by this, and nothing in the
 * codebase closes that gap today.
 *
 * @memberof module:lib/storage/util
 * @param {string} filename - Candidate absolute path (already percent-decoded).
 * @param {string} base     - The intended base directory.
 * @returns {?string} The canonical in-base path, or `null` when it escapes `base`.
 * @example
 * confineToBase('/srv/data/2026/01/x.pdf', '/srv/data');    // => '/srv/data/2026/01/x.pdf'
 * confineToBase('/srv/data/../../etc/passwd', '/srv/data'); // => null
 * confineToBase('/srv/data-secrets/x', '/srv/data');        // => null (sibling-prefix bypass)
 * confineToBase('/srv/data/x', '');                         // => null (fails closed)
 */
function confineToBase(filename, base) {
    if ( typeof(filename) != 'string' || typeof(base) != 'string' || base.length === 0 ) {
        return null;
    }
    var _resolvedBase = nodePath.resolve(base);
    var _resolvedFile = nodePath.resolve(filename);
    // separator-aware containment: identical to base, or a proper child of it
    if ( _resolvedFile === _resolvedBase || _resolvedFile.indexOf(_resolvedBase + nodePath.sep) === 0 ) {
        return _resolvedFile;
    }
    return null;
}

/**
 * Parse a unit-suffixed size string into bytes.
 *
 * **Deliberately stricter than the upload path's parser.** `core/server.js`
 * treats a BARE number as megabytes, purely so pre-#B51 upload configs keep
 * working. A new key carries no such debt, and `settings.upload` already gives
 * a bare number two different meanings in one block (`maxFields: 1000` is a
 * count, `maxFieldsSize: 50` would be megabytes) — so there is no house
 * semantic to be consistent with. This parser refuses to guess: a bare number
 * returns `NaN` and the boot lint names the fix. Every explicit-unit string
 * parses identically in both, so the two never disagree where both accept.
 *
 * Units are binary (1024-based) despite the KB/MB/GB spelling, matching the
 * upload parser.
 *
 * @memberof module:lib/storage/util
 * @param {string} value - e.g. `'50MB'`, `'512KB'`, `'1.5GB'`, `'900B'`.
 * @returns {number} Bytes, or `NaN` when the value is not a unit-suffixed string.
 * @example
 * parseSize('50MB');  // => 52428800
 * parseSize('1.5GB'); // => 1610612736
 * parseSize('50');    // => NaN (no unit — refused, never assumed to be MB)
 * parseSize(50);      // => NaN (bare number — refused)
 * parseSize(null);    // => NaN
 */
function parseSize(value) {
    if ( typeof(value) != 'string' ) { return NaN; }
    var m = value.trim().match(/^([0-9]*\.?[0-9]+)\s*(b|kb|k|mb|m|gb|g)$/i);
    if ( !m ) { return NaN; }
    var n = parseFloat(m[1]);
    switch ( m[2].toLowerCase() ) {
        case 'b':
            return n;
        case 'k':
        case 'kb':
            return n * 1024;
        case 'g':
        case 'gb':
            return n * 1024 * 1024 * 1024;
        case 'm':
        case 'mb':
        default:
            return n * 1024 * 1024;
    }
}

/**
 * Derive a safe file extension from a client-supplied filename.
 *
 * The extension is the ONLY part of an untrusted name that reaches the
 * filesystem, and it exists purely so an operator browsing the store can tell
 * a PDF from a PNG — nothing reads it back. It is therefore whitelisted hard
 * rather than escaped: alphanumerics only, at most 10 characters, lowercased.
 * Anything else yields the empty string and the object is stored without an
 * extension, which is always safe.
 *
 * Only the last segment of a multi-dot name survives (`.tar.gz` yields `.gz`);
 * the original name is preserved verbatim in the metadata row, where it
 * belongs.
 *
 * Extraction is delegated to `path.extname` rather than hand-rolled, so the
 * edge cases match the platform's own rule instead of a second opinion about
 * it. Two that a naive `lastIndexOf('.')` gets wrong: a dotfile (`.hidden`) has
 * NO extension — the leading dot marks it hidden, not typed — and a dot in a
 * parent directory (`a.b/c`) does not give `c` an extension.
 *
 * @memberof module:lib/storage/util
 * @param {*} originalName - Untrusted client filename; any type is tolerated.
 * @returns {string} A sanitised extension including the leading dot, or `''`.
 * @example
 * sanitiseExtension('invoice.pdf');        // => '.pdf'
 * sanitiseExtension('IMG_0001.JPEG');      // => '.jpeg'
 * sanitiseExtension('archive.tar.gz');     // => '.gz'
 * sanitiseExtension('../../etc/passwd');   // => ''
 * sanitiseExtension('payload.php%00.jpg'); // => '.jpg'
 * sanitiseExtension('.hidden');            // => ''  (a dotfile is not an extension)
 * sanitiseExtension('noext');              // => ''
 * sanitiseExtension('trailing.');          // => ''
 * sanitiseExtension(null);                 // => ''
 */
function sanitiseExtension(originalName) {
    if ( typeof(originalName) != 'string' ) { return ''; }
    var ext = nodePath.extname(originalName);
    if ( ext.length < 2 ) { return ''; } // '' (no extension) or a bare trailing '.'
    ext = ext.slice(1);
    if ( !/^[A-Za-z0-9]{1,10}$/.test(ext) ) { return ''; }
    return '.' + ext.toLowerCase();
}

module.exports = {
    ulid              : ulid,
    confineToBase     : confineToBase,
    parseSize         : parseSize,
    sanitiseExtension : sanitiseExtension
};
