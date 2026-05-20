/**
 * Invariant test for the intervals table.
 *
 * Walks every row in `intervals` and asserts THREE invariants on each:
 *
 *   1. Polymorphic FK type alignment.
 *      start_act_id / end_act_id resolve to entities of type='Act'.
 *      start_scene_id / end_scene_id, when not NULL, resolve to type='Scene'.
 *      entity_id resolves to ANY entity (Character, Event, etc.).
 *
 *   2. Position-FK consistency for scene-anchored rows.
 *      Where a scene FK is set, the stored start_position / end_position MUST
 *      match what computeIntervalPositions(FKs) returns within POSITION_EPSILON.
 *
 *   3. Act-ordering consistency.
 *      For every row: floor(start_position) == act_index_of(start_act_id) AND
 *                     floor(end_position - epsilon) == act_index_of(end_act_id).
 *      This catches Act-ordering drift: the act_index lookup is what feeds
 *      computeIntervalPositions, so mismatches between stored positions and
 *      current Act ordering surface here.
 *
 * The test populates a small but realistic graph (3 Acts, scenes in Act 1,
 * 3 characters, 1 event, intervals across the worked examples from
 * docs/adr/0003-premise-4-position-math.md → "Worked examples"). It also
 * exercises the failure path: deliberately planted bad rows MUST be detected
 * by the invariants.
 *
 * In production, this same test runs against the real DB on every CI cycle
 * (configurable via DATABASE_URL).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, seedActs, seedTestUser } from '../helpers/test-db.js';
import { entities, intervals } from '../../src/lib/server/db/schema.js';
import {
	writeInterval,
	computeIntervalPositions,
	actIndexOf,
	POSITION_EPSILON
} from '../../src/lib/server/intervals.js';

type Db = Awaited<ReturnType<typeof createTestDb>>;

interface Violation {
	row: typeof intervals.$inferSelect;
	check: 'fk_type' | 'position_fk' | 'act_ordering';
	detail: string;
}

/**
 * Walk every interval, run the 3 checks, return violations.
 */
async function findViolations(db: Db, userId: string): Promise<Violation[]> {
	const violations: Violation[] = [];
	const rows = await db.select().from(intervals);

	for (const row of rows) {
		// Check 1: polymorphic FK type alignment
		const [entity] = await db
			.select({ id: entities.id, type: entities.type })
			.from(entities)
			.where(eq(entities.id, row.entityId));
		if (!entity) {
			violations.push({ row, check: 'fk_type', detail: `entity_id ${row.entityId} not found` });
			continue;
		}

		const [startAct] = await db
			.select({ id: entities.id, type: entities.type })
			.from(entities)
			.where(eq(entities.id, row.startActId));
		if (!startAct) {
			violations.push({
				row,
				check: 'fk_type',
				detail: `start_act_id ${row.startActId} not found`
			});
			continue;
		}
		if (startAct.type !== 'Act') {
			violations.push({
				row,
				check: 'fk_type',
				detail: `start_act_id ${row.startActId} has type='${startAct.type}', expected 'Act'`
			});
			// Skip remaining checks — they depend on Act-type FKs being valid.
			continue;
		}

		const [endAct] = await db
			.select({ id: entities.id, type: entities.type })
			.from(entities)
			.where(eq(entities.id, row.endActId));
		if (!endAct) {
			violations.push({
				row,
				check: 'fk_type',
				detail: `end_act_id ${row.endActId} not found`
			});
			continue;
		}
		if (endAct.type !== 'Act') {
			violations.push({
				row,
				check: 'fk_type',
				detail: `end_act_id ${row.endActId} has type='${endAct.type}', expected 'Act'`
			});
			continue;
		}

		if (row.startSceneId) {
			const [s] = await db
				.select({ type: entities.type })
				.from(entities)
				.where(eq(entities.id, row.startSceneId));
			if (!s || s.type !== 'Scene') {
				violations.push({
					row,
					check: 'fk_type',
					detail: `start_scene_id ${row.startSceneId} type='${s?.type ?? 'missing'}'`
				});
			}
		}
		if (row.endSceneId) {
			const [s] = await db
				.select({ type: entities.type })
				.from(entities)
				.where(eq(entities.id, row.endSceneId));
			if (!s || s.type !== 'Scene') {
				violations.push({
					row,
					check: 'fk_type',
					detail: `end_scene_id ${row.endSceneId} type='${s?.type ?? 'missing'}'`
				});
			}
		}

		// Check 2: position-FK consistency for scene-anchored rows
		if (row.startSceneId && row.endSceneId) {
			const derived = await computeIntervalPositions(db, {
				startActId: row.startActId,
				startSceneId: row.startSceneId,
				endActId: row.endActId,
				endSceneId: row.endSceneId
			}, userId);
			if (Math.abs(derived.startPosition - row.startPosition) > POSITION_EPSILON) {
				violations.push({
					row,
					check: 'position_fk',
					detail: `start_position ${row.startPosition} != derived ${derived.startPosition}`
				});
			}
			if (Math.abs(derived.endPosition - row.endPosition) > POSITION_EPSILON) {
				violations.push({
					row,
					check: 'position_fk',
					detail: `end_position ${row.endPosition} != derived ${derived.endPosition}`
				});
			}
		}

		// Check 3: act-ordering consistency
		const startActIdx = await actIndexOf(db, row.startActId, userId);
		const endActIdx = await actIndexOf(db, row.endActId, userId);
		if (Math.floor(row.startPosition) !== startActIdx) {
			violations.push({
				row,
				check: 'act_ordering',
				detail: `floor(start_position=${row.startPosition})=${Math.floor(
					row.startPosition
				)} != act_index_of(start_act_id)=${startActIdx}`
			});
		}
		// end_position can be exactly at a whole-number act boundary (exclusive end).
		// A row covering all of Act 1 has end=2.0; floor(2.0 - ε) = 1 which is the
		// act index of Act 1. So this floor matches end_act_id's index.
		const adjustedEnd = Math.floor(row.endPosition - 1e-12);
		if (adjustedEnd !== endActIdx) {
			violations.push({
				row,
				check: 'act_ordering',
				detail: `floor(end_position - ε=${row.endPosition})=${adjustedEnd} != act_index_of(end_act_id)=${endActIdx}`
			});
		}
	}
	return violations;
}

