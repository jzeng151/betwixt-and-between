/**
 * Integration tests for POST /api/entities/batch — Decision D21 / Issue 20A
 * (locked 2026-04-29 in /plan-eng-review).
 *
 * Body: { entities: [{ type, name, parentId?, position?, data? }, ...] }
 *
 * Behavior:
 *   - All inserts in one db.transaction. If any fails, zero rows persist.
 *   - Returned ids preserve input order.
 *   - Validates each payload (missing name → 400 for the whole batch).
 *   - recomputeIntervalsForAct is called once per affected parent act
 *     (deduped, not N times).
 *
 * Tests are RED until the implementation lands.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { createTestDb, seedActs } from '../helpers/test-db.js';
import { entities, intervals } from '../../src/lib/server/db/schema.js';
import { writeInterval } from '../../src/lib/server/intervals.js';

let currentDb: ReturnType<typeof createTestDb>;

vi.mock('$lib/server/db/index.js', () => ({
	get db() {
		return currentDb;
	}
}));

const batchRoute = await import('../../src/routes/api/entities/batch/+server.js');

function mkEvent(overrides: { url?: URL; params?: Record<string, string>; body?: unknown } = {}): any {
	return {
		url: overrides.url ?? new URL('http://localhost/api/entities/batch'),
		params: overrides.params ?? {},
		request: {
			json: async () => overrides.body
		}
	};
}

async function readJson(res: Response): Promise<any> {
	return JSON.parse(await res.text());
}

describe('POST /api/entities/batch — atomic multi-entity creation (D21)', () => {
	let acts: { act0: string; act1: string; act2: string };

	beforeEach(async () => {
		currentDb = createTestDb();
		acts = await seedActs(currentDb);
	});

	it('happy path: 5 scenes inserted, returned in order with ids', async () => {
		const payload = {
			entities: [
				{ type: 'Scene', name: 'S0', parentId: acts.act1, position: 0 },
				{ type: 'Scene', name: 'S1', parentId: acts.act1, position: 1 },
				{ type: 'Scene', name: 'S2', parentId: acts.act1, position: 2 },
				{ type: 'Scene', name: 'S3', parentId: acts.act1, position: 3 },
				{ type: 'Scene', name: 'S4', parentId: acts.act1, position: 4 }
			]
		};
		const res = await batchRoute.POST(mkEvent({ body: payload }));
		expect(res.status).toBe(201);
		const body = await readJson(res);

		expect(Array.isArray(body)).toBe(true);
		expect(body).toHaveLength(5);
		expect(body.map((r: any) => r.name)).toEqual(['S0', 'S1', 'S2', 'S3', 'S4']);
		for (const r of body) expect(r.id).toBeTruthy();

		const persisted = await currentDb
			.select()
			.from(entities)
			.where(and(eq(entities.type, 'Scene'), eq(entities.parentId, acts.act1)));
		expect(persisted).toHaveLength(5);
	});

	it('validates each payload: any missing name → 400 with zero inserts', async () => {
		const beforeCount = (await currentDb.select().from(entities)).length;

		await expect(
			batchRoute.POST(
				mkEvent({
					body: {
						entities: [
							{ type: 'Scene', name: 'OK', parentId: acts.act1, position: 0 },
							{ type: 'Scene', name: '', parentId: acts.act1, position: 1 },
							{ type: 'Scene', name: 'Also OK', parentId: acts.act1, position: 2 }
						]
					}
				})
			)
		).rejects.toMatchObject({ status: 400 });

		const afterCount = (await currentDb.select().from(entities)).length;
		expect(afterCount).toBe(beforeCount);
	});

	it('atomic on FK violation: zero rows persist when any insert fails', async () => {
		const beforeCount = (await currentDb.select().from(entities)).length;

		await expect(
			batchRoute.POST(
				mkEvent({
					body: {
						entities: [
							{ type: 'Scene', name: 'S0', parentId: acts.act1, position: 0 },
							{
								type: 'Scene',
								name: 'Orphan',
								parentId: 'nonexistent-parent',
								position: 0
							}
						]
					}
				})
			)
		).rejects.toBeDefined();

		const afterCount = (await currentDb.select().from(entities)).length;
		expect(afterCount).toBe(beforeCount);
	});

	it('calls recomputeIntervalsForAct once per affected parent (deduped)', async () => {
		// Plant a scene-anchored interval in act1 BEFORE the batch — adding more
		// scenes changes m, so this interval's positions must shift.
		const [s0] = await currentDb
			.insert(entities)
			.values({ type: 'Scene', name: 'PreS0', parentId: acts.act1, position: 0 })
			.returning();
		const [ellie] = await currentDb
			.insert(entities)
			.values({ type: 'Character', name: 'Ellie' })
			.returning();
		await writeInterval(currentDb, {
			entityId: ellie.id,
			startActId: acts.act1,
			startSceneId: s0.id,
			endActId: acts.act1,
			endSceneId: s0.id
		});
		// Baseline: m=1, s0 → [1.0, 2.0).
		let [row] = await currentDb.select().from(intervals);
		expect(row.startPosition).toBeCloseTo(1.0, 9);
		expect(row.endPosition).toBeCloseTo(2.0, 9);

		// Insert 3 more scenes in act1 in one batch → m becomes 4.
		// All for the SAME parent → recompute should run exactly once for act1.
		await batchRoute.POST(
			mkEvent({
				body: {
					entities: [
						{ type: 'Scene', name: 'B1', parentId: acts.act1, position: 1 },
						{ type: 'Scene', name: 'B2', parentId: acts.act1, position: 2 },
						{ type: 'Scene', name: 'B3', parentId: acts.act1, position: 3 }
					]
				}
			})
		);

		// After batch: m=4 in act1. s0 is still scene index 0 → [1.0, 1.25).
		[row] = await currentDb.select().from(intervals);
		expect(row.startPosition).toBeCloseTo(1.0, 9);
		expect(row.endPosition).toBeCloseTo(1.25, 9);
	});

	it('heterogeneous batch: scenes for different acts handled correctly', async () => {
		const res = await batchRoute.POST(
			mkEvent({
				body: {
					entities: [
						{ type: 'Scene', name: 'A0', parentId: acts.act0, position: 0 },
						{ type: 'Scene', name: 'A1', parentId: acts.act1, position: 0 },
						{ type: 'Scene', name: 'A2', parentId: acts.act2, position: 0 }
					]
				}
			})
		);
		expect(res.status).toBe(201);
		const body = await readJson(res);
		expect(body).toHaveLength(3);

		const inAct0 = await currentDb
			.select()
			.from(entities)
			.where(and(eq(entities.type, 'Scene'), eq(entities.parentId, acts.act0)));
		expect(inAct0).toHaveLength(1);
		const inAct1 = await currentDb
			.select()
			.from(entities)
			.where(and(eq(entities.type, 'Scene'), eq(entities.parentId, acts.act1)));
		expect(inAct1).toHaveLength(1);
		const inAct2 = await currentDb
			.select()
			.from(entities)
			.where(and(eq(entities.type, 'Scene'), eq(entities.parentId, acts.act2)));
		expect(inAct2).toHaveLength(1);
	});

	it('empty batch returns empty array and persists nothing', async () => {
		const beforeCount = (await currentDb.select().from(entities)).length;
		const res = await batchRoute.POST(mkEvent({ body: { entities: [] } }));
		expect(res.status).toBe(201);
		const body = await readJson(res);
		expect(body).toEqual([]);
		const afterCount = (await currentDb.select().from(entities)).length;
		expect(afterCount).toBe(beforeCount);
	});

	it('rejects when entities field is missing or non-array', async () => {
		await expect(
			batchRoute.POST(mkEvent({ body: {} }))
		).rejects.toMatchObject({ status: 400 });

		await expect(
			batchRoute.POST(mkEvent({ body: { entities: 'oops' } }))
		).rejects.toMatchObject({ status: 400 });
	});

	it('rejects unknown entity type in batch with 400 (no rows persist)', async () => {
		const beforeCount = (await currentDb.select().from(entities)).length;
		await expect(
			batchRoute.POST(
				mkEvent({
					body: {
						entities: [
							{ type: 'Scene', name: 'OK', parentId: acts.act1, position: 0 },
							{ type: 'Dragon', name: 'Smaug' }
						]
					}
				})
			)
		).rejects.toMatchObject({ status: 400 });
		const afterCount = (await currentDb.select().from(entities)).length;
		expect(afterCount).toBe(beforeCount);
	});
});
