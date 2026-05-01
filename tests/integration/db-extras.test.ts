/**
 * Backfill tests for gaps not covered by db.test.ts or intervals-*.test.ts.
 *
 * Covers:
 *   1. entities.data JSON field round-trip and edge cases
 *   2. entities.parent_id + position columns (PR 1 hierarchy support)
 *   3. canvas_positions UNIQUE(entity_id) upsert constraint
 *   4. Multi-row cascade fan-out from a single entity deletion
 *   5. Index-aligned query ordering (entities_type_position_idx)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';
import { createTestDb } from '../helpers/test-db.js';
import { entities, relationships, canvasPositions } from '../../src/lib/server/db/schema.js';

describe('entities.data jsonb field handling', () => {
	let db: Awaited<ReturnType<typeof createTestDb>>;

	beforeEach(async () => {
		db = await createTestDb();
	});

	it('round-trips an object via the jsonb data column', async () => {
		const payload = { motivation: 'find brother', age: 27 };
		const [created] = await db
			.insert(entities)
			.values({ type: 'Character', name: 'Ellie', data: payload })
			.returning();

		const [fetched] = await db.select().from(entities).where(eq(entities.id, created.id));
		expect(fetched.data).toEqual(payload);
		expect(fetched.data.motivation).toBe('find brother');
		expect(fetched.data.age).toBe(27);
	});

	it('defaults data to {} when not specified', async () => {
		const [created] = await db
			.insert(entities)
			.values({ type: 'Note', name: 'Untitled' })
			.returning();
		expect(created.data).toEqual({});
	});

	it('updates only the data field without touching name or type', async () => {
		const [created] = await db
			.insert(entities)
			.values({ type: 'Character', name: 'Damien', data: { rank: 1 } })
			.returning();

		await db
			.update(entities)
			.set({ data: { rank: 2, scarred: true } })
			.where(eq(entities.id, created.id));

		const [updated] = await db.select().from(entities).where(eq(entities.id, created.id));
		expect(updated.name).toBe('Damien');
		expect(updated.type).toBe('Character');
		expect(updated.data.rank).toBe(2);
		expect(updated.data.scarred).toBe(true);
	});

	it('handles arrays and nested objects in the data field', async () => {
		const payload = {
			tags: ['protagonist', 'wounded'],
			stats: { hp: 12, mp: 0 }
		};
		const [created] = await db
			.insert(entities)
			.values({ type: 'Character', name: 'Iris', data: payload })
			.returning();

		expect(created.data.tags).toEqual(['protagonist', 'wounded']);
		expect((created.data.stats as Record<string, number>).hp).toBe(12);
	});

	it('handles unicode and special characters in the data field', async () => {
		const payload = { quote: 'Iść — naprzód! 「行く」', emoji: 'spades' };
		const [created] = await db
			.insert(entities)
			.values({ type: 'Note', name: 'q', data: payload })
			.returning();

		expect(created.data.quote).toBe('Iść — naprzód! 「行く」');
		expect(created.data.emoji).toBe('spades');
	});
});

describe('entities.parent_id + position', () => {
	let db: Awaited<ReturnType<typeof createTestDb>>;

	beforeEach(async () => {
		db = await createTestDb();
	});

	it('persists parent_id pointing at an Act for a Scene', async () => {
		const [act] = await db
			.insert(entities)
			.values({ type: 'Act', name: 'Act 0', position: 0 })
			.returning();
		const [scene] = await db
			.insert(entities)
			.values({ type: 'Scene', name: 'Opening', parentId: act.id, position: 0 })
			.returning();

		const [fetched] = await db.select().from(entities).where(eq(entities.id, scene.id));
		expect(fetched.parentId).toBe(act.id);
		expect(fetched.position).toBe(0);
	});

	it('orders sibling Scenes by position within the same parent', async () => {
		const [act] = await db
			.insert(entities)
			.values({ type: 'Act', name: 'Act 0', position: 0 })
			.returning();
		await db.insert(entities).values({ type: 'Scene', name: 'C', parentId: act.id, position: 2 });
		await db.insert(entities).values({ type: 'Scene', name: 'A', parentId: act.id, position: 0 });
		await db.insert(entities).values({ type: 'Scene', name: 'B', parentId: act.id, position: 1 });

		const ordered = await db
			.select()
			.from(entities)
			.where(and(eq(entities.type, 'Scene'), eq(entities.parentId, act.id)))
			.orderBy(asc(entities.position));

		expect(ordered.map((s) => s.name)).toEqual(['A', 'B', 'C']);
	});

	it('persists parent_id as null for root-level Acts', async () => {
		const [act] = await db
			.insert(entities)
			.values({ type: 'Act', name: 'Root Act', position: 0 })
			.returning();

		const [fetched] = await db.select().from(entities).where(eq(entities.id, act.id));
		expect(fetched.parentId).toBeNull();
	});

	it('cascades deletion from Act to all child Scenes via parent_id', async () => {
		const [act] = await db
			.insert(entities)
			.values({ type: 'Act', name: 'Act 0', position: 0 })
			.returning();
		await db.insert(entities).values({ type: 'Scene', name: 'S0', parentId: act.id, position: 0 });
		await db.insert(entities).values({ type: 'Scene', name: 'S1', parentId: act.id, position: 1 });
		await db.insert(entities).values({ type: 'Scene', name: 'S2', parentId: act.id, position: 2 });

		const [before] = await db
			.select({ c: count() })
			.from(entities)
			.where(eq(entities.type, 'Scene'));
		expect(before.c).toBe(3);

		await db.delete(entities).where(eq(entities.id, act.id));

		const [after] = await db
			.select({ c: count() })
			.from(entities)
			.where(eq(entities.type, 'Scene'));
		expect(after.c).toBe(0);
	});

	it('rejects parent_id that does not reference an existing entity', async () => {
		await expect(
			db
				.insert(entities)
				.values({
					type: 'Scene',
					name: 'orphan',
					parentId: '00000000-0000-0000-0000-000000000000',
					position: 0
				})
		).rejects.toThrow();
	});

	it('allows position to be null for non-ordered entities', async () => {
		const [char] = await db
			.insert(entities)
			.values({ type: 'Character', name: 'Free Agent' })
			.returning();
		expect(char.position).toBeNull();
		expect(char.parentId).toBeNull();
	});

	it('allows duplicate position values when parent differs', async () => {
		const [act0] = await db
			.insert(entities)
			.values({ type: 'Act', name: 'A0', position: 0 })
			.returning();
		const [act1] = await db
			.insert(entities)
			.values({ type: 'Act', name: 'A1', position: 1 })
			.returning();

		await db
			.insert(entities)
			.values({ type: 'Scene', name: 's', parentId: act0.id, position: 0 });
		await db
			.insert(entities)
			.values({ type: 'Scene', name: 's', parentId: act1.id, position: 0 });

		const [result] = await db
			.select({ c: count() })
			.from(entities)
			.where(eq(entities.type, 'Scene'));
		expect(result.c).toBe(2);
	});

	it('cascades deletion through nested parent chains', async () => {
		const [act] = await db
			.insert(entities)
			.values({ type: 'Act', name: 'Act 0', position: 0 })
			.returning();
		const [scene] = await db
			.insert(entities)
			.values({ type: 'Scene', name: 'S0', parentId: act.id, position: 0 })
			.returning();
		// A nested child (a Note "owned" by a Scene via parent_id).
		await db
			.insert(entities)
			.values({ type: 'Note', name: 'beat', parentId: scene.id });

		await db.delete(entities).where(eq(entities.id, act.id));

		const [result] = await db.select({ c: count() }).from(entities);
		expect(result.c).toBe(0);
	});
});

describe('canvas_positions UNIQUE(entity_id) constraint', () => {
	let db: Awaited<ReturnType<typeof createTestDb>>;

	beforeEach(async () => {
		db = await createTestDb();
	});

	it('allows canvas_positions for distinct entity_ids', async () => {
		const [a] = await db
			.insert(entities)
			.values({ type: 'Character', name: 'A' })
			.returning();
		const [b] = await db
			.insert(entities)
			.values({ type: 'Character', name: 'B' })
			.returning();

		await db.insert(canvasPositions).values({ entityId: a.id, x: 10, y: 10 });
		await db.insert(canvasPositions).values({ entityId: b.id, x: 20, y: 20 });

		const [result] = await db.select({ c: count() }).from(canvasPositions);
		expect(result.c).toBe(2);
	});

	it('rejects a second canvas_position for the same entity_id', async () => {
		const [a] = await db
			.insert(entities)
			.values({ type: 'Character', name: 'A' })
			.returning();

		await db.insert(canvasPositions).values({ entityId: a.id, x: 10, y: 10 });

		await expect(
			db.insert(canvasPositions).values({ entityId: a.id, x: 99, y: 99 })
		).rejects.toThrow(/UNIQUE/i);
	});

	it('honors onConflictDoUpdate for canvas_position upsert', async () => {
		const [a] = await db
			.insert(entities)
			.values({ type: 'Character', name: 'A' })
			.returning();

		await db.insert(canvasPositions).values({ entityId: a.id, x: 10, y: 10 });
		await db
			.insert(canvasPositions)
			.values({ entityId: a.id, x: 99, y: 99 })
			.onConflictDoUpdate({
				target: canvasPositions.entityId,
				set: { x: 99, y: 99 }
			});

		const rows = await db
			.select()
			.from(canvasPositions)
			.where(eq(canvasPositions.entityId, a.id));
		expect(rows).toHaveLength(1);
		expect(rows[0].x).toBe(99);
		expect(rows[0].y).toBe(99);
	});

	it('applies default width/height when not specified', async () => {
		const [a] = await db
			.insert(entities)
			.values({ type: 'Character', name: 'A' })
			.returning();
		const [pos] = await db
			.insert(canvasPositions)
			.values({ entityId: a.id })
			.returning();

		expect(pos.x).toBe(0);
		expect(pos.y).toBe(0);
		expect(pos.width).toBe(160);
		expect(pos.height).toBe(80);
	});
});

describe('multi-edge cascade fan-out from a single entity', () => {
	let db: Awaited<ReturnType<typeof createTestDb>>;

	beforeEach(async () => {
		db = await createTestDb();
	});

	it('deleting an entity removes all dependent rows but leaves siblings intact', async () => {
		const [a] = await db
			.insert(entities)
			.values({ type: 'Character', name: 'A' })
			.returning();
		const [b] = await db
			.insert(entities)
			.values({ type: 'Location', name: 'B' })
			.returning();
		const [c] = await db
			.insert(entities)
			.values({ type: 'Event', name: 'C' })
			.returning();

		await db
			.insert(relationships)
			.values({ fromId: a.id, toId: b.id, type: 'located_at' });
		await db
			.insert(relationships)
			.values({ fromId: a.id, toId: c.id, type: 'caused_by' });
		await db.insert(canvasPositions).values({ entityId: a.id, x: 5, y: 5 });

		await db.delete(entities).where(eq(entities.id, a.id));

		const [rels] = await db.select({ c: count() }).from(relationships);
		const [pos] = await db.select({ c: count() }).from(canvasPositions);
		expect(rels.c).toBe(0);
		expect(pos.c).toBe(0);

		// B and C still exist.
		const survivors = await db.select().from(entities);
		expect(survivors.map((s) => s.id).sort()).toEqual([b.id, c.id].sort());
	});

	it('cascades when the relationship target (to_id) is deleted, not just source', async () => {
		const [a] = await db
			.insert(entities)
			.values({ type: 'Character', name: 'A' })
			.returning();
		const [b] = await db
			.insert(entities)
			.values({ type: 'Location', name: 'B' })
			.returning();

		await db
			.insert(relationships)
			.values({ fromId: a.id, toId: b.id, type: 'located_at' });

		await db.delete(entities).where(eq(entities.id, b.id));

		const [rels] = await db.select({ c: count() }).from(relationships);
		expect(rels.c).toBe(0);
		// A is still here.
		const remaining = await db.select().from(entities);
		expect(remaining).toHaveLength(1);
		expect(remaining[0].id).toBe(a.id);
	});
});

describe('ordering queries against entities_type_position_idx', () => {
	let db: Awaited<ReturnType<typeof createTestDb>>;

	beforeEach(async () => {
		db = await createTestDb();
	});

	it('returns root-level Acts in ascending position order', async () => {
		// Insert out of order to confirm ordering happens at query time.
		await db.insert(entities).values({ type: 'Act', name: 'Act 2', position: 2 });
		await db.insert(entities).values({ type: 'Act', name: 'Act 0', position: 0 });
		await db.insert(entities).values({ type: 'Act', name: 'Act 1', position: 1 });

		const acts = await db
			.select()
			.from(entities)
			.where(and(eq(entities.type, 'Act'), isNull(entities.parentId)))
			.orderBy(asc(entities.position));

		expect(acts.map((a) => a.name)).toEqual(['Act 0', 'Act 1', 'Act 2']);
	});

	it('does not commingle Acts from different scopes (root vs nested)', async () => {
		const [rootAct] = await db
			.insert(entities)
			.values({ type: 'Act', name: 'Root', position: 0 })
			.returning();
		// A nested "Act" under another Act (unusual, but tests the parent_id IS NULL filter).
		await db
			.insert(entities)
			.values({ type: 'Act', name: 'Nested', parentId: rootAct.id, position: 0 });

		const rootActs = await db
			.select()
			.from(entities)
			.where(and(eq(entities.type, 'Act'), isNull(entities.parentId)))
			.orderBy(asc(entities.position));

		expect(rootActs).toHaveLength(1);
		expect(rootActs[0].name).toBe('Root');
	});

	it('uses the entities_type_position_idx for the act-ordering query', async () => {
		await db.insert(entities).values({ type: 'Act', name: 'Act 0', position: 0 });
		await db.insert(entities).values({ type: 'Act', name: 'Act 1', position: 1 });

		// pg uses EXPLAIN (not EXPLAIN QUERY PLAN). drizzle exposes raw SQL
		// via .execute(); pglite returns rows under .rows.
		const plan = await db.execute(
			sql`EXPLAIN SELECT * FROM entities WHERE type = 'Act' AND parent_id IS NULL ORDER BY position`
		);
		const planText = JSON.stringify(plan);
		// Index Scan / Index Only Scan — the key signal is "Index" rather
		// than "Seq Scan."
		expect(planText).toMatch(/Index/i);
	});

	it('orders by created_at when position is unavailable (entities_created_at_idx)', async () => {
		const [first] = await db
			.insert(entities)
			.values({ type: 'Note', name: 'First' })
			.returning();
		// Force a different created_at by manually setting it (raw SQL avoids
		// races inside the same now() microsecond). pg uses interval syntax.
		await db.execute(
			sql`UPDATE entities SET created_at = created_at - interval '10 seconds' WHERE id = ${first.id}`
		);
		await db.insert(entities).values({ type: 'Note', name: 'Second' });

		const notes = await db
			.select()
			.from(entities)
			.where(eq(entities.type, 'Note'))
			.orderBy(asc(entities.createdAt));

		expect(notes.map((n) => n.name)).toEqual(['First', 'Second']);
	});

	it('treats NULL positions as orderable but groups them per SQLite NULLS FIRST default', async () => {
		await db.insert(entities).values({ type: 'Character', name: 'P', position: 5 });
		await db.insert(entities).values({ type: 'Character', name: 'Q' }); // null position
		await db.insert(entities).values({ type: 'Character', name: 'R', position: 1 });

		const chars = await db
			.select()
			.from(entities)
			.where(eq(entities.type, 'Character'))
			.orderBy(asc(entities.position));

		// SQLite default ASC: NULLs sort first.
		expect(chars[0].name).toBe('Q');
		expect(chars[1].name).toBe('R');
		expect(chars[2].name).toBe('P');
	});
});
