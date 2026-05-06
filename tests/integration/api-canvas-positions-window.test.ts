/**
 * Vitest integration tests for /api/canvas-positions/window/[windowId] and
 * /api/canvas-positions/window/[windowId]/batch handlers (Phase 1B Lane A).
 *
 * Covers per-window upsert semantics, cross-window isolation, FK cascade on
 * entity deletion, and batch-transaction atomicity (the C5 dagre-layout
 * guarantee that motivates A3).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb } from '../helpers/test-db.js';
import { entities, windowCanvasState } from '../../src/lib/server/db/schema.js';
import { eq } from 'drizzle-orm';

let currentDb: Awaited<ReturnType<typeof createTestDb>>;

vi.mock('$lib/server/db/index.js', () => ({
	getDb: async () => currentDb
}));

const route = await import(
	'../../src/routes/api/canvas-positions/window/[windowId]/+server.js'
);
const batchRoute = await import(
	'../../src/routes/api/canvas-positions/window/[windowId]/batch/+server.js'
);

function mkEvent(
	overrides: { params?: Record<string, string>; body?: unknown } = {}
): any {
	return {
		url: new URL('http://localhost/api/canvas-positions/window/x'),
		params: overrides.params ?? {},
		request: {
			json: async () => overrides.body
		}
	};
}

async function readJson(res: Response): Promise<any> {
	return JSON.parse(await res.text());
}

async function makeEntity(name = 'A'): Promise<string> {
	const [e] = await currentDb
		.insert(entities)
		.values({ type: 'Character', name })
		.returning();
	return e.id;
}

describe('/api/canvas-positions/window/[windowId] GET', () => {
	beforeEach(async () => {
		currentDb = await createTestDb();
	});

	it('returns empty array for a window with no rows', async () => {
		const res = await route.GET(mkEvent({ params: { windowId: 'win-1' } }));
		expect(await readJson(res)).toEqual([]);
	});

	it('returns inserted rows for the window', async () => {
		const entityId = await makeEntity();
		await route.PUT(
			mkEvent({
				params: { windowId: 'win-1' },
				body: { entityId, x: 10, y: 20, pinned: 1 }
			})
		);

		const res = await route.GET(mkEvent({ params: { windowId: 'win-1' } }));
		const body = await readJson(res);
		expect(body).toHaveLength(1);
		expect(body[0]).toMatchObject({ entityId, x: 10, y: 20, pinned: 1 });
	});
});

describe('/api/canvas-positions/window/[windowId] PUT', () => {
	let entityId: string;

	beforeEach(async () => {
		currentDb = await createTestDb();
		entityId = await makeEntity('Ellie');
	});

	it('inserts a new row when (windowId, entityId) is fresh', async () => {
		const res = await route.PUT(
			mkEvent({
				params: { windowId: 'win-1' },
				body: { entityId, x: 100, y: 200, width: 300, height: 150, pinned: 0 }
			})
		);
		const body = await readJson(res);
		expect(body).toMatchObject({
			windowId: 'win-1',
			entityId,
			x: 100,
			y: 200,
			width: 300,
			height: 150,
			pinned: 0
		});
	});

	it('upserts: second PUT for same (windowId, entityId) overwrites first', async () => {
		await route.PUT(
			mkEvent({ params: { windowId: 'win-1' }, body: { entityId, x: 1, y: 2 } })
		);
		await route.PUT(
			mkEvent({
				params: { windowId: 'win-1' },
				body: { entityId, x: 99, y: 88, pinned: 1 }
			})
		);

		const rows = await currentDb
			.select()
			.from(windowCanvasState)
			.where(eq(windowCanvasState.windowId, 'win-1'));
		expect(rows).toHaveLength(1);
		expect(rows[0].x).toBe(99);
		expect(rows[0].y).toBe(88);
		expect(rows[0].pinned).toBe(1);
	});

	it('coerces boolean pinned to integer 0/1 (Greptile P2)', async () => {
		// JSON clients commonly serialize boolean-feeling fields as true/false;
		// the integer storage shape is internal. Both should land as 1/0.
		await route.PUT(
			mkEvent({
				params: { windowId: 'win-1' },
				body: { entityId, x: 1, y: 2, pinned: true }
			})
		);
		const [row1] = await currentDb
			.select()
			.from(windowCanvasState)
			.where(eq(windowCanvasState.windowId, 'win-1'));
		expect(row1.pinned).toBe(1);

		await route.PUT(
			mkEvent({
				params: { windowId: 'win-1' },
				body: { entityId, x: 1, y: 2, pinned: false }
			})
		);
		const [row2] = await currentDb
			.select()
			.from(windowCanvasState)
			.where(eq(windowCanvasState.windowId, 'win-1'));
		expect(row2.pinned).toBe(0);
	});

	it('rejects malformed body with 400', async () => {
		await expect(
			route.PUT(mkEvent({ params: { windowId: 'win-1' }, body: null }))
		).rejects.toMatchObject({ status: 400 });
	});

	it('rejects non-uuid entityId with 400', async () => {
		await expect(
			route.PUT(
				mkEvent({
					params: { windowId: 'win-1' },
					body: { entityId: 'not-a-uuid', x: 1, y: 2 }
				})
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('rejects missing x/y with 400', async () => {
		await expect(
			route.PUT(mkEvent({ params: { windowId: 'win-1' }, body: { entityId } }))
		).rejects.toMatchObject({ status: 400 });
	});
});

describe('/api/canvas-positions/window/[windowId] DELETE', () => {
	beforeEach(async () => {
		currentDb = await createTestDb();
	});

	it('removes all rows for the windowId; rows for other windows untouched', async () => {
		const a = await makeEntity('A');
		const b = await makeEntity('B');
		await route.PUT(
			mkEvent({ params: { windowId: 'win-1' }, body: { entityId: a, x: 1, y: 1 } })
		);
		await route.PUT(
			mkEvent({ params: { windowId: 'win-1' }, body: { entityId: b, x: 2, y: 2 } })
		);
		await route.PUT(
			mkEvent({ params: { windowId: 'win-2' }, body: { entityId: a, x: 3, y: 3 } })
		);

		await route.DELETE(mkEvent({ params: { windowId: 'win-1' } }));

		const win1 = await currentDb
			.select()
			.from(windowCanvasState)
			.where(eq(windowCanvasState.windowId, 'win-1'));
		const win2 = await currentDb
			.select()
			.from(windowCanvasState)
			.where(eq(windowCanvasState.windowId, 'win-2'));

		expect(win1).toHaveLength(0);
		expect(win2).toHaveLength(1);
		expect(win2[0].entityId).toBe(a);
	});
});

describe('cross-window isolation', () => {
	beforeEach(async () => {
		currentDb = await createTestDb();
	});

	it('two windows with overlapping entityIds work independently', async () => {
		const a = await makeEntity('Shared');
		await route.PUT(
			mkEvent({ params: { windowId: 'win-1' }, body: { entityId: a, x: 10, y: 10 } })
		);
		await route.PUT(
			mkEvent({ params: { windowId: 'win-2' }, body: { entityId: a, x: 99, y: 99 } })
		);

		const res1 = await route.GET(mkEvent({ params: { windowId: 'win-1' } }));
		const res2 = await route.GET(mkEvent({ params: { windowId: 'win-2' } }));
		const body1 = await readJson(res1);
		const body2 = await readJson(res2);

		expect(body1).toHaveLength(1);
		expect(body2).toHaveLength(1);
		expect(body1[0].x).toBe(10);
		expect(body2[0].x).toBe(99);
	});

	it('two batch writes to different windows for the same entity stay isolated', async () => {
		// Concurrency-adjacent test: simulating the pattern where two FG
		// instances on the same focal set both run "Layout by type". Each
		// targets its own window endpoint; cross-window state must stay
		// independent. Per the locked plan: cross-window concurrent layout
		// is independent (per-window canvas means no cross-talk).
		const a = await makeEntity('A');
		const b = await makeEntity('B');

		// Both batches fire at "the same time" — Promise.all sequences them
		// against the same DB connection but the windowId discriminator means
		// no rows collide.
		await Promise.all([
			batchRoute.POST(
				mkEvent({
					params: { windowId: 'win-1' },
					body: [
						{ entityId: a, x: 1, y: 1 },
						{ entityId: b, x: 2, y: 2 }
					]
				})
			),
			batchRoute.POST(
				mkEvent({
					params: { windowId: 'win-2' },
					body: [
						{ entityId: a, x: 100, y: 100 },
						{ entityId: b, x: 200, y: 200 }
					]
				})
			)
		]);

		const win1 = await readJson(await route.GET(mkEvent({ params: { windowId: 'win-1' } })));
		const win2 = await readJson(await route.GET(mkEvent({ params: { windowId: 'win-2' } })));
		expect(win1).toHaveLength(2);
		expect(win2).toHaveLength(2);
		// Sort by entityId for deterministic ordering then compare.
		win1.sort((p: { entityId: string }, q: { entityId: string }) =>
			p.entityId.localeCompare(q.entityId)
		);
		win2.sort((p: { entityId: string }, q: { entityId: string }) =>
			p.entityId.localeCompare(q.entityId)
		);
		expect(win1.map((r: { x: number }) => r.x).sort()).toEqual([1, 2]);
		expect(win2.map((r: { x: number }) => r.x).sort()).toEqual([100, 200]);
	});

	it('pin in window A is unaffected by layout-by-type batch in window B (locked test plan)', async () => {
		// This is the per-window canvas isolation guarantee from the test plan
		// in TODOS.md. Layout-by-type writes to window B's batch endpoint MUST
		// NOT touch any rows in window A — pinned-stays-put is sacred per
		// CONSIDERATIONS T2A and crosses windows too.
		const shared = await makeEntity('Shared');

		// Pin in win-A at (10, 10)
		await route.PUT(
			mkEvent({
				params: { windowId: 'win-A' },
				body: { entityId: shared, x: 10, y: 10, pinned: 1 }
			})
		);

		// Layout-by-type batch in win-B writes the same entity at a totally
		// different position (no `pinned` set since the FG layout-by-type
		// writes pinned=0 for unpinned-in-this-window nodes).
		await batchRoute.POST(
			mkEvent({
				params: { windowId: 'win-B' },
				body: [{ entityId: shared, x: 500, y: 500, pinned: 0 }]
			})
		);

		// win-A's row must be untouched: same coords, still pinned.
		const winA = await readJson(await route.GET(mkEvent({ params: { windowId: 'win-A' } })));
		expect(winA).toHaveLength(1);
		expect(winA[0].x).toBe(10);
		expect(winA[0].y).toBe(10);
		expect(winA[0].pinned).toBe(1);

		// win-B's row reflects the layout write.
		const winB = await readJson(await route.GET(mkEvent({ params: { windowId: 'win-B' } })));
		expect(winB).toHaveLength(1);
		expect(winB[0].x).toBe(500);
		expect(winB[0].pinned).toBe(0);
	});
});

describe('cascade on entity delete', () => {
	beforeEach(async () => {
		currentDb = await createTestDb();
	});

	it('deletes window_canvas_state rows when the entity is deleted', async () => {
		const a = await makeEntity('Doomed');
		await route.PUT(
			mkEvent({ params: { windowId: 'win-1' }, body: { entityId: a, x: 1, y: 1 } })
		);
		await route.PUT(
			mkEvent({ params: { windowId: 'win-2' }, body: { entityId: a, x: 2, y: 2 } })
		);

		await currentDb.delete(entities).where(eq(entities.id, a));

		const remaining = await currentDb.select().from(windowCanvasState);
		expect(remaining).toHaveLength(0);
	});
});

describe('/api/canvas-positions/window/[windowId]/batch POST', () => {
	beforeEach(async () => {
		currentDb = await createTestDb();
	});

	it('inserts N rows atomically (happy path)', async () => {
		const ids = await Promise.all([
			makeEntity('a'),
			makeEntity('b'),
			makeEntity('c'),
			makeEntity('d'),
			makeEntity('e')
		]);
		const body = ids.map((entityId, i) => ({ entityId, x: i, y: i * 10 }));

		const res = await batchRoute.POST(
			mkEvent({ params: { windowId: 'win-1' }, body })
		);
		const out = await readJson(res);
		expect(out).toHaveLength(5);

		const rows = await currentDb
			.select()
			.from(windowCanvasState)
			.where(eq(windowCanvasState.windowId, 'win-1'));
		expect(rows).toHaveLength(5);
	});

	it('rolls back the entire batch when any row fails (FK violation)', async () => {
		const valid1 = await makeEntity('v1');
		const valid2 = await makeEntity('v2');
		// Well-formed UUID but no matching entity → FK violation at insert time.
		const ghost = '00000000-0000-0000-0000-000000000000';

		const body = [
			{ entityId: valid1, x: 1, y: 1 },
			{ entityId: valid2, x: 2, y: 2 },
			{ entityId: ghost, x: 3, y: 3 }
		];

		// Tightened from .toBeDefined() (Greptile P2): assert the rejection is
		// actually a FK violation, not a 400 from a mis-wired validation path
		// or some unrelated runtime failure. drizzle wraps the pg error as
		// 'Failed query: insert into ...' with the underlying 23503 message
		// in the cause; the regex tolerates either wrapping shape.
		await expect(
			batchRoute.POST(mkEvent({ params: { windowId: 'win-1' }, body }))
		).rejects.toThrow(/foreign key|Failed query.*insert/i);

		// Critical C5 guarantee: the two valid rows must NOT be in the DB.
		const rows = await currentDb.select().from(windowCanvasState);
		expect(rows).toHaveLength(0);
	});

	it('rejects non-array body with 400', async () => {
		await expect(
			batchRoute.POST(
				mkEvent({ params: { windowId: 'win-1' }, body: { not: 'array' } })
			)
		).rejects.toMatchObject({ status: 400 });
	});
});
