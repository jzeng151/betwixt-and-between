import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
	PREFERENCES_DEFAULTS,
	PREFERENCES_CODE_MAX_VERSION
} from '../../src/lib/types/preferences.js';
import {
	MIGRATIONS,
	__setStorageForTesting,
	__reloadFromStorageForTesting,
	setPreference,
	getPreference,
	preferences
} from '$lib/stores/preferences.js';
import type { Appearance } from '$lib/types/preferences.js';

describe('Preferences appearance', () => {
	beforeEach(() => {
		__setStorageForTesting(null);
		__reloadFromStorageForTesting();
	});

	it('defaults include appearance section', () => {
		expect(PREFERENCES_DEFAULTS.appearance).toEqual({
			theme: 'dark',
			accentColor: '#c8942a'
		});
	});

	it('code max version is 2', () => {
		expect(PREFERENCES_CODE_MAX_VERSION).toBe(2);
	});

	it('migration #2 adds appearance to v1 payloads', () => {
		const v1 = { schemaVersion: 1 };
		const migrated = MIGRATIONS[2](v1) as { schemaVersion: number; appearance: Appearance };
		expect(migrated.schemaVersion).toBe(2);
		expect(migrated.appearance).toEqual({
			theme: 'dark',
			accentColor: '#c8942a'
		});
	});

	it('migration #2 preserves existing keys', () => {
		const v1 = { schemaVersion: 1, extra: 'data' };
		const migrated = MIGRATIONS[2](v1) as Record<string, unknown>;
		expect(migrated.extra).toBe('data');
	});

	it('updating appearance via preferences store works', () => {
		const storage = new Map<string, string>();
		__setStorageForTesting({
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => storage.set(key, value),
			removeItem: (key: string) => storage.delete(key)
		});
		__reloadFromStorageForTesting();

		const newAppearance: Appearance = { theme: 'light', accentColor: '#3b82f6' };
		setPreference('appearance', newAppearance);

		expect(getPreference('appearance')).toEqual(newAppearance);
		expect(get(preferences).appearance).toEqual(newAppearance);
	});

	it('appearance persists to storage', () => {
		const storage = new Map<string, string>();
		__setStorageForTesting({
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => storage.set(key, value),
			removeItem: (key: string) => storage.delete(key)
		});
		__reloadFromStorageForTesting();

		setPreference('appearance', { theme: 'light', accentColor: '#ff0000' });

		const stored = JSON.parse(storage.get('btw:preferences')!);
		expect(stored.appearance).toEqual({ theme: 'light', accentColor: '#ff0000' });
	});
});
