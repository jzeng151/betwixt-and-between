/**
 * WM3 Slice 5 PR-B — EventChain scope model (D3 / ADR 0006).
 *
 * Verifies that "scene-equality" visibility for a `caused_by` edge needs NO new
 * schema: authoring start_scene === end_scene === sceneX yields the position
 * window [sceneX.start, sceneX.end), and the existing `isEdgeVisibleAtT`
 * predicate already gates the edge to exactly that scene. Also proves the
 * window survives `recomputeAllIntervals` on an Act reorder (the boundaries
 * re-derive from the scene FKs, not from frozen positions).
 *
 * Scene math: an Act at index i spans [i, i+1). With 3 scenes under it, the
 * middle scene (index 1) spans [i + 1/3, i + 2/3).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, seedTestUser } from '../helpers/test-db.js';
import { entities, relationships } from '../../src/lib/server/db/schema.js';
import {
	recomputeAllIntervals,
	recomputeIntervalsForAct,
	resolveRelationshipBounds
} from '../../src/lib/server/intervals.js';
import { isEdgeVisibleAtT } from '../../src/lib/features/timeline/playhead-store.js';

type Db = Awaited<ReturnType<typeof createTestDb>>;

describe('EventChain scope — scene-equality via caused_by (Slice 5 PR-B / D3)', () => {
	let db: Db;
	let userId: string;
	let act0: string;
	let act1: string;
	let scene0: string; // first scene under act0 → [0, 1/3) at act index 0
	let scene1: string; // middle scene under act0 → [1/3, 2/3) at act index 0
	let cause: string;
	let effect: string;

	beforeEach(async () => {
		db = await createTestDb();
		userId = (await seedTestUser(db)).id;

		[act0, act1] = (
			await db
				.insert(entities)
				.values([
					{ userId, type: 'Act', name: 'Act 0', position: 0 },
					{ userId, type: 'Act', name: 'Act 1', position: 1 }
				])
				.returning()
		).map((a) => a.id);

		// 3 scenes under act0 so the middle scene is a non-trivial third.
		const scenes = await db
			.insert(entities)
			.values([
				{ userId, type: 'Scene', name: 'S0', parentId: act0, position: 0 },
				{ userId, type: 'Scene', name: 'S1', parentId: act0, position: 1 },
				{ userId, type: 'Scene', name: 'S2', parentId: act0, position: 2 }
			])
			.returning();
		scene0 = scenes[0].id;
		scene1 = scenes[1].id;

		// caused_by connects Event → Event (effect ← cause).
		const evs = await db
			.insert(entities)
			.values([
				{ userId, type: 'Event', name: 'Cause' },
				{ userId, type: 'Event', name: 'Effect' }
			])
			.returning();
		cause = evs[0].id;
		effect = evs[1].id;
	});

	async function scopeToScene1(): Promise<string> {
		const bounds = await resolveRelationshipBounds(
			db,
			{ startActId: act0, startSceneId: scene1, endActId: act0, endSceneId: scene1 },
			userId
		);
		const [rel] = await db
			.insert(relationships)
			.values({
				userId,
				fromId: effect,
				toId: cause,
				type: 'caused_by',
				startActId: act0,
				startSceneId: scene1,
				endActId: act0,
				endSceneId: scene1,
				startPosition: bounds.startPosition,
				endPosition: bounds.endPosition
			})
			.returning();
		return rel.id;
	}

	it('start=end=sceneX yields the scene window and is visible iff t in [start, end)', async () => {
		const relId = await scopeToScene1();
		const [rel] = await db.select().from(relationships).where(eq(relationships.id, relId));

		// Act 0 spans [0,1); middle of 3 scenes → [1/3, 2/3).
		expect(rel.startPosition).toBeCloseTo(1 / 3, 9);
		expect(rel.endPosition).toBeCloseTo(2 / 3, 9);

		// "Visible only while the playhead is inside scene 1."
		expect(isEdgeVisibleAtT(rel, 0.5)).toBe(true); // inside scene 1
		expect(isEdgeVisibleAtT(rel, 0.2)).toBe(false); // scene 0
		expect(isEdgeVisibleAtT(rel, 0.8)).toBe(false); // scene 2
		expect(isEdgeVisibleAtT(rel, 1 / 3)).toBe(true); // start inclusive
		expect(isEdgeVisibleAtT(rel, 2 / 3)).toBe(false); // end exclusive
		expect(isEdgeVisibleAtT(rel, null)).toBe(true); // scrubber idle
	});

	it('scene-equality window survives recomputeAllIntervals on an Act reorder', async () => {
		const relId = await scopeToScene1();

		// Swap: act0 → index 1, act1 → index 0. Scene 1 stays under act0, so its
		// window must re-derive to [1 + 1/3, 1 + 2/3) = [4/3, 5/3).
		await db.update(entities).set({ position: 1 }).where(eq(entities.id, act0));
		await db.update(entities).set({ position: 0 }).where(eq(entities.id, act1));

		await recomputeAllIntervals(db, userId);

		const [rel] = await db.select().from(relationships).where(eq(relationships.id, relId));
		expect(rel.startPosition).toBeCloseTo(1 + 1 / 3, 9);
		expect(rel.endPosition).toBeCloseTo(1 + 2 / 3, 9);

		// Visibility tracks the moved scene: now visible at 1.5, not at the old 0.5.
		expect(isEdgeVisibleAtT(rel, 1.5)).toBe(true);
		expect(isEdgeVisibleAtT(rel, 0.5)).toBe(false);
	});

	it('scene reorder WITHIN an act refreshes the caused_by window via recomputeIntervalsForAct', async () => {
		// Regression for the cross-model adversarial finding (Slice 5 ship): a
		// scene-within-act mutation calls recomputeIntervalsForAct, which prior
		// to the fix refreshed intervals + placements but NOT scene-anchored
		// relationships — leaving caused_by.start_position stale. Since PR-D
		// wires that position to a user-facing jump-to-cause click, a stale
		// value silently scrubbed the playhead to the wrong story-time.
		const relId = await scopeToScene1();

		// Sanity: middle of 3 scenes under act 0 → [1/3, 2/3).
		{
			const [rel] = await db.select().from(relationships).where(eq(relationships.id, relId));
			expect(rel.startPosition).toBeCloseTo(1 / 3, 9);
			expect(rel.endPosition).toBeCloseTo(2 / 3, 9);
		}

		// Reorder S1 to the front of act 0 (index 0). No Act index changes, so
		// the route would call recomputeIntervalsForAct(act0), not recomputeAll.
		await db.update(entities).set({ position: 0 }).where(eq(entities.id, scene1));
		await db.update(entities).set({ position: 1 }).where(eq(entities.id, scene0));

		await recomputeIntervalsForAct(db, act0, userId);

		// S1 is now the first of 3 scenes → window re-derives to [0, 1/3).
		const [rel] = await db.select().from(relationships).where(eq(relationships.id, relId));
		expect(rel.startPosition).toBeCloseTo(0, 9);
		expect(rel.endPosition).toBeCloseTo(1 / 3, 9);

		// Jump-to-cause would now scrub to the correct new position, not the stale 1/3.
		expect(isEdgeVisibleAtT(rel, 0.1)).toBe(true); // inside the moved window
		expect(isEdgeVisibleAtT(rel, 0.5)).toBe(false); // old window, no longer visible
	});
});
