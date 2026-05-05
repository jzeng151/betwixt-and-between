import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
	preferences,
	loadFromStorage,
	saveToStorage,
	setPreference,
	getPreference,
	versionError,
	PreferencesVersionError,
	MIGRATIONS,
	__setStorageForTesting,
	__reloadFromStorageForTesting,
	__testing__,
	type StorageLike
} from '../../src/lib/stores/preferences.js';
import { PREFERENCES_CODE_MAX_VERSION, PREFERENCES_DEFAULTS } from '../../src/lib/types/preferences.js';

/**
 * In-memory Storage stub. Fresh instance per test; spies via direct map access.
 * Throwing variants opted-in per test for storage-failure paths.
 */
function makeStubStorage(opts: { throwOnGet?: boolean; throwOnSet?: boolean } = {}): StorageLike & {
	_data: Map<string, string>;
} {
	const _data = new Map<string, string>();
	return {
		_data,
		getItem(k) {
			if (opts.throwOnGet) throw new Error('storage unavailable');
			return _data.get(k) ?? null;
		},
		setItem(k, v) {
			if (opts.throwOnSet) throw new Error('quota exceeded');
			_data.set(k, v);
		}
	};
}

beforeEach(() => {
	// Reset module-level state between tests so the singleton store doesn't
	// carry leakage. Set storage to null first; the reload reseeds with
	// defaults.
	__setStorageForTesting(null);
	__reloadFromStorageForTesting();
});

describe('preferences load path', () => {
	it('loads defaults when storage is null (SSR / private browsing)', () => {
		expect(loadFromStorage(null)).toEqual(PREFERENCES_DEFAULTS);
	});

	it('loads defaults when storage is empty (cold install)', () => {
		const storage = makeStubStorage();
		expect(loadFromStorage(storage)).toEqual(PREFERENCES_DEFAULTS);
	});

	it('deep-merges stored partial over defaults', () => {
		const storage = makeStubStorage();
		storage._data.set(
			__testing__.STORAGE_KEY,
			JSON.stringify({ schemaVersion: PREFERENCES_CODE_MAX_VERSION, _customField: 'overridden' })
		);
		const loaded = loadFromStorage(storage) as unknown as Record<string, unknown>;
		expect(loaded.schemaVersion).toBe(PREFERENCES_CODE_MAX_VERSION);
		expect(loaded._customField).toBe('overridden');
	});

	it('recovers with defaults when JSON is malformed', () => {
		const storage = makeStubStorage();
		storage._data.set(__testing__.STORAGE_KEY, '{"not valid json,,,');
		expect(loadFromStorage(storage)).toEqual(PREFERENCES_DEFAULTS);
	});

	it('recovers with defaults when stored payload is a non-object (e.g. JSON literal 42)', () => {
		const storage = makeStubStorage();
		storage._data.set(__testing__.STORAGE_KEY, '42');
		expect(loadFromStorage(storage)).toEqual(PREFERENCES_DEFAULTS);
	});

	it('recovers with defaults when storage.getItem throws (corrupt browser state)', () => {
		const storage = makeStubStorage({ throwOnGet: true });
		expect(loadFromStorage(storage)).toEqual(PREFERENCES_DEFAULTS);
	});

	it('refuses-to-load (throws) when storedVersion > code max — downgrade protection', () => {
		const storage = makeStubStorage();
		storage._data.set(
			__testing__.STORAGE_KEY,
			JSON.stringify({ schemaVersion: PREFERENCES_CODE_MAX_VERSION + 5 })
		);
		expect(() => loadFromStorage(storage)).toThrow(PreferencesVersionError);
		try {
			loadFromStorage(storage);
		} catch (e) {
			expect(e).toBeInstanceOf(PreferencesVersionError);
			expect((e as PreferencesVersionError).storedVersion).toBe(PREFERENCES_CODE_MAX_VERSION + 5);
			expect((e as PreferencesVersionError).codeMaxVersion).toBe(PREFERENCES_CODE_MAX_VERSION);
		}
	});

	it('runs forward migrations sequentially v0 → code-max', () => {
		// Register a synthetic migration for the duration of this test only.
		const target = PREFERENCES_CODE_MAX_VERSION;
		const synthetic: Record<number, (old: unknown) => unknown> = {};
		for (let v = 0; v < target; v++) {
			const next = v + 1;
			synthetic[next] = (old) => ({
				...(old as object),
				schemaVersion: next,
				[`_migrated_to_v${next}`]: true
			});
		}
		const original = { ...MIGRATIONS };
		try {
			Object.assign(MIGRATIONS, synthetic);
			const storage = makeStubStorage();
			storage._data.set(
				__testing__.STORAGE_KEY,
				JSON.stringify({ schemaVersion: 0, _legacy: 'preserved' })
			);
			const loaded = loadFromStorage(storage) as unknown as Record<string, unknown>;
			expect(loaded.schemaVersion).toBe(PREFERENCES_CODE_MAX_VERSION);
			expect(loaded._legacy).toBe('preserved');
			for (let v = 1; v <= target; v++) {
				expect(loaded[`_migrated_to_v${v}`]).toBe(true);
			}
		} finally {
			for (const k of Object.keys(synthetic)) delete MIGRATIONS[Number(k)];
			Object.assign(MIGRATIONS, original);
		}
	});

	it('falls back to defaults when a migration THROWS — does not brick the app', () => {
		const target = PREFERENCES_CODE_MAX_VERSION;
		if (target === 0) {
			// No migrations to run — this test is moot at code-max version 0. Skip.
			expect(true).toBe(true);
			return;
		}
		const original = { ...MIGRATIONS };
		try {
			MIGRATIONS[target] = () => {
				throw new Error('migration crashed');
			};
			const storage = makeStubStorage();
			storage._data.set(
				__testing__.STORAGE_KEY,
				JSON.stringify({ schemaVersion: target - 1, valuableData: 'preserved-in-storage' })
			);
			expect(loadFromStorage(storage)).toEqual(PREFERENCES_DEFAULTS);
		} finally {
			delete MIGRATIONS[target];
			Object.assign(MIGRATIONS, original);
		}
	});

	it('falls back to defaults when a migration returns a NON-OBJECT', () => {
		const target = PREFERENCES_CODE_MAX_VERSION;
		if (target === 0) {
			expect(true).toBe(true);
			return;
		}
		const original = { ...MIGRATIONS };
		try {
			MIGRATIONS[target] = () => 'not an object' as unknown;
			const storage = makeStubStorage();
			storage._data.set(
				__testing__.STORAGE_KEY,
				JSON.stringify({ schemaVersion: target - 1 })
			);
			expect(loadFromStorage(storage)).toEqual(PREFERENCES_DEFAULTS);
		} finally {
			delete MIGRATIONS[target];
			Object.assign(MIGRATIONS, original);
		}
	});

	it('reports stored version (not code-max) when migration chain has a gap', () => {
		const target = PREFERENCES_CODE_MAX_VERSION;
		if (target < 2) {
			// Cannot exercise a missing-link gap when there's only one step (or zero).
			expect(true).toBe(true);
			return;
		}
		const original = { ...MIGRATIONS };
		try {
			// Pretend stored is at version 0; register migration for step 1 but not for step 2.
			MIGRATIONS[1] = (old) => ({ ...(old as object), schemaVersion: 1 });
			delete MIGRATIONS[2];
			const storage = makeStubStorage();
			storage._data.set(__testing__.STORAGE_KEY, JSON.stringify({ schemaVersion: 0 }));
			const loaded = loadFromStorage(storage);
			// Stored version should be 0 (where it actually was) since the chain is broken.
			// We do NOT claim code-max — that would lie about reaching it.
			expect(loaded.schemaVersion).toBe(0);
		} finally {
			delete MIGRATIONS[1];
			delete MIGRATIONS[2];
			Object.assign(MIGRATIONS, original);
		}
	});
});

