/**
 * Integration tests for `moveSceneToAct(db, sceneId, newActId, newPosition, userId)` —
 * Decision T3-pulled-in (locked 2026-04-29 in /plan-eng-review).
 *
 * Behavior:
 *   - Updates the scene's parent_id and position.
 *   - Updates intervals where start_scene_id = thisScene → start_act_id = newActId.
 *   - Updates intervals where end_scene_id   = thisScene → end_act_id   = newActId.
 *   - recomputeIntervalsForAct fires for BOTH the OLD parent and the NEW parent
 *     (composition changed in both).
 *   - Atomic in db.transaction.
 *   - Rejects newActId that doesn't exist or isn't an Act.
 *   - Position cascade in the target act: existing scenes at position >=
 *     newPosition get bumped.
 *
 * Tests are RED until the implementation lands.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { eq, and, asc } from 'drizzle-orm';
import { createTestDb, seedActs, seedTestUser } from '../helpers/test-db.js';
import { entities, intervals } from '../../src/lib/server/db/schema.js';
import { writeInterval, moveSceneToAct } from '../../src/lib/server/intervals.js';

type Db = Awaited<ReturnType<typeof createTestDb>>;

describe('moveSceneToAct — T3-pulled-in', () => {
	let db: Db;
	let userId: string;
	let acts: { act0: string; act1: string; act2: string };
	let ellie: string;

	beforeEach(async () => {
		db = await createTestDb();
		const _user = await seedTestUser(db);
		userId = _user.id;
		acts = await seedActs(db, userId);
		const [c] = await db
			.insert(entities)
			.values({ userId, type: 'Character', name: 'Ellie' })
			.returning();
		ellie = c.id;
	});

	it("updates the scene's parent_id and position", async () => {
		const [s] = await db
			.insert(entities)
			.values({ userId, type: 'Scene', name: 'S', parentId: acts.act1, position: 0 })
			.returning();

		await moveSceneToAct(db, s.id, acts.act2, 0, userId);

		const [moved] = await db.select().from(entities).where(eq(entities.id, s.id));
		expect(moved.parentId).toBe(acts.act2);
		expect(moved.position).toBe(0);
	});

	it('updates start_act_id on intervals where start_scene_id = thisScene', async () => {
		const [s] = await db
			.insert(entities)
			.values({ userId, type: 'Scene', name: 'S', parentId: acts.act1, position: 0 })
			.returning();

		// Ellie anchored at scene s on both ends.
		await writeInterval(db, {
			entityId: ellie,
			startActId: acts.act1,
			startSceneId: s.id,
			endActId: acts.act1,
			endSceneId: s.id
		}, userId);

		await moveSceneToAct(db, s.id, acts.act2, 0, userId);

		const [row] = await db.select().from(intervals);
		expect(row.startActId).toBe(acts.act2);
		expect(row.startSceneId).toBe(s.id);
	});

	it('re-anchors scene-scoped relationships across the move (no parent/act mismatch throw)', async () => {
		// Slice 5 PR-D / Codex P1. recomputeIntervalsForAct now walks scene-scoped
		// relationships, and computeIntervalPositions throws if a scene's parent
		// act != the relationship's start/end_act_id. moveSceneToAct must rewrite
		// the relationship act FKs (like it does for intervals/placements) so the
		// caused_by edge survives the cross-act move and recomputes cleanly.
		const { relationships } = await import('../../src/lib/server/db/schema.js');
		const [bob] = await db.insert(entities).values({ userId, type: 'Character', name: 'Bob' }).returning();
		const [s] = await db
			.insert(entities)
			.values({ userId, type: 'Scene', name: 'S', parentId: acts.act1, position: 0 })
			.returning();

		// caused_by scoped to scene s on both ends, anchored to act1.
		await db.insert(relationships).values({ userId,
			fromId: ellie,
			toId: bob.id,
			type: 'caused_by',
			startActId: acts.act1,
			startSceneId: s.id,
			endActId: acts.act1,
			endSceneId: s.id,
			startPosition: 1 + 0,
			endPosition: 1 + 1
		});

		// Must not throw (a throw aborts the scene move).
		await expect(moveSceneToAct(db, s.id, acts.act2, 0, userId)).resolves.toBeUndefined();

		const [rel] = await db.select().from(relationships).where(eq(relationships.fromId, ellie));
		expect(rel.startActId).toBe(acts.act2);
		expect(rel.endActId).toBe(acts.act2);
		expect(rel.startSceneId).toBe(s.id);
		expect(rel.endSceneId).toBe(s.id);
		// act2 is index 2 → scene (sole scene of act2) occupies [2, 3).
		expect(rel.startPosition).toBeCloseTo(2.0, 9);
		expect(rel.endPosition).toBeCloseTo(3.0, 9);
	});

	it('updates end_act_id on intervals where end_scene_id = thisScene', async () => {
		const [sStart] = await db
			.insert(entities)
			.values({ userId, type: 'Scene', name: 'SStart', parentId: acts.act1, position: 0 })
			.returning();
		const [sEnd] = await db
			.insert(entities)
			.values({ userId, type: 'Scene', name: 'SEnd', parentId: acts.act1, position: 1 })
			.returning();

		await writeInterval(db, {
			entityId: ellie,
			startActId: acts.act1,
			startSceneId: sStart.id,
			endActId: acts.act1,
			endSceneId: sEnd.id
		}, userId);

		// Move ONLY sEnd to act2.
		await moveSceneToAct(db, sEnd.id, acts.act2, 0, userId);

		const [row] = await db.select().from(intervals);
		expect(row.startActId).toBe(acts.act1);
		expect(row.startSceneId).toBe(sStart.id);
		expect(row.endActId).toBe(acts.act2);
		expect(row.endSceneId).toBe(sEnd.id);
	});

	it('recompute fires for BOTH old and new parent (composition changed in both)', async () => {
		// Plant scenes such that both old and new parent acts have other scenes
		// whose interval-positions depend on m.
		const [s0Old] = await db
			.insert(entities)
			.values({ userId, type: 'Scene', name: 'OldS0', parentId: acts.act1, position: 0 })
			.returning();
		const [sMove] = await db
			.insert(entities)
			.values({ userId, type: 'Scene', name: 'Mover', parentId: acts.act1, position: 1 })
			.returning();

		// One existing scene in target act2.
		const [s0New] = await db
			.insert(entities)
			.values({ userId, type: 'Scene', name: 'NewS0', parentId: acts.act2, position: 0 })
			.returning();

		// Interval anchored to s0Old (still in act1 after the move).
		await writeInterval(db, {
			entityId: ellie,
			startActId: acts.act1,
			startSceneId: s0Old.id,
			endActId: acts.act1,
			endSceneId: s0Old.id
		}, userId);
		// Interval anchored to s0New (still in act2 after the move).
		const [damienE] = await db
			.insert(entities)
			.values({ userId, type: 'Character', name: 'Damien' })
			.returning();
		await writeInterval(db, {
			entityId: damienE.id,
			startActId: acts.act2,
			startSceneId: s0New.id,
			endActId: acts.act2,
			endSceneId: s0New.id
		}, userId);

		// Baseline:
		//   act1 has 2 scenes (m=2): s0Old → [1.0, 1.5).
		//   act2 has 1 scene  (m=1): s0New → [2.0, 3.0).
		const baseline = await db
			.select()
			.from(intervals)
			.orderBy(asc(intervals.startPosition));
		expect(baseline[0].startPosition).toBeCloseTo(1.0, 9);
		expect(baseline[0].endPosition).toBeCloseTo(1.5, 9);
		expect(baseline[1].startPosition).toBeCloseTo(2.0, 9);
		expect(baseline[1].endPosition).toBeCloseTo(3.0, 9);

		// Move sMove from act1 → act2 at position 0 (target's existing s0New
		// bumps to position 1).
		await moveSceneToAct(db, sMove.id, acts.act2, 0, userId);

		// Old parent recomputed: act1 m=1 → s0Old → [1.0, 2.0).
		// New parent recomputed: act2 m=2 → sMove at k=0 → [2.0, 2.5);
		//                                   s0New now at k=1 → [2.5, 3.0).
		const after = await db
			.select()
			.from(intervals)
			.orderBy(asc(intervals.startPosition));

		const ellieRow = after.find((r) => r.entityId === ellie);
		const damienRow = after.find((r) => r.entityId === damienE.id);
		expect(ellieRow?.startPosition).toBeCloseTo(1.0, 9);
		expect(ellieRow?.endPosition).toBeCloseTo(2.0, 9);
		expect(damienRow?.startPosition).toBeCloseTo(2.5, 9);
		expect(damienRow?.endPosition).toBeCloseTo(3.0, 9);
	});

	it('atomic in db.transaction: failure rolls back parent_id update', async () => {
		const [s] = await db
			.insert(entities)
			.values({ userId, type: 'Scene', name: 'S', parentId: acts.act1, position: 0 })
			.returning();

		// Pass an invalid newActId — should throw without persisting parent_id.
		await expect(
			moveSceneToAct(db, s.id, 'no-such-act', 0, userId)
		).rejects.toThrow();

		const [unchanged] = await db.select().from(entities).where(eq(entities.id, s.id));
		expect(unchanged.parentId).toBe(acts.act1);
		expect(unchanged.position).toBe(0);
	});

	it('rejects when newActId points to a non-Act entity', async () => {
		const [s] = await db
			.insert(entities)
			.values({ userId, type: 'Scene', name: 'S', parentId: acts.act1, position: 0 })
			.returning();

		await expect(
			moveSceneToAct(db, s.id, ellie, 0, userId) // ellie is a Character
		).rejects.toThrow();
	});

	it('position cascade: existing scenes at position >= newPosition get bumped', async () => {
		// 3 existing scenes in act2 (positions 0, 1, 2).
		const [tA] = await db
			.insert(entities)
			.values({ userId, type: 'Scene', name: 'TA', parentId: acts.act2, position: 0 })
			.returning();
		const [tB] = await db
			.insert(entities)
			.values({ userId, type: 'Scene', name: 'TB', parentId: acts.act2, position: 1 })
			.returning();
		const [tC] = await db
			.insert(entities)
			.values({ userId, type: 'Scene', name: 'TC', parentId: acts.act2, position: 2 })
			.returning();

		const [sMove] = await db
			.insert(entities)
			.values({ userId, type: 'Scene', name: 'Mover', parentId: acts.act1, position: 0 })
			.returning();

		// Insert at position 1 in act2 — tB and tC should bump.
		await moveSceneToAct(db, sMove.id, acts.act2, 1, userId);

		const inAct2 = await db
			.select()
			.from(entities)
			.where(and(eq(entities.type, 'Scene'), eq(entities.parentId, acts.act2)))
			.orderBy(asc(entities.position));
		expect(inAct2).toHaveLength(4);
		const map = new Map(inAct2.map((s) => [s.id, s.position]));
		expect(map.get(tA.id)).toBe(0);
		expect(map.get(sMove.id)).toBe(1);
		expect(map.get(tB.id)).toBe(2);
		expect(map.get(tC.id)).toBe(3);
	});

	it('rejects on non-existent sceneId', async () => {
		await expect(
			moveSceneToAct(db, 'no-such-scene', acts.act2, 0, userId)
		).rejects.toThrow();
	});

	// Characterization test for docs/findings/duplicate-act-on-cross-act-scene-move.md.
	// The QA-surfaced bug claims a phantom Act appears after a cross-act Scene move
	// via PATCH. moveSceneToAct only UPDATEs entities (never INSERTs), so if the bug
	// lives in this function we'd see act count grow here. If this stays green, the
	// bug must originate upstream (PATCH handler) or in something this calls into
	// (recomputeIntervalsForAct, map-placement updates).
	it('preserves the act count across a cross-act Scene move (finding repro)', async () => {
		// Mirror the finding's seed exactly: 3 Acts at positions 0/1/2.
		// The shared seedActs already gives us act0/act1/act2 at those positions.
		const [scene3] = await db
			.insert(entities)
			.values({ userId, type: 'Scene', name: 'Scene 3', parentId: acts.act1, position: 0 })
			.returning();
		await db.insert(entities).values({ userId, type: 'Scene', name: 'Scene 4', parentId: acts.act1, position: 1 });
		await db.insert(entities).values({ userId, type: 'Scene', name: 'Scene 5', parentId: acts.act2, position: 0 });
		await db.insert(entities).values({ userId, type: 'Scene', name: 'Scene 6', parentId: acts.act2, position: 1 });

		const actsBefore = await db
			.select()
			.from(entities)
			.where(and(eq(entities.userId, userId), eq(entities.type, 'Act')));
		expect(actsBefore).toHaveLength(3);

		// PATCH /api/entities/{Scene3.id} body {"parentId": Act III.id, "position": 2}
		// — equivalent direct call into moveSceneToAct.
		await moveSceneToAct(db, scene3.id, acts.act2, 2, userId);

		const actsAfter = await db
			.select()
			.from(entities)
			.where(and(eq(entities.userId, userId), eq(entities.type, 'Act')));
		expect(actsAfter).toHaveLength(3);
	});
});
