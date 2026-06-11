/**
 * Gina — ESM entry point (#M10)
 *
 * Mirrors `require('gina')` for ESM consumers and modern bundlers:
 *
 *   import gina from 'gina';
 *
 *   gina.onInitialize(function (event, conf) { ... });
 *   gina.start();
 *
 * Default export ONLY — the framework object is assembled at runtime by
 * the CJS core (lifecycle hooks, lib registry, plugins), so the namespace
 * default is the honest ESM surface; static named re-exports would freeze
 * values at import time.
 *
 * The core is resolved through package.json's `main` field so this file
 * never carries a version-pinned framework path (no version-bump coupling).
 * Importing outside a spawned bundle child has exactly the semantics of
 * `require('gina')` there — the framework bootstrap expects the bundle
 * context and throws without it.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const gna = require(require('./package.json').main);

export default gna;
