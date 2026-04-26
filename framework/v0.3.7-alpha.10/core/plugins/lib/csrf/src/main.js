/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2026 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */
'use strict';

/**
 * Csrf plugin (#CSRF2) — signed double-submit token middleware.
 *
 * Stateless CSRF defense aligned with OWASP ASVS 4.0 V4.2.1. Issues a
 * signed token cookie on safe-method requests and verifies a matching
 * value on mutating requests (POST/PUT/PATCH/DELETE). Token shape:
 *
 *     <nonce_b64url>.<mac_b64url>
 *     mac = HMAC-SHA256(sessionId + ':' + nonce_b64url, GINA_CSRF_SECRET)
 *
 * Bundles adopt it with two lines in their bootstrap, AFTER the session
 * middleware:
 *
 *     var csrf = require('gina').plugins.Csrf();
 *     app.use(session({...}));   // must register session FIRST
 *     app.use(csrf);
 *
 * Per-route opt-out via `routing.json > "csrfExempt": true` for webhook
 * receivers (Stripe, GitHub, etc.) where CSRF defense doesn't apply.
 *
 * @module plugins/csrf
 */

var crypto = require('crypto');

var ALLOWED_ROTATE = ['per-session', 'per-request'];

var DEFAULT_COOKIE_NAME  = 'gina-csrf-token';
var DEFAULT_HEADER_NAME  = 'X-Gina-CSRF-Token';
var DEFAULT_FIELD_NAME   = '_csrf';
var DEFAULT_ROTATE       = 'per-session';
var DEFAULT_SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

var NONCE_BYTES = 16;
var MAC_BYTES   = 32;

/**
 * Read the active bundle's `settings.json > csrf.*` section and return
 * the merged framework defaults.
 *
 * @returns {{cookieName: string, headerName: string, fieldName: string,
 *            rotate: string, safeMethods: string[]}}
 * @throws  {Error} when a setting has an unsupported value.
 * @inner
 * @private
 */
function resolveSettingsDefaults() {
    var defaults = {
        cookieName:  DEFAULT_COOKIE_NAME,
        headerName:  DEFAULT_HEADER_NAME,
        fieldName:   DEFAULT_FIELD_NAME,
        rotate:      DEFAULT_ROTATE,
        safeMethods: DEFAULT_SAFE_METHODS.slice()
    };
    var csrfConf = {};

    try {
        var ctx    = getContext();
        var bundle = ctx && ctx.bundle;
        var env    = ctx && ctx.env;
        var conf   = (typeof getConfig === 'function') ? getConfig() : null;
        if (bundle && env && conf && conf[bundle] && conf[bundle][env]) {
            var content  = conf[bundle][env].content || {};
            var settings = content.settings || {};
            csrfConf     = settings.csrf || {};
        }
    } catch (ignored) {
        csrfConf = {};
    }

    if (typeof csrfConf.cookieName === 'string' && csrfConf.cookieName) {
        defaults.cookieName = csrfConf.cookieName;
    }
    if (typeof csrfConf.headerName === 'string' && csrfConf.headerName) {
        defaults.headerName = csrfConf.headerName;
    }
    if (typeof csrfConf.fieldName === 'string' && csrfConf.fieldName) {
        defaults.fieldName = csrfConf.fieldName;
    }
    if (typeof csrfConf.rotate === 'string') {
        if (ALLOWED_ROTATE.indexOf(csrfConf.rotate) < 0) {
            throw new Error(
                '[gina csrf] settings.json > csrf.rotate must be one of '
                + ALLOWED_ROTATE.map(function (v) { return '"' + v + '"'; }).join(', ')
                + ' — got: ' + JSON.stringify(csrfConf.rotate)
            );
        }
        defaults.rotate = csrfConf.rotate;
    }
    if (Array.isArray(csrfConf.safeMethods)) {
        defaults.safeMethods = csrfConf.safeMethods.map(function (m) {
            return String(m).toUpperCase();
        });
    }

    return defaults;
}

