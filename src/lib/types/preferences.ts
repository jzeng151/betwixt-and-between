/**
 * User preferences shape — the persisted root.
 *
 * Sub-branches add their own sections (appearance, hotkeys, entityDefaults,
 * editor, etc.) by augmenting this interface or extending Preferences in their
 * own type files. The scaffold only owns `schemaVersion`; everything else is
 * additive and version-migrated as needed.
 */
export interface Preferences {
	/**
	 * Monotonically-increasing version of the persisted shape. Bump when adding
	 * a section that requires a migration from a prior shape. Read at load time
	 * to decide which migrations to run; refuse-to-run if stored value exceeds
	 * what the running build knows about (downgrade protection).
	 */
	schemaVersion: number;
}

/**
 * The current code's max-known version. Bump in lockstep with adding a
 * migration to MIGRATIONS in stores/preferences.ts.
 */
export const PREFERENCES_CODE_MAX_VERSION: number = 1;

/**
 * Built-in defaults. Sub-branches extend by deep-merge: their defaults compose
 * with this object, never replace it. Frozen so a future caller can't mutate
 * the canonical defaults via reference.
 */
export const PREFERENCES_DEFAULTS: Readonly<Preferences> = Object.freeze({
	schemaVersion: PREFERENCES_CODE_MAX_VERSION
});
