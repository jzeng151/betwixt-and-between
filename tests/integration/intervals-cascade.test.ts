/**
 * Cascade smoke tests — Reviewer Concern from design doc.
 *
 * "Delete an Act → intervals + scenes both vanish via cascade chains, no
 * orphaned rows. SQLite cascade order is fine in practice but worth a smoke
 * test in PR 1's migration verification step."
 *
 * The interactions worth confirming:
 *   1. Delete Character → all that character's intervals vanish (entity_id CASCADE).
 *   2. Delete Act → all intervals starting OR ending in it vanish (start_act_id /
 *      end_act_id CASCADE), AND all child Scenes vanish (parent_id CASCADE),
 *      AND any intervals anchored to those scenes get their scene_id SET to NULL
 *      first, then are CASCADE-deleted because of the act FK. Net: zero orphans.
 *   3. Delete Scene → intervals' start_scene_id / end_scene_id → SET NULL
 *      (the interval row stays, scene anchoring lost, position preserved
 *      until next recompute).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { eq, count } from 'drizzle-orm';
import { createTestDb, seedActs } from '../helpers/test-db.js';
import { entities, intervals } from '../../src/lib/server/db/schema.js';
import { writeInterval, recomputeAllIntervals } from '../../src/lib/server/intervals.js';

describe('cascade behavior on entity deletion', () => {
	let db: ReturnType<typeof createTestDb>;
	let acts: { act0: string; act1: string; act2: string };
	let ellie: string;
	let damien: string;

	beforeEach(async () => {
		db = createTestDb();
		acts = await seedActs(db);
		const [a] = await db
			.insert(entities)
			.values({ type: 'Character', name: 'Ellie' })
			.returning();
		ellie = a.id;
		const [b] = await db
			.insert(entities)
			.values({ type: 'Character', name: 'Damien' })
			.returning();
		damien = b.id;
	});

	it('deleting a Character deletes only their intervals', async () => {
		await writeInterval(db, { entityId: ellie, startActId: acts.act0, endActId: acts.act0 });
		await writeInterval(db, { entityId: ellie, startActId: acts.act1, endActId: acts.act1 });
		await writeInterval(db, { entityId: damien, startActId: acts.act2, endActId: acts.act2 });

		const [pre] = await db.select({ c: count() }).from(intervals);
		expect(pre.c).toBe(3);

		await db.delete(entities).where(eq(entities.id, ellie));

		const remaining = await db.select().from(intervals);
		expect(remaining).toHaveLength(1);
		expect(remaining[0].entityId).toBe(damien);
	});

	it('deleting an Act cascades to its intervals AND child scenes (no orphans)', async () => {
		// Act 1 has 3 scenes.
		const sceneIds: string[] = [];
		for (let k = 0; k < 3; k++) {
			const [s] = await db
				.insert(entities)
				.values({ type: 'Scene', name: `S${k}`, parentId: acts.act1, position: k })
				.returning();
			sceneIds.push(s.id);
		}

		// Ellie has a scene-anchored interval inside Act 1.
		await writeInterval(db, {
			entityId: ellie,
			startActId: acts.act1,
			startSceneId: sceneIds[0],
			endActId: acts.act1,
			endSceneId: sceneIds[2]
		});
		// Damien has a separate Act 2 interval (untouched).
		await writeInterval(db, { entityId: damien, startActId: acts.act2, endActId: acts.act2 });

		const [scenesPre] = await db
			.select({ c: count() })
			.from(entities)
			.where(eq(entities.parentId, acts.act1));
		expect(scenesPre.c).toBe(3);

		await db.delete(entities).where(eq(entities.id, acts.act1));

		// REGRESSION TEST — locked 2026-04-29 in /plan-eng-review per the iron
		// rule on regressions. Per Decision D1, the DELETE handler now fires
		// recompute after act delete; survivors must reflect the NEW act
		// ordering, not their pre-delete positions.
		await recomputeAllIntervals(db);

		// Scenes for Act 1 are gone (parent_id CASCADE).
		const [scenesPost] = await db
			.select({ c: count() })
			.from(entities)
			.where(eq(entities.parentId, acts.act1));
		expect(scenesPost.c).toBe(0);

		// Intervals touching Act 1 are gone. Damien's Act 2 row remains.
		const remaining = await db.select().from(intervals);
		expect(remaining).toHaveLength(1);
		expect(remaining[0].entityId).toBe(damien);

		// No orphans: every remaining interval references a still-extant act.
		for (const r of remaining) {
			const [a] = await db.select().from(entities).where(eq(entities.id, r.startActId));
			expect(a).toBeDefined();
		}

		// REGRESSION assertion: Damien's interval was originally Act 2 → [2, 3).
		// After Act 1 was deleted, original Act 2 is now at index 1 in the
		// global act ordering, so the interval's positions become [1, 2).
		// This tightens the previous "preserved (recompute would clear them;
		// that's a follow-up)" comment into an active check.
		expect(remaining[0].startPosition).toBeCloseTo(1.0, 9);
		expect(remaining[0].endPosition).toBeCloseTo(2.0, 9);
	});

	it('deleting a Scene SETs NULL on intervals scene FKs (interval row preserved)', async () => {
		const [s0] = await db
			.insert(entities)
			.values({ type: 'Scene', name: 'S0', parentId: acts.act1, position: 0 })
			.returning();
		const [s1] = await db
			.insert(entities)
			.values({ type: 'Scene', name: 'S1', parentId: acts.act1, position: 1 })
			.returning();

		await writeInterval(db, {
			entityId: ellie,
			startActId: acts.act1,
			startSceneId: s0.id,
			endActId: acts.act1,
			endSceneId: s1.id
		});

		await db.delete(entities).where(eq(entities.id, s0.id));

		const [row] = await db.select().from(intervals);
		expect(row).toBeDefined();
		expect(row.startSceneId).toBeNull();
		// s1 is still alive; end_scene_id should remain.
		expect(row.endSceneId).toBe(s1.id);
		// Position values are preserved by the cascade itself (SET NULL on
		// scene FK doesn't move positions). Per Decision D1 (locked 2026-04-29
		// in /plan-eng-review), the API DELETE handler orchestrates a recompute
		// after structural mutations; that orchestration is covered by the
		// act-delete regression block above and by api-entities-delete-reparent.
		expect(row.startPosition).toBeCloseTo(1.0, 9);
	});
});
