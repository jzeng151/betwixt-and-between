/**
 * Slice 3 E1 — world_map_layer_prefs server CRUD + cross-user invariant.
 *
 * Covers:
 *   - GET happy path returns prefs for the caller's map
 *   - PATCH upserts: first call inserts, second call updates
 *   - GET on someone else's map → 404 (assertMapOwnership)
 *   - PATCH on someone else's map → 404
 *   - Unknown layer_key is accepted by the schema (lazy GC per the
 *     write helper's contract) — strings ≤ 64 chars pass
 *   - visible coerced to 0/1; out-of-range rejects with 400
 *   - Composite PK round-trip: same (user, map, layer) updates same row
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createTestDb, seedTestUser } from '../helpers/test-db.js';
import { worldMaps, worldMapLayerPrefs } from '../../src/lib/server/db/schema.js';

let currentDb: Awaited<ReturnType<typeof createTestDb>>;
let userId: string;

const { GET: LIST_PREFS, PATCH: PATCH_PREF } = await import(
	'../../src/routes/api/world-map-layer-prefs/+server.js'
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mkEvent(overrides: {
	url?: URL;
	body?: unknown;
	user?: { id: string; name: string; email: string; emailVerified: boolean };
} = {}): any {
	const uid = overrides.user?.id ?? userId;
	return {
		url: overrides.url ?? new URL('http://localhost/api/world-map-layer-prefs'),
		params: {},
		request: { json: async () => overrides.body },
		locals: {
			db: currentDb,
			user: overrides.user ?? {
				id: uid,
				name: 'Test User',
				email: 't@t.com',
				emailVerified: true
			},
			session: {
				id: crypto.randomUUID(),
				userId: uid,
				expiresAt: new Date(Date.now() + 86400000),
				token: 'tok'
			}
		}
	};
}

async function readJson(res: Response): Promise<unknown> {
	return JSON.parse(await res.text());
}

async function seedMap(ownerId: string, name = 'M'): Promise<string> {
	const [row] = await currentDb
		.insert(worldMaps)
		.values({ userId: ownerId, name })
		.returning({ id: worldMaps.id });
	return row.id;
}

beforeEach(async () => {
	currentDb = await createTestDb();
	const u = await seedTestUser(currentDb);
	userId = u.id;
});

describe('Slice 3 E1 — world_map_layer_prefs', () => {
	it('GET returns empty array for a map with no prefs yet', async () => {
		const mapId = await seedMap(userId);
		const res = await LIST_PREFS(
			mkEvent({
				url: new URL(`http://localhost/api/world-map-layer-prefs?worldMapId=${mapId}`)
			})
		);
		const body = (await readJson(res)) as unknown[];
		expect(Array.isArray(body)).toBe(true);
		expect(body).toHaveLength(0);
	});

	it('PATCH inserts a new pref then GET returns it', async () => {
		const mapId = await seedMap(userId);
		const patchRes = await PATCH_PREF(
			mkEvent({ body: { worldMapId: mapId, layerKey: 'grid', visible: 0 } })
		);
		const inserted = (await readJson(patchRes)) as Record<string, unknown>;
		expect(inserted.layerKey).toBe('grid');
		expect(inserted.visible).toBe(0);

		const listRes = await LIST_PREFS(
			mkEvent({
				url: new URL(`http://localhost/api/world-map-layer-prefs?worldMapId=${mapId}`)
			})
		);
		const list = (await readJson(listRes)) as Array<{
			layerKey: string;
			visible: number;
		}>;
		expect(list).toHaveLength(1);
		expect(list[0].layerKey).toBe('grid');
		expect(list[0].visible).toBe(0);
	});

	it('PATCH on existing (user, map, layer) updates rather than inserts', async () => {
		const mapId = await seedMap(userId);
		await PATCH_PREF(
			mkEvent({ body: { worldMapId: mapId, layerKey: 'terrain', visible: 0 } })
		);
		await PATCH_PREF(
			mkEvent({ body: { worldMapId: mapId, layerKey: 'terrain', visible: 1 } })
		);
		const rows = await currentDb
			.select()
			.from(worldMapLayerPrefs)
			.where(
				and(
					eq(worldMapLayerPrefs.userId, userId),
					eq(worldMapLayerPrefs.worldMapId, mapId),
					eq(worldMapLayerPrefs.layerKey, 'terrain')
				)
			);
		expect(rows).toHaveLength(1);
		expect(rows[0].visible).toBe(1);
	});

	it('GET on another user\'s map returns 404 (assertMapOwnership)', async () => {
		const userB = await seedTestUser(currentDb, { email: 'b@test.com' });
		const otherMapId = await seedMap(userB.id);
		await expect(
			LIST_PREFS(
				mkEvent({
					url: new URL(
						`http://localhost/api/world-map-layer-prefs?worldMapId=${otherMapId}`
					)
				})
			)
		).rejects.toMatchObject({ status: 404 });
	});

	it("PATCH against another user's map returns 404", async () => {
		const userB = await seedTestUser(currentDb, { email: 'b@test.com' });
		const otherMapId = await seedMap(userB.id);
		await expect(
			PATCH_PREF(
				mkEvent({
					body: { worldMapId: otherMapId, layerKey: 'grid', visible: 0 }
				})
			)
		).rejects.toMatchObject({ status: 404 });
	});

	it('PATCH rejects visible values other than 0 or 1', async () => {
		const mapId = await seedMap(userId);
		await expect(
			PATCH_PREF(
				mkEvent({ body: { worldMapId: mapId, layerKey: 'grid', visible: 2 } })
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('PATCH rejects empty layerKey', async () => {
		const mapId = await seedMap(userId);
		await expect(
			PATCH_PREF(
				mkEvent({ body: { worldMapId: mapId, layerKey: '', visible: 1 } })
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('PATCH accepts unknown layer_key (schema lazy GC; reader ignores)', async () => {
		// Per the schema comment in 0021 + world_map_layer_prefs spec,
		// layer_key is not constrained to LAYER_KEYS at the DB level. Stale
		// rows are silently ignored by the client. The server happily
		// stores future/legacy keys.
		const mapId = await seedMap(userId);
		const res = await PATCH_PREF(
			mkEvent({
				body: { worldMapId: mapId, layerKey: 'future-layer', visible: 1 }
			})
		);
		const row = (await readJson(res)) as { layerKey: string };
		expect(row.layerKey).toBe('future-layer');
	});

	it('cross-user invariant scan: no rows where pref.user_id != world_maps.user_id', async () => {
		// The PR A schema test sets this same invariant. Slice 3 E1's
		// server helper is the enforcement point — running the GET/PATCH
		// flow should NEVER produce a violating row.
		const userB = await seedTestUser(currentDb, { email: 'b@test.com' });
		const mapId = await seedMap(userId);
		const mapBId = await seedMap(userB.id);

		// User A writes to their own map (good).
		await PATCH_PREF(
			mkEvent({ body: { worldMapId: mapId, layerKey: 'grid', visible: 0 } })
		);
		// User A tries User B's map (rejected).
		try {
			await PATCH_PREF(
				mkEvent({ body: { worldMapId: mapBId, layerKey: 'grid', visible: 0 } })
			);
		} catch {
			/* expected 404 */
		}

		const rows = await currentDb
			.select({
				prefUser: worldMapLayerPrefs.userId,
				mapUser: worldMaps.userId,
				layerKey: worldMapLayerPrefs.layerKey
			})
			.from(worldMapLayerPrefs)
			.innerJoin(worldMaps, eq(worldMaps.id, worldMapLayerPrefs.worldMapId));
		for (const row of rows) {
			expect(row.prefUser).toBe(row.mapUser);
		}
	});
});
