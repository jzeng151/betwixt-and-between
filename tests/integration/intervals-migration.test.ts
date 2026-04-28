/**
 * Tests for the appears_in → intervals migration script.
 *
 * Critical regression cases from /plan-eng-review test plan:
 *   - migration is idempotent (run twice → same final state, no errors)
 *   - malformed appears_in policy: orphan FK / type mismatch / duplicates →
 *     logged + skipped, not aborted
 *   - fresh-install path (no appears_in rows) → no-op
 *   - existing-data path → N appears_in → N intervals
 *   - delete-Act cascade smoke (Reviewer Concern from design doc)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync, readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import * as schema from '../../src/lib/server/db/schema.js';
import { entities, relationships, intervals } from '../../src/lib/server/db/schema.js';
import { SCHEMA_DDL, seedActs } from '../helpers/test-db.js';
import { migrate } from '../../scripts/migrations/intervals-migration.js';

function createFileBackedDb() {
	// migrate() opens its own Database connection via dbPath, so we need a real
	// file the script can re-open. Use a temp path.
	const path = join(tmpdir(), `betwixt-test-${randomUUID()}.db`);
	const client = new Database(path);
	client.pragma('foreign_keys = ON');
	client.exec(SCHEMA_DDL);
	const db = drizzle(client, { schema });
	return { db, client, path };
}

describe('intervals migration', () => {
	let dbPath: string;
	let warningsPath: string;

	beforeEach(() => {
		dbPath = '';
		warningsPath = '';
	});

	afterEach(() => {
		// Best-effort cleanup of temp files.
		if (dbPath && existsSync(dbPath)) {
			try {
				unlinkSync(dbPath);
			} catch {
				// best-effort
			}
		}
		if (warningsPath && existsSync(warningsPath)) {
			try {
				unlinkSync(warningsPath);
			} catch {
				// best-effort
			}
		}
	});

	it('fresh-install path: no appears_in rows → no-op, all stats zero', async () => {
		const { db, client, path } = createFileBackedDb();
		await seedActs(db);
		client.close();
		dbPath = path;
		warningsPath = `${path}.warnings.txt`;

		const stats = await migrate(dbPath, warningsPath);
		expect(stats.scanned).toBe(0);
		expect(stats.migrated).toBe(0);
		expect(stats.skippedOrphan).toBe(0);
		expect(stats.skippedTypeMismatch).toBe(0);
		expect(stats.skippedDuplicate).toBe(0);
	});

	it('migrates existing appears_in rows to intervals', async () => {
		const { db, client, path } = createFileBackedDb();
		const acts = await seedActs(db);
		const [ellie] = await db
			.insert(entities)
			.values({ type: 'Character', name: 'Ellie' })
			.returning();
		const [damien] = await db
			.insert(entities)
			.values({ type: 'Character', name: 'Damien' })
			.returning();

		await db.insert(relationships).values({
			fromId: ellie.id,
			toId: acts.act0,
			type: 'appears_in'
		});
		await db.insert(relationships).values({
			fromId: ellie.id,
			toId: acts.act1,
			type: 'appears_in'
		});
		await db.insert(relationships).values({
			fromId: damien.id,
			toId: acts.act2,
			type: 'appears_in'
		});
		// A non-appears_in relationship that should NOT be touched.
		await db.insert(relationships).values({
			fromId: ellie.id,
			toId: damien.id,
			type: 'rivals'
		});

		client.close();
		dbPath = path;
		warningsPath = `${path}.warnings.txt`;

		const stats = await migrate(dbPath, warningsPath);
		expect(stats.scanned).toBe(3);
		expect(stats.migrated).toBe(3);
		expect(stats.skippedOrphan).toBe(0);

		// Verify against the same DB.
		const verify = new Database(path);
		const dbV = drizzle(verify, { schema });
		const ints = await dbV.select().from(intervals);
		const rels = await dbV.select().from(relationships);
		verify.close();

		expect(ints).toHaveLength(3);
		// Ellie has two intervals (Act 0 + Act 1), Damien one (Act 2).
		const ellieInts = ints.filter((i) => i.entityId === ellie.id);
		const damienInts = ints.filter((i) => i.entityId === damien.id);
		expect(ellieInts).toHaveLength(2);
		expect(damienInts).toHaveLength(1);
		// All migrated full-act: positions [i, i+1).
		for (const r of ints) {
			expect(r.endPosition - r.startPosition).toBeCloseTo(1.0, 9);
			expect(r.startSceneId).toBeNull();
			expect(r.endSceneId).toBeNull();
		}
		// Only the rivals relationship survives in `relationships`.
		expect(rels).toHaveLength(1);
		expect(rels[0].type).toBe('rivals');
	});

	it('idempotent: running twice does not duplicate intervals', async () => {
		const { db, client, path } = createFileBackedDb();
		const acts = await seedActs(db);
		const [ellie] = await db
			.insert(entities)
			.values({ type: 'Character', name: 'Ellie' })
			.returning();
		await db.insert(relationships).values({
			fromId: ellie.id,
			toId: acts.act0,
			type: 'appears_in'
		});
		client.close();
		dbPath = path;
		warningsPath = `${path}.warnings.txt`;

		await migrate(dbPath, warningsPath);
		const stats2 = await migrate(dbPath, warningsPath);

		// Second run: nothing left to migrate.
		expect(stats2.scanned).toBe(0);
		expect(stats2.migrated).toBe(0);

		const verify = new Database(path);
		const dbV = drizzle(verify, { schema });
		const ints = await dbV.select().from(intervals);
		verify.close();
		expect(ints).toHaveLength(1);
	});

	it('logs warnings for malformed rows: type mismatch (to_id is Character, not Act)', async () => {
		const { db, client, path } = createFileBackedDb();
		await seedActs(db);
		const [ellie] = await db
			.insert(entities)
			.values({ type: 'Character', name: 'Ellie' })
			.returning();
		const [damien] = await db
			.insert(entities)
			.values({ type: 'Character', name: 'Damien' })
			.returning();
		// Pointing appears_in at a Character — that's malformed.
		await db.insert(relationships).values({
			fromId: ellie.id,
			toId: damien.id,
			type: 'appears_in'
		});
		client.close();
		dbPath = path;
		warningsPath = `${path}.warnings.txt`;

		const stats = await migrate(dbPath, warningsPath);
		expect(stats.scanned).toBe(1);
		expect(stats.migrated).toBe(0);
		expect(stats.skippedTypeMismatch).toBe(1);

		expect(existsSync(warningsPath)).toBe(true);
		// Malformed row remains in relationships for manual cleanup.
		const verify = new Database(path);
		const dbV = drizzle(verify, { schema });
		const rels = await dbV.select().from(relationships);
		verify.close();
		expect(rels).toHaveLength(1);
		expect(rels[0].type).toBe('appears_in');
	});

	it('logs warnings for duplicate (entityId, actId) pairs', async () => {
		const { db, client, path } = createFileBackedDb();
		const acts = await seedActs(db);
		const [ellie] = await db
			.insert(entities)
			.values({ type: 'Character', name: 'Ellie' })
			.returning();
		// Two appears_in rows for the same character/act.
		await db.insert(relationships).values({
			fromId: ellie.id,
			toId: acts.act0,
			type: 'appears_in'
		});
		await db.insert(relationships).values({
			fromId: ellie.id,
			toId: acts.act0,
			type: 'appears_in'
		});
		client.close();
		dbPath = path;
		warningsPath = `${path}.warnings.txt`;

		const stats = await migrate(dbPath, warningsPath);
		expect(stats.scanned).toBe(2);
		expect(stats.migrated).toBe(1);
		expect(stats.skippedDuplicate).toBe(1);

		const verify = new Database(path);
		const dbV = drizzle(verify, { schema });
		const ints = await dbV.select().from(intervals);
		const rels = await dbV
			.select()
			.from(relationships)
			.where(eq(relationships.type, 'appears_in'));
		verify.close();
		expect(ints).toHaveLength(1);
		// The duplicate row remains in relationships.
		expect(rels).toHaveLength(1);
	});

	// Greptile P2 regression: warnings file uses appendFileSync, not writeFileSync.
	// Re-running the migration after malformed rows still surface must PRESERVE
	// the original run's history rather than overwriting it.
	it('appends to warnings file across runs; does not overwrite earlier history', async () => {
		const { db, client, path } = createFileBackedDb();
		await seedActs(db);
		const [ellie] = await db
			.insert(entities)
			.values({ type: 'Character', name: 'Ellie' })
			.returning();
		const [damien] = await db
			.insert(entities)
			.values({ type: 'Character', name: 'Damien' })
			.returning();
		// Plant a malformed row that will be skipped both runs (Char→Char).
		await db.insert(relationships).values({
			fromId: ellie.id,
			toId: damien.id,
			type: 'appears_in'
		});
		client.close();
		dbPath = path;
		warningsPath = `${path}.warnings.txt`;

		// First run
		const stats1 = await migrate(dbPath, warningsPath);
		expect(stats1.skippedTypeMismatch).toBe(1);
		expect(existsSync(warningsPath)).toBe(true);
		const firstContents = readFileSync(warningsPath, 'utf-8');
		// First run should have written exactly one warning block + one warning line.
		const firstHeaderCount = (firstContents.match(/# Migration warnings/g) ?? []).length;
		expect(firstHeaderCount).toBe(1);

		// Second run: same malformed row remains and is skipped again.
		const stats2 = await migrate(dbPath, warningsPath);
		expect(stats2.skippedTypeMismatch).toBe(1);
		const secondContents = readFileSync(warningsPath, 'utf-8');
		// File grew (append) rather than was replaced (overwrite).
		expect(secondContents.length).toBeGreaterThan(firstContents.length);
		// The first run's header/timestamp is still present.
		expect(secondContents.startsWith(firstContents)).toBe(true);
		// And there are now TWO header blocks.
		const secondHeaderCount = (secondContents.match(/# Migration warnings/g) ?? []).length;
		expect(secondHeaderCount).toBe(2);
	});
});

