/**
 * @module inspector-redact
 *
 * Redacts secret-looking keys from Inspector payloads before they are shipped
 * to window.__ginaData, localStorage.__ginaData, or /_gina/agent SSE frames.
 *
 * Dev-mode only. Never applied to the actual HTTP response body — the template
 * still receives the real data object; only the Inspector clone is redacted.
 *
 * Configuration is read from settings.json:
 *
 *   "inspector": {
 *       "redact": {
 *           "patterns": ["password", "pwd", "token", ...],   // optional — extends/replaces defaults
 *           "types":    ["password"],                         // client-side DOM input types
 *           "replacement": "[redacted]"                        // optional
 *       }
 *   }
 *
 * When `patterns` or `types` is omitted, the defaults below are used.
 */

'use strict';

var DEFAULT_PATTERNS = [
    'password', 'passwd', 'pwd',
    'secret',
    'token', 'apikey', 'api[_-]?key',
    'cvv', 'cvc', 'ccv',
    'pan', 'ssn',
    'authorization', 'credentials',
    'private[_-]?key'
];

var DEFAULT_TYPES = ['password'];
var REPLACEMENT   = '[redacted]';

// Keys ending with these suffixes describe validation rules, policies, or
// config metadata — they do not hold user input. A key like `passwordRule`
// or `passwordPolicy` must pass through untouched even though it contains
// the substring "password". Matched case-insensitively at the very end of
// the key name.
var NON_SECRET_SUFFIX = /(rule|rules|policy|policies|validator|config|configuration|settings|setting|meta|metadata|format|requirements|strength|constraint|constraints|options|option|schema|definition|definitions|spec|specs)$/i;

/**
 * Compile an array of regex source strings into RegExp objects. Invalid
 * entries are dropped silently so a bad config key cannot crash a render.
 * @param {string[]} patterns
 * @returns {RegExp[]}
 */
function compile(patterns) {
    var out = [];
    if (!Array.isArray(patterns)) return out;
    for (var i = 0; i < patterns.length; i++) {
        try { out.push(new RegExp(patterns[i], 'i')); } catch (e) { /* skip */ }
    }
    return out;
}

/**
 * @param {string} key
 * @param {RegExp[]} compiled
 * @returns {boolean}
 */
function keyMatches(key, compiled) {
    if (typeof key !== 'string') return false;
    // Rule/policy/config keys describe validation, not user input — skip them
    // even when the name contains a secret keyword (e.g. `passwordRule`).
    if (NON_SECRET_SUFFIX.test(key)) return false;
    for (var i = 0; i < compiled.length; i++) {
        if (compiled[i].test(key)) return true;
    }
    return false;
}

function walk(value, compiled, replacement, maxDepth, depth, seen) {
    if (depth > maxDepth) return value;
    if (value === null || typeof value !== 'object') return value;
    if (seen.has(value)) return '[circular]';
    seen.add(value);

    if (Array.isArray(value)) {
        var arr = new Array(value.length);
        for (var i = 0; i < value.length; i++) {
            arr[i] = walk(value[i], compiled, replacement, maxDepth, depth + 1, seen);
        }
        return arr;
    }

    var out  = {};
    var keys = Object.keys(value);
    for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        var v   = value[key];
        if (keyMatches(key, compiled)) {
            // Only primitive leaf values are redacted. Object/array values under
            // a secret-like key are metadata (validation rules, error maps,
            // validator specs keyed by form field name like `account[password]`)
            // — walk into them so any primitive secrets nested deeper still get
            // caught, but the rule structure itself passes through.
            if (v === null || typeof v === 'undefined') {
                out[key] = v;
            } else if (typeof v === 'object') {
                out[key] = walk(v, compiled, replacement, maxDepth, depth + 1, seen);
            } else {
                out[key] = replacement;
            }
        } else {
            out[key] = walk(v, compiled, replacement, maxDepth, depth + 1, seen);
        }
    }
    return out;
}

/**
 * Walk `obj` and replace values whose key matches any redaction pattern with
 * `replacement` (default `[redacted]`). Returns a deep-cloned copy — the
 * input object is never mutated. Circular references become `'[circular]'`.
 *
 * @param {*} obj
 * @param {object} [options]
 * @param {string[]} [options.patterns]            - raw regex source strings (ignored if compiledPatterns is set)
 * @param {RegExp[]} [options.compiledPatterns]
 * @param {string}   [options.replacement='[redacted]']
 * @param {number}   [options.maxDepth=50]
 * @returns {*}
 */
function redact(obj, options) {
    options = options || {};
    var compiled = options.compiledPatterns
        || compile(options.patterns || DEFAULT_PATTERNS);
    var replacement = (typeof options.replacement === 'string') ? options.replacement : REPLACEMENT;
    var maxDepth    = (typeof options.maxDepth === 'number') ? options.maxDepth : 50;
    return walk(obj, compiled, replacement, maxDepth, 0, new WeakSet());
}

/**
 * Resolve redaction configuration from a bundle's conf object. Accepts either
 * `conf.inspector.redact` or `conf.content.inspector.redact` — whichever
 * exists wins. Unknown/invalid keys fall back to defaults.
 *
 * @param {object} conf
 * @returns {{patterns:string[], types:string[], replacement:string, compiledPatterns:RegExp[]}}
 */
function getConfig(conf) {
    var redactConf = null;
    if (conf) {
        if (conf.inspector && conf.inspector.redact) {
            redactConf = conf.inspector.redact;
        } else if (conf.content && conf.content.settings && conf.content.settings.inspector && conf.content.settings.inspector.redact) {
            redactConf = conf.content.settings.inspector.redact;
        } else if (conf.content && conf.content.inspector && conf.content.inspector.redact) {
            redactConf = conf.content.inspector.redact;
        } else if (conf.settings && conf.settings.inspector && conf.settings.inspector.redact) {
            redactConf = conf.settings.inspector.redact;
        }
    }
    redactConf = redactConf || {};

    var patterns = (Array.isArray(redactConf.patterns) && redactConf.patterns.length > 0)
        ? redactConf.patterns : DEFAULT_PATTERNS;
    var types = (Array.isArray(redactConf.types) && redactConf.types.length > 0)
        ? redactConf.types : DEFAULT_TYPES;
    var replacement = (typeof redactConf.replacement === 'string' && redactConf.replacement)
        ? redactConf.replacement : REPLACEMENT;

    return {
        patterns         : patterns,
        types            : types,
        replacement      : replacement,
        compiledPatterns : compile(patterns)
    };
}

module.exports = {
    DEFAULT_PATTERNS    : DEFAULT_PATTERNS,
    DEFAULT_TYPES       : DEFAULT_TYPES,
    REPLACEMENT         : REPLACEMENT,
    NON_SECRET_SUFFIX   : NON_SECRET_SUFFIX,
    compile             : compile,
    keyMatches          : keyMatches,
    redact              : redact,
    getConfig           : getConfig
};