describe('intervals invariant: type alignment + position-FK consistency + act ordering', () => {
	let db: Db;
	let userId: string;
	let acts: { act0: string; act1: string; act2: string };

	beforeEach(async () => {
		db = await createTestDb();
		const _user = await seedTestUser(db);
		userId = _user.id;
		acts = await seedActs(db, userId);
	});

	it('clean DB has no violations', async () => {
		const violations = await findViolations(db, userId);
		expect(violations).toEqual([]);
	});

	it('all six worked-example rows are invariant-clean', async () => {
		const [ellie] = await db
			.insert(entities)
			.values({ userId, type: 'Character', name: 'Ellie' })
			.returning();
		const [damien] = await db
			.insert(entities)
			.values({ userId, type: 'Character', name: 'Damien' })
			.returning();
		const [marcus] = await db
			.insert(entities)
			.values({ userId, type: 'Character', name: 'Marcus' })
			.returning();
		const [scout] = await db
			.insert(entities)
			.values({ userId, type: 'Character', name: 'Scout' })
			.returning();
		const [battle] = await db
			.insert(entities)
			.values({ userId, type: 'Event', name: 'Battle of Three Rivers' })
			.returning();

		// 5 scenes in Act 1
		const a1scenes = [];
		for (let k = 0; k < 5; k++) {
			const [s] = await db
				.insert(entities)
				.values({ userId, type: 'Scene', name: `A1-S${k}`, parentId: acts.act1, position: k })
				.returning();
			a1scenes.push(s);
		}
		// 3 scenes in Act 2
		const a2scenes = [];
		for (let k = 0; k < 3; k++) {
			const [s] = await db
				.insert(entities)
				.values({ userId, type: 'Scene', name: `A2-S${k}`, parentId: acts.act2, position: k })
				.returning();
			a2scenes.push(s);
		}

		// (1) Ellie all of Act 1
		await writeInterval(db, { entityId: ellie.id, startActId: acts.act1, endActId: acts.act1 }, userId);
		// (2) Battle multi-act, Act 0 → Act 2 (no scene FKs, full extent)
		await writeInterval(db, { entityId: battle.id, startActId: acts.act0, endActId: acts.act2 }, userId);
		// (3) Scout-like — scene-anchored sub-range in Act 1.
		// Use a distinct entity so this doesn't overlap with row (1)'s Ellie
		// [1, 2); same-entity overlap is rejected by writeInterval per
		// /plan-eng-review resolutions item 1.2 (locked 2026-04-28).
		const [eve] = await db
			.insert(entities)
			.values({ userId, type: 'Character', name: 'Eve' })
			.returning();
		await writeInterval(db, {
			entityId: eve.id,
			startActId: acts.act1,
			startSceneId: a1scenes[1].id,
			endActId: acts.act1,
			endSceneId: a1scenes[3].id
		}, userId);
		// (4) Damien multi-act with scenes
		await writeInterval(db, {
			entityId: damien.id,
			startActId: acts.act0,
			startSceneId: undefined,
			endActId: acts.act2,
			endSceneId: a2scenes[1].id
		}, userId);
		// (5) Marcus full Act 0
		await writeInterval(db, { entityId: marcus.id, startActId: acts.act0, endActId: acts.act0 }, userId);
		// (6) Scout full Act 2
		await writeInterval(db, { entityId: scout.id, startActId: acts.act2, endActId: acts.act2 }, userId);

		const violations = await findViolations(db, userId);
		expect(violations).toEqual([]);
	});

	// =============================================================================
	// Negative tests — invariants MUST catch corruption
	// =============================================================================

	it('catches polymorphic FK violation (start_act_id pointing at Character)', async () => {
		const [ellie] = await db
			.insert(entities)
			.values({ userId, type: 'Character', name: 'Ellie' })
			.returning();
		// Plant a bad row directly. writeInterval would reject this; we go around it.
		await db.insert(intervals).values({
			userId,
			entityId: ellie.id,
			// Both act FKs point at a CHARACTER entity. SQLite doesn't enforce type.
			startActId: ellie.id,
			endActId: ellie.id,
			startPosition: 0,
			endPosition: 1
		});

		const violations = await findViolations(db, userId);
		expect(violations.some((v) => v.check === 'fk_type')).toBe(true);
		expect(violations.some((v) => v.detail.includes('Character'))).toBe(true);
	});

	it('catches position-FK drift on a scene-anchored row', async () => {
		const [ellie] = await db
			.insert(entities)
			.values({ userId, type: 'Character', name: 'Ellie' })
			.returning();
		const [s0] = await db
			.insert(entities)
			.values({ userId, type: 'Scene', name: 'S0', parentId: acts.act1, position: 0 })
			.returning();
		const [s1] = await db
			.insert(entities)
			.values({ userId, type: 'Scene', name: 'S1', parentId: acts.act1, position: 1 })
			.returning();

		// Plant a bad row: positions deliberately wrong for the FKs.
		// scene 0 of 2 in Act 1 should be [1.0, 1.5). We write [1.0, 1.7).
		await db.insert(intervals).values({
			userId,
			entityId: ellie.id,
			startActId: acts.act1,
			startSceneId: s0.id,
			endActId: acts.act1,
			endSceneId: s1.id, // s1 of 2 ends at 2.0
			startPosition: 1.0,
			endPosition: 1.7 // wrong; should be 2.0
		});

		const violations = await findViolations(db, userId);
		expect(violations.some((v) => v.check === 'position_fk')).toBe(true);
	});

	it('catches act-ordering drift after Act position changes (without recompute)', async () => {
		const [ellie] = await db
			.insert(entities)
			.values({ userId, type: 'Character', name: 'Ellie' })
			.returning();
		// Write a clean full-Act-1 interval.
		await writeInterval(db, { entityId: ellie.id, startActId: acts.act1, endActId: acts.act1 }, userId);
		// Now reorder Acts: swap Act 1 and Act 2 positions.
		await db.update(entities).set({ position: 2 }).where(eq(entities.id, acts.act1));
		await db.update(entities).set({ position: 1 }).where(eq(entities.id, acts.act2));
		// Without recomputeAllIntervals, the row's start_position=1.0 / end_position=2.0
		// no longer matches act_index_of(act1)=2.

		const violations = await findViolations(db, userId);
		expect(violations.some((v) => v.check === 'act_ordering')).toBe(true);
	});
});
