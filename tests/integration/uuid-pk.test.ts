/**
 * uuid PKs auto-generated via gen_random_uuid() (Drizzle's defaultRandom).
 *
 * Post-T8a, all 4 tables (entities, relationships, canvas_positions,
 * intervals) use uuid('id').defaultRandom() instead of the sqlite-era
 * text('id').$defaultFn(() => crypto.randomUUID()) pattern. This test
 * confirms the default actually fires server-side and produces a
 * valid v4 uuid string.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../helpers/test-db.js';
import { entities, relationships, canvasPositions, intervals } from '../../src/lib/server/db/schema.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('auto-generated uuid PKs', () => {
	let db: Awaited<ReturnType<typeof createTestDb>>;

	beforeEach(async () => {
		db = await createTestDb();
	});

	it('entities.id auto-generates a v4 uuid when not specified', async () => {
		const [row] = await db
			.insert(entities)
			.values({ type: 'Act', name: 'A' })
			.returning();
		expect(row.id).toMatch(UUID_V4);
	});

	it('relationships.id auto-generates a v4 uuid', async () => {
		const [a] = await db
			.insert(entities)
			.values({ type: 'Character', name: 'A' })
			.returning();
		const [b] = await db
			.insert(entities)
			.values({ type: 'Character', name: 'B' })
			.returning();
		const [rel] = await db
			.insert(relationships)
			.values({ fromId: a.id, toId: b.id, type: 'allied_with' })
			.returning();
		expect(rel.id).toMatch(UUID_V4);
	});

	it('canvas_positions.id auto-generates a v4 uuid', async () => {
		const [a] = await db
			.insert(entities)
			.values({ type: 'Character', name: 'A' })
			.returning();
		const [pos] = await db
			.insert(canvasPositions)
			.values({ entityId: a.id, x: 10, y: 20 })
			.returning();
		expect(pos.id).toMatch(UUID_V4);
	});

	it('intervals.id auto-generates a v4 uuid', async () => {
		const [act] = await db
			.insert(entities)
			.values({ type: 'Act', name: 'Act 0', position: 0 })
			.returning();
		const [ellie] = await db
			.insert(entities)
			.values({ type: 'Character', name: 'Ellie' })
			.returning();
		const [iv] = await db
			.insert(intervals)
			.values({
				entityId: ellie.id,
				startActId: act.id,
				endActId: act.id,
				startPosition: 0,
				endPosition: 1
			})
			.returning();
		expect(iv.id).toMatch(UUID_V4);
	});

	it('two consecutive inserts produce different uuids (collision check)', async () => {
		const [a] = await db
			.insert(entities)
			.values({ type: 'Note', name: 'a' })
			.returning();
		const [b] = await db
			.insert(entities)
			.values({ type: 'Note', name: 'b' })
			.returning();
		expect(a.id).not.toBe(b.id);
	});
});
