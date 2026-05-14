/**
 * Integration tests for WorldMap v2 Steps 2 + 3:
 *   - Map variant schema invariants (M9): EXCLUDE no-overlap, partial-unique
 *     single default, CHECK position order, open-ended rejection.
 *   - M10 polymorphic FK validation for the four variant temporal-bound FKs.
 *   - M11 reorder cascade: recomputeAllIntervals propagates into
 *     recomputeWorldMapVariantsAll within the same transaction.
 *   - Step 2 `part_of` relationship: type-check both endpoints, single-parent,
 *     cycle rejection.
 *   - Duplicate-map endpoint: clones row + regions, drops variant bounds.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, seedActs, seedTestUser } from '../helpers/test-db.js';
import { entities, worldMaps, mapRegions } from '../../src/lib/server/db/schema.js';
import { recomputeAllIntervals } from '../../src/lib/server/intervals.js';

let currentDb: Awaited<ReturnType<typeof createTestDb>>;
let userId: string;

const mapRoute = await import('../../src/routes/api/maps/+server.js');
const dupRoute = await import('../../src/routes/api/maps/[id]/duplicate/+server.js');
const relRoute = await import('../../src/routes/api/relationships/+server.js');

function mkEvent(
	overrides: { url?: URL; params?: Record<string, string>; body?: unknown } = {}
): any {
	return {
		url: overrides.url ?? new URL('http://localhost/api/maps'),
		params: overrides.params ?? {},
		request: { json: async () => overrides.body },
		locals: {
			db: currentDb,
			user: { id: userId, name: 'T', email: 't@t.com', emailVerified: true },
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

async function seedLocation(db: typeof currentDb, name: string) {
	const [l] = await db
		.insert(entities)
		.values({ userId, type: 'Location', name })
		.returning();
	return l.id;
}

describe('world_maps variant schema (M9)', () => {
	let act0: string;
	let act1: string;
	let act2: string;
	let location: string;

	beforeEach(async () => {
		currentDb = await createTestDb();
		const u = await seedTestUser(currentDb);
		userId = u.id;
		const seeded = await seedActs(currentDb, userId);
		act0 = seeded.act0;
		act1 = seeded.act1;
		act2 = seeded.act2;
		location = await seedLocation(currentDb, 'Gondor');
	});

	it('creates a default variant (all-null bounds) for a Location', async () => {
		const res = await mapRoute.POST(
			mkEvent({ body: { name: 'Default Gondor', locationId: location } })
		);
		expect(res.status).toBe(201);
		const body = await readJson(res);
		expect(body.startPosition).toBeNull();
		expect(body.endPosition).toBeNull();
		expect(body.startActId).toBeNull();
	});

	it('creates a scoped variant with valid bounds', async () => {
		const res = await mapRoute.POST(
			mkEvent({
				body: {
					name: 'Pre-war Gondor',
					locationId: location,
					startActId: act0,
					endActId: act0
				}
			})
		);
		expect(res.status).toBe(201);
		const body = await readJson(res);
		expect(body.startPosition).toBe(0);
		expect(body.endPosition).toBe(1);
	});

	it('rejects a second default variant for the same Location (partial-unique)', async () => {
		await mapRoute.POST(
			mkEvent({ body: { name: 'Default A', locationId: location } })
		);
		await expect(
			mapRoute.POST(mkEvent({ body: { name: 'Default B', locationId: location } }))
		).rejects.toMatchObject({ status: 409 });
	});

	it('rejects overlapping scoped variants for the same Location (EXCLUDE)', async () => {
		// [0, 1) — act0 only
		await mapRoute.POST(
			mkEvent({
				body: {
					name: 'V1',
					locationId: location,
					startActId: act0,
					endActId: act0
				}
			})
		);
		// [0, 2) — act0 → act1; overlaps with the [0,1) above
		await expect(
			mapRoute.POST(
				mkEvent({
					body: {
						name: 'V2',
						locationId: location,
						startActId: act0,
						endActId: act1
					}
				})
			)
		).rejects.toMatchObject({ status: 409 });
	});

	it('accepts two abutting non-overlapping variants for the same Location', async () => {
		// [0, 1)
		const a = await mapRoute.POST(
			mkEvent({
				body: { name: 'Pre', locationId: location, startActId: act0, endActId: act0 }
			})
		);
		// [1, 2)
		const b = await mapRoute.POST(
			mkEvent({
				body: { name: 'Post', locationId: location, startActId: act1, endActId: act1 }
			})
		);
		expect(a.status).toBe(201);
		expect(b.status).toBe(201);
	});

	it('allows two scoped variants for different Locations to overlap', async () => {
		const other = await seedLocation(currentDb, 'Rohan');
		await mapRoute.POST(
			mkEvent({
				body: { name: 'Gondor', locationId: location, startActId: act0, endActId: act0 }
			})
		);
		const second = await mapRoute.POST(
			mkEvent({
				body: { name: 'Rohan', locationId: other, startActId: act0, endActId: act0 }
			})
		);
		expect(second.status).toBe(201);
	});
});

describe('world_maps variant polymorphic FK invariants (M10)', () => {
	let act0: string;
	let location: string;

	beforeEach(async () => {
		currentDb = await createTestDb();
		const u = await seedTestUser(currentDb);
		userId = u.id;
		const seeded = await seedActs(currentDb, userId);
		act0 = seeded.act0;
		location = await seedLocation(currentDb, 'Gondor');
	});

	it('rejects a non-Act entity as start_act_id', async () => {
		await expect(
			mapRoute.POST(
				mkEvent({
					body: {
						name: 'Bad',
						locationId: location,
						startActId: location, // a Location id, not Act
						endActId: act0
					}
				})
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('rejects a non-Scene entity as start_scene_id', async () => {
		await expect(
			mapRoute.POST(
				mkEvent({
					body: {
						name: 'Bad',
						locationId: location,
						startActId: act0,
						startSceneId: act0, // an Act id, not Scene
						endActId: act0
					}
				})
			)
		).rejects.toMatchObject({ status: 400 });
	});
});

describe('M11: Act reorder cascades into variant position recompute', () => {
	let act0: string;
	let act1: string;
	let act2: string;
	let location: string;

	beforeEach(async () => {
		currentDb = await createTestDb();
		const u = await seedTestUser(currentDb);
		userId = u.id;
		const seeded = await seedActs(currentDb, userId);
		act0 = seeded.act0;
		act1 = seeded.act1;
		act2 = seeded.act2;
		location = await seedLocation(currentDb, 'Gondor');
	});

	it('shifts variant positions when the anchor Act moves later in the order', async () => {
		// Variant anchored to act0 (index 0) only — occupies [0, 1).
		const created = await mapRoute.POST(
			mkEvent({
				body: { name: 'V', locationId: location, startActId: act0, endActId: act0 }
			})
		);
		const before = await readJson(created);
		expect(before.startPosition).toBe(0);
		expect(before.endPosition).toBe(1);

		// Promote act0 to the highest position so it becomes the last act in order.
		// actIndexOf sorts by (position, createdAt), so new ordering: act1=0, act2=1, act0=2.
		await currentDb.update(entities).set({ position: 100 }).where(eq(entities.id, act0));

		await recomputeAllIntervals(currentDb, userId);

		const [after] = await currentDb
			.select()
			.from(worldMaps)
			.where(eq(worldMaps.id, before.id));
		expect(after.startPosition).toBe(2);
		expect(after.endPosition).toBe(3);
	});

	it('preserves EXCLUDE invariance when one variant shifts and another stays', async () => {
		// V1 anchored to act0 (index 0) → [0, 1). V2 anchored to act2 (index 2) → [2, 3).
		await mapRoute.POST(
			mkEvent({
				body: { name: 'V1', locationId: location, startActId: act0, endActId: act0 }
			})
		);
		await mapRoute.POST(
			mkEvent({
				body: { name: 'V2', locationId: location, startActId: act2, endActId: act2 }
			})
		);

		// Pull act1 to the end. New order: act0=0, act2=1, act1=2.
		// V1 (act0) stays at [0, 1). V2 (act2) shifts from [2, 3) to [1, 2).
		// No transient overlap — only V2 moves and its new range was previously
		// unoccupied (act1's old slot).
		await currentDb.update(entities).set({ position: 100 }).where(eq(entities.id, act1));

		await recomputeAllIntervals(currentDb, userId);

		const all = await currentDb.select().from(worldMaps);
		const v1 = all.find((m) => m.name === 'V1')!;
		const v2 = all.find((m) => m.name === 'V2')!;
		expect(v1.startPosition).toBe(0);
		expect(v1.endPosition).toBe(1);
		expect(v2.startPosition).toBe(1);
		expect(v2.endPosition).toBe(2);
	});
});

describe('part_of relationship validation', () => {
	let loc1: string;
	let loc2: string;
	let loc3: string;
	let character: string;

	beforeEach(async () => {
		currentDb = await createTestDb();
		const u = await seedTestUser(currentDb);
		userId = u.id;
		loc1 = await seedLocation(currentDb, 'Middle-earth');
		loc2 = await seedLocation(currentDb, 'Gondor');
		loc3 = await seedLocation(currentDb, 'Minas Tirith');
		const [c] = await currentDb
			.insert(entities)
			.values({ userId, type: 'Character', name: 'Aragorn' })
			.returning();
		character = c.id;
	});

	it('accepts a valid Location → Location part_of', async () => {
		const res = await relRoute.POST(
			mkEvent({ body: { fromId: loc2, toId: loc1, type: 'part_of' } })
		);
		expect(res.status).toBe(201);
	});

	it('rejects part_of when fromId is not a Location', async () => {
		await expect(
			relRoute.POST(
				mkEvent({ body: { fromId: character, toId: loc1, type: 'part_of' } })
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('rejects part_of when toId is not a Location', async () => {
		await expect(
			relRoute.POST(
				mkEvent({ body: { fromId: loc1, toId: character, type: 'part_of' } })
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('rejects self-part_of', async () => {
		await expect(
			relRoute.POST(mkEvent({ body: { fromId: loc1, toId: loc1, type: 'part_of' } }))
		).rejects.toMatchObject({ status: 400 });
	});

	it('rejects a second part_of from the same child (single-parent)', async () => {
		await relRoute.POST(
			mkEvent({ body: { fromId: loc2, toId: loc1, type: 'part_of' } })
		);
		await expect(
			relRoute.POST(
				mkEvent({ body: { fromId: loc2, toId: loc3, type: 'part_of' } })
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('rejects part_of that would create a cycle', async () => {
		// loc3 part_of loc2 part_of loc1; then loc1 part_of loc3 closes the loop.
		await relRoute.POST(
			mkEvent({ body: { fromId: loc3, toId: loc2, type: 'part_of' } })
		);
		await relRoute.POST(
			mkEvent({ body: { fromId: loc2, toId: loc1, type: 'part_of' } })
		);
		await expect(
			relRoute.POST(
				mkEvent({ body: { fromId: loc1, toId: loc3, type: 'part_of' } })
			)
		).rejects.toMatchObject({ status: 400 });
	});
});

describe('/api/maps/[id]/duplicate', () => {
	let location: string;

	beforeEach(async () => {
		currentDb = await createTestDb();
		const u = await seedTestUser(currentDb);
		userId = u.id;
		location = await seedLocation(currentDb, 'Gondor');
	});

	it('clones map row + regions; drops variant bounds', async () => {
		const seeded = await seedActs(currentDb, userId);
		const created = await mapRoute.POST(
			mkEvent({
				body: {
					name: 'Original',
					locationId: location,
					startActId: seeded.act0,
					endActId: seeded.act1
				}
			})
		);
		const map = await readJson(created);

		// Add a region directly to the DB (bypasses the regions route for speed).
		await currentDb.insert(mapRegions).values({
			mapId: map.id,
			locationId: location,
			polygon: [
				[0, 0],
				[1, 0],
				[1, 1]
			],
			color: '#abcdef'
		});

		const dupRes = await dupRoute.POST(
			mkEvent({ params: { id: map.id } })
		);
		expect(dupRes.status).toBe(201);
		const clone = await readJson(dupRes);

		expect(clone.id).not.toBe(map.id);
		expect(clone.name).toBe('Original (copy)');
		expect(clone.locationId).toBe(location);
		// Variant bounds intentionally NOT carried over — clone is a default
		// variant (and partial-unique still holds because the source was scoped).
		expect(clone.startActId).toBeNull();
		expect(clone.endActId).toBeNull();
		expect(clone.startPosition).toBeNull();
		expect(clone.endPosition).toBeNull();

		// Regions cloned with new ids + new mapId.
		expect(clone.regions).toHaveLength(1);
		expect(clone.regions[0].mapId).toBe(clone.id);
		expect(clone.regions[0].color).toBe('#abcdef');
		expect(clone.regions[0].polygon).toEqual([
			[0, 0],
			[1, 0],
			[1, 1]
		]);
	});

	it('returns 404 for non-existent map', async () => {
		await expect(
			dupRoute.POST(mkEvent({ params: { id: crypto.randomUUID() } }))
		).rejects.toMatchObject({ status: 404 });
	});
});
