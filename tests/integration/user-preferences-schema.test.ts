/**
 * Settings customization Phase 1 — 0024 user_preferences schema invariants.
 *
 * Asserts what the migration guarantees, not how server code uses it
 * (PATCH merge + atomic version bump land in T2/T4 with their own tests):
 *   • table applies on PGlite + new-row defaults (is_active=1, version=1, data={})
 *   • partial unique user_preferences_one_active — at most ONE active row per user
 *   • the constraint is PER-USER (two users each get an active row)
 *   • a user may hold inactive rows alongside the active one (profiles groundwork)
 *   • bump_updated_at trigger fires on UPDATE (and version is NOT auto-bumped —
 *     that's the app-level concurrency counter, not the trigger's job)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { createTestDb, seedTestUser } from '../helpers/test-db.js';
import { userPreferences } from '../../src/lib/server/db/schema.js';

type Db = Awaited<ReturnType<typeof createTestDb>>;

describe('0024 user_preferences — schema invariants', () => {
	let db: Db;
	let userId: string;

	beforeEach(async () => {
		db = await createTestDb();
		userId = (await seedTestUser(db)).id;
	});

	it('applies the migration and new rows pick up defaults', async () => {
		const [row] = await db
			.insert(userPreferences)
			.values({ userId, name: 'Default' })
			.returning();
		expect(row.name).toBe('Default');
		expect(row.isActive).toBe(1);
		expect(row.version).toBe(1);
		expect(row.data).toEqual({});
		expect(row.profileId).toMatch(/^[0-9a-f-]{36}$/); // gen_random_uuid()
		expect(row.initializedFromClientAt).toBeNull();
		expect(row.createdAt).toBeInstanceOf(Date);
	});

	it('rejects a second is_active=1 row for the same user (partial unique)', async () => {
		await db.insert(userPreferences).values({ userId, name: 'Default' });
		// Different profile_id (PK differs) — the rejection must come from the
		// partial unique index user_preferences_one_active, not the PK.
		await expect(
			db.insert(userPreferences).values({ userId, name: 'Second active' })
		).rejects.toThrow();
	});

	it('allows each user their own active row (constraint is per-user)', async () => {
		const otherUserId = (await seedTestUser(db, { email: 'other@test.com' })).id;
		await db.insert(userPreferences).values({ userId, name: 'Default' });
		await expect(
			db.insert(userPreferences).values({ userId: otherUserId, name: 'Default' })
		).resolves.toBeDefined();
		const active = await db
			.select()
			.from(userPreferences)
			.where(eq(userPreferences.isActive, 1));
		expect(active).toHaveLength(2);
	});

	it('allows a user to hold inactive rows alongside the active one (profiles groundwork)', async () => {
		await db.insert(userPreferences).values({ userId, name: 'Default' });
		await expect(
			db.insert(userPreferences).values({ userId, name: 'Map work', isActive: 0 })
		).resolves.toBeDefined();
		const rows = await db
			.select()
			.from(userPreferences)
			.where(eq(userPreferences.userId, userId));
		expect(rows).toHaveLength(2);
		expect(rows.filter((r) => r.isActive === 1)).toHaveLength(1);
	});

	it('bump_updated_at fires on UPDATE; version is NOT auto-bumped by the trigger', async () => {
		const [row] = await db
			.insert(userPreferences)
			.values({ userId, name: 'Default' })
			.returning();
		const before = row.updatedAt.getTime();

		// Ensure wall-clock advances so now() differs across the two txns.
		await new Promise((r) => setTimeout(r, 15));

		const [updated] = await db
			.update(userPreferences)
			.set({ data: { appearance: { theme: 'light' } } })
			.where(
				and(eq(userPreferences.userId, userId), eq(userPreferences.profileId, row.profileId))
			)
			.returning();

		expect(updated.updatedAt.getTime()).toBeGreaterThan(before);
		// The trigger only maintains updated_at. The concurrency counter is
		// app-managed (atomic conditional UPDATE in T2), so an update that does
		// not touch `version` leaves it unchanged.
		expect(updated.version).toBe(1);
	});
});
