import { describe, it, expect, beforeEach } from 'vitest';
import { eq, count } from 'drizzle-orm';
import * as schema from '../../src/lib/server/db/schema.js';
import { entities, relationships, canvasPositions } from '../../src/lib/server/db/schema.js';
import { createTestDb } from '../helpers/test-db.js';

describe('entities', () => {
	let db: Awaited<ReturnType<typeof createTestDb>>;

	beforeEach(async () => {
		db = await createTestDb();
	});

	it('creates and reads each entity type', async () => {
		for (const type of schema.EntityType) {
			const [created] = await db
				.insert(entities)
				.values({ type, name: `Test ${type}` })
				.returning();
			expect(created.id).toBeTruthy();
			expect(created.type).toBe(type);
			expect(created.name).toBe(`Test ${type}`);

			const fetched = await db.select().from(entities).where(eq(entities.id, created.id));
			expect(fetched).toHaveLength(1);
			expect(fetched[0].type).toBe(type);
		}
	});

	it('updates an entity', async () => {
		const [entity] = await db
			.insert(entities)
			.values({ type: 'Character', name: 'Elara' })
			.returning();

		await db.update(entities).set({ name: 'Elara Voss' }).where(eq(entities.id, entity.id));

		const [updated] = await db.select().from(entities).where(eq(entities.id, entity.id));
		expect(updated.name).toBe('Elara Voss');
	});

	it('deletes an entity', async () => {
		const [entity] = await db
			.insert(entities)
			.values({ type: 'Note', name: 'Draft' })
			.returning();

		await db.delete(entities).where(eq(entities.id, entity.id));

		const remaining = await db.select().from(entities).where(eq(entities.id, entity.id));
		expect(remaining).toHaveLength(0);
	});

	it('sets created_at automatically', async () => {
		const before = Math.floor(Date.now() / 1000) - 1;
		const [entity] = await db
			.insert(entities)
			.values({ type: 'Event', name: 'The Fall' })
			.returning();
		const after = Math.floor(Date.now() / 1000) + 1;

		expect(entity.createdAt).toBeTruthy();
		const ts = entity.createdAt instanceof Date ? entity.createdAt.getTime() / 1000 : Number(entity.createdAt);
		expect(ts).toBeGreaterThanOrEqual(before);
		expect(ts).toBeLessThanOrEqual(after);
	});
});

describe('relationships FK cascade', () => {
	let db: Awaited<ReturnType<typeof createTestDb>>;

	beforeEach(async () => {
		db = await createTestDb();
	});

	it('deletes relationships when entity is deleted', async () => {
		const [char] = await db
			.insert(entities)
			.values({ type: 'Character', name: 'Elara' })
			.returning();
		const [loc] = await db
			.insert(entities)
			.values({ type: 'Location', name: 'Ashenveil' })
			.returning();

		await db
			.insert(relationships)
			.values({ fromId: char.id, toId: loc.id, type: 'located_at' });

		const [beforeDelete] = await db.select({ c: count() }).from(relationships);
		expect(beforeDelete.c).toBe(1);

		await db.delete(entities).where(eq(entities.id, char.id));

		const [afterDelete] = await db.select({ c: count() }).from(relationships);
		expect(afterDelete.c).toBe(0);
	});

	it('cascades when to_id entity is deleted', async () => {
		const [a] = await db.insert(entities).values({ type: 'Character', name: 'A' }).returning();
		const [b] = await db.insert(entities).values({ type: 'Character', name: 'B' }).returning();

		await db.insert(relationships).values({ fromId: a.id, toId: b.id, type: 'rivals' });

		await db.delete(entities).where(eq(entities.id, b.id));

		const [result] = await db.select({ c: count() }).from(relationships);
		expect(result.c).toBe(0);
	});
});

describe('canvas_positions FK cascade', () => {
	let db: Awaited<ReturnType<typeof createTestDb>>;

	beforeEach(async () => {
		db = await createTestDb();
	});

	it('deletes canvas position when entity is deleted', async () => {
		const [entity] = await db
			.insert(entities)
			.values({ type: 'Character', name: 'Elara' })
			.returning();

		await db.insert(canvasPositions).values({ entityId: entity.id, x: 100, y: 200 });

		await db.delete(entities).where(eq(entities.id, entity.id));

		const remaining = await db
			.select()
			.from(canvasPositions)
			.where(eq(canvasPositions.entityId, entity.id));
		expect(remaining).toHaveLength(0);
	});
});
