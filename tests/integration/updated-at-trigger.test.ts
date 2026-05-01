/**
 * BEFORE UPDATE trigger fires on every UPDATE: updated_at advances past
 * created_at without application code setting it.
 *
 * The trigger replaces 17 manual `updatedAt: sql\`(unixepoch())\`` lines
 * from the sqlite era. If the trigger ever silently fails to fire (e.g.,
 * dropped from a future migration), timestamps go stale and we lose a
 * piece of audit data — but no test would surface it. This guards that.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/test-db.js';
import { entities, intervals } from '../../src/lib/server/db/schema.js';

describe('bump_updated_at BEFORE UPDATE trigger', () => {
	let db: Awaited<ReturnType<typeof createTestDb>>;

	beforeEach(async () => {
		db = await createTestDb();
	});

	it('advances entities.updated_at on UPDATE without app-side updatedAt set', async () => {
		const [row] = await db
			.insert(entities)
			.values({ type: 'Act', name: 'A' })
			.returning();
		const initial = row.updatedAt;

		// Sleep ~10ms to ensure the timestamp can advance.
		await new Promise((r) => setTimeout(r, 10));

		await db.update(entities).set({ name: 'A renamed' }).where(eq(entities.id, row.id));

		const [after] = await db.select().from(entities).where(eq(entities.id, row.id));
		expect(after.updatedAt.getTime()).toBeGreaterThan((initial as Date).getTime());
		expect(after.name).toBe('A renamed');
	});

	it('advances intervals.updated_at on UPDATE without app-side updatedAt set', async () => {
		// Build an interval via raw insert (bypassing writeInterval to keep
		// the test focused on trigger semantics, not chokepoint logic).
		const [act0] = await db
			.insert(entities)
			.values({ type: 'Act', name: 'Act 0', position: 0 })
			.returning();
		const [ellie] = await db
			.insert(entities)
			.values({ type: 'Character', name: 'Ellie' })
			.returning();
		const [interval] = await db
			.insert(intervals)
			.values({
				entityId: ellie.id,
				startActId: act0.id,
				endActId: act0.id,
				startPosition: 0,
				endPosition: 1
			})
			.returning();
		const initial = interval.updatedAt;

		await new Promise((r) => setTimeout(r, 10));
		await db
			.update(intervals)
			.set({ endPosition: 0.5 })
			.where(eq(intervals.id, interval.id));

		const [after] = await db
			.select()
			.from(intervals)
			.where(eq(intervals.id, interval.id));
		expect(after.updatedAt.getTime()).toBeGreaterThan((initial as Date).getTime());
	});

	it('does not advance updated_at on no-op SELECT', async () => {
		const [row] = await db
			.insert(entities)
			.values({ type: 'Note', name: 'n' })
			.returning();
		const initial = row.updatedAt;

		await new Promise((r) => setTimeout(r, 10));
		// Read-only query — trigger should not fire.
		await db.select().from(entities).where(eq(entities.id, row.id));

		const [after] = await db.select().from(entities).where(eq(entities.id, row.id));
		expect(after.updatedAt.getTime()).toBe((initial as Date).getTime());
	});
});
