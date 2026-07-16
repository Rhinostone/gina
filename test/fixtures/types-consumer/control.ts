/**
 * CAN-FAIL control — this file MUST FAIL to compile.
 *
 * `script/check_types_consumer.js` compiles it after the clean fixture and
 * asserts a NON-zero exit carrying both expected diagnostics:
 *
 *  - TS2339 on the bogus member below — proves package-name resolution
 *    actually loaded gina's declarations (if `gina` had silently resolved
 *    to `any`, this access would pass and the whole gate would be vacuous);
 *  - TS2304 from `bad-lib.d.ts` — proves `skipLibCheck: false` is operative
 *    (with `true`, an error INSIDE a declaration file is ignored).
 *
 * If this file ever compiles clean, the gate is broken, not the code.
 */

/// <reference path="./bad-lib.d.ts" />

import gina = require('gina');

const mustNotExist = gina.dto3bNonexistentMemberForControl;
void mustNotExist;

export {};