/**
 * 16 cryptographically secure random bytes.
 *
 * @returns {Buffer}
 * @inner
 * @private
 */
function generateNonce() {
    var bytes = new Uint8Array(NONCE_BYTES);
    crypto.getRandomValues(bytes);
    return Buffer.from(bytes);
}

/**
 * Build a `<nonce_b64url>.<mac_b64url>` token bound to the given session
 * id. The MAC commits to the b64url-encoded nonce (not the raw bytes)
 * so the verify path doesn't need to round-trip through Buffer.
 *
 * @param   {string} sessionId — the value `req.session.id` returns
 * @param   {string} secret    — `GINA_CSRF_SECRET` (>= 32 bytes recommended)
 * @returns {string}            — e.g. `"abc...xyz.def...uvw"`
 * @inner
 * @private
 */
function generateToken(sessionId, secret) {
    var nonceBuf = generateNonce();
    var nonceB64 = nonceBuf.toString('base64url');
    var mac = crypto.createHmac('sha256', secret)
                    .update(sessionId + ':' + nonceB64)
                    .digest();
    return nonceB64 + '.' + mac.toString('base64url');
}

/**
 * Constant-time verify of a presented token. Returns `false` on any
 * structural problem (wrong shape, truncated halves, invalid base64url,
 * length mismatch) — the only `true` path is a successful HMAC equality.
 *
 * @param   {string} token     — value from cookie / header / form field
 * @param   {string} sessionId — `req.session.id`
 * @param   {string} secret    — `GINA_CSRF_SECRET`
 * @returns {boolean}
 * @inner
 * @private
 */
function verifyToken(token, sessionId, secret) {
    if (typeof token !== 'string' || !token) return false;
    if (typeof sessionId !== 'string' || !sessionId) return false;
    if (typeof secret !== 'string' || !secret) return false;

    var dot = token.indexOf('.');
    if (dot < 1 || dot !== token.lastIndexOf('.')) return false;

    var nonceB64 = token.substring(0, dot);
    var macB64   = token.substring(dot + 1);
    if (!nonceB64 || !macB64) return false;

    var nonceBuf, presentedMac;
    try {
        nonceBuf     = Buffer.from(nonceB64, 'base64url');
        presentedMac = Buffer.from(macB64,   'base64url');
    } catch (e) {
        return false;
    }
    if (nonceBuf.length !== NONCE_BYTES) return false;

    var expectedMac = crypto.createHmac('sha256', secret)
                            .update(sessionId + ':' + nonceB64)
                            .digest();
    if (presentedMac.length !== expectedMac.length) return false;

    try { return crypto.timingSafeEqual(presentedMac, expectedMac); }
    catch (e) { return false; }
}

/**
 * Read a single cookie value out of `req.headers.cookie`.
 *
 * @inner
 * @private
 */
function readCookie(req, name) {
    var raw = req && req.headers && req.headers.cookie;
    if (!raw) return null;
    var parts = String(raw).split(';');
    for (var i = 0; i < parts.length; i++) {
        var p  = parts[i].trim();
        var eq = p.indexOf('=');
        if (eq < 0) continue;
        if (p.substring(0, eq).trim() === name) {
            try { return decodeURIComponent(p.substring(eq + 1).trim()); }
            catch (e) { return p.substring(eq + 1).trim(); }
        }
    }
    return null;
}

/**
 * Append a Set-Cookie line, preserving any cookie set earlier in the
 * pipeline.
 *
 * @inner
 * @private
 */
function appendSetCookie(res, name, value, secure) {
    var parts = [
        name + '=' + encodeURIComponent(value),
        'Path=/',
        'SameSite=Lax'
    ];
    if (secure) parts.push('Secure');
    var line = parts.join('; ');

    var existing = (typeof res.getHeader === 'function') ? res.getHeader('Set-Cookie') : null;
    if (existing) {
        var arr = Array.isArray(existing) ? existing.slice() : [existing];
        arr.push(line);
        res.setHeader('Set-Cookie', arr);
    } else {
        res.setHeader('Set-Cookie', line);
    }
}

