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
} from '$lib/os/preferences-store.js';
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

	it('code max version is 5', () => {
		expect(PREFERENCES_CODE_MAX_VERSION).toBe(5);
	});

	it('migration #4 is a pure version bump (color maps are optional, not seeded)', () => {
		const v3 = {
			schemaVersion: 3,
			appearance: { theme: 'dark' as const, accentColor: '#c8942a' },
			editor: { linkPreviewEnabled: true }
		};
		const migrated = MIGRATIONS[4](v3) as Record<string, unknown>;
		expect(migrated.schemaVersion).toBe(4);
		// New override maps are absent until the user sets them.
		const app = migrated.appearance as Record<string, unknown>;
		expect(app.entityTypeColors).toBeUndefined();
		expect(app.relationshipTypeColors).toBeUndefined();
		expect(app.roleColors).toBeUndefined();
	});

	it('defaults include graph + windows sections (Phase 2)', () => {
		expect(PREFERENCES_DEFAULTS.graph).toEqual({ hardFilter: true, showGhostTrails: false });
		expect(PREFERENCES_DEFAULTS.windows).toEqual({ defaults: {} });
	});

	it('migration #5 is a pure version bump; deep-merge fills graph/windows defaults', () => {
		const v4 = {
			schemaVersion: 4,
			appearance: { theme: 'dark' as const, accentColor: '#c8942a' },
			editor: { linkPreviewEnabled: true }
		};
		const migrated = MIGRATIONS[5](v4) as Record<string, unknown>;
		expect(migrated.schemaVersion).toBe(5);
		// The migration itself doesn't seed the sections — migrateAndMerge's
		// deep-merge over PREFERENCES_DEFAULTS does. A v4 blob loaded through the
		// store ends up with the defaulted sections.
		__setStorageForTesting({
			getItem: () => JSON.stringify(v4),
			setItem: () => {},
			removeItem: () => {}
		});
		__reloadFromStorageForTesting();
		const loaded = get(preferences);
		expect(loaded.schemaVersion).toBe(5);
		expect(loaded.graph).toEqual({ hardFilter: true, showGhostTrails: false });
		expect(loaded.windows).toEqual({ defaults: {} });
	});

	it('migration #4 preserves existing keys', () => {
		const v3 = {
			schemaVersion: 3,
			appearance: { theme: 'light' as const, accentColor: '#aabbcc' },
			editor: { linkPreviewEnabled: false },
			extra: 'kept'
		};
		const migrated = MIGRATIONS[4](v3) as Record<string, unknown>;
		expect((migrated.appearance as { theme: string }).theme).toBe('light');
		expect((migrated.editor as { linkPreviewEnabled: boolean }).linkPreviewEnabled).toBe(false);
		expect(migrated.extra).toBe('kept');
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

	it('migration #3 adds editor.linkPreviewEnabled defaulting to true', () => {
		const v2 = { schemaVersion: 2, appearance: { theme: 'dark', accentColor: '#c8942a' } };
		const migrated = MIGRATIONS[3](v2) as {
			schemaVersion: number;
			editor: { linkPreviewEnabled: boolean };
		};
		expect(migrated.schemaVersion).toBe(3);
		expect(migrated.editor).toEqual({ linkPreviewEnabled: true });
	});

	it('migration #3 preserves existing keys (appearance, schemaVersion bump)', () => {
		const v2 = {
			schemaVersion: 2,
			appearance: { theme: 'light' as const, accentColor: '#aabbcc' },
			extra: 'kept'
		};
		const migrated = MIGRATIONS[3](v2) as Record<string, unknown>;
		expect((migrated.appearance as { theme: string }).theme).toBe('light');
		expect((migrated.appearance as { accentColor: string }).accentColor).toBe('#aabbcc');
		expect(migrated.extra).toBe('kept');
	});

	it('defaults include editor.linkPreviewEnabled = true', () => {
		expect(PREFERENCES_DEFAULTS.editor).toEqual({ linkPreviewEnabled: true });
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
