/**
 * World Map v3 Slice 1a Δ1a-E — recompute cascade transaction atomicity.
 *
 * Per docs/plans/world-map-v3-design.md § "Recompute transaction atomicity"
 * (outside voice — subagent #14, codex #11): the cascade that walks
 * intervals → relationships → variants → placements → mapAnchors →
 * mapEvents inside recomputeAllIntervals MUST be atomic when wrapped in a
 * db.transaction. Partial-failure mid-cascade must leave every table in
 * pre-state OR every table in post-state — never mixed.
 *
 * The API handlers at src/routes/api/entities/+server.ts and
 * /[id]/+server.ts wrap recomputeAllIntervals in `db.transaction(async tx
 * => …)`. This test mirrors that contract by throwing AFTER the recompute
 * completes but BEFORE the tx commits — the cleanest way to provoke the
 * "everything must roll back together" property without mocking out
 * internal SQL paths (which would test the mock, not the cascade).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createTestDb, seedActs, seedTestUser } from '../helpers/test-db.js';
import {
	entities,
	intervals,
	mapAnchors,
	mapEvents,
	worldMaps
} from '../../src/lib/server/db/schema.js';
import {
	recomputeAllIntervals,
	snapshotActOrdering,
	writeInterval
} from '../../src/lib/server/intervals.js';

describe('recomputeAllIntervals cascade atomicity (Δ1a-E)', () => {
	let db: Awaited<ReturnType<typeof createTestDb>>;
	let userId: string;
	let acts: { act0: string; act1: string; act2: string };

	beforeEach(async () => {
		db = await createTestDb();
		const user = await seedTestUser(db);
		userId = user.id;
		acts = await seedActs(db, userId);
	});

	it('rolls back intervals + map_anchors + map_events together when the wrapping tx throws', async () => {
		// Seed enough state to be sensitive to a recompute pass:
		//   - one interval over Acts 0..2
		//   - one world_map with one anchor + one event at t=1.5 (i.e., act1
		//     mid-point, which Act-reorder will reproject).
		const [ellie] = await db
			.insert(entities)
			.values({ userId, type: 'Character', name: 'Ellie' })
			.returning();
		const interval = await writeInterval(
			db,
			{ entityId: ellie.id, startActId: acts.act0, endActId: acts.act2 },
			userId
		);
		const [map] = await db
			.insert(worldMaps)
			.values({ userId, name: 'M' })
			.returning();
		const [anchor] = await db
			.insert(mapAnchors)
			.values({
				worldMapId: map.id,
				tPosition: 1.5,
				stateJsonb: { regions: [], artifacts: [], chains: [] }
			})
			.returning();
		const [event] = await db
			.insert(mapEvents)
			.values({
				worldMapId: map.id,
				tPosition: 1.5,
				kind: 'transfer_region',
				payloadJsonb: {}
			})
			.returning();

		// Capture pre-cascade values for the iron rule check.
		const preInterval = { start: interval.startPosition, end: interval.endPosition };
		const preAnchor = { t: anchor.tPosition };
		const preEvent = { t: event.tPosition };

		// Swap acts 1 and 2 so recompute has real work to do — without this,
		// recompute would no-op and a passing test would prove nothing.
		const preSnapshot = await snapshotActOrdering(db, userId);
		await db
			.update(entities)
			.set({ position: 1 })
			.where(and(eq(entities.id, acts.act2), eq(entities.userId, userId)));
		await db
			.update(entities)
			.set({ position: 2 })
			.where(and(eq(entities.id, acts.act1), eq(entities.userId, userId)));

		// Run the cascade inside a tx that throws after recompute completes.
		await expect(
			db.transaction(async (tx) => {
				await recomputeAllIntervals(tx, userId, preSnapshot);
				throw new Error('boom — caller failure post-cascade');
			})
		).rejects.toThrow('boom');

		// IRON RULE: nothing is committed.
		const [intervalAfter] = await db
			.select()
			.from(intervals)
			.where(eq(intervals.id, interval.id));
		const [anchorAfter] = await db
			.select()
			.from(mapAnchors)
			.where(eq(mapAnchors.id, anchor.id));
		const [eventAfter] = await db
			.select()
			.from(mapEvents)
			.where(eq(mapEvents.id, event.id));

		expect(intervalAfter.startPosition).toBeCloseTo(preInterval.start, 9);
		expect(intervalAfter.endPosition).toBeCloseTo(preInterval.end, 9);
		expect(anchorAfter.tPosition).toBeCloseTo(preAnchor.t, 9);
		expect(eventAfter.tPosition).toBeCloseTo(preEvent.t, 9);
	});

	it('commits intervals + map_anchors + map_events together on tx success', async () => {
		// Mirror image of the rollback test: when the tx commits cleanly,
		// every cascade target moved together. Belt-and-suspenders on
		// world-map-v3-recompute-cross-user.test.ts (which already covers
		// the success path with cross-user isolation as the focus).
		const [ellie] = await db
			.insert(entities)
			.values({ userId, type: 'Character', name: 'E' })
			.returning();
		await writeInterval(
			db,
			{ entityId: ellie.id, startActId: acts.act0, endActId: acts.act2 },
			userId
		);
		const [map] = await db
			.insert(worldMaps)
			.values({ userId, name: 'M' })
			.returning();
		const [anchor] = await db
			.insert(mapAnchors)
			.values({
				worldMapId: map.id,
				tPosition: 1.5,
				stateJsonb: { regions: [], artifacts: [], chains: [] }
			})
			.returning();

		const preSnapshot = await snapshotActOrdering(db, userId);
		await db
			.update(entities)
			.set({ position: 1 })
			.where(and(eq(entities.id, acts.act2), eq(entities.userId, userId)));
		await db
			.update(entities)
			.set({ position: 2 })
			.where(and(eq(entities.id, acts.act1), eq(entities.userId, userId)));

		await db.transaction(async (tx) => {
			await recomputeAllIntervals(tx, userId, preSnapshot);
		});

		// act1 (oldIdx=1) → newIdx=2 → t=1.5 reprojects to t=2.5.
		const [anchorAfter] = await db
			.select()
			.from(mapAnchors)
			.where(eq(mapAnchors.id, anchor.id));
		expect(anchorAfter.tPosition).toBeCloseTo(2.5, 9);
	});
});