describe('preferences save + reactive store', () => {
	it('writable subscribe writes through to storage on every update (after the initial-fire skip)', () => {
		const storage = makeStubStorage();
		__setStorageForTesting(storage);
		__reloadFromStorageForTesting();
		// setPreference triggers update → subscribe-to-self saves
		setPreference('schemaVersion', PREFERENCES_CODE_MAX_VERSION);
		const raw = storage._data.get(__testing__.STORAGE_KEY);
		expect(raw).not.toBeNull();
		const parsed = JSON.parse(raw as string);
		expect(parsed.schemaVersion).toBe(PREFERENCES_CODE_MAX_VERSION);
	});

	it('does NOT write defaults to storage at module-load / reload (preserve concurrent-tab + downgrade-protected data)', () => {
		const storage = makeStubStorage();
		// Pre-seed storage with valuable data the user wrote from another tab / older build.
		storage._data.set(__testing__.STORAGE_KEY, JSON.stringify({ schemaVersion: 0, valuable: 'data' }));
		__setStorageForTesting(storage);
		__reloadFromStorageForTesting();
		// After reload, the in-memory store has migrated/defaulted shape — but storage
		// must NOT have been overwritten by the auto-subscribe on load.
		const raw = storage._data.get(__testing__.STORAGE_KEY) as string;
		const stillThere = JSON.parse(raw);
		expect(stillThere.valuable).toBe('data');
	});

	it('does NOT write to storage while versionError is set (preserves the user data the version check exists to protect)', () => {
		const storage = makeStubStorage();
		storage._data.set(
			__testing__.STORAGE_KEY,
			JSON.stringify({ schemaVersion: PREFERENCES_CODE_MAX_VERSION + 5, original: 'sacred' })
		);
		__setStorageForTesting(storage);
		__reloadFromStorageForTesting();
		// versionError is now set; in-memory store is defaults
		expect(get(versionError)).toBeInstanceOf(PreferencesVersionError);
		// Now simulate the app trying to save (e.g. user toggles a control)
		setPreference('schemaVersion', 999 as unknown as number);
		// Storage should still hold the original sacred data, not be overwritten by defaults
		const raw = storage._data.get(__testing__.STORAGE_KEY) as string;
		const stillThere = JSON.parse(raw);
		expect(stillThere.original).toBe('sacred');
		expect(stillThere.schemaVersion).toBe(PREFERENCES_CODE_MAX_VERSION + 5);
	});

	it('saveToStorage silently no-ops when storage is null', () => {
		expect(() => saveToStorage(PREFERENCES_DEFAULTS as unknown as typeof PREFERENCES_DEFAULTS, null)).not.toThrow();
	});

	it('saveToStorage silently swallows write failures (quota / disabled mid-session)', () => {
		const storage = makeStubStorage({ throwOnSet: true });
		expect(() => saveToStorage(PREFERENCES_DEFAULTS, storage)).not.toThrow();
	});

	it('round-trip: set then reload yields the same shape', () => {
		const storage = makeStubStorage();
		__setStorageForTesting(storage);
		__reloadFromStorageForTesting();
		setPreference('schemaVersion', PREFERENCES_CODE_MAX_VERSION);
		const after = loadFromStorage(storage);
		expect(after).toEqual(get(preferences));
	});

	it('getPreference reads the current value without subscribing', () => {
		expect(getPreference('schemaVersion')).toBe(PREFERENCES_CODE_MAX_VERSION);
	});

	it('versionError is null on the happy path', () => {
		__setStorageForTesting(makeStubStorage());
		__reloadFromStorageForTesting();
		expect(get(versionError)).toBeNull();
	});

	it('versionError is populated and store boots with defaults when stored is too new', () => {
		const storage = makeStubStorage();
		storage._data.set(
			__testing__.STORAGE_KEY,
			JSON.stringify({ schemaVersion: PREFERENCES_CODE_MAX_VERSION + 5 })
		);
		__setStorageForTesting(storage);
		__reloadFromStorageForTesting();
		const err = get(versionError);
		expect(err).toBeInstanceOf(PreferencesVersionError);
		expect(get(preferences)).toEqual(PREFERENCES_DEFAULTS);
	});
});

