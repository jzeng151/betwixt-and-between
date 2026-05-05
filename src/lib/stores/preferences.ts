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
 * every mutation. No batching — preferences mutations are rare and human-paced.
 *
 * Schema versioning (eng-review Lock 3):
 *  - Stored payload carries a `schemaVersion` field
 *  - Load runs forward migrations sequentially up to PREFERENCES_CODE_MAX_VERSION
 *  - Refuse-to-load if storedVersion > codeMax (user opened an old build with
 *    newer-shape prefs in localStorage); throws PreferencesVersionError so the
 *    UI can show a clear "Update the app" message instead of silently
 *    downgrading and losing data.
 */

const STORAGE_KEY = 'btw:preferences';

/**
 * Forward migrations from version N → N+1. Add an entry here when bumping
 * PREFERENCES_CODE_MAX_VERSION. Each migration receives the deserialized old
 * payload and returns the new shape (still as a plain object — defaults are
 * deep-merged afterward).
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

/** Test hook: swap the storage adapter or null it out to simulate unavailability. */
export function __setStorageForTesting(s: StorageLike | null): void {
	_storage = s;
}

/** Plain-object deep merge. Arrays and primitives are replaced wholesale. */
function deepMerge<T>(base: T, over: unknown): T {
	if (over === null || over === undefined) return base;
	if (typeof base !== 'object' || base === null) return over as T;
	if (typeof over !== 'object') return base;
	if (Array.isArray(base) || Array.isArray(over)) return over as T;
	const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
	for (const key of Object.keys(over as Record<string, unknown>)) {
		const baseVal = (base as Record<string, unknown>)[key];
		const overVal = (over as Record<string, unknown>)[key];
		result[key] =
			key in (base as Record<string, unknown>) ? deepMerge(baseVal, overVal) : overVal;
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
 * empty, or contains malformed JSON. Throws PreferencesVersionError when the
 * stored payload's schemaVersion exceeds the running build's code-max version.
 */
export function loadFromStorage(storage: StorageLike | null = _storage): Preferences {
	if (!storage) return PREFERENCES_DEFAULTS;
	const raw = (() => {
		try {
			return storage.getItem(STORAGE_KEY);
		} catch {
			return null;
		}
	})();
	const parsed = safeParse(raw);
	if (parsed == null || typeof parsed !== 'object') return PREFERENCES_DEFAULTS;

	const storedVersion =
		typeof (parsed as { schemaVersion?: unknown }).schemaVersion === 'number'
			? ((parsed as { schemaVersion: number }).schemaVersion as number)
			: 0;

	if (storedVersion > PREFERENCES_CODE_MAX_VERSION) {
		throw new PreferencesVersionError(storedVersion, PREFERENCES_CODE_MAX_VERSION);
	}

	let current: unknown = parsed;
	for (let v = storedVersion; v < PREFERENCES_CODE_MAX_VERSION; v++) {
		const migrate = MIGRATIONS[v + 1];
		if (migrate) current = migrate(current);
	}

	const merged = deepMerge(PREFERENCES_DEFAULTS, current);
	// Ensure schemaVersion always reflects the code-max after a successful load.
	return { ...merged, schemaVersion: PREFERENCES_CODE_MAX_VERSION };
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
		if (e instanceof PreferencesVersionError) return { prefs: PREFERENCES_DEFAULTS, error: e };
		throw e;
	}
}

const _initial = initialLoad();

/**
 * The reactive preferences store. Subscribers re-render on every update; every
 * update writes through to storage. Read via $preferences in components.
 */
export const preferences = writable<Preferences>(_initial.prefs);

/**
 * If the persisted shape was ahead of this build's known schema, holds the
 * thrown error so the UI can show an "Update the app" message. Null on the
 * happy path.
 */
export const versionError = writable<PreferencesVersionError | null>(_initial.error);

// Subscribe-to-self pattern: every set/update writes through.
preferences.subscribe((p) => saveToStorage(p));

/** Set a single top-level preference key, preserving the rest of the shape. */
export function setPreference<K extends keyof Preferences>(key: K, value: Preferences[K]): void {
	preferences.update((p) => ({ ...p, [key]: value }));
}

/** Read a single top-level preference key without subscribing. */
export function getPreference<K extends keyof Preferences>(key: K): Preferences[K] {
	return get(preferences)[key];
}

/**
 * Test hook: re-run load and reset both stores. Use after swapping storage in
 * a unit test that needs to observe the load path against a fresh stub.
 */
export function __reloadFromStorageForTesting(): void {
	const { prefs, error } = initialLoad();
	preferences.set(prefs);
	versionError.set(error);
}

// Re-export internals for direct testing without going through the singleton.
export const __testing__ = {
	STORAGE_KEY,
	deepMerge,
	safeParse
};
