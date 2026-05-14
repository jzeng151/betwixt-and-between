/**
 * Invariant test for the world_maps.location_id polymorphic FK.
 *
 * Postgres cannot CHECK a column's referent type, so the invariant
 * "location_id (when non-null) targets entities.type='Location'" is
 * upheld by:
 *   - write-time validation in /api/maps (POST + PATCH)
 *   - this Vitest invariant test scanning every row
 *
 * Same pattern as intervals-invariant.test.ts.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, seedTestUser } from '../helpers/test-db.js';
import { entities, worldMaps } from '../../src/lib/server/db/schema.js';

type Db = Awaited<ReturnType<typeof createTestDb>>;

interface Violation {
	row: typeof worldMaps.$inferSelect;
	detail: string;
}

async function findViolations(db: Db): Promise<Violation[]> {
	const violations: Violation[] = [];
	const rows = await db.select().from(worldMaps);
	for (const row of rows) {
		if (row.locationId == null) continue;
		const [target] = await db
			.select({ type: entities.type })
			.from(entities)
			.where(eq(entities.id, row.locationId));
		if (!target) {
			violations.push({ row, detail: `location_id ${row.locationId} not found` });
			continue;
		}
		if (target.type !== 'Location') {
			violations.push({
				row,
				detail: `location_id ${row.locationId} has type='${target.type}', expected 'Location'`
			});
		}
	}
	return violations;
}

describe('world_maps invariant: location_id polymorphic FK type alignment', () => {
	let db: Db;
	let userId: string;

	beforeEach(async () => {
		db = await createTestDb();
		const u = await seedTestUser(db);
		userId = u.id;
	});

	it('clean DB has no violations', async () => {
		const violations = await findViolations(db);
		expect(violations).toEqual([]);
	});

	it('map unlinked (location_id NULL) is clean', async () => {
		await db.insert(worldMaps).values({ userId, name: 'Unlinked Map' });
		const violations = await findViolations(db);
		expect(violations).toEqual([]);
	});

	it('map linked to a Location entity is clean', async () => {
		const [loc] = await db
			.insert(entities)
			.values({ userId, type: 'Location', name: 'Gondor' })
			.returning();
		await db.insert(worldMaps).values({ userId, name: 'Gondor map', locationId: loc.id });
		const violations = await findViolations(db);
		expect(violations).toEqual([]);
	});

	it('catches location_id pointing at a Character entity', async () => {
		// Plant a bad row directly. The write layer would reject this; we go around it.
		const [character] = await db
			.insert(entities)
			.values({ userId, type: 'Character', name: 'Frodo' })
			.returning();
		await db.insert(worldMaps).values({ userId, name: 'Bad map', locationId: character.id });

		const violations = await findViolations(db);
		expect(violations).toHaveLength(1);
		expect(violations[0].detail).toContain('Character');
	});

	it('SET NULL fires when the linked Location is deleted and stamps location_inactive_at', async () => {
		const [loc] = await db
			.insert(entities)
			.values({ userId, type: 'Location', name: 'Doomed City' })
			.returning();
		const [map] = await db
			.insert(worldMaps)
			.values({ userId, name: 'Doomed', locationId: loc.id })
			.returning();
		expect(map.locationInactiveAt).toBeNull();

		await db.delete(entities).where(eq(entities.id, loc.id));

		const [after] = await db.select().from(worldMaps).where(eq(worldMaps.id, map.id));
		expect(after.locationId).toBeNull();
		// Trigger from migration 0008 must stamp the timestamp so the orphan-map
		// UI can distinguish deletion-driven unlinks from never-linked rows.
		expect(after.locationInactiveAt).not.toBeNull();
		const violations = await findViolations(db);
		expect(violations).toEqual([]);
	});

	it('trigger clears location_inactive_at when a previously orphaned map is re-linked', async () => {
		const [loc1] = await db
			.insert(entities)
			.values({ userId, type: 'Location', name: 'First' })
			.returning();
		const [map] = await db
			.insert(worldMaps)
			.values({ userId, name: 'Roamer', locationId: loc1.id })
			.returning();
		await db.delete(entities).where(eq(entities.id, loc1.id));
		const [orphaned] = await db.select().from(worldMaps).where(eq(worldMaps.id, map.id));
		expect(orphaned.locationInactiveAt).not.toBeNull();

		const [loc2] = await db
			.insert(entities)
			.values({ userId, type: 'Location', name: 'Second' })
			.returning();
		await db.update(worldMaps).set({ locationId: loc2.id }).where(eq(worldMaps.id, map.id));

		const [reLinked] = await db.select().from(worldMaps).where(eq(worldMaps.id, map.id));
		expect(reLinked.locationId).toBe(loc2.id);
		expect(reLinked.locationInactiveAt).toBeNull();
	});
});
