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

// Mirrors the SQL in drizzle/0011_data_model_cleanup.sql statement-for-
// statement. Each destructive statement is wrapped in a DO block with
// RAISE NOTICE in the real migration; the tests run the same DO blocks
// so the NOTICE-vs-no-NOTICE shape doesn't drift between test and prod.
// Final ALTER TABLE blocks install + re-install the CHECK constraints
// that fence the trimmed enum values.
const MIGRATION_STATEMENTS = [
	`DO $$ DECLARE n bigint;
     BEGIN
       SELECT count(*) INTO n FROM relationships WHERE type = 'pov_of';
       RAISE NOTICE '0011: deleting % pov_of rows', n;
       DELETE FROM relationships WHERE type = 'pov_of';
     END $$`,
	// Pre-collision DELETE: drops mentor_of rows that would violate the
	// partial-unique dedup indexes (relationships_timeless_dedup /
	// relationships_temporal_dedup, see 0002_spotlight_temporal.sql)
	// once rewritten to type='other'. Must run BEFORE the UPDATE.
	`DO $$ DECLARE n bigint;
     BEGIN
       SELECT count(*) INTO n FROM relationships m
         WHERE m.type = 'mentor_of'
           AND EXISTS (
             SELECT 1 FROM relationships o
             WHERE o.type = 'other'
               AND o.from_id = m.from_id
               AND o.to_id = m.to_id
               AND (
                 (o.start_position IS NULL AND m.start_position IS NULL)
                 OR o.start_position = m.start_position
               )
           );
       RAISE NOTICE '0011: deleting % mentor_of rows that would collide with existing other rows', n;
       DELETE FROM relationships m
       WHERE m.type = 'mentor_of'
         AND EXISTS (
           SELECT 1 FROM relationships o
           WHERE o.type = 'other'
             AND o.from_id = m.from_id
             AND o.to_id = m.to_id
             AND (
               (o.start_position IS NULL AND m.start_position IS NULL)
               OR o.start_position = m.start_position
             )
         );
     END $$`,
	`DO $$ DECLARE n bigint;
     BEGIN
       SELECT count(*) INTO n FROM relationships WHERE type = 'mentor_of';
       RAISE NOTICE '0011: rewriting % mentor_of rows to other + label', n;
       UPDATE relationships
         SET type = 'other', label = COALESCE(label, 'mentor of')
         WHERE type = 'mentor_of';
     END $$`,
	`DO $$ DECLARE n bigint;
     BEGIN
       SELECT count(*) INTO n FROM relationships WHERE type = 'appears_in';
       RAISE NOTICE '0011: deleting % appears_in rows', n;
       DELETE FROM relationships WHERE type = 'appears_in';
     END $$`,
	`DO $$ DECLARE n bigint;
     BEGIN
       SELECT count(*) INTO n FROM entities WHERE type = 'Door';
       RAISE NOTICE '0011: rewriting % Door entities to Artifact + data.legacySubtype', n;
       UPDATE entities
         SET type = 'Artifact',
             data = jsonb_set(coalesce(data, '{}'::jsonb), '{legacySubtype}', '"door"'::jsonb)
         WHERE type = 'Door';
     END $$`,
	`ALTER TABLE relationships DROP CONSTRAINT IF EXISTS relationships_type_valid`,
	`ALTER TABLE relationships ADD CONSTRAINT relationships_type_valid CHECK (
       type IN (
         'takes_place_at','caused_by','allied_with','rivals',
         'located_at','note_of','part_of','other'
       )
     )`,
	`ALTER TABLE entities DROP CONSTRAINT IF EXISTS entities_type_valid`,
	`ALTER TABLE entities ADD CONSTRAINT entities_type_valid CHECK (
       type IN ('Character','Location','Event','Act','Scene','Note','Artifact','Item')
     )`
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
		// The 0011 migration adds CHECK constraints fencing the trimmed enum
		// values. This test file specifically seeds pre-migration-shape data
		// (cut types like 'pov_of', 'mentor_of', 'appears_in', 'Door') to
		// exercise the cleanup logic — drop the constraints up front so the
		// legacy-shape INSERTs go through. runMigration() re-adds the
		// constraints via its trailing ALTER TABLE statements, so the
		// post-state of any test that calls runMigration() once again has
		// the fence in place. Tests that don't call runMigration() operate
		// against the unfenced shape, which is fine — they're either
		// post-state checks (the constraints survived createTestDb's apply
		// of 0011) or idempotency probes.
		await db.execute(sql`ALTER TABLE relationships DROP CONSTRAINT IF EXISTS relationships_type_valid`);
		await db.execute(sql`ALTER TABLE entities DROP CONSTRAINT IF EXISTS entities_type_valid`);
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

	it('Door rewrite merges into existing data without dropping pre-existing keys', async () => {
		// jsonb_set is supposed to merge a new key into an existing
		// object; this test pins that behavior on a Door with rich
		// pre-existing data so a future rewrite (e.g. switch to ||
		// concatenation, or accidentally overwriting `data`) breaks the
		// invariant rather than silently dropping author content.
		const [door] = await db
			.execute(
				sql`
					INSERT INTO entities (user_id, type, name, data)
					VALUES (${userId}, 'Door', 'Vault Door', '{"locked":true,"keyId":"abc-123","color":"#8b4513"}'::jsonb)
					RETURNING id
				`
			)
			.then((r) => r.rows as Array<{ id: string }>);
		await runMigration(db);
		const rows = await db.select().from(entities).where(sql`id = ${door.id}`);
		const data = rows[0].data as Record<string, unknown>;
		expect(rows[0].type).toBe('Artifact');
		expect(data.legacySubtype).toBe('door');
		expect(data.locked).toBe(true);
		expect(data.keyId).toBe('abc-123');
		expect(data.color).toBe('#8b4513');
	});

	it('mentor_of/other collision: pre-existing other wins; colliding mentor_of dropped', async () => {
		// Per comment 2(b) in 0011_data_model_cleanup.sql. If the same
		// (from, to) pair carries both a mentor_of row AND an other row
		// with the same temporal key, the UPDATE→other would violate
		// relationships_timeless_dedup. The pre-UPDATE DELETE drops the
		// colliding mentor_of; the pre-existing other survives unchanged.
		await db.execute(sql`
			INSERT INTO relationships (user_id, from_id, to_id, type, label)
			VALUES
				(${userId}, ${alice}, ${bob}, 'other', 'colleague'),
				(${userId}, ${alice}, ${bob}, 'mentor_of', NULL)
		`);
		await runMigration(db);
		const rows = await db
			.select()
			.from(relationships)
			.where(sql`from_id = ${alice} AND to_id = ${bob}`);
		expect(rows).toHaveLength(1);
		expect(rows[0].type).toBe('other');
		expect(rows[0].label).toBe('colleague');
	});

	it('mentor_of survives the rewrite when no colliding other row exists', async () => {
		// Negative-space companion to the collision test: with no pre-
		// existing other row for the pair, the mentor_of is rewritten
		// to other with label='mentor of' rather than dropped. Guards
		// against the pre-collision DELETE being too aggressive.
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

	it('NULL+temporal coexistence: a timeless other and a temporal mentor_of on the same pair both survive', async () => {
		// The partial-unique dedup indexes (relationships_timeless_dedup +
		// relationships_temporal_dedup, see 0002_spotlight_temporal.sql)
		// scope by start_position IS NULL vs IS NOT NULL — so a timeless
		// `other` row and a temporal `mentor_of` row on the same (from, to)
		// pair use DIFFERENT partial indexes and do NOT collide. The pre-
		// collision DELETE predicate at 0011:76-87 must NOT fire here; the
		// IS NULL guard on `m.start_position` is what keeps it precise.
		// A regression that dropped the IS NULL conjunct would silently
		// delete the temporal mentor_of and let only the timeless other
		// through.
		//
		// Seed an Act so we have a valid start_act_id for the temporal row
		// (resolveRelationshipBounds would write the position derived from
		// the act FK; here we set it directly because we're bypassing the
		// app layer to seed pre-migration shape).
		const [act] = await db
			.insert(entities)
			.values({ userId, type: 'Act', name: 'Act 1', position: 0 })
			.returning();
		// relationships_position_order CHECK requires either both
		// start_position + end_position NULL, or both non-NULL with
		// start < end. Seed the temporal row at [0, 1).
		await db.execute(sql`
			INSERT INTO relationships (user_id, from_id, to_id, type, label, start_act_id, end_act_id, start_position, end_position)
			VALUES
				(${userId}, ${alice}, ${bob}, 'other', 'colleague', NULL, NULL, NULL, NULL),
				(${userId}, ${alice}, ${bob}, 'mentor_of', NULL, ${act.id}, ${act.id}, 0, 1)
		`);
		await runMigration(db);
		const rows = await db
			.select()
			.from(relationships)
			.where(sql`from_id = ${alice} AND to_id = ${bob}`);
		// Both rows survive. The mentor_of was rewritten to other+label='mentor of'.
		// The timeless other was untouched.
		expect(rows).toHaveLength(2);
		const sorted = [...rows].sort((a, b) => (a.startPosition ?? -1) - (b.startPosition ?? -1));
		expect(sorted[0].type).toBe('other');
		expect(sorted[0].label).toBe('colleague');
		expect(sorted[0].startPosition).toBeNull();
		expect(sorted[1].type).toBe('other');
		expect(sorted[1].label).toBe('mentor of');
		expect(sorted[1].startPosition).toBe(0);
	});

	it('post-migration CHECK constraints reject INSERTs of cut types', async () => {
		// Defense-in-depth assertion. After runMigration(), the CHECK
		// constraints from the migration's trailing ALTER blocks fence
		// the trimmed enum values at the DB level — so a rolling-deploy
		// stale Worker carrying the dead types can no longer silently
		// re-introduce them. PGlite wraps the underlying pg error and
		// the constraint name doesn't appear in the wrapped .message,
		// so we catch the error object and inspect `.code` (Postgres
		// 23514 = check_violation) + `.constraint` (the named constraint
		// the row violated).
		await runMigration(db);
		async function expectCheckViolation(stmt: string, expectedConstraint: string) {
			let caught: unknown;
			try {
				await db.execute(sql.raw(stmt));
			} catch (e) {
				caught = e;
			}
			expect(caught).toBeDefined();
			// Drizzle wraps the PGlite error in DrizzleQueryError; the
			// underlying pg error fields (code, constraint) live on
			// .cause. Fall back to top-level if pg-protocol exposed them
			// directly.
			const e = caught as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
			const code = e.cause?.code ?? e.code;
			const constraint = e.cause?.constraint ?? e.constraint;
			expect(code).toBe('23514');
			expect(constraint).toBe(expectedConstraint);
		}
		for (const t of ['pov_of', 'mentor_of', 'appears_in'] as const) {
			await expectCheckViolation(
				`INSERT INTO relationships (user_id, from_id, to_id, type)
				 VALUES ('${userId}', '${alice}', '${bob}', '${t}')`,
				'relationships_type_valid'
			);
		}
		await expectCheckViolation(
			`INSERT INTO entities (user_id, type, name)
			 VALUES ('${userId}', 'Door', 'D')`,
			'entities_type_valid'
		);
	});

	it('migration is idempotent: re-running on a clean DB is a no-op', async () => {
		const before = await db.select().from(relationships);
		await runMigration(db);
		await runMigration(db);
		const after = await db.select().from(relationships);
		expect(after).toEqual(before);
	});
});
