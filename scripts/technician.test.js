/* Compatibility alias for the roster suite.
 *
 * The canonical file is `technician-mgmt.js` (registered in run-tests.js).
 * This alias exists so `MAHER_TEST_SUITES=scripts/technician.test.js npm test`
 * and a direct node invocation both reach the same E2E checks without
 * duplicating coverage in the full regression. Never point either file at a
 * live database — the shared test-support guard still applies.
 */
require("./technician-mgmt.js");
