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
		// Augment the type only locally for this test — sub-branches will add real fields.
		// Here we confirm the merge mechanism preserves both partial and default values.
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
		// Acts on the migrations table to prove the v→v+1 pipeline executes.
		// We simulate an "old" stored payload at version 0 with a legacy field
		// that the migration renames to a new field.
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
			// Strip the synthetic entries so the next test sees a clean MIGRATIONS table.
			for (const k of Object.keys(synthetic)) delete MIGRATIONS[Number(k)];
			Object.assign(MIGRATIONS, original);
		}
	});
});

describe('preferences save + reactive store', () => {
	it('writable subscribe writes through to storage on every update', () => {
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

	it('saveToStorage silently no-ops when storage is null', () => {
		expect(() => saveToStorage(PREFERENCES_DEFAULTS, null)).not.toThrow();
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
		// Re-load via the public load function with the same storage.
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
	const { deepMerge } = __testing__;

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
		// User somehow stored a non-object; we keep base rather than corrupt the shape.
		expect(deepMerge({ x: 1 }, 42 as unknown)).toEqual({ x: 1 });
	});
});
