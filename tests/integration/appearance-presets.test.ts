/**
 * Settings customization Phase 3 — appearance presets (T10).
 *
 * Covers: list (built-ins + user rows), create with appearance validation,
 * delete (incl. built-ins not deletable + user-scoping), and the apply path's
 * one guarantee — applying a preset changes ONLY appearance.*, leaving the
 * profile's graph/windows/editor sections intact (F1), proven through the real
 * server patch.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, seedTestUser, type TestDb } from '../helpers/test-db.js';
import {
	listPresets,
	createPreset,
	deletePreset
} from '../../src/lib/server/appearance-presets.js';
import { getActivePreferences, patchPreferences } from '../../src/lib/server/user-preferences.js';
import { buildApplyPresetPatch } from '../../src/lib/preferences-presets.js';
import type { Appearance } from '../../src/lib/types/preferences.js';

async function expectStatus(p: Promise<unknown>, status: number) {
	await expect(p).rejects.toMatchObject({ status });
}

describe('Phase 3 presets', () => {
	let db: TestDb;
	let userId: string;
	beforeEach(async () => {
		db = await createTestDb();
		userId = (await seedTestUser(db)).id;
	});

	it('lists built-ins with no user rows initially', async () => {
		const { builtins, user } = await listPresets(db, userId);
		expect(user).toHaveLength(0);
		expect(builtins.map((p) => p.name)).toContain('High Contrast');
		expect(builtins.every((p) => p.builtin)).toBe(true);
	});

	it('creates a user preset and lists it', async () => {
		const created = await createPreset(db, userId, 'My Theme', {
			theme: 'dark',
			accentColor: '#abcdef',
			entityTypeColors: { Character: '#123456' }
		});
		expect(created).toMatchObject({ name: 'My Theme', builtin: false });
		const { user } = await listPresets(db, userId);
		expect(user).toHaveLength(1);
		expect(user[0].appearance).toMatchObject({ accentColor: '#abcdef' });
	});

	it('rejects an invalid appearance (bad hex / unknown key / non-object)', async () => {
		await expectStatus(createPreset(db, userId, 'bad', { accentColor: 'not-a-hex' }), 400);
		await expectStatus(
			createPreset(db, userId, 'bad', { entityTypeColors: { Nope: '#ffffff' } }),
			400
		);
		await expectStatus(createPreset(db, userId, 'bad', 42 as unknown), 400);
		await expectStatus(createPreset(db, userId, '   ', { theme: 'dark' }), 400);
	});

	it('deletes a user preset; built-in ids are not deletable', async () => {
		const created = await createPreset(db, userId, 'Tmp', { theme: 'light' });
		await deletePreset(db, userId, created.presetId);
		expect((await listPresets(db, userId)).user).toHaveLength(0);
		// Built-in id is not a uuid → 400; a random uuid → 404.
		await expectStatus(deletePreset(db, userId, 'builtin:high-contrast'), 400);
		await expectStatus(deletePreset(db, userId, crypto.randomUUID()), 404);
	});

	it('presets are user-scoped', async () => {
		const created = await createPreset(db, userId, 'Mine', { theme: 'dark' });
		const otherId = (await seedTestUser(db, { email: 'b@t.com' })).id;
		expect((await listPresets(db, otherId)).user).toHaveLength(0);
		await expectStatus(deletePreset(db, otherId, created.presetId), 404);
	});

	it('apply changes ONLY appearance.* — graph/windows/editor survive (F1)', async () => {
		// Seed a profile with customised appearance + the other sections.
		const v1 = (await getActivePreferences(db, userId)).version;
		const r = await patchPreferences(
			db,
			userId,
			{
				set: {
					appearance: {
						theme: 'dark',
						accentColor: '#111111',
						entityTypeColors: { Character: '#aaaaaa', Location: '#bbbbbb' }
					},
					graph: { hardFilter: true, showGhostTrails: true },
					windows: { defaults: { settings: { width: 500, height: 400 } } }
				}
			},
			v1
		);

		const preset: Appearance = {
			theme: 'light',
			accentColor: '#222222',
			entityTypeColors: { Location: '#999999' }
		};
		const active = r.data.appearance as Appearance;
		const patch = buildApplyPresetPatch(active, preset);
		const applied = await patchPreferences(db, userId, patch, r.version);

		// appearance is exactly the preset (Character dropped, Location replaced).
		expect(applied.data.appearance).toEqual(preset);
		// Other sections are untouched.
		expect(applied.data.graph).toEqual({ hardFilter: true, showGhostTrails: true });
		expect(applied.data.windows).toEqual({ defaults: { settings: { width: 500, height: 400 } } });
	});
});
