/**
 * Domain type re-exports. Each sub-module owns one feature area's types so
 * parallel branches don't collide on a single types.ts file. Append a new
 * `export * from './<domain>'` line when adding a domain submodule.
 */
export type { Preferences, Appearance } from './preferences.js';
export { PREFERENCES_CODE_MAX_VERSION, PREFERENCES_DEFAULTS } from './preferences.js';
