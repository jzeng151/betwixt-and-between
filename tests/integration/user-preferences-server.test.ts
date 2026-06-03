/**
 * Settings customization Phase 1 — T2 server helpers (user-preferences.ts).
 *
 * Covers getActivePreferences (lazy race-safe create) and patchPreferences
 * (deep-merge set, unset-delete, optimistic concurrency, validation). The
 * Approach-B concurrency matrix (5A) is the load-bearing part: stale → 409,
 * reconcile-and-retry → no lost update, version monotonic.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, seedTestUser } from '../helpers/test-db.js';
import { getActivePreferences, patchPreferences } from '../../src/lib/server/user-preferences.js';

type Db = Awaited<ReturnType<typeof createTestDb>>;

/** Assert a helper throws a SvelteKit HttpError with the given status. */
async function expectStatus(p: Promise<unknown>, status: number) {
	await expect(p).rejects.toMatchObject({ status });
}

describe('T2 getActivePreferences', () => {
	let db: Db;
	let userId: string;
	beforeEach(async () => {
		db = await createTestDb();
		userId = (await seedTestUser(db)).id;
	});

	it('lazily creates a Default row on first access (v1, empty data)', async () => {
		const a = await getActivePreferences(db, userId);
		expect(a.name).toBe('Default');
		expect(a.version).toBe(1);
		expect(a.data).toEqual({});
		expect(a.profileId).toMatch(/^[0-9a-f-]{36}$/);
	});

	it('marks initialized:false on a fresh row, true after the first PATCH', async () => {
		const fresh = await getActivePreferences(db, userId);
		expect(fresh.initialized).toBe(false);

		await patchPreferences(db, userId, { set: { appearance: { theme: 'light' } } }, fresh.version);

		const after = await getActivePreferences(db, userId);
		expect(after.initialized).toBe(true);
	});

	it('keeps initialized true (marker not bumped) across later PATCHes', async () => {
		const fresh = await getActivePreferences(db, userId);
		await patchPreferences(db, userId, { set: { appearance: { theme: 'light' } } }, fresh.version);
		const r = await patchPreferences(
			db,
			userId,
			{ set: { appearance: { accentColor: '#abcdef' } } },
			2
		);
		expect(r.initialized).toBe(true);
	});

	it('returns the same row on repeat access (no duplicate active rows)', async () => {
		const a = await getActivePreferences(db, userId);
		const b = await getActivePreferences(db, userId);
		expect(b.profileId).toBe(a.profileId);
	});

	it('is race-safe: concurrent first-access resolves to one active row', async () => {
		const [a, b, c] = await Promise.all([
			getActivePreferences(db, userId),
			getActivePreferences(db, userId),
			getActivePreferences(db, userId)
		]);
		expect(a.profileId).toBe(b.profileId);
		expect(b.profileId).toBe(c.profileId);
	});
});

describe('T2 patchPreferences — merge + unset', () => {
	let db: Db;
	let userId: string;
	beforeEach(async () => {
		db = await createTestDb();
		userId = (await seedTestUser(db)).id;
		await getActivePreferences(db, userId); // ensure v1 Default exists
	});

	it('deep-merges set and bumps version', async () => {
		const r = await patchPreferences(
			db,
			userId,
			{ set: { appearance: { theme: 'light' } } },
			1
		);
		expect(r.version).toBe(2);
		expect(r.data).toMatchObject({ appearance: { theme: 'light' } });
	});

	it('unset deletes a dotted path (reset to default)', async () => {
		await patchPreferences(
			db,
			userId,
			{ set: { appearance: { entityTypeColors: { Character: '#ff0000', Location: '#00ff00' } } } },
			1
		);
		const r = await patchPreferences(
			db,
			userId,
			{ unset: ['appearance.entityTypeColors.Character'] },
			2
		);
		expect(r.data.appearance).toMatchObject({ entityTypeColors: { Location: '#00ff00' } });
		expect((r.data.appearance as any).entityTypeColors.Character).toBeUndefined();
	});

	it('strips prototype-pollution keys from set', async () => {
		const r = await patchPreferences(
			db,
			userId,
			{ set: { __proto__: { polluted: true }, appearance: { theme: 'light' } } as any },
			1
		);
		expect(({} as any).polluted).toBeUndefined();
		expect(Object.prototype.hasOwnProperty.call(r.data, '__proto__')).toBe(false);
	});
});