describe('preferences deepMerge primitive', () => {
	const { deepMerge, PROTO_POLLUTION_KEYS } = __testing__;

	it('merges plain object trees, preserving keys not in the override', () => {
		const base = { a: 1, b: { c: 2, d: 3 } };
		const over = { b: { c: 99 } };
		expect(deepMerge(base, over)).toEqual({ a: 1, b: { c: 99, d: 3 } });
	});

	it('replaces arrays wholesale (no element-wise merge)', () => {
		const base = { items: [1, 2, 3] };
		const over = { items: [9] };
		expect(deepMerge(base, over)).toEqual({ items: [9] });
	});

	it('falls back to base when override is null / undefined', () => {
		expect(deepMerge({ x: 1 }, null)).toEqual({ x: 1 });
		expect(deepMerge({ x: 1 }, undefined)).toEqual({ x: 1 });
	});

	it('falls back to base when override is a non-object scalar', () => {
		expect(deepMerge({ x: 1 }, 42 as unknown)).toEqual({ x: 1 });
	});

	it('does not corrupt base when base is a non-object (returns base unchanged)', () => {
		// The typed signature is a lie here, but the function must defend against
		// recursive calls where base happens to be primitive.
		expect(deepMerge(42 as unknown, { a: 1 })).toBe(42);
	});

	it('skips __proto__ / constructor / prototype keys (defends against localStorage injection)', () => {
		const base = { x: 1 };
		const malicious = JSON.parse('{"x":2,"__proto__":{"polluted":true},"constructor":{"polluted":true},"prototype":{"polluted":true}}');
		const result = deepMerge(base, malicious) as Record<string, unknown>;
		expect(result.x).toBe(2); // legitimate key still merged
		expect((result as { polluted?: unknown }).polluted).toBeUndefined();
		// And critically: Object.prototype itself was not touched
		const probe = {} as Record<string, unknown>;
		expect(probe.polluted).toBeUndefined();
		// Sanity: PROTO_POLLUTION_KEYS list is what the implementation guards on
		expect(PROTO_POLLUTION_KEYS.has('__proto__')).toBe(true);
		expect(PROTO_POLLUTION_KEYS.has('constructor')).toBe(true);
		expect(PROTO_POLLUTION_KEYS.has('prototype')).toBe(true);
	});

	it('deepMerge does not mutate the base object', () => {
		const base = { x: 1, nested: { y: 2 } };
		const over = { x: 99, nested: { y: 99 } };
		const snapshot = JSON.parse(JSON.stringify(base));
		deepMerge(base, over);
		expect(base).toEqual(snapshot);
	});
});

describe('PREFERENCES_DEFAULTS immutability', () => {
	it('is frozen — direct mutation throws in strict mode (silently no-ops in sloppy)', () => {
		// Reading is always safe.
		expect(PREFERENCES_DEFAULTS.schemaVersion).toBe(PREFERENCES_CODE_MAX_VERSION);
		// Object.isFrozen is the contract test.
		expect(Object.isFrozen(PREFERENCES_DEFAULTS)).toBe(true);
	});
});
