import { writable, get } from 'svelte/store';
import {
	PREFERENCES_CODE_MAX_VERSION,
	PREFERENCES_DEFAULTS,
	type Preferences
} from '../types/preferences.js';

/**
 * User preferences store — the per-user persistent root.
 *
 * Pre-T8b: localStorage-backed (single tenant, no auth).
 * Post-T8b: this module hydrates from `users.preferences jsonb` on login and
 *           writes through to both server + localStorage cache. The scaffold
 *           establishes the storage shape; the server-sync layer lands later.
 *
 * Subscribers re-render on every change. Writes save through to storage on
 * every mutation EXCEPT when versionError is set (downgrade-protection mode):
 * in that case the store boots with defaults so the UI works, but writes are
 * suppressed so the user's actual stored data is preserved untouched until
 * they update the app.
 *
 * Schema versioning (eng-review Lock 3):
 *  - Stored payload carries a `schemaVersion` field
 *  - Load runs forward migrations sequentially up to PREFERENCES_CODE_MAX_VERSION
 *  - Refuse-to-load if storedVersion > codeMax (user opened an old build with
 *    newer-shape prefs in localStorage); throws PreferencesVersionError so the
 *    UI can show a clear "Update the app" message instead of silently
 *    downgrading and losing data.
 *  - When the version error fires, write-through is suppressed so the booted
 *    defaults DO NOT overwrite the user's preserved storage. Without this, the
 *    auto-subscribe save callback would clobber the very data the version
 *    check was trying to protect.
 */

const STORAGE_KEY = 'btw:preferences';

/**
 * Object keys that must never propagate from stored payloads into the merged
 * shape — protects against `__proto__` / `constructor` / `prototype` injection
 * from a localStorage payload an attacker could write (or that a future buggy
 * migration could produce).
 */
const PROTO_POLLUTION_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Forward migrations from version N → N+1. Add an entry here when bumping
 * PREFERENCES_CODE_MAX_VERSION. Each migration receives the deserialized old
 * payload and MUST return a plain object (not null, not a primitive). Throws
 * are caught and logged; a failed migration causes load to fall back to
 * defaults rather than killing the app.
 */
export const MIGRATIONS: Record<number, (old: unknown) => unknown> = {
	// Example for future use:
	// 2: (v1) => ({ ...(v1 as object), schemaVersion: 2, newSection: { ... } }),
};