describe('T2 patchPreferences — Approach-B concurrency matrix (5A)', () => {
	let db: Db;
	let userId: string;
	beforeEach(async () => {
		db = await createTestDb();
		userId = (await seedTestUser(db)).id;
		await getActivePreferences(db, userId);
	});

	it('stale clientVersion → 409', async () => {
		await patchPreferences(db, userId, { set: { appearance: { theme: 'light' } } }, 1); // → v2
		await expectStatus(
			patchPreferences(db, userId, { set: { appearance: { accentColor: '#abcdef' } } }, 1),
			409
		);
	});

	it('reconcile-and-retry after 409 → no lost update, version monotonic', async () => {
		// Client A writes theme at v1 → v2.
		await patchPreferences(db, userId, { set: { appearance: { theme: 'light' } } }, 1);
		// Client B (still v1) writes accent → stale → 409.
		await expectStatus(
			patchPreferences(db, userId, { set: { appearance: { accentColor: '#abcdef' } } }, 1),
			409
		);
		// B reconciles: re-fetch fresh base (v2), re-apply its pending patch, retry.
		const fresh = await getActivePreferences(db, userId);
		expect(fresh.version).toBe(2);
		const afterB = await patchPreferences(
			db,
			userId,
			{ set: { appearance: { accentColor: '#abcdef' } } },
			fresh.version
		);
		expect(afterB.version).toBe(3);
		// Both writes survive — A's theme AND B's accent. No lost update.
		expect(afterB.data.appearance).toMatchObject({ theme: 'light', accentColor: '#abcdef' });
	});

	it('different-subtree concurrent writes both land after reconciliation', async () => {
		await patchPreferences(db, userId, { set: { editor: { linkPreviewEnabled: false } } }, 1); // v2
		// second writer at stale v1 → 409, then reconciles at v2
		await expectStatus(
			patchPreferences(db, userId, { set: { appearance: { theme: 'light' } } }, 1),
			409
		);
		const r = await patchPreferences(db, userId, { set: { appearance: { theme: 'light' } } }, 2);
		expect(r.data).toMatchObject({
			editor: { linkPreviewEnabled: false },
			appearance: { theme: 'light' }
		});
	});

	it('version increments monotonically across N writes', async () => {
		let v = 1;
		for (const theme of ['light', 'dark', 'light', 'dark'] as const) {
			const r = await patchPreferences(db, userId, { set: { appearance: { theme } } }, v);
			v = r.version;
		}
		expect(v).toBe(5);
	});
});

