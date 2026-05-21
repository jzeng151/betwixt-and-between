/**
 * Post-migration invariants for drizzle/0011_data_model_cleanup.sql
 * (Step 5.5, 2026-05-21 — see docs/plans/codebase-restructure-2026-05-20.md).
 *
 * The migration retires four data-model surfaces flagged by the
 * 2026-05-20 whole-app /office-hours audit:
 *
 *   1. pov_of  — DELETE
 *   2. mentor_of — UPDATE → other + label='mentor of' (label is a text
 *                  column on relationships, not data.label)
 *   3. appears_in — DELETE (per user decision 2026-05-21; ADR 0002's
 *                   "Drop plan unclear" closed out with delete-only)
 *   4. Door entity type — UPDATE → Artifact + data.legacySubtype='door'
 *
 * createTestDb() applies all drizzle/*.sql migrations at boot, so any
 * inserts made through the Drizzle API after that point will already be
 * rejected by the trimmed TS enums. To prove the migration LOGIC
 * (not just the enum trim), this test bypasses the TS layer with raw
 * SQL inserts, then runs each migration statement and asserts the
 * resulting state.
 *
 * Note: `entities.type` and `relationships.type` are plain text columns
 * (the enum is enforced TS-side + at the API layer; see schema.ts
 * comments), so raw SQL can insert legacy values that mirror the shape
 * of pre-migration prod data.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { createTestDb, seedTestUser } from '../helpers/test-db.js';
import { entities, relationships } from '../../src/lib/server/db/schema.js';

type Db = Awaited<ReturnType<typeof createTestDb>>;

const MIGRATION_STATEMENTS = [
	`DELETE FROM relationships WHERE type = 'pov_of'`,
	`UPDATE relationships
     SET type = 'other', label = COALESCE(label, 'mentor of')
     WHERE type = 'mentor_of'`,
	`DELETE FROM relationships WHERE type = 'appears_in'`,
	`UPDATE entities
     SET type = 'Artifact',
         data = jsonb_set(coalesce(data, '{}'::jsonb), '{legacySubtype}', '"door"'::jsonb)
     WHERE type = 'Door'`
] as const;

async function runMigration(db: Db) {
	for (const stmt of MIGRATION_STATEMENTS) {
		await db.execute(sql.raw(stmt));
	}
}

describe('drizzle/0011_data_model_cleanup.sql', () => {
	let db: Db;
	let userId: string;
	let alice: string;
	let bob: string;

	beforeEach(async () => {
		db = await createTestDb();
		const u = await seedTestUser(db);
		userId = u.id;
		const [a] = await db
			.insert(entities)
			.values({ userId, type: 'Character', name: 'Alice' })
			.returning();
		const [b] = await db
			.insert(entities)
			.values({ userId, type: 'Character', name: 'Bob' })
			.returning();
		alice = a.id;
		bob = b.id;
	});

	it('post-state: no relationships rows of any cut type', async () => {
		const cut = await db.execute(sql`
			SELECT count(*)::int AS n
			FROM relationships
			WHERE type IN ('pov_of', 'mentor_of', 'appears_in')
		`);
		expect(Number((cut.rows[0] as { n: number }).n)).toBe(0);
	});

	it('post-state: no entities rows of type=Door', async () => {
		const cut = await db.execute(sql`
			SELECT count(*)::int AS n
			FROM entities
			WHERE type = 'Door'
		`);
		expect(Number((cut.rows[0] as { n: number }).n)).toBe(0);
	});

	it('migration deletes pov_of rows', async () => {
		await db.execute(sql`
			INSERT INTO relationships (user_id, from_id, to_id, type)
			VALUES (${userId}, ${alice}, ${bob}, 'pov_of')
		`);
		await runMigration(db);
		const after = await db.execute(sql`
			SELECT count(*)::int AS n FROM relationships WHERE type = 'pov_of'
		`);
		expect(Number((after.rows[0] as { n: number }).n)).toBe(0);
	});

	it('migration rewrites mentor_of → other + label="mentor of"', async () => {
		await db.execute(sql`
			INSERT INTO relationships (user_id, from_id, to_id, type)
			VALUES (${userId}, ${alice}, ${bob}, 'mentor_of')
		`);
		await runMigration(db);
		const rows = await db
			.select()
			.from(relationships)
			.where(sql`from_id = ${alice} AND to_id = ${bob}`);
		expect(rows).toHaveLength(1);
		expect(rows[0].type).toBe('other');
		expect(rows[0].label).toBe('mentor of');
	});

	it('migration preserves an existing label when rewriting mentor_of', async () => {
		// COALESCE protects an author who already labeled the mentorship
		// with something more specific. Pre-cut, the label was free-form
		// on top of the typed edge; post-cut, it's the only source of
		// human-readable name.
		await db.execute(sql`
			INSERT INTO relationships (user_id, from_id, to_id, type, label)
			VALUES (${userId}, ${alice}, ${bob}, 'mentor_of', 'patron of')
		`);
		await runMigration(db);
		const rows = await db
			.select()
			.from(relationships)
			.where(sql`from_id = ${alice} AND to_id = ${bob}`);
		expect(rows[0].type).toBe('other');
		expect(rows[0].label).toBe('patron of');
	});

	it('migration deletes appears_in rows', async () => {
		await db.execute(sql`
			INSERT INTO relationships (user_id, from_id, to_id, type)
			VALUES (${userId}, ${alice}, ${bob}, 'appears_in')
		`);
		await runMigration(db);
		const after = await db.execute(sql`
			SELECT count(*)::int AS n FROM relationships WHERE type = 'appears_in'
		`);
		expect(Number((after.rows[0] as { n: number }).n)).toBe(0);
	});

	it('migration rewrites Door entities → Artifact + data.legacySubtype="door"', async () => {
		const [door] = await db
			.execute(
				sql`
					INSERT INTO entities (user_id, type, name)
					VALUES (${userId}, 'Door', 'Throne Room Door')
					RETURNING id
				`
			)
			.then((r) => r.rows as Array<{ id: string }>);
		await runMigration(db);
		const rows = await db
			.select()
			.from(entities)
			.where(sql`id = ${door.id}`);
		expect(rows).toHaveLength(1);
		expect(rows[0].type).toBe('Artifact');
		expect((rows[0].data as Record<string, unknown>)?.legacySubtype).toBe('door');
	});

	it('migration is idempotent: re-running on a clean DB is a no-op', async () => {
		const before = await db.select().from(relationships);
		await runMigration(db);
		await runMigration(db);
		const after = await db.select().from(relationships);
		expect(after).toEqual(before);
	});
});
