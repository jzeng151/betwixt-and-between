/**
 * Shared in-process Postgres test DB factory (PGlite).
 *
 * PGlite is Postgres compiled to WASM — same engine, same SQL, same query
 * planner, same transaction semantics as full Postgres. Runs in-process
 * with no Docker, no Testcontainers, no external service. Replaces the
 * sqlite better-sqlite3-in-memory pattern from the pre-T8a era.
 *
 * Each call returns a fresh DB with the production schema applied via
 * the same `drizzle/0000_*.sql` migration that runs against Neon in prod.
 * That keeps tests honest: if a migration drifts from `schema.ts`, tests
 * catch it; the test DDL is no longer a hand-maintained mirror.
 *
 * createTestDb() is async (PGlite boot + migration apply). Update callers:
 *   const db = await createTestDb();
 *   let db: Awaited<ReturnType<typeof createTestDb>>;
 */

import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { drizzle } from 'drizzle-orm/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as schema from '../../src/lib/server/db/schema.js';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'drizzle');

/**
 * Read all .sql migration files in order and return the concatenated DDL.
 * drizzle-kit's `--> statement-breakpoint` markers are split into separate
 * exec() calls because PGlite executes one statement per exec.
 */
function loadMigrations(): string[] {
	const files = readdirSync(MIGRATIONS_DIR)
		.filter((f) => f.endsWith('.sql'))
		.sort();
	const statements: string[] = [];
	for (const file of files) {
		const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
		// Drizzle splits statements with `--> statement-breakpoint`. Split
		// on that marker; trim; drop empties.
		const parts = sql
			.split('--> statement-breakpoint')
			.map((s) => s.trim())
			.filter((s) => s.length > 0);
		statements.push(...parts);
	}
	return statements;
}

const MIGRATION_STATEMENTS = loadMigrations();

export async function createTestDb() {
	// btree_gist is needed for the world_maps variant EXCLUDE constraint
	// (migration 0009). PGlite ships the extension bundle but only loads
	// it when explicitly registered here.
	const client = new PGlite({ extensions: { btree_gist } });
	await client.waitReady;
	for (const stmt of MIGRATION_STATEMENTS) {
		await client.exec(stmt);
	}
	return drizzle(client, { schema });
}

export type TestDb = Awaited<ReturnType<typeof createTestDb>>;

/**
 * Convenience: seed three Acts (positions 0, 1, 2) into a fresh test DB.
 *
 * Pass `userId` to scope the acts to a user (required after T8b S5'). Tests
 * that don't yet thread userId can call the legacy form `seedActs(db)` —
 * acts are inserted with userId NULL and intervals.ts functions called with a
 * matching null-equivalent userId will not see them. New tests should always
 * pass userId.
 */
export async function seedActs(db: TestDb, userId?: string) {
	const { entities } = await import('../../src/lib/server/db/schema.js');
	const [act0] = await db
		.insert(entities)
		.values({ userId: userId ?? null, type: 'Act', name: 'Act 0', position: 0 })
		.returning();
	const [act1] = await db
		.insert(entities)
		.values({ userId: userId ?? null, type: 'Act', name: 'Act 1', position: 1 })
		.returning();
	const [act2] = await db
		.insert(entities)
		.values({ userId: userId ?? null, type: 'Act', name: 'Act 2', position: 2 })
		.returning();
	return { act0: act0.id, act1: act1.id, act2: act2.id };
}

/** Seed a test user row for auth-gated integration tests. Returns user fields for mkEvent. */
export async function seedTestUser(
	db: TestDb,
	overrides?: { id?: string; email?: string; name?: string },
) {
	const { user } = await import('../../src/lib/server/db/schema.js');
	const id = overrides?.id ?? crypto.randomUUID();
	const [row] = await db
		.insert(user)
		.values({
			id,
			name: overrides?.name ?? 'Test User',
			email: overrides?.email ?? `test-${id.slice(0, 8)}@test.com`,
			emailVerified: true,
		})
		.returning();
	return { id: row.id, name: row.name, email: row.email };
}
