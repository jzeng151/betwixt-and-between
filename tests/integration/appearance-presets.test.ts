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
	let storyId: string;
	beforeEach(async () => {
		db = await createTestDb();
		storyId = (await seedTestUser(db)).id;
	});

	it('lists built-ins with no user rows initially', async () => {
		const { builtins, user } = await listPresets(db, storyId);
		expect(user).toHaveLength(0);
		expect(builtins.map((p) => p.name)).toContain('High Contrast');
		expect(builtins.every((p) => p.builtin)).toBe(true);
	});

	it('replays a creation ID atomically and compares JSON values within its story', async () => {
		const id = crypto.randomUUID();
		const appearance = { theme: 'dark', accentColor: '#abcdef', roleColors: { Ally: '#123456', Rival: '#abcdef' } };
		const reordered = { roleColors: { Rival: '#abcdef', Ally: '#123456' }, accentColor: '#abcdef', theme: 'dark' };
		const results = await Promise.all([
			createPreset(db, storyId, 'Colors', appearance, id),
			createPreset(db, storyId, 'Colors', reordered, id)
		]);
		expect(results.map((r) => r.presetId)).toEqual([id, id]);
		expect((await listPresets(db, storyId)).user).toHaveLength(1);
		await expectStatus(createPreset(db, storyId, 'Changed', appearance, id), 409);
		await expectStatus(createPreset(db, storyId, 'Colors', { ...appearance, theme: 'light' }, id), 409);
		await expectStatus(createPreset(db, storyId, 'Invalid', appearance, 'not-a-uuid'), 400);
		const otherStory = (await seedTestUser(db, { email: 'preset-replay-other@t.com' })).id;
		expect(await createPreset(db, otherStory, 'Own colors', appearance, id)).toMatchObject({ presetId: id, name: 'Own colors' });
		expect((await listPresets(db, storyId)).user[0].name).toBe('Colors');
	});

	it('creates a user preset and lists it', async () => {
		const created = await createPreset(db, storyId, 'My Theme', {
			theme: 'dark',
			accentColor: '#abcdef',
			entityTypeColors: { Character: '#123456' }
		});
		expect(created).toMatchObject({ name: 'My Theme', builtin: false });
		const { user } = await listPresets(db, storyId);
		expect(user).toHaveLength(1);
		expect(user[0].appearance).toMatchObject({ accentColor: '#abcdef' });
	});

	it('rejects an invalid appearance (bad hex / unknown key / non-object)', async () => {
		await expectStatus(createPreset(db, storyId, 'bad', { accentColor: 'not-a-hex' }), 400);
		await expectStatus(
			createPreset(db, storyId, 'bad', { entityTypeColors: { Nope: '#ffffff' } }),
			400
		);
		await expectStatus(createPreset(db, storyId, 'bad', 42 as unknown), 400);
		await expectStatus(createPreset(db, storyId, '   ', { theme: 'dark' }), 400);
	});

	it('requires theme and accentColor (preset is applied as an exact replacement) (codex PR #69)', async () => {
		await expectStatus(createPreset(db, storyId, 'no-accent', { theme: 'dark' }), 400);
		await expectStatus(createPreset(db, storyId, 'no-theme', { accentColor: '#abcdef' }), 400);
	});

	it('deletes a user preset; built-in ids are not deletable', async () => {
		const created = await createPreset(db, storyId, 'Tmp', { theme: 'light', accentColor: '#abcdef' });
		await deletePreset(db, storyId, created.presetId);
		expect((await listPresets(db, storyId)).user).toHaveLength(0);
		// Built-in id is not a uuid → 400; a random uuid → 404.
		await expectStatus(deletePreset(db, storyId, 'builtin:high-contrast'), 400);
		await expectStatus(deletePreset(db, storyId, crypto.randomUUID()), 404);
	});

	it('rejects an oversized appearance payload (codex PR #69)', async () => {
		// validateAppearance ignores unknown top-level keys, so the size guard is
		// what stops a client bloating its preset rows (loaded on every list).
		const huge = { theme: 'dark', accentColor: '#abcdef', junk: 'x'.repeat(70_000) } as unknown;
		await expectStatus(createPreset(db, storyId, 'big', huge), 400);
		expect((await listPresets(db, storyId)).user).toHaveLength(0);
	});

	it('presets are user-scoped', async () => {
		const created = await createPreset(db, storyId, 'Mine', { theme: 'dark', accentColor: '#abcdef' });
		const otherId = (await seedTestUser(db, { email: 'b@t.com' })).id;
		expect((await listPresets(db, otherId)).user).toHaveLength(0);
		await expectStatus(deletePreset(db, otherId, created.presetId), 404);
	});

	it('apply changes ONLY appearance.* — graph/windows/editor survive (F1)', async () => {
		// Seed a profile with customised appearance + the other sections.
		const v1 = (await getActivePreferences(db, storyId)).version;
		const r = await patchPreferences(
			db,
			storyId,
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
		const applied = await patchPreferences(db, storyId, patch, r.version);

		// appearance is exactly the preset (Character dropped, Location replaced).
		expect(applied.data.appearance).toEqual(preset);
		// Other sections are untouched.
		expect(applied.data.graph).toEqual({ hardFilter: true, showGhostTrails: true });
		expect(applied.data.windows).toEqual({ defaults: { settings: { width: 500, height: 400 } } });
	});
});
