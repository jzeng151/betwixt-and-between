import { writable, get } from 'svelte/store';
import {
	PREFERENCES_CODE_MAX_VERSION,
	PREFERENCES_DEFAULTS,
	type Preferences
} from '../types/preferences.js';
// Shared merge primitives — one source of truth with the server PATCH handler
// (src/lib/server/user-preferences.ts) so client-optimistic and server-
// authoritative merges cannot diverge.
import { deepMerge, isPlainObject, PROTO_POLLUTION_KEYS } from '../preferences-merge.js';

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

// PROTO_POLLUTION_KEYS, isPlainObject, and deepMerge now live in
// ../preferences-merge.js (shared with the server PATCH handler) and are
// imported above. Re-exported via __testing__ for the existing test surface.

/**
 * Forward migrations from version N → N+1. Add an entry here when bumping
 * PREFERENCES_CODE_MAX_VERSION. Each migration receives the deserialized old
 * payload and MUST return a plain object (not null, not a primitive). Throws
 * are caught and logged; a failed migration causes load to fall back to
 * defaults rather than killing the app.
 */
export const MIGRATIONS: Record<number, (old: unknown) => unknown> = {
	2: (v1) => ({
		...(v1 as object),
		schemaVersion: 2,
		appearance: { theme: 'dark' as const, accentColor: '#c8942a' }
	}),
	3: (v2) => ({
		...(v2 as object),
		schemaVersion: 3,
		// Slice 7: editor.linkPreviewEnabled controls the [[Name]] chip
		// preview pane below textareas. Default true so existing users
		// see the feature on first load after upgrade.
		editor: { linkPreviewEnabled: true }
	}),
	4: (v3) => ({
		// Settings customization Phase 1: adds appearance.{entityTypeColors,
		// relationshipTypeColors,roleColors}. They are OPTIONAL overrides
		// (absent = use built-in --color-* default), so the migration is a
		// pure version bump — no field is seeded. deep-merge with
		// PREFERENCES_DEFAULTS (which omits the maps) preserves "absent".
		...(v3 as object),
		schemaVersion: 4
	})
};

/** A subset of the Web Storage API — easy to stub in unit tests. */
export interface StorageLike {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem?(key: string): void;
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
	if (typeof window === 'undefined') return null;
	return window.localStorage ?? null;
}

let _storage: StorageLike | null = detectBrowserStorage();

/**
 * Test-only hook. Naming convention: leading-underscore exports are internal
 * and must not be imported by app code. Sub-branch reviews enforce this.
 */
export function __setStorageForTesting(s: StorageLike | null): void {
	_storage = s;
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
 * Run forward migrations on a parsed payload and deep-merge over
 * PREFERENCES_DEFAULTS. The shared core for BOTH the localStorage load path
 * AND the server-hydrate path (T4) — a server blob at an older schemaVersion
 * MUST be migrated the same way a stored one is, instead of being applied raw
 * (codex outside-voice).
 *
 * Returns defaults for a null/non-object payload. Throws
 * PreferencesVersionError when schemaVersion exceeds the running build's code
 * max (downgrade protection — an older client must not write a newer blob's
 * shape back over the server's data). Migration throws / non-object returns
 * fall back to defaults rather than bricking.
 */
export function migrateAndMerge(parsed: unknown): Preferences {
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

/**
 * Read the persisted preferences from `storage`, migrate, and deep-merge with
 * PREFERENCES_DEFAULTS. Returns defaults when storage is null/empty/malformed.
 * Propagates PreferencesVersionError from migrateAndMerge (downgrade protection).
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
	return migrateAndMerge(safeParse(raw));
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
