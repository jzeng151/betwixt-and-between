/**
 * Multi-tenant isolation: maps + regions (T8b S6).
 *
 * Maps have a direct userId column. Map regions live in anchor JSON
 * (Slice 2 D2 PR-C) and are scoped via JOIN on worldMaps.userId. Cross-
 * user access on either surface returns 404 / empty / 400.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import {
	createTestDb,
	seedTestUser,
	seedRegionWithAnchorBackfill
} from '../helpers/test-db.js';
import { worldMaps, mapAnchors } from '../../src/lib/server/db/schema.js';

let currentDb: Awaited<ReturnType<typeof createTestDb>>;

const mapsRoute = await import('../../src/routes/api/maps/+server.js');
const mapIdRoute = await import('../../src/routes/api/maps/[id]/+server.js');
const regionsRoute = await import('../../src/routes/api/maps/[id]/regions/+server.js');
const regionIdRoute = await import('../../src/routes/api/maps/[id]/regions/[rid]/+server.js');

function mkEvent(userId: string, overrides: { params?: Record<string, string>; body?: unknown; url?: string } = {}): any {
	return {
		url: new URL(overrides.url ?? 'http://localhost/api/maps'),
		params: overrides.params ?? {},
		request: { json: async () => overrides.body },
		locals: {
			db: currentDb,
			user: { id: userId, name: 'u', email: `${userId}@t.com`, emailVerified: true },
			session: { id: crypto.randomUUID(), userId, expiresAt: new Date(Date.now() + 86400000), token: 't' }
		}
	};
}

async function readJson(res: Response): Promise<any> {
	return JSON.parse(await res.text());
}

async function regionInAnchor(mapId: string, regionId: string): Promise<boolean> {
	const rows = await currentDb
		.select()
		.from(mapAnchors)
		.where(eq(mapAnchors.worldMapId, mapId));
	for (const a of rows) {
		const state = a.stateJsonb as { regions?: Array<{ region_id: string }> };
		if ((state.regions ?? []).some((r) => r.region_id === regionId)) return true;
	}
	return false;
}

describe('auth isolation: /api/maps', () => {
	let userA: string;
	let userB: string;
	let aMapId: string;
	let aRegionId: string;

	beforeEach(async () => {
		currentDb = await createTestDb();
		userA = (await seedTestUser(currentDb, { email: 'a@t.com' })).id;
		userB = (await seedTestUser(currentDb, { email: 'b@t.com' })).id;
		const [m] = await currentDb
			.insert(worldMaps)
			.values({ userId: userA, name: 'A map' })
			.returning();
		aMapId = m.id;
		const r = await seedRegionWithAnchorBackfill(currentDb, {
			mapId: aMapId,
			polygon: [
				[0, 0],
				[1, 0],
				[1, 1]
			]
		});
		aRegionId = r.id;
	});

	it('user B GET list returns empty', async () => {
		const res = await mapsRoute.GET(mkEvent(userB));
		expect(await readJson(res)).toEqual([]);
	});

	it('user B GET map returns 404', async () => {
		await expect(
			mapIdRoute.GET(mkEvent(userB, { params: { id: aMapId } }))
		).rejects.toMatchObject({ status: 404 });
	});

	it('user B PATCH map returns 404', async () => {
		await expect(
			mapIdRoute.PATCH(mkEvent(userB, { params: { id: aMapId }, body: { name: 'pwned' } }))
		).rejects.toMatchObject({ status: 404 });

		const [row] = await currentDb.select().from(worldMaps).where(eq(worldMaps.id, aMapId));
		expect(row.name).toBe('A map');
	});

	it('user B DELETE map returns 404, map survives', async () => {
		await expect(
			mapIdRoute.DELETE(mkEvent(userB, { params: { id: aMapId } }))
		).rejects.toMatchObject({ status: 404 });

		const [row] = await currentDb.select().from(worldMaps).where(eq(worldMaps.id, aMapId));
		expect(row).toBeDefined();
	});

	it('user B POST region under user A map returns 404 (parent map scoped)', async () => {
		await expect(
			regionsRoute.POST(
				mkEvent(userB, {
					params: { id: aMapId },
					body: {
						polygon: [
							[0, 0],
							[1, 0],
							[1, 1]
						]
					}
				})
			)
		).rejects.toMatchObject({ status: 404 });
	});

	it('user B PATCH region returns 404, region survives', async () => {
		await expect(
			regionIdRoute.PATCH(
				mkEvent(userB, {
					params: { id: aMapId, rid: aRegionId },
					// Slice 2 D1: color is gone; use locationId=null as a
					// harmless PATCH body to exercise the cross-user 404 path.
					body: { locationId: null }
				})
			)
		).rejects.toMatchObject({ status: 404 });

		expect(await regionInAnchor(aMapId, aRegionId)).toBe(true);
	});

	it('user B DELETE region returns 404, region survives', async () => {
		await expect(
			regionIdRoute.DELETE(
				mkEvent(userB, { params: { id: aMapId, rid: aRegionId } })
			)
		).rejects.toMatchObject({ status: 404 });

		expect(await regionInAnchor(aMapId, aRegionId)).toBe(true);
	});
});
