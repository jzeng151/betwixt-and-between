/**
 * jsonb round-trip: entity.data writes and reads as a JS object, with
 * nested structures preserved.
 *
 * Post-T8a, entity.data is jsonb (not text-stringified-JSON). Drizzle's
 * $type<Record<string, unknown>>() bridges the type without runtime
 * parse/stringify at the boundary. This test guards that the boundary
 * really is invisible — what you put in is what you get out, deep-equal.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/test-db.js';
import { entities } from '../../src/lib/server/db/schema.js';

describe('entities.data jsonb round-trip', () => {
	let db: Awaited<ReturnType<typeof createTestDb>>;

	beforeEach(async () => {
		db = await createTestDb();
	});

	it('preserves a deeply nested object across insert + select', async () => {
		const payload = {
			synopsis: 'In which the door opens',
			arcs: ['intro', 'descent', 'return'],
			beats: {
				inciting: 'cat enters',
				midpoint: { kind: 'reversal', impact: 8 },
				ending: null
			},
			counts: { words: 1234, scenes: 5 }
		};
		const [created] = await db
			.insert(entities)
			.values({ type: 'Act', name: 'Act I', data: payload })
			.returning();

		const [read] = await db.select().from(entities).where(eq(entities.id, created.id));
		expect(read.data).toEqual(payload);
		// Type assertion: we get JS objects/arrays/nulls, not strings.
		expect(typeof read.data).toBe('object');
		expect(Array.isArray((read.data as Record<string, unknown>).arcs)).toBe(true);
	});

	it('preserves unicode and special characters', async () => {
		const payload = {
			quote: 'Iść — naprzód! 「行く」',
			emoji: '🎭',
			control: 'tab\there\nnewline'
		};
		const [created] = await db
			.insert(entities)
			.values({ type: 'Note', name: 'q', data: payload })
			.returning();
		const [read] = await db.select().from(entities).where(eq(entities.id, created.id));
		expect(read.data).toEqual(payload);
	});

	it('updates data via .set() with a new object replaces (not merges)', async () => {
		const [created] = await db
			.insert(entities)
			.values({ type: 'Character', name: 'C', data: { age: 30, role: 'hero' } })
			.returning();

		await db
			.update(entities)
			.set({ data: { age: 31 } })
			.where(eq(entities.id, created.id));

		const [read] = await db.select().from(entities).where(eq(entities.id, created.id));
		// jsonb assignment replaces the whole field. Caller is responsible
		// for spreading existing data if a merge is desired.
		expect(read.data).toEqual({ age: 31 });
	});

	it('defaults to {} when omitted on insert', async () => {
		const [created] = await db
			.insert(entities)
			.values({ type: 'Note', name: 'untitled' })
			.returning();
		expect(created.data).toEqual({});
	});
});
