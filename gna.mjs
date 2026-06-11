/**
 * Gina — ESM counterpart of `require('gina/gna')` (#M10)
 *
 *   import gna from 'gina/gna';
 *
 *   // destructure AFTER framework boot — see below
 *   const { getContext, getConfig } = gna;
 *
 * Default export ONLY, on purpose: the CJS module exposes getter
 * properties that resolve at ACCESS time (after framework boot). Static
 * named ESM re-exports would capture `undefined` before boot, so the
 * getter namespace is passed through untouched.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const gnaHelpers = require('./gna.js');

export default gnaHelpers;
