/**
 * 2026-06 security/bug audit — regression tests for the fix branch.
 *
 *   B1 — an Act reorder that inverts an interval's anchor order is
 *        swap-normalized instead of 500ing the whole reorder.
 *   B2 — DELETE Act ?moveScenesTo=<act> with an interval [scene-in-deleted →
 *        end-of-deleted] follows the scenes to the target act instead of
 *        rescoping to prevAct and aborting on the inverted range.
 *   B5 — computeIntervalPositions enforces half-open act ranges for explicit
 *        positions (start == range.end / end == range.start rejected).
 *   B8 — Scene insert at an occupied position bumps siblings (parity with
 *        the Act insert-between cascade).
 *   REL — POST /api/relationships clears scene FKs when their act FK is
 *        absent (previously persisted unvalidated scene UUIDs verbatim).
 *   PLC — placement `data` jsonb is size-capped.
 *   ENT-SIZE — entity `data` jsonb is size-capped (parity with placements),
 *        including non-object payloads (a bare JSON string can't skip the cap).
 *   NTE-SIZE — note entry `body` is size-capped at a roomier 256KB (long-form
 *        text gets headroom the 16KB entity cap would deny).
 *   ENT — entities PATCH validates name/position scalars (400, not 500).
 *   CNV — canvas batch upsert dedupes same-entity rows (single-statement
 *        upsert can't touch one conflict target twice).
 *   MRG — updateInterval's overlap-merge runs inside a transaction: a failure
 *        after the absorbed-sibling DELETEs rolls them back instead of
 *        silently dropping them (the raw-pool autocommit data-loss the
 *        intervals/[id] PATCH tx wrap prevents).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { and, asc, eq } from 'drizzle-orm';
import { createTestDb, seedActs, seedTestUser } from '../helpers/test-db.js';
import { entities, intervals, mapPlacements, relationships, windowCanvasState, worldMaps } from '../../src/lib/server/db/schema.js';
import { writeInterval, moveSceneToAct, updateInterval } from '../../src/lib/server/intervals.js';
import { recomputeWorldMapVariantsAll } from '../../src/lib/server/world-maps.js';

let db: Awaited<ReturnType<typeof createTestDb>>;
let userId: string;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mkEvent(overrides: { url?: URL; params?: Record<string, string>; body?: unknown } = {}): any {
	return {
		url: overrides.url ?? new URL('http://localhost/'),
		params: overrides.params ?? {},
		request: { json: async () => overrides.body },
		locals: {
			db,
			user: { id: userId, name: 'Test User', email: 'test@test.com', emailVerified: true }
		}
	};
}

const { POST: POST_ENTITY } = await import('../../src/routes/api/entities/+server.js');
const { PATCH: PATCH_ENTITY, DELETE: DELETE_ENTITY } = await import(
	'../../src/routes/api/entities/[id]/+server.js'
);
const { POST: POST_RELATIONSHIP } = await import('../../src/routes/api/relationships/+server.js');
const { POST: POST_PLACEMENT } = await import('../../src/routes/api/map-placements/+server.js');
const { POST: POST_CANVAS_BATCH } = await import(
	'../../src/routes/api/canvas-positions/window/[windowId]/batch/+server.js'
);
const { POST: POST_NOTE } = await import('../../src/routes/api/notes/entries/+server.js');
const { POST: POST_BATCH } = await import('../../src/routes/api/entities/batch/+server.js');

async function seedCharacter(name: string): Promise<string> {
	const [row] = await db
		.insert(entities)
		.values({ userId, type: 'Character', name })
		.returning();
	return row.id;
}

async function seedScene(parentId: string, name: string, position: number): Promise<string> {
	const [row] = await db
		.insert(entities)
		.values({ userId, type: 'Scene', name, parentId, position })
		.returning();
	return row.id;
}

beforeEach(async () => {
	db = await createTestDb();
	userId = (await seedTestUser(db)).id;
});

describe('B1 — act reorder inversion is swap-normalized', () => {
	it('swapping the two anchor acts of a spanning interval succeeds and swaps the endpoints', async () => {
		const acts = await seedActs(db, userId);
		const ellie = await seedCharacter('Ellie');
		const created = await writeInterval(
			db,
			{ entityId: ellie, startActId: acts.act0, endActId: acts.act1 },
			userId
		);
		expect([created.startPosition, created.endPosition]).toEqual([0, 2]);

		// Move act0 to position 1 (swap with act1). Pre-fix this 500ed: the
		// derived start (act0 now idx 1) >= derived end (act1 now idx 0).
		const res = await PATCH_ENTITY(
			mkEvent({ params: { id: acts.act0 }, body: { position: 1 } })
		);
		expect(res.status).toBe(200);

		const [row] = await db.select().from(intervals).where(eq(intervals.id, created.id));
		expect(row.startActId).toBe(acts.act1);
		expect(row.endActId).toBe(acts.act0);
		expect(row.startPosition).toBe(0);
		expect(row.endPosition).toBe(2);
		expect(row.startPosition).toBeLessThan(row.endPosition);
	});
});

describe('B1b — swap-normalization that would overlap a sibling rolls back', () => {
	it('a reorder whose swap widens an interval across a same-entity sibling aborts instead of writing an overlap', async () => {
		const acts = await seedActs(db, userId);
		const ellie = await seedCharacter('Ellie');
		// A spans [act0, act1) = [0, 2); B sits in act2 = [2, 3). Adjacent, no overlap.
		const a = await writeInterval(
			db,
			{ entityId: ellie, startActId: acts.act0, endActId: acts.act1 },
			userId
		);
		const b = await writeInterval(
			db,
			{ entityId: ellie, startActId: acts.act2, endActId: acts.act2 },
			userId
		);
		// Move act0 after act2 (position 2). Order becomes act1, act2, act0; A
		// swap-normalizes to [0, 3) which would intersect B's recomputed [1, 2).
		// The guard aborts with an actionable 409 (entity name + both spans + how
		// to resolve), not an opaque 500.
		await expect(
			PATCH_ENTITY(mkEvent({ params: { id: acts.act0 }, body: { position: 2 } }))
		).rejects.toMatchObject({
			status: 409,
			body: { message: expect.stringMatching(/"Ellie".+overlapping time spans/i) }
		});
		// Transaction rolled back: both intervals AND the act reorder are untouched.
		const [rowA] = await db.select().from(intervals).where(eq(intervals.id, a.id));
		const [rowB] = await db.select().from(intervals).where(eq(intervals.id, b.id));
		expect([rowA.startPosition, rowA.endPosition]).toEqual([0, 2]);
		expect([rowB.startPosition, rowB.endPosition]).toEqual([2, 3]);
		const [act0row] = await db.select().from(entities).where(eq(entities.id, acts.act0));
		expect(act0row.position).toBe(0);
	});
});

describe('B2 — DELETE act with moveScenesTo follows the scenes', () => {
	it('an interval [scene-in-deleted → end-of-deleted] lands in the target act', async () => {
		const acts = await seedActs(db, userId);
		const ellie = await seedCharacter('Ellie');
		const scene = await seedScene(acts.act1, 'S', 0);
		const created = await writeInterval(
			db,
			{ entityId: ellie, startActId: acts.act1, startSceneId: scene, endActId: acts.act1 },
			userId
		);

		// Pre-fix this 500ed when a prev act existed: the start side followed
		// its scene to act2 while the end side was rescoped to act0 → inverted.
		const res = await DELETE_ENTITY(
			mkEvent({
				url: new URL(`http://localhost/api/entities/${acts.act1}?moveScenesTo=${acts.act2}`),
				params: { id: acts.act1 }
			})
		);
		expect(res.status).toBe(204);

		const [scn] = await db.select().from(entities).where(eq(entities.id, scene));
		expect(scn.parentId).toBe(acts.act2);

		const [row] = await db.select().from(intervals).where(eq(intervals.id, created.id));
		expect(row).toBeDefined();
		expect(row.startActId).toBe(acts.act2);
		expect(row.startSceneId).toBe(scene);
		expect(row.endActId).toBe(acts.act2);
		expect(row.endSceneId).toBeNull();
		// act2's post-delete index is 1: the interval covers [scene start, end-of-act2).
		expect(row.startPosition).toBe(1);
		expect(row.endPosition).toBe(2);
	});
});

describe('B5 — half-open act-range checks on explicit positions', () => {
	it('rejects a start position exactly at the act range end', async () => {
		const acts = await seedActs(db, userId);
		const ellie = await seedCharacter('Ellie');
		await expect(
			writeInterval(
				db,
				{ entityId: ellie, startActId: acts.act0, endActId: acts.act1, startPosition: 1 },
				userId
			)
		).rejects.toThrow(/outside act range/);
	});

	it('rejects an end position exactly at the act range start', async () => {
		const acts = await seedActs(db, userId);
		const ellie = await seedCharacter('Ellie');
		await expect(
			writeInterval(
				db,
				{ entityId: ellie, startActId: acts.act0, endActId: acts.act1, endPosition: 1 },
				userId
			)
		).rejects.toThrow(/outside act range/);
	});

	it('still accepts interior free-fraction positions', async () => {
		const acts = await seedActs(db, userId);
		const ellie = await seedCharacter('Ellie');
		const created = await writeInterval(
			db,
			{
				entityId: ellie,
				startActId: acts.act0,
				endActId: acts.act1,
				startPosition: 0.25,
				endPosition: 1.75
			},
			userId
		);
		expect(created.startPosition).toBe(0.25);
		expect(created.endPosition).toBe(1.75);
	});
});

describe('B8 — scene insert-between bumps siblings', () => {
	it('creating a scene at an occupied position shifts the occupant up', async () => {
		const acts = await seedActs(db, userId);
		const s0 = await seedScene(acts.act0, 'S0', 0);
		const s1 = await seedScene(acts.act0, 'S1', 1);

		const res = await POST_ENTITY(
			mkEvent({ body: { type: 'Scene', name: 'S-mid', parentId: acts.act0, position: 1 } })
		);
		expect(res.status).toBe(201);

		const scenes = await db
			.select({ id: entities.id, position: entities.position })
			.from(entities)
			.where(and(eq(entities.parentId, acts.act0), eq(entities.type, 'Scene')))
			.orderBy(asc(entities.position));
		expect(scenes.map((s) => s.position)).toEqual([0, 1, 2]);
		expect(scenes[0].id).toBe(s0);
		expect(scenes[2].id).toBe(s1);
	});
});

describe('REL — relationships POST clears scene FKs without their act FK', () => {
	it('a scene FK with no act FKs is normalized to null, not persisted verbatim', async () => {
		const acts = await seedActs(db, userId);
		const scene = await seedScene(acts.act0, 'S', 0);
		const ellie = await seedCharacter('Ellie');
		const damien = await seedCharacter('Damien');

		const res = await POST_RELATIONSHIP(
			mkEvent({
				body: { fromId: ellie, toId: damien, type: 'other', startSceneId: scene }
			})
		);
		expect(res.status).toBe(201);
		const created = (await res.json()) as { id: string };

		const [row] = await db
			.select()
			.from(relationships)
			.where(eq(relationships.id, created.id));
		expect(row.startSceneId).toBeNull();
		expect(row.startActId).toBeNull();
		expect(row.startPosition).toBeNull();
	});
});

describe('PLC — placement data jsonb size cap', () => {
	it('rejects a data blob over the cap with 400', async () => {
		await expect(
			POST_PLACEMENT(
				mkEvent({
					body: { x: 0.5, y: 0.5, data: { pad: 'x'.repeat(17000) } }
				})
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('measures true UTF-8 bytes: a multibyte blob under the char-count but over the byte cap is rejected', async () => {
		// 6000 emoji = 6000 UTF-16 length but 24000 UTF-8 bytes (> 16384 cap).
		// The old String.length check would have accepted this.
		await expect(
			POST_PLACEMENT(
				mkEvent({ body: { x: 0.5, y: 0.5, data: { pad: '😀'.repeat(6000) } } })
			)
		).rejects.toMatchObject({ status: 400 });
	});
});

describe('ENT-SIZE — entity data jsonb size cap (parity with placements)', () => {
	it('rejects an entity data blob over the cap with 400', async () => {
		await expect(
			POST_ENTITY(
				mkEvent({ body: { type: 'Character', name: 'Ellie', data: { pad: 'x'.repeat(17000) } } })
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('measures true UTF-8 bytes: a multibyte entity blob under the char-count but over the byte cap is rejected', async () => {
		// 6000 emoji = 6000 UTF-16 length but 24000 UTF-8 bytes (> 16384 cap).
		await expect(
			POST_ENTITY(
				mkEvent({ body: { type: 'Character', name: 'Ellie', data: { pad: '😀'.repeat(6000) } } })
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('rejects an oversized NON-object data payload (bare string bypasses a typeof-object-only cap)', async () => {
		// Entity routes persist `data` verbatim (`data ?? {}`), so a giant bare
		// string would dodge a cap that only measured objects and store a
		// multi-megabyte row. The cap must measure any non-null payload.
		await expect(
			POST_ENTITY(
				mkEvent({ body: { type: 'Character', name: 'Ellie', data: 'x'.repeat(17000) } })
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('accepts a normal-size entity data blob', async () => {
		const res = await POST_ENTITY(
			mkEvent({ body: { type: 'Character', name: 'Ellie', data: { role: 'protagonist' } } })
		);
		expect(res.status).toBe(201);
	});
});

describe('NTE-SIZE — note entry body is size-capped (generous 256KB)', () => {
	it('rejects a note body over the 256KB cap with 400', async () => {
		await expect(
			POST_NOTE(mkEvent({ body: { name: 'Backstory', body: 'x'.repeat(262145) } }))
		).rejects.toMatchObject({ status: 400 });
	});

	it('accepts a long-form note body well under the cap (parity: not the 16KB entity cap)', async () => {
		// ~32k chars is rejected by the 16KB entity cap but must pass the note cap —
		// long-form notes are the whole point of the roomier limit.
		const res = await POST_NOTE(
			mkEvent({ body: { name: 'Backstory', body: 'x'.repeat(32000) } })
		);
		expect(res.status).toBe(201);
	});
});

describe('ENT — entities PATCH scalar validation', () => {
	it('rejects a non-string name with 400 (was a TypeError 500)', async () => {
		const ellie = await seedCharacter('Ellie');
		await expect(
			PATCH_ENTITY(mkEvent({ params: { id: ellie }, body: { name: 123 } }))
		).rejects.toMatchObject({ status: 400 });
	});

	it('rejects a non-integer position with 400', async () => {
		const acts = await seedActs(db, userId);
		await expect(
			PATCH_ENTITY(mkEvent({ params: { id: acts.act0 }, body: { position: 1.5 } }))
		).rejects.toMatchObject({ status: 400 });
	});
});

describe('CNV — canvas batch upsert handles duplicate entityIds', () => {
	it('dedupes same-entity rows last-wins in one statement', async () => {
		const ellie = await seedCharacter('Ellie');
		const windowId = crypto.randomUUID();
		const res = await POST_CANVAS_BATCH(
			mkEvent({
				params: { windowId },
				body: [
					{ entityId: ellie, x: 1, y: 1 },
					{ entityId: ellie, x: 9, y: 9 }
				]
			})
		);
		expect(res.status).toBe(200);

		const rows = await db
			.select()
			.from(windowCanvasState)
			.where(eq(windowCanvasState.windowId, windowId));
		expect(rows).toHaveLength(1);
		expect(rows[0].x).toBe(9);
		expect(rows[0].y).toBe(9);
	});

	it('rejects an oversized batch with 400 (bounds the bind-parameter count)', async () => {
		const windowId = crypto.randomUUID();
		const big = Array.from({ length: 2001 }, () => ({
			entityId: crypto.randomUUID(),
			x: 0,
			y: 0
		}));
		await expect(
			POST_CANVAS_BATCH(mkEvent({ params: { windowId }, body: big }))
		).rejects.toMatchObject({ status: 400 });
	});
});

describe('WM — moveSceneToAct reanchors scene-anchored world_map variants (codex P1 follow-up)', () => {
	it('a variant anchored to a moved scene follows it to the new act, recomputes, and survives a later variant recompute (no scene/act-mismatch 500)', async () => {
		const acts = await seedActs(db, userId);
		const scene = await seedScene(acts.act0, 'S', 0);
		const [location] = await db
			.insert(entities)
			.values({ userId, type: 'Location', name: 'Gondor' })
			.returning();

		// Variant scene-anchored to S, the single scene of act0 → spans [0, 1).
		const [variant] = await db
			.insert(worldMaps)
			.values({
				userId,
				name: 'Gondor — during S',
				locationId: location.id,
				startActId: acts.act0,
				startSceneId: scene,
				endActId: acts.act0,
				endSceneId: scene,
				startPosition: 0,
				endPosition: 1
			})
			.returning();

		// Move S from act0 → act1. Pre-fix the variant kept startActId=act0 while
		// its scene moved to act1; computeIntervalPositions' scene/act-mismatch
		// guard then 500ed the next Act-level recompute, bricking act reordering.
		await db.transaction(async (tx) => {
			await moveSceneToAct(tx, scene, acts.act1, 0, userId);
		});

		const [row] = await db.select().from(worldMaps).where(eq(worldMaps.id, variant.id));
		expect(row.startActId).toBe(acts.act1);
		expect(row.endActId).toBe(acts.act1);
		expect(row.startSceneId).toBe(scene);
		expect(row.endSceneId).toBe(scene);
		// act1 (index 1), S now its only scene → [1, 2).
		expect(row.startPosition).toBeCloseTo(1, 9);
		expect(row.endPosition).toBeCloseTo(2, 9);

		// A later variant recompute (what an Act reorder triggers) must NOT throw
		// on a scene/act mismatch — the reanchor closed it.
		await expect(
			db.transaction(async (tx) => recomputeWorldMapVariantsAll(tx, userId))
		).resolves.toBeGreaterThanOrEqual(0);
	});
});

describe('MRG — updateInterval overlap-merge is transactional', () => {
	it('a failure after the absorbed-sibling DELETE rolls it back instead of silently dropping it', async () => {
		const acts = await seedActs(db, userId);
		const ellie = await seedCharacter('Ellie');
		// A sits in act0 = [0, 1); B sits in act2 = [2, 3). Same entity, no overlap.
		const a = await writeInterval(
			db,
			{ entityId: ellie, startActId: acts.act0, endActId: acts.act0 },
			userId
		);
		const b = await writeInterval(
			db,
			{ entityId: ellie, startActId: acts.act2, endActId: acts.act2 },
			userId
		);

		// Extend A across act2 → derived [0, 3) overlaps B [2, 3): updateInterval
		// DELETEs B (absorbed) then UPDATEs A to the union. Inject a failure right
		// after the merge completes inside the tx; the route wraps updateInterval
		// in db.transaction for exactly this reason. Pre-fix (raw-pool autocommit)
		// B's delete would have committed → silent data loss.
		let absorbedGoneMidTx = false;
		await expect(
			db.transaction(async (tx) => {
				await updateInterval(tx, a.id, { startActId: acts.act0, endActId: acts.act2 }, userId);
				// The tx sees its own write: B is already deleted, A is the union.
				const midB = await tx.select().from(intervals).where(eq(intervals.id, b.id));
				absorbedGoneMidTx = midB.length === 0;
				throw new Error('injected post-merge failure');
			})
		).rejects.toThrow('injected post-merge failure');

		// The merge really did delete B inside the tx (otherwise rollback is vacuous).
		expect(absorbedGoneMidTx).toBe(true);

		// After rollback: B is back at its original range and A keeps [0, 1).
		const [rowB] = await db.select().from(intervals).where(eq(intervals.id, b.id));
		expect(rowB).toBeDefined();
		expect([rowB.startPosition, rowB.endPosition]).toEqual([2, 3]);
		const [rowA] = await db.select().from(intervals).where(eq(intervals.id, a.id));
		expect([rowA.startPosition, rowA.endPosition]).toEqual([0, 1]);
	});
});

describe('MOVE-400 — scene move to a non-Act target returns 400, not opaque 500', () => {
	it('PATCH parentId pointing at a non-Act surfaces moveSceneToAct validation as 400 (codex P2)', async () => {
		const acts = await seedActs(db, userId);
		const scene = await seedScene(acts.act0, 'S', 0);
		const ellie = await seedCharacter('Ellie'); // a Character, not an Act
		// moveSceneToAct throws a plain Error('Target ... type=Character ...'); the
		// post-audit catch must classify it as app-validation (not a PG driver
		// error) and surface 400 instead of re-throwing it as an opaque 500.
		await expect(
			PATCH_ENTITY(mkEvent({ params: { id: scene }, body: { parentId: ellie } }))
		).rejects.toMatchObject({ status: 400 });
	});
});

describe('NTE-PARITY — generic entity routes apply the roomy note cap to Notes', () => {
	// ~32k chars: rejected by the 16KB generic entity cap, accepted by the 256KB
	// note cap. A Note that succeeds through /api/notes/entries must also succeed
	// through the generic entity create / batch / PATCH (codex P2).
	const bigNoteData = { body: 'x'.repeat(32000) };

	it('POST /api/entities type=Note accepts a 32KB body (would 400 under the entity cap)', async () => {
		const res = await POST_ENTITY(
			mkEvent({ body: { type: 'Note', name: 'Backstory', data: bigNoteData } })
		);
		expect(res.status).toBe(201);
	});

	it('POST /api/entities type=Note still rejects a body over the 256KB note cap', async () => {
		await expect(
			POST_ENTITY(
				mkEvent({ body: { type: 'Note', name: 'Backstory', data: { body: 'x'.repeat(262145) } } })
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('POST /api/entities/batch applies the note cap per Note item', async () => {
		const res = await POST_BATCH(
			mkEvent({ body: { entities: [{ type: 'Note', name: 'Backstory', data: bigNoteData }] } })
		);
		expect(res.status).toBe(201);
	});

	it('PATCH /api/entities/[id] applies the note cap when the existing row is a Note', async () => {
		const [note] = await db
			.insert(entities)
			.values({ userId, type: 'Note', name: 'Backstory', data: { body: '' } })
			.returning();
		const res = await PATCH_ENTITY(
			mkEvent({ params: { id: note.id }, body: { data: bigNoteData } })
		);
		expect(res.status).toBe(200);
	});

	it('a non-Note entity still gets the 16KB cap through the generic PATCH', async () => {
		const ellie = await seedCharacter('Ellie');
		await expect(
			PATCH_ENTITY(mkEvent({ params: { id: ellie }, body: { data: { pad: 'x'.repeat(17000) } } }))
		).rejects.toMatchObject({ status: 400 });
	});
});

describe('INV — scene reorder swap-normalizes inverted bounds across all sibling derived-position tables', () => {
	// A variant/edge/placement anchored start→sceneA, end→sceneB in one act, with
	// sceneA reordered past sceneB, derives an inverted (or zero-extent) range. Each
	// table carries a `start_position < end_position` CHECK, so pre-fix the scene
	// reorder 500ed and rolled back. The shared resolveRelationshipBoundsSwapNormalized
	// swaps the side anchors so the row stays valid and the reorder succeeds.

	async function seedTwoSceneAct() {
		const acts = await seedActs(db, userId);
		const s0 = await seedScene(acts.act0, 'S0', 0);
		const s1 = await seedScene(acts.act0, 'S1', 1);
		return { acts, s0, s1 };
	}

	// Reorder s0 after s1 → order becomes [s1@0, s0@1]; the start-anchor scene now
	// sits after the end-anchor scene in the same act.
	async function reorderS0AfterS1(s0: string) {
		const res = await PATCH_ENTITY(mkEvent({ params: { id: s0 }, body: { position: 1 } }));
		expect(res.status).toBe(200);
	}

	it('world_maps variant: inverted anchors swap, reorder succeeds, start < end', async () => {
		const { acts, s0, s1 } = await seedTwoSceneAct();
		const [location] = await db
			.insert(entities)
			.values({ userId, type: 'Location', name: 'Gondor' })
			.returning();
		const [variant] = await db
			.insert(worldMaps)
			.values({
				userId,
				name: 'Gondor — S0..S1',
				locationId: location.id,
				startActId: acts.act0,
				startSceneId: s0,
				endActId: acts.act0,
				endSceneId: s1,
				startPosition: 0,
				endPosition: 1
			})
			.returning();

		await reorderS0AfterS1(s0);

		const [row] = await db.select().from(worldMaps).where(eq(worldMaps.id, variant.id));
		expect(row.startSceneId).toBe(s1);
		expect(row.endSceneId).toBe(s0);
		expect(row.startPosition!).toBeLessThan(row.endPosition!);
	});

	it('relationships caused edge: inverted anchors swap, reorder succeeds, start < end', async () => {
		const { acts, s0, s1 } = await seedTwoSceneAct();
		const ellie = await seedCharacter('Ellie');
		const damien = await seedCharacter('Damien');
		const [edge] = await db
			.insert(relationships)
			.values({
				userId,
				fromId: ellie,
				toId: damien,
				type: 'other',
				startActId: acts.act0,
				startSceneId: s0,
				endActId: acts.act0,
				endSceneId: s1,
				startPosition: 0,
				endPosition: 1
			})
			.returning();

		await reorderS0AfterS1(s0);

		const [row] = await db.select().from(relationships).where(eq(relationships.id, edge.id));
		expect(row.startSceneId).toBe(s1);
		expect(row.endSceneId).toBe(s0);
		expect(row.startPosition!).toBeLessThan(row.endPosition!);
	});

	it('map_placements: inverted anchors swap, reorder succeeds, start < end', async () => {
		const { acts, s0, s1 } = await seedTwoSceneAct();
		const ellie = await seedCharacter('Ellie');
		const [placement] = await db
			.insert(mapPlacements)
			.values({
				userId,
				placeableId: ellie,
				x: 0.5,
				y: 0.5,
				startActId: acts.act0,
				startSceneId: s0,
				endActId: acts.act0,
				endSceneId: s1,
				startPosition: 0,
				endPosition: 1
			})
			.returning();

		await reorderS0AfterS1(s0);

		const [row] = await db.select().from(mapPlacements).where(eq(mapPlacements.id, placement.id));
		expect(row.startSceneId).toBe(s1);
		expect(row.endSceneId).toBe(s0);
		expect(row.startPosition!).toBeLessThan(row.endPosition!);
	});
});

describe('EXCL-409 — a recompute that overlaps two same-Location variants returns 409, not 500', () => {
	it('translates the world_maps EXCLUDE (23P01, deferred to commit) to an actionable 409 and rolls back', async () => {
		const acts = await seedActs(db, userId);
		// Four scenes in act0 → quarter-act ranges [0,¼)[¼,½)[½,¾)[¾,1).
		const s0 = await seedScene(acts.act0, 'S0', 0);
		const s1 = await seedScene(acts.act0, 'S1', 1);
		const s2 = await seedScene(acts.act0, 'S2', 2);
		const s3 = await seedScene(acts.act0, 'S3', 3);
		const [location] = await db
			.insert(entities)
			.values({ userId, type: 'Location', name: 'Gondor' })
			.returning();

		// Two adjacent, non-overlapping variants for the SAME location: V1 [s0..s1]
		// = [0, 0.5), V2 [s2..s3] = [0.5, 1.0). Both insert cleanly.
		const [v1] = await db
			.insert(worldMaps)
			.values({
				userId,
				name: 'V1',
				locationId: location.id,
				startActId: acts.act0,
				startSceneId: s0,
				endActId: acts.act0,
				endSceneId: s1,
				startPosition: 0,
				endPosition: 0.5
			})
			.returning();
		const [v2] = await db
			.insert(worldMaps)
			.values({
				userId,
				name: 'V2',
				locationId: location.id,
				startActId: acts.act0,
				startSceneId: s2,
				endActId: acts.act0,
				endSceneId: s3,
				startPosition: 0.5,
				endPosition: 1
			})
			.returning();

		// Move s1 after s2 → order [s0, s2, s1, s3]. Recompute widens V1 to [0, 0.75)
		// and V2 to [0.25, 1.0): they now overlap, tripping world_maps_variant_no_overlap
		// (23P01) at commit. Pre-fix the catch only knew 23505 → opaque 500.
		await expect(
			PATCH_ENTITY(mkEvent({ params: { id: s1 }, body: { position: 2 } }))
		).rejects.toMatchObject({ status: 409 });

		// Deferred constraint failed the whole tx → variants and scene order untouched.
		const [r1] = await db.select().from(worldMaps).where(eq(worldMaps.id, v1.id));
		expect([r1.startPosition, r1.endPosition]).toEqual([0, 0.5]);
		const [r2] = await db.select().from(worldMaps).where(eq(worldMaps.id, v2.id));
		expect([r2.startPosition, r2.endPosition]).toEqual([0.5, 1]);
		const [scn1] = await db.select().from(entities).where(eq(entities.id, s1));
		expect(scn1.position).toBe(1);
	});
});