describe('T2 patchPreferences — validation', () => {
	let db: Db;
	let userId: string;
	beforeEach(async () => {
		db = await createTestDb();
		userId = (await seedTestUser(db)).id;
		await getActivePreferences(db, userId);
	});

	it('rejects a non-hex color value (400)', async () => {
		await expectStatus(
			patchPreferences(db, userId, { set: { appearance: { accentColor: 'not-a-color' } } }, 1),
			400
		);
	});

	it('rejects an unknown entity-type color key (400)', async () => {
		await expectStatus(
			patchPreferences(
				db,
				userId,
				{ set: { appearance: { entityTypeColors: { Bogus: '#ffffff' } } } },
				1
			),
			400
		);
	});

	it('rejects an unsafe unset path (400)', async () => {
		await expectStatus(patchPreferences(db, userId, { unset: ['__proto__.x'] }, 1), 400);
	});

	it('rejects a too-new schemaVersion (400) so it cannot brick hydrate (codex)', async () => {
		await expectStatus(patchPreferences(db, userId, { set: { schemaVersion: 999 } }, 1), 400);
		await expectStatus(patchPreferences(db, userId, { set: { schemaVersion: 0 } }, 1), 400);
		await expectStatus(patchPreferences(db, userId, { set: { schemaVersion: 1.5 } }, 1), 400);
	});

	it('accepts the current schemaVersion stamp', async () => {
		const r = await patchPreferences(db, userId, { set: { schemaVersion: 4 } }, 1);
		expect(r.version).toBe(2);
	});

	it('rejects an oversized blob (400)', async () => {
		await expectStatus(
			patchPreferences(
				db,
				userId,
				{ set: { editor: { huge: 'x'.repeat(70_000) } } as any },
				1
			),
			400
		);
	});

	it('rejects a stale-shaped patch with no set or unset (400)', async () => {
		await expectStatus(patchPreferences(db, userId, {}, 1), 400);
	});

	it('accepts valid per-type / per-role color maps', async () => {
		const r = await patchPreferences(
			db,
			userId,
			{
				set: {
					appearance: {
						entityTypeColors: { Character: '#c8942a' },
						relationshipTypeColors: { allied_with: '#2dd4bf' },
						roleColors: { Protagonist: '#abcdef' }
					}
				}
			},
			1
		);
		expect(r.version).toBe(2);
	});

	// ── Phase 2 (Item 4 graph, Item 3 windows) — A3 section validation ──────────
	it('accepts valid graph toggle defaults', async () => {
		const r = await patchPreferences(
			db,
			userId,
			{ set: { graph: { hardFilter: false, showGhostTrails: true } } },
			1
		);
		expect(r.version).toBe(2);
	});

	it('rejects a non-boolean graph toggle (400)', async () => {
		await expectStatus(
			patchPreferences(db, userId, { set: { graph: { showGhostTrails: 'yes' } } } as any, 1),
			400
		);
	});

	it('validates graph even when appearance is absent (A3 — above early-return)', async () => {
		await expectStatus(
			patchPreferences(db, userId, { set: { graph: { hardFilter: 1 } } } as any, 1),
			400
		);
	});

	it('accepts valid window geometry defaults', async () => {
		const r = await patchPreferences(
			db,
			userId,
			{ set: { windows: { defaults: { 'world-map': { width: 1200, height: 800, x: 40, y: 40 } } } } },
			1
		);
		expect(r.version).toBe(2);
	});

	it('rejects NaN / non-finite window geometry (400)', async () => {
		await expectStatus(
			patchPreferences(
				db,
				userId,
				{ set: { windows: { defaults: { 'world-map': { width: Number.NaN, height: 800 } } } } } as any,
				1
			),
			400
		);
	});

	it('rejects an unknown AppId key in windows.defaults (400)', async () => {
		await expectStatus(
			patchPreferences(
				db,
				userId,
				{ set: { windows: { defaults: { 'not-an-app': { width: 100, height: 100 } } } } } as any,
				1
			),
			400
		);
	});

	it('rejects window geometry missing required dimensions (400)', async () => {
		await expectStatus(
			patchPreferences(
				db,
				userId,
				{ set: { windows: { defaults: { wiki: { x: 10, y: 10 } } } } } as any,
				1
			),
			400
		);
	});
});

describe('T2 cross-user isolation', () => {
	it('patching one user does not touch another', async () => {
		const db = await createTestDb();
		const a = (await seedTestUser(db)).id;
		const b = (await seedTestUser(db, { email: 'b@test.com' })).id;
		await getActivePreferences(db, a);
		await patchPreferences(db, a, { set: { appearance: { theme: 'light' } } }, 1);
		const bPrefs = await getActivePreferences(db, b);
		expect(bPrefs.data).toEqual({}); // b's freshly-created Default is untouched
	});
});