/**
 * Best-effort detection of whether the active request travelled over
 * TLS. `Secure` is auto-injected when the answer is yes.
 *
 * @inner
 * @private
 */
function isSecureRequest(req) {
    if (!req) return false;
    if (req.secure === true) return true;
    if (req.connection && req.connection.encrypted) return true;
    if (req.socket && req.socket.encrypted) return true;
    var proto = req.headers && req.headers['x-forwarded-proto'];
    if (typeof proto === 'string' && /^https$/i.test(proto.split(',')[0].trim())) return true;
    return false;
}

/**
 * Pull the presented token from request headers first, then from a
 * parsed body field (`req.body`, `req.post`, `req.put`, `req.patch`,
 * `req.delete`).
 *
 * @inner
 * @private
 */
function readPresentedToken(req, headerNameLower, fieldName) {
    if (req && req.headers && typeof req.headers[headerNameLower] === 'string') {
        return req.headers[headerNameLower];
    }
    var sources = [req.body, req.post, req.put, req.patch, req['delete']];
    for (var i = 0; i < sources.length; i++) {
        var b = sources[i];
        if (b && typeof b === 'object' && typeof b[fieldName] === 'string' && b[fieldName]) {
            return b[fieldName];
        }
    }
    return null;
}

/**
 * Reject a mutating request with 403 Forbidden and log the reason.
 *
 * @inner
 * @private
 */
function reject(req, res, reason) {
    console.error('[csrf] forbidden — ' + reason + ' on ' + (req.method || '?') + ' ' + (req.url || '?'));
    res.statusCode = 403;
    if (typeof res.setHeader === 'function') {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    }
    res.end('Forbidden');
}

var SESSIONLESS_MESSAGE =
    '[csrf] no req.session.id - Csrf plugin requires the Session plugin to be registered before it.'
    + ' If your bundle uses Bearer-token auth (cookies disabled), remove the Csrf plugin'
    + ' - CSRF doesn\'t apply to non-cookie authentication.';

/**
 * Build the CSRF middleware. The factory reads
 * `process.env.GINA_CSRF_SECRET` once, at call time, and refuses to
 * proceed if it is missing — no dev fallback.
 *
 * @example
 *   var csrf = require('gina').plugins.Csrf();
 *   app.use(session({ secret: process.env.SESSION_SECRET }));
 *   app.use(csrf);
 *
 * @example
 *   // routing.json — webhook receiver opts out:
 *   "stripe-webhook": {
 *     "url": "/webhooks/stripe",
 *     "method": "POST",
 *     "csrfExempt": true,
 *     "param": { "control": "@webhook:stripe", "file": "stripe.js" }
 *   }
 *
 * @param   {object} [opts]
 * @param   {string} [opts.secret]      — overrides `GINA_CSRF_SECRET` (test harness)
 * @param   {string} [opts.cookieName]
 * @param   {string} [opts.headerName]
 * @param   {string} [opts.fieldName]
 * @param   {string} [opts.rotate]      — `"per-session"` (default) or `"per-request"`
 * @param   {string[]} [opts.safeMethods]
 * @returns {function}                  — Express-compatible middleware `(req, res, next)`
 * @throws  {Error} when `GINA_CSRF_SECRET` is missing.
 */