/** A subset of the Web Storage API — easy to stub in unit tests. */
export interface StorageLike {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

/** Thrown when stored prefs are from a build newer than the running code. */
export class PreferencesVersionError extends Error {
	readonly storedVersion: number;
	readonly codeMaxVersion: number;
	constructor(storedVersion: number, codeMaxVersion: number) {
		super(
			`Stored preferences are version ${storedVersion}, but this build only reads up to version ${codeMaxVersion}. Update the app to read your saved preferences.`
		);
		this.name = 'PreferencesVersionError';
		this.storedVersion = storedVersion;
		this.codeMaxVersion = codeMaxVersion;
	}
}

/** Returns the ambient localStorage if present, else null (SSR / private browsing). */
function detectBrowserStorage(): StorageLike | null {
	if (typeof globalThis === 'undefined') return null;
	const g = globalThis as { localStorage?: StorageLike };
	return g.localStorage ?? null;
}

let _storage: StorageLike | null = detectBrowserStorage();

/**
 * Test-only hook. Naming convention: leading-underscore exports are internal
 * and must not be imported by app code. Sub-branch reviews enforce this.
 */
export function __setStorageForTesting(s: StorageLike | null): void {
	_storage = s;
}

/**
 * Returns true if `v` is a plain object (not null, not array, not function).
 * Used to validate migration outputs and to gate `deepMerge` recursion.
 */
function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Plain-object deep merge. Arrays and primitives are replaced wholesale.
 * Skips prototype-pollution keys to defend against malicious localStorage
 * payloads. Returns a defensive shallow-copy so callers can't mutate base.
 */
function deepMerge<T>(base: T, over: unknown): T {
	if (over === null || over === undefined) return base;
	const baseIsObj = isPlainObject(base);
	const overIsObj = isPlainObject(over);
	if (!baseIsObj && !overIsObj) {
		// Both are non-object scalars — override wins. This is the recursive
		// primitive case (e.g. {x:1} merged with {x:2} → x recurses to (1,2) → 2).
		return over as T;
	}
	if (!baseIsObj || !overIsObj) {
		// One side is an object, the other isn't — type mismatch. Preserve the
		// base shape rather than corrupt the caller's typed expectation. A
		// stored payload that flips a nested object to a scalar (or vice versa)
		// gets ignored at that key, falling back to the default shape.
		return base;
	}
	const result: Record<string, unknown> = { ...base };
	for (const key of Object.keys(over)) {
		if (PROTO_POLLUTION_KEYS.has(key)) continue;
		const baseVal = base[key];
		const overVal = over[key];
		result[key] = key in base ? deepMerge(baseVal, overVal) : overVal;
	}
	return result as T;
}

/** Parse JSON without throwing. Returns null on any failure. */
function safeParse(raw: string | null): unknown {
	if (raw == null) return null;
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

/**
 * Read the persisted preferences from `storage`, run forward migrations, and
 * deep-merge with PREFERENCES_DEFAULTS. Returns defaults when storage is null,
 * empty, malformed, or contains a non-object payload. Throws
 * PreferencesVersionError when the stored payload's schemaVersion exceeds the
 * running build's code-max version. Catches migration failures (throws and
 * non-object returns) and falls back to defaults rather than propagating.
 */
export function loadFromStorage(storage: StorageLike | null = _storage): Preferences {
	if (!storage) return { ...PREFERENCES_DEFAULTS };
	const raw = (() => {
		try {
			return storage.getItem(STORAGE_KEY);
		} catch {
			return null;
		}
	})();
	const parsed = safeParse(raw);
	if (!isPlainObject(parsed)) return { ...PREFERENCES_DEFAULTS };

	const storedVersion =
		typeof parsed.schemaVersion === 'number' ? (parsed.schemaVersion as number) : 0;

	if (storedVersion > PREFERENCES_CODE_MAX_VERSION) {
		throw new PreferencesVersionError(storedVersion, PREFERENCES_CODE_MAX_VERSION);
	}

	let current: unknown = parsed;
	let migrationsCompleted = true;
	for (let v = storedVersion; v < PREFERENCES_CODE_MAX_VERSION; v++) {
		const migrate = MIGRATIONS[v + 1];
		if (!migrate) {
			// No migration registered for this step — gap in the chain. Don't
			// claim we reached code-max when we didn't.
			migrationsCompleted = false;
			break;
		}
		let next: unknown;
		try {
			next = migrate(current);
		} catch {
			// A buggy migration cannot brick the app. Fall back to defaults.
			return { ...PREFERENCES_DEFAULTS };
		}
		if (!isPlainObject(next)) {
			// Migration returned a non-object — also broken; fall back rather
			// than silently corrupt downstream merge.
			return { ...PREFERENCES_DEFAULTS };
		}
		current = next;
	}

	const merged = deepMerge(PREFERENCES_DEFAULTS as Preferences, current);
	// Only claim code-max version if every migration step actually ran. A
	// missing migration entry means the persisted shape is at the version
	// where the chain stopped — recording it accurately is what lets the
	// next code release (which adds the missing migration) pick up the
	// chain from the right step.
	const reachedVersion = migrationsCompleted ? PREFERENCES_CODE_MAX_VERSION : storedVersion;
	return { ...merged, schemaVersion: reachedVersion };
}

/** Persist `prefs` to `storage`. Silently no-ops when storage is null or write fails. */
export function saveToStorage(
	prefs: Preferences,
	storage: StorageLike | null = _storage
): void {
	if (!storage) return;
	try {
		storage.setItem(STORAGE_KEY, JSON.stringify(prefs));
	} catch {
		// Storage full / disabled mid-session — silently degrade. The next
		// successful save replaces the stale entry; we never block the user
		// for a write failure on a UI preference.
	}
}

/**
 * Initial load. Wrapped so a load-time PreferencesVersionError doesn't crash
 * the module import — it surfaces via `versionError` instead, which the UI
 * can surface as an "Update the app" banner. Defaults are used in the
 * meantime so the app boots.
 */
function initialLoad(): { prefs: Preferences; error: PreferencesVersionError | null } {
	try {
		return { prefs: loadFromStorage(), error: null };
	} catch (e) {
		if (e instanceof PreferencesVersionError) {
			return { prefs: { ...PREFERENCES_DEFAULTS }, error: e };
		}
		// Any other unexpected error: degrade to defaults. We must not crash
		// the module import on a load-time error — that would brick every
		// subscriber across the app on a single corrupt stored payload.
		return { prefs: { ...PREFERENCES_DEFAULTS }, error: null };
	}
}

const _initial = initialLoad();

/**
 * The reactive preferences store. Subscribers re-render on every update. See
 * `versionError` and the subscribe-to-self gate below for write-through rules.
 */
export const preferences = writable<Preferences>(_initial.prefs);

/**
 * If the persisted shape was ahead of this build's known schema, holds the
 * thrown error so the UI can show an "Update the app" message. Null on the
 * happy path. While non-null, write-through to storage is suppressed: the
 * user's preserved data must NOT be overwritten with the defaults the store
 * booted with.
 */
export const versionError = writable<PreferencesVersionError | null>(_initial.error);

/**
 * Subscribe-to-self pattern: every set/update writes through. Two guards:
 *  - Skip the very first synchronous fire (Svelte writables call subscribe
 *    callbacks immediately with the current value). Without this, opening any
 *    page would re-write defaults to storage, clobbering data from another
 *    tab or from an older app build.
 *  - Skip when versionError is set (downgrade protection). Writing defaults
 *    in that state would destroy the very data the version check exists to
 *    preserve.
 */
let _initialSaveSkipped = false;
preferences.subscribe((p) => {
	if (!_initialSaveSkipped) {
		_initialSaveSkipped = true;
		return;
	}
	if (get(versionError) !== null) return;
	saveToStorage(p);
});

/** Set a single top-level preference key, preserving the rest of the shape. */
export function setPreference<K extends keyof Preferences>(key: K, value: Preferences[K]): void {
	preferences.update((p) => ({ ...p, [key]: value }));
}

/** Read a single top-level preference key without subscribing. */
export function getPreference<K extends keyof Preferences>(key: K): Preferences[K] {
	return get(preferences)[key];
}

/**
 * Test-only. Re-runs load and resets both stores plus the initial-save guard.
 * Use after swapping storage in a unit test that needs to observe the load
 * path against a fresh stub.
 */
export function __reloadFromStorageForTesting(): void {
	const { prefs, error } = initialLoad();
	_initialSaveSkipped = false;
	preferences.set(prefs);
	versionError.set(error);
	// Re-arm the subscribe-to-self gate so the manual `set` above doesn't
	// trigger an unwanted save. The first subscribe-fire after this reset
	// will be the one we want to skip.
}

// Re-export internals for direct testing without going through the singleton.
// Naming is leading-underscore by convention; app code must not import these.
export const __testing__ = {
	STORAGE_KEY,
	deepMerge,
	safeParse,
	isPlainObject,
	PROTO_POLLUTION_KEYS
};
