/**
 * Act-delete rescope tests — locked 2026-04-29 after manual report that
 * deleting an act removed (rather than rescoped) characters/events whose
 * interval touched the deleted act.
 *
 * Behavior:
 *   - Interval entirely within the deleted act → deleted (no salvage).
 *   - Interval ending in the deleted act → end clamped to end-of-prev-act.
 *   - Interval starting in the deleted act → start clamped to start-of-next.
 *   - Interval spanning multiple acts INCLUDING the deleted one (e.g. start
 *     in A, end in C, with B deleted) is unaffected by rescope (recompute
 *     handles index shift).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, seedActs, SCHEMA_DDL } from '../helpers/test-db.js';
import { entities, intervals } from '../../src/lib/server/db/schema.js';
import { writeInterval } from '../../src/lib/server/intervals.js';
import { eq } from 'drizzle-orm';

// Hit the real DELETE endpoint via SvelteKit handler import. We mock $lib/server/db
// to point at the in-memory test DB.
import { vi } from 'vitest';

let testDb: Awaited<ReturnType<typeof createTestDb>>;
vi.mock('$lib/server/db/index.js', () => ({
	get db() {
		return testDb;
	}
}));

const { DELETE } = await import('../../src/routes/api/entities/[id]/+server.js');

function makeEvent(path: string, params: Record<string, string>) {
	const fullUrl = `http://localhost${path}`;
	return {
		params,
		url: new URL(fullUrl),
		request: new Request(fullUrl, { method: 'DELETE' })
	} as Parameters<typeof DELETE>[0];
}

describe('act delete rescopes intervals instead of cascading', () => {
	let acts: { act0: string; act1: string; act2: string };
	let ellie: string;

	beforeEach(async () => {
		testDb = await createTestDb();
		acts = await seedActs(testDb);
		const [e] = await testDb
			.insert(entities)
			.values({ type: 'Character', name: 'Ellie' })
			.returning();
		ellie = e.id;
	});

	it('clamps endActId to prev-act when interval ends in the deleted (last) act', async () => {
		// Ellie spans A,B,C → endActId=C, deleted is C, expect endActId=B endPos=2
		await writeInterval(testDb, {
			entityId: ellie,
			startActId: acts.act0,
			endActId: acts.act2,
			startPosition: 0.5,
			endPosition: 2.7
		});

		await DELETE(makeEvent(`/api/entities/${acts.act2}`, { id: acts.act2 }));

		const remaining = await testDb.select().from(intervals);
		expect(remaining).toHaveLength(1);
		expect(remaining[0].endActId).toBe(acts.act1);
		expect(remaining[0].startPosition).toBeCloseTo(0.5, 9);
		expect(remaining[0].endPosition).toBeCloseTo(2, 9);
	});

	it('clamps startActId to next-act when interval starts in the deleted (first) act', async () => {
		// Ellie spans A,B → startActId=A, deleted=A, expect startActId=B startPos=0 (post-delete idx)
		await writeInterval(testDb, {
			entityId: ellie,
			startActId: acts.act0,
			endActId: acts.act1,
			startPosition: 0.3,
			endPosition: 1.6
		});

		await DELETE(makeEvent(`/api/entities/${acts.act0}`, { id: acts.act0 }));

		const remaining = await testDb.select().from(intervals);
		expect(remaining).toHaveLength(1);
		expect(remaining[0].startActId).toBe(acts.act1);
		// After delete, act1 is at idx 0. Recompute moves startPos to 0, endPos to (0 + oldFraction(1.6)).
		expect(remaining[0].startPosition).toBeCloseTo(0, 9);
		expect(remaining[0].endPosition).toBeCloseTo(0.6, 9);
	});

	it('deletes interval fully contained in the deleted act (no salvage)', async () => {
		await writeInterval(testDb, {
			entityId: ellie,
			startActId: acts.act1,
			endActId: acts.act1,
			startPosition: 1.2,
			endPosition: 1.8
		});

		await DELETE(makeEvent(`/api/entities/${acts.act1}`, { id: acts.act1 }));

		const remaining = await testDb.select().from(intervals);
		expect(remaining).toHaveLength(0);
	});

	it('clamps both ends when an interval starts AND ends are anchored to the same deleted act, but only one of them is the act (mixed case is impossible — sanity)', async () => {
		// Two intervals: one ends in deleted, one starts in deleted.
		await writeInterval(testDb, {
			entityId: ellie,
			startActId: acts.act0,
			endActId: acts.act2,
			startPosition: 0,
			endPosition: 2.5
		});
		const [d] = await testDb.insert(entities).values({ type: 'Character', name: 'D' }).returning();
		await writeInterval(testDb, {
			entityId: d.id,
			startActId: acts.act2,
			endActId: acts.act2,
			startPosition: 2.1,
			endPosition: 2.9
		});

		await DELETE(makeEvent(`/api/entities/${acts.act2}`, { id: acts.act2 }));

		const all = await testDb.select().from(intervals);
		expect(all).toHaveLength(1);
		expect(all[0].entityId).toBe(ellie);
		expect(all[0].endActId).toBe(acts.act1);
	});

	it('preserves interval spanning across the deleted middle act (not anchored to it)', async () => {
		// Ellie: startActId=A, endActId=C — neither end is in the deleted act B.
		await writeInterval(testDb, {
			entityId: ellie,
			startActId: acts.act0,
			endActId: acts.act2,
			startPosition: 0.5,
			endPosition: 2.5
		});

		await DELETE(makeEvent(`/api/entities/${acts.act1}`, { id: acts.act1 }));

		const remaining = await testDb.select().from(intervals);
		expect(remaining).toHaveLength(1);
		// After delete, act2 is at idx 1. Recompute: oldFraction(0.5)=0.5 → newEnd = 1+0.5 = 1.5
		expect(remaining[0].startPosition).toBeCloseTo(0.5, 9);
		expect(remaining[0].endPosition).toBeCloseTo(1.5, 9);
	});
});
