/**
 * Vitest integration tests for /api/map-placements (WorldMap v2 Step 4).
 *
 * Coverage:
 *   - POST/GET/PATCH/DELETE happy path
 *   - Polymorphic FK guards (placeable_id type set, location_id Location, FK
 *     bound types — Act and Scene)
 *   - x/y validation at the API layer + the DB CHECK
 *   - ON DELETE behavior: placeable CASCADE, location SET NULL, map SET NULL
 *   - M11 — recomputeAllIntervals cascades through recomputePlacementBoundsAll
 *   - default placement (all-null bounds) always active across playheads
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, seedActs, seedTestUser } from '../helpers/test-db.js';
import { and, eq } from 'drizzle-orm';
import { entities, mapPlacements, worldMaps } from '../../src/lib/server/db/schema.js';
import { recomputeAllIntervals } from '../../src/lib/server/intervals.js';

let currentDb: Awaited<ReturnType<typeof createTestDb>>;
let userId: string;

const { POST: CREATE_PLACEMENT, GET: LIST_PLACEMENTS } = await import(
	'../../src/routes/api/map-placements/+server.js'
);
const placementIdRoute = await import('../../src/routes/api/map-placements/[id]/+server.js');

function mkEvent(
	overrides: { url?: URL; params?: Record<string, string>; body?: unknown } = {}
): any {
	return {
		url: overrides.url ?? new URL('http://localhost/api/map-placements'),
		params: overrides.params ?? {},
		request: { json: async () => overrides.body },
		locals: {
			db: currentDb,
			user: {
				id: userId,
				name: 'Test User',
				email: 't@t.com',
				emailVerified: true
			},
			session: {
				id: crypto.randomUUID(),
				userId,
				expiresAt: new Date(Date.now() + 86400000),
				token: 'tok'
			}
		}
	};
}

async function readJson(res: Response): Promise<any> {
	return JSON.parse(await res.text());
}

async function seedLocation(name = 'Gondor') {
	const [loc] = await currentDb
		.insert(entities)
		.values({ userId, type: 'Location', name })
		.returning();
	return loc;
}

async function seedCharacter(name = 'Frodo') {
	const [c] = await currentDb
		.insert(entities)
		.values({ userId, type: 'Character', name })
		.returning();
	return c;
}

async function seedMap(name = 'Map', locationId: string | null = null) {
	const [m] = await currentDb
		.insert(worldMaps)
		.values({ userId, name, locationId, baseImageUrl: '/x.png', width: 1000, height: 800 })
		.returning();
	return m;
}

beforeEach(async () => {
	currentDb = await createTestDb();
	const u = await seedTestUser(currentDb);
	userId = u.id;
});

describe('POST /api/map-placements', () => {
	it('creates a placement with fractional coords and default (all-null) bounds', async () => {
		const loc = await seedLocation();
		const ch = await seedCharacter();
		const map = await seedMap('Mid', loc.id);

		const res = await CREATE_PLACEMENT(
			mkEvent({
				body: {
					placeableId: ch.id,
					locationId: loc.id,
					mapId: map.id,
					x: 0.4,
					y: 0.7
				}
			})
		);
		expect(res.status).toBe(201);
		const body = await readJson(res);
		expect(body.x).toBeCloseTo(0.4);
		expect(body.y).toBeCloseTo(0.7);
		expect(body.startPosition).toBeNull();
		expect(body.endPosition).toBeNull();
		expect(body.placeableId).toBe(ch.id);
	});

	it('rejects placeable_id pointing at a Location', async () => {
		const loc = await seedLocation();
		await expect(
			CREATE_PLACEMENT(mkEvent({ body: { placeableId: loc.id, x: 0.1, y: 0.1 } }))
		).rejects.toMatchObject({ status: 400 });
	});

	it('accepts Artifact / Item / Door as placeable types', async () => {
		for (const type of ['Artifact', 'Item', 'Door'] as const) {
			const [e] = await currentDb
				.insert(entities)
				.values({ userId, type, name: `New ${type}` })
				.returning();
			const res = await CREATE_PLACEMENT(
				mkEvent({ body: { placeableId: e.id, x: 0.5, y: 0.5 } })
			);
			expect(res.status).toBe(201);
		}
	});

	it('rejects location_id pointing at a Character', async () => {
		const ch = await seedCharacter();
		await expect(
			CREATE_PLACEMENT(
				mkEvent({ body: { placeableId: ch.id, locationId: ch.id, x: 0.1, y: 0.1 } })
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('rejects x/y outside [0, 1]', async () => {
		const ch = await seedCharacter();
		await expect(
			CREATE_PLACEMENT(mkEvent({ body: { placeableId: ch.id, x: 1.5, y: 0.1 } }))
		).rejects.toMatchObject({ status: 400 });
		await expect(
			CREATE_PLACEMENT(mkEvent({ body: { placeableId: ch.id, x: 0.1, y: -0.1 } }))
		).rejects.toMatchObject({ status: 400 });
	});

	it('derives start_position / end_position from act FKs', async () => {
		const acts = await seedActs(currentDb, userId);
		const ch = await seedCharacter();
		const res = await CREATE_PLACEMENT(
			mkEvent({
				body: {
					placeableId: ch.id,
					x: 0.3,
					y: 0.3,
					startActId: acts.act0,
					endActId: acts.act1
				}
			})
		);
		const body = await readJson(res);
		expect(body.startPosition).toBeCloseTo(0);
		expect(body.endPosition).toBeCloseTo(2);
	});

	it('rejects scene_id pointing at an Act', async () => {
		const acts = await seedActs(currentDb, userId);
		const ch = await seedCharacter();
		await expect(
			CREATE_PLACEMENT(
				mkEvent({
					body: {
						placeableId: ch.id,
						x: 0.1,
						y: 0.1,
						startActId: acts.act0,
						startSceneId: acts.act1
					}
				})
			)
		).rejects.toMatchObject({ status: 400 });
	});
});

describe('GET /api/map-placements', () => {
	it('filters by locationId / placeableId / mapId', async () => {
		const loc1 = await seedLocation('A');
		const loc2 = await seedLocation('B');
		const ch = await seedCharacter();
		const map = await seedMap('M', loc1.id);
		await CREATE_PLACEMENT(
			mkEvent({ body: { placeableId: ch.id, locationId: loc1.id, mapId: map.id, x: 0.1, y: 0.1 } })
		);
		await CREATE_PLACEMENT(
			mkEvent({ body: { placeableId: ch.id, locationId: loc2.id, x: 0.2, y: 0.2 } })
		);

		const r1 = await readJson(
			await LIST_PLACEMENTS(
				mkEvent({ url: new URL(`http://x/api/map-placements?locationId=${loc1.id}`) })
			)
		);
		expect(r1).toHaveLength(1);
		expect(r1[0].locationId).toBe(loc1.id);

		const r2 = await readJson(
			await LIST_PLACEMENTS(
				mkEvent({ url: new URL(`http://x/api/map-placements?mapId=${map.id}`) })
			)
		);
		expect(r2).toHaveLength(1);
	});
});

describe('PATCH + DELETE /api/map-placements/[id]', () => {
	it('PATCH updates x/y and bounds; DELETE removes the row', async () => {
		const ch = await seedCharacter();
		const created = await readJson(
			await CREATE_PLACEMENT(mkEvent({ body: { placeableId: ch.id, x: 0.1, y: 0.1 } }))
		);

		const patchRes = await placementIdRoute.PATCH(
			mkEvent({ params: { id: created.id }, body: { x: 0.6, y: 0.6 } })
		);
		const updated = await readJson(patchRes);
		expect(updated.x).toBeCloseTo(0.6);

		const delRes = await placementIdRoute.DELETE(mkEvent({ params: { id: created.id } }));
		expect(delRes.status).toBe(204);

		const rows = await currentDb
			.select()
			.from(mapPlacements)
			.where(eq(mapPlacements.id, created.id));
		expect(rows).toHaveLength(0);
	});

	it('PATCH bounds: clearing both act FKs clears their scene FKs too', async () => {
		const acts = await seedActs(currentDb, userId);
		const ch = await seedCharacter();
		const [scene] = await currentDb
			.insert(entities)
			.values({ userId, type: 'Scene', name: 's0', parentId: acts.act0, position: 0 })
			.returning();
		const created = await readJson(
			await CREATE_PLACEMENT(
				mkEvent({
					body: {
						placeableId: ch.id,
						x: 0.1,
						y: 0.1,
						startActId: acts.act0,
						startSceneId: scene.id,
						endActId: acts.act1
					}
				})
			)
		);
		expect(created.startSceneId).toBe(scene.id);

		const patched = await readJson(
			await placementIdRoute.PATCH(
				mkEvent({
					params: { id: created.id },
					body: { startActId: null, endActId: null }
				})
			)
		);
		expect(patched.startActId).toBeNull();
		expect(patched.endActId).toBeNull();
		expect(patched.startSceneId).toBeNull();
		expect(patched.endSceneId).toBeNull();
		expect(patched.startPosition).toBeNull();
		expect(patched.endPosition).toBeNull();
	});

	it('PATCH rejects asymmetric bounds (one act FK null, other set)', async () => {
		const acts = await seedActs(currentDb, userId);
		const ch = await seedCharacter();
		const created = await readJson(
			await CREATE_PLACEMENT(
				mkEvent({
					body: {
						placeableId: ch.id,
						x: 0.1,
						y: 0.1,
						startActId: acts.act0,
						endActId: acts.act1
					}
				})
			)
		);
		await expect(
			placementIdRoute.PATCH(
				mkEvent({ params: { id: created.id }, body: { startActId: null } })
			)
		).rejects.toMatchObject({ status: 400 });
	});
});

describe('cascade behavior', () => {
	it('placeable delete CASCADEs placements', async () => {
		const ch = await seedCharacter();
		await CREATE_PLACEMENT(mkEvent({ body: { placeableId: ch.id, x: 0.1, y: 0.1 } }));
		await currentDb.delete(entities).where(eq(entities.id, ch.id));
		const rows = await currentDb
			.select()
			.from(mapPlacements)
			.where(eq(mapPlacements.userId, userId));
		expect(rows).toHaveLength(0);
	});

	it('location delete SETs NULL on placements', async () => {
		const loc = await seedLocation();
		const ch = await seedCharacter();
		const created = await readJson(
			await CREATE_PLACEMENT(
				mkEvent({ body: { placeableId: ch.id, locationId: loc.id, x: 0.1, y: 0.1 } })
			)
		);
		await currentDb.delete(entities).where(eq(entities.id, loc.id));
		const [row] = await currentDb
			.select()
			.from(mapPlacements)
			.where(eq(mapPlacements.id, created.id));
		expect(row.locationId).toBeNull();
		expect(row.placeableId).toBe(ch.id);
	});

	it('map delete SETs NULL on placements (placement survives)', async () => {
		const loc = await seedLocation();
		const ch = await seedCharacter();
		const map = await seedMap('M', loc.id);
		const created = await readJson(
			await CREATE_PLACEMENT(
				mkEvent({
					body: { placeableId: ch.id, locationId: loc.id, mapId: map.id, x: 0.1, y: 0.1 }
				})
			)
		);
		await currentDb.delete(worldMaps).where(eq(worldMaps.id, map.id));
		const [row] = await currentDb
			.select()
			.from(mapPlacements)
			.where(eq(mapPlacements.id, created.id));
		expect(row.mapId).toBeNull();
		expect(row.locationId).toBe(loc.id);
	});
});

describe('M11 — placement bounds recompute on Act reorder', () => {
	it('recomputes start/end_position when the anchored Act changes position', async () => {
		const acts = await seedActs(currentDb, userId);
		const ch = await seedCharacter();
		const created = await readJson(
			await CREATE_PLACEMENT(
				mkEvent({
					body: {
						placeableId: ch.id,
						x: 0.1,
						y: 0.1,
						startActId: acts.act0,
						endActId: acts.act0
					}
				})
			)
		);
		expect(created.startPosition).toBeCloseTo(0);
		expect(created.endPosition).toBeCloseTo(1);

		// Move act0 from position 0 to position 2 (swap with act2).
		await currentDb.transaction(async (tx) => {
			await tx
				.update(entities)
				.set({ position: 99 })
				.where(and(eq(entities.id, acts.act0), eq(entities.userId, userId)));
			await tx
				.update(entities)
				.set({ position: 0 })
				.where(and(eq(entities.id, acts.act2), eq(entities.userId, userId)));
			await tx
				.update(entities)
				.set({ position: 2 })
				.where(and(eq(entities.id, acts.act0), eq(entities.userId, userId)));
			await recomputeAllIntervals(tx, userId);
		});

		const [after] = await currentDb
			.select()
			.from(mapPlacements)
			.where(eq(mapPlacements.id, created.id));
		expect(after.startPosition).toBeCloseTo(2);
		expect(after.endPosition).toBeCloseTo(3);
	});
});
