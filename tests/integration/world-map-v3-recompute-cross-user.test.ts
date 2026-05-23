/**
 * World Map v3 Slice 1a — cross-user scoping invariant for the new
 * recomputeMapAnchors / recomputeMapEvents passes inside recomputeAllIntervals.
 *
 * CLAUDE.md: "A missing JOIN is a cross-user data leak." map_anchors and
 * map_events have no user_id column; every query must scope through
 * world_maps.user_id. This test pins the regression class today (pulled
 * forward from U8) — a future refactor that drops the userMapIds filter
 * would silently reproject another user's anchors. The defense-in-depth
 * UPDATE filter is the code-level guard; this test is the behavior-level
 * guard.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, seedTestUser, seedActs } from '../helpers/test-db.js';
import { entities, worldMaps, mapAnchors, mapEvents } from '../../src/lib/server/db/schema.js';
import { recomputeAllIntervals, snapshotActOrdering } from '../../src/lib/server/intervals.js';
import { and, eq } from 'drizzle-orm';

describe('World Map v3 recompute — cross-user JOIN scoping', () => {
	let db: Awaited<ReturnType<typeof createTestDb>>;

	beforeEach(async () => {
		db = await createTestDb();
	});

	it('reprojecting User A anchors/events leaves User B rows unchanged', async () => {
		const userA = await seedTestUser(db, { email: 'a@test.com' });
		const userB = await seedTestUser(db, { email: 'b@test.com' });

		// Seed identical 3-Act stories for both users.
		const actsA = await seedActs(db, userA.id);
		const actsB = await seedActs(db, userB.id);

		// One world_map per user.
		const [mapA] = await db
			.insert(worldMaps)
			.values({ userId: userA.id, name: 'Map A' })
			.returning();
		const [mapB] = await db
			.insert(worldMaps)
			.values({ userId: userB.id, name: 'Map B' })
			.returning();

		// Place one anchor + one event in each user's map at the SAME t_position
		// so we can detect if User A's recompute accidentally rewrote User B's
		// rows: identical inputs, only User A should diverge.
		const T_INITIAL = 1.5;
		const [anchorA] = await db
			.insert(mapAnchors)
			.values({
				worldMapId: mapA.id,
				tPosition: T_INITIAL,
				stateJsonb: { regions: [], artifacts: [], chains: [] }
			})
			.returning();
		const [anchorB] = await db
			.insert(mapAnchors)
			.values({
				worldMapId: mapB.id,
				tPosition: T_INITIAL,
				stateJsonb: { regions: [], artifacts: [], chains: [] }
			})
			.returning();
		const [eventA] = await db
			.insert(mapEvents)
			.values({
				worldMapId: mapA.id,
				tPosition: T_INITIAL,
				kind: 'transfer_region',
				payloadJsonb: {}
			})
			.returning();
		const [eventB] = await db
			.insert(mapEvents)
			.values({
				worldMapId: mapB.id,
				tPosition: T_INITIAL,
				kind: 'transfer_region',
				payloadJsonb: {}
			})
			.returning();

		// Capture User A's pre-reorder Act ordering, then swap acts 1 and 2.
		// Snapshot: {0: act0, 1: act1, 2: act2}. After swap: cache should map
		// act1 → newIdx=2 and act2 → newIdx=1. Anchor/event at t=1.5 (oldIdx=1
		// → actId=actsA.act1 → newIdx=2) should reproject to t=2.5.
		const preSnapshot = await snapshotActOrdering(db, userA.id);
		await db
			.update(entities)
			.set({ position: 1 })
			.where(and(eq(entities.id, actsA.act2), eq(entities.userId, userA.id)));
		await db
			.update(entities)
			.set({ position: 2 })
			.where(and(eq(entities.id, actsA.act1), eq(entities.userId, userA.id)));

		await recomputeAllIntervals(db, userA.id, preSnapshot);

		// User A's anchor + event reprojected: oldIdx=1 (act1) → newIdx=2 → t=2.5.
		const [anchorAAfter] = await db
			.select()
			.from(mapAnchors)
			.where(eq(mapAnchors.id, anchorA.id));
		const [eventAAfter] = await db
			.select()
			.from(mapEvents)
			.where(eq(mapEvents.id, eventA.id));
		expect(anchorAAfter.tPosition).toBeCloseTo(2.5, 9);
		expect(eventAAfter.tPosition).toBeCloseTo(2.5, 9);

		// User B's anchor + event UNTOUCHED. This is the cross-user invariant.
		const [anchorBAfter] = await db
			.select()
			.from(mapAnchors)
			.where(eq(mapAnchors.id, anchorB.id));
		const [eventBAfter] = await db
			.select()
			.from(mapEvents)
			.where(eq(mapEvents.id, eventB.id));
		expect(anchorBAfter.tPosition).toBe(T_INITIAL);
		expect(eventBAfter.tPosition).toBe(T_INITIAL);

		// Sanity: User B's acts are also unchanged. (Confirms we didn't bleed
		// into User B's entities table either.)
		const userBActs = await db
			.select()
			.from(entities)
			.where(and(eq(entities.userId, userB.id), eq(entities.type, 'Act')));
		expect(userBActs.find((a) => a.id === actsB.act0)?.position).toBe(0);
		expect(userBActs.find((a) => a.id === actsB.act1)?.position).toBe(1);
		expect(userBActs.find((a) => a.id === actsB.act2)?.position).toBe(2);
	});

	it('swapping two acts with anchors at identical fractional offsets does not violate the unique index', async () => {
		// Regression for the P1 Codex flagged on PR #52 (commit 23077b60):
		// per-row UPDATE map_anchors during a reorder violates the
		// (world_map_id, t_position) UNIQUE index when two anchors swap slots.
		// Two anchors at t=1.5 (Act 1) and t=2.5 (Act 2) after a 1↔2 swap are
		// each destined for the other's current value; a row-by-row UPDATE to
		// the final value trips the unique index on the first write. The fix
		// is a two-phase write — park then place. This test fails against the
		// pre-fix code and passes against the fix.
		const user = await seedTestUser(db, { email: 'swap@test.com' });
		const acts = await seedActs(db, user.id);
		const [map] = await db
			.insert(worldMaps)
			.values({ userId: user.id, name: 'Swap Map' })
			.returning();
		const [anchorAct1] = await db
			.insert(mapAnchors)
			.values({
				worldMapId: map.id,
				tPosition: 1.5,
				stateJsonb: { regions: [], artifacts: [], chains: [], tag: 'act1' }
			})
			.returning();
		const [anchorAct2] = await db
			.insert(mapAnchors)
			.values({
				worldMapId: map.id,
				tPosition: 2.5,
				stateJsonb: { regions: [], artifacts: [], chains: [], tag: 'act2' }
			})
			.returning();

		// Swap act1 (was at 1) with act2 (was at 2).
		const preSnapshot = await snapshotActOrdering(db, user.id);
		await db
			.update(entities)
			.set({ position: 1 })
			.where(and(eq(entities.id, acts.act2), eq(entities.userId, user.id)));
		await db
			.update(entities)
			.set({ position: 2 })
			.where(and(eq(entities.id, acts.act1), eq(entities.userId, user.id)));

		// Pre-fix this throws "duplicate key value violates unique constraint
		// map_anchors_world_map_id_t_position_uniq" and the entire cascade
		// rolls back. Post-fix it completes cleanly.
		await expect(recomputeAllIntervals(db, user.id, preSnapshot)).resolves.not.toThrow();

		// Verify both anchors landed at their swapped final positions.
		// anchorAct1: oldIdx=1 → act1 → newIdx=2 → t=2.5
		// anchorAct2: oldIdx=2 → act2 → newIdx=1 → t=1.5
		const [a1After] = await db
			.select()
			.from(mapAnchors)
			.where(eq(mapAnchors.id, anchorAct1.id));
		const [a2After] = await db
			.select()
			.from(mapAnchors)
			.where(eq(mapAnchors.id, anchorAct2.id));
		expect(a1After.tPosition).toBeCloseTo(2.5, 9);
		expect(a2After.tPosition).toBeCloseTo(1.5, 9);
		// And the unique index is intact (no row got parked at ANCHOR_PARK_OFFSET).
		const allAfter = await db.select().from(mapAnchors).where(eq(mapAnchors.worldMapId, map.id));
		expect(allAfter.every((r) => Math.abs(r.tPosition) < 1e10)).toBe(true);
	});

	it('deleting an Act drops anchors in that Act and reprojects later-Act anchors without collision', async () => {
		// Regression for the P1 Codex flagged on PR #52 commit a9c550f
		// (line 637): during Act deletion, an anchor at t=1.5 in the deleted
		// Act 1 was left at t=1.5 by the old "skip" branch. A later-Act
		// anchor at t=2.5 in Act 2 shifts down to t=1.5 (Act 2 → newIdx=1
		// after the delete). Both targeting t=1.5 → UNIQUE index collision
		// → cascade transaction aborts. The fix: pre-pass DELETEs anchors
		// whose Act no longer exists, vacating the slot before phase 2.
		const user = await seedTestUser(db, { email: 'del@test.com' });
		const acts = await seedActs(db, user.id);
		const [map] = await db
			.insert(worldMaps)
			.values({ userId: user.id, name: 'Delete Map' })
			.returning();
		const [anchorInDeletedAct] = await db
			.insert(mapAnchors)
			.values({
				worldMapId: map.id,
				tPosition: 1.5,
				stateJsonb: { regions: [], artifacts: [], chains: [], tag: 'in-deleted-act' }
			})
			.returning();
		const [anchorInLaterAct] = await db
			.insert(mapAnchors)
			.values({
				worldMapId: map.id,
				tPosition: 2.5,
				stateJsonb: { regions: [], artifacts: [], chains: [], tag: 'in-later-act' }
			})
			.returning();

		// Simulate Act 1 delete: snapshot first, then drop the row, then
		// recompute against the now-shifted ordering.
		const preSnapshot = await snapshotActOrdering(db, user.id);
		await db
			.delete(entities)
			.where(and(eq(entities.id, acts.act1), eq(entities.userId, user.id)));
		// Shift Act 2 down to position 1 (matches what the entity DELETE
		// cascade in the route handler does implicitly via the recompute).
		await db
			.update(entities)
			.set({ position: 1 })
			.where(and(eq(entities.id, acts.act2), eq(entities.userId, user.id)));

		await expect(recomputeAllIntervals(db, user.id, preSnapshot)).resolves.not.toThrow();

		// anchorInDeletedAct dropped.
		const deletedRow = await db
			.select()
			.from(mapAnchors)
			.where(eq(mapAnchors.id, anchorInDeletedAct.id));
		expect(deletedRow).toHaveLength(0);

		// anchorInLaterAct survives, reprojected to t=1.5 (Act 2 shifted to idx 1, frac 0.5).
		const [survivor] = await db
			.select()
			.from(mapAnchors)
			.where(eq(mapAnchors.id, anchorInLaterAct.id));
		expect(survivor.tPosition).toBeCloseTo(1.5, 9);
	});

	it('inserting an Act between existing Acts reprojects map_anchor t_position via POST handler', async () => {
		// Regression for the P1 Codex flagged on PR #52 commit a9c550f
		// (line 433): POST /api/entities calls recomputeAllIntervals
		// WITHOUT preSnapshot on insert-between flows, so intervals get
		// rewritten but map_anchors are silently skipped. World-map history
		// drifts: an anchor in old Act 1 keeps t=1.5 even though Act 1's
		// new index is now 2 after a new Act was inserted at position 1.
		const { POST } = await import('../../src/routes/api/entities/+server.js');
		const user = await seedTestUser(db, { email: 'insert@test.com' });
		const acts = await seedActs(db, user.id);
		const [map] = await db
			.insert(worldMaps)
			.values({ userId: user.id, name: 'Insert Map' })
			.returning();
		const [anchor] = await db
			.insert(mapAnchors)
			.values({
				worldMapId: map.id,
				tPosition: 1.5,
				stateJsonb: { regions: [], artifacts: [], chains: [], tag: 'in-act1' }
			})
			.returning();

		// Call POST /api/entities directly to insert a new Act at position 1.
		// Old Act 1 (at oldIdx=1) shifts to newIdx=2; the anchor at t=1.5
		// should reproject to t=2.5.
		// Minimal RequestEvent shape — same pattern as tests/integration/api-entities.test.ts.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const event: any = {
			url: new URL('http://localhost/api/entities'),
			params: {},
			request: {
				json: async () => ({ type: 'Act', name: 'Inserted Act', position: 1 })
			},
			locals: {
				db,
				user: { id: user.id, name: 'X', email: 'x@x.com', emailVerified: true },
				session: {
					id: crypto.randomUUID(),
					userId: user.id,
					expiresAt: new Date(Date.now() + 86400000),
					token: 't'
				}
			}
		};
		const res = await POST(event);
		expect(res.status).toBe(201);

		const [anchorAfter] = await db
			.select()
			.from(mapAnchors)
			.where(eq(mapAnchors.id, anchor.id));
		expect(anchorAfter.tPosition).toBeCloseTo(2.5, 9);

		// Sanity: original Act 1's new position is 2.
		const [act1After] = await db
			.select()
			.from(entities)
			.where(and(eq(entities.id, acts.act1), eq(entities.userId, user.id)));
		expect(act1After.position).toBe(2);
	});
});