function Csrf(opts) {
    opts = opts || {};

    var secret = (typeof opts.secret === 'string' && opts.secret)
                 ? opts.secret
                 : process.env.GINA_CSRF_SECRET;
    if (typeof secret !== 'string' || !secret) {
        throw new Error(
            '[gina csrf] GINA_CSRF_SECRET env var is required.'
            + ' Generate once: openssl rand -base64 64.'
            + ' Place in your bundle\'s env.json or your shell profile.'
        );
    }

    var defaults    = resolveSettingsDefaults();
    var cookieName  = (typeof opts.cookieName === 'string' && opts.cookieName) ? opts.cookieName : defaults.cookieName;
    var headerName  = (typeof opts.headerName === 'string' && opts.headerName) ? opts.headerName : defaults.headerName;
    var fieldName   = (typeof opts.fieldName  === 'string' && opts.fieldName)  ? opts.fieldName  : defaults.fieldName;
    var rotate      = (typeof opts.rotate     === 'string' && opts.rotate)     ? opts.rotate     : defaults.rotate;
    if (ALLOWED_ROTATE.indexOf(rotate) < 0) {
        throw new Error(
            '[gina csrf] rotate must be one of '
            + ALLOWED_ROTATE.map(function (v) { return '"' + v + '"'; }).join(', ')
            + ' — got: ' + JSON.stringify(rotate)
        );
    }
    var safeMethods = Array.isArray(opts.safeMethods)
                      ? opts.safeMethods.map(function (m) { return String(m).toUpperCase(); })
                      : defaults.safeMethods;

    var headerNameLower = headerName.toLowerCase();

    return function ginaCsrf(req, res, next) {
        if (!req || !req.session) {
            return next(new Error(SESSIONLESS_MESSAGE));
        }

        var sessionId = req.session.id;
        var method    = (req.method || 'GET').toUpperCase();
        var isSafe    = safeMethods.indexOf(method) > -1;
        var isExempt  = !!(req.routing && req.routing.csrfExempt);

        if (typeof sessionId !== 'string' || !sessionId) {
            if (!isSafe && !isExempt) {
                return next(new Error(SESSIONLESS_MESSAGE));
            }
            return next();
        }

        if (isSafe) {
            var existing  = readCookie(req, cookieName);
            var needIssue = (rotate === 'per-request')
                            || !existing
                            || !verifyToken(existing, sessionId, secret);
            var token     = needIssue ? generateToken(sessionId, secret) : existing;
            if (needIssue) {
                appendSetCookie(res, cookieName, token, isSecureRequest(req));
            }
            req.csrfToken = token;
            return next();
        }

        if (isExempt) {
            return next();
        }

        var presented = readPresentedToken(req, headerNameLower, fieldName);
        var cookie    = readCookie(req, cookieName);

        if (!presented || !cookie) {
            return reject(req, res, 'missing token');
        }
        if (presented.length !== cookie.length) {
            return reject(req, res, 'token/cookie length mismatch');
        }
        var presentedBuf = Buffer.from(presented, 'utf8');
        var cookieBuf    = Buffer.from(cookie,    'utf8');
        var pairOk;
        try { pairOk = crypto.timingSafeEqual(presentedBuf, cookieBuf); }
        catch (e) { pairOk = false; }
        if (!pairOk) {
            return reject(req, res, 'token/cookie mismatch');
        }

        if (!verifyToken(presented, sessionId, secret)) {
            return reject(req, res, 'invalid token');
        }

        req.csrfToken = presented;
        return next();
    };
}

// Exposed for unit testing. Do not rely on these in application code —
// they may change without notice.
Csrf._resolveSettingsDefaults = resolveSettingsDefaults;
Csrf._generateToken           = generateToken;
Csrf._verifyToken             = verifyToken;
Csrf._readCookie              = readCookie;
Csrf._appendSetCookie         = appendSetCookie;
Csrf._isSecureRequest         = isSecureRequest;
Csrf._readPresentedToken      = readPresentedToken;
Csrf._ALLOWED_ROTATE          = ALLOWED_ROTATE;
Csrf._SESSIONLESS_MESSAGE     = SESSIONLESS_MESSAGE;
Csrf._NONCE_BYTES             = NONCE_BYTES;
Csrf._MAC_BYTES               = MAC_BYTES;

module.exports = Csrf;
