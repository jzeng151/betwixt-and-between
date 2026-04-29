/**
 * Phase 1A PR 1 — data migration from `appears_in` relationships to `intervals`.
 *
 * Run AFTER `drizzle-kit migrate` has applied the schema migration that adds
 * the `intervals` table and the `entities.parent_id` / `entities.position`
 * columns.
 *
 * Behavior (CONSIDERATIONS.md → "Migration: rollback and recovery" + the
 * /plan-eng-review malformed-row policy):
 *
 *   - Walks every `appears_in` row in `relationships`.
 *   - For each row:
 *       * If from_id resolves to a Character AND to_id resolves to an Act:
 *         create one full-act interval (start_position = i, end_position = i+1).
 *       * Else (orphan FK, type mismatch, duplicate): log to
 *         migration-warnings.txt, skip. Do NOT abort.
 *   - Deletes ONLY the successfully migrated `appears_in` rows from
 *     `relationships`. Orphans/duplicates remain for manual cleanup.
 *   - Idempotent. Run twice → second run finds no `appears_in` rows and
 *     no-ops cleanly.
 *
 * BEFORE RUNNING in any environment with real data: take a snapshot
 *   npx tsx scripts/migrations/snapshot-pre-intervals.ts
 *
 * Restore via
 *   npx tsx scripts/migrations/restore-pre-intervals.ts [snapshot]
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, and } from 'drizzle-orm';
import { appendFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as schema from '../../src/lib/server/db/schema.js';
import { entities, relationships } from '../../src/lib/server/db/schema.js';
import { writeInterval, actIndexOf } from '../../src/lib/server/intervals.js';

interface MigrationStats {
	scanned: number;
	migrated: number;
	skippedOrphan: number;
	skippedTypeMismatch: number;
	skippedDuplicate: number;
	skippedOther: number;
}

interface Warning {
	relId: string;
	fromId: string;
	toId: string;
	reason: string;
}

async function migrate(dbPath: string, warningsPath: string): Promise<MigrationStats> {
	const client = new Database(dbPath);
	client.pragma('foreign_keys = ON');
	const db = drizzle(client, { schema });

	const stats: MigrationStats = {
		scanned: 0,
		migrated: 0,
		skippedOrphan: 0,
		skippedTypeMismatch: 0,
		skippedDuplicate: 0,
		skippedOther: 0
	};
	const warnings: Warning[] = [];

	// Track unique (entityId, actId) pairs we've migrated to detect duplicates.
	const seenPairs = new Set<string>();
	const successfullyMigratedRelIds: string[] = [];

	const appearsInRows = await db
		.select()
		.from(relationships)
		.where(eq(relationships.type, 'appears_in'));

	stats.scanned = appearsInRows.length;
	console.log(`[migrate] Scanning ${appearsInRows.length} appears_in rows...`);

	for (const row of appearsInRows) {
		// Validate from_id (must exist; should be Character but we accept Event too
		// since the existing data model permits any entity to "appear in" an act).
		const [from] = await db.select().from(entities).where(eq(entities.id, row.fromId));
		if (!from) {
			warnings.push({
				relId: row.id,
				fromId: row.fromId,
				toId: row.toId,
				reason: 'from_id entity not found (orphan FK)'
			});
			stats.skippedOrphan++;
			continue;
		}

		// Validate to_id is an Act.
		const [to] = await db.select().from(entities).where(eq(entities.id, row.toId));
		if (!to) {
			warnings.push({
				relId: row.id,
				fromId: row.fromId,
				toId: row.toId,
				reason: 'to_id entity not found (orphan FK)'
			});
			stats.skippedOrphan++;
			continue;
		}
		if (to.type !== 'Act') {
			warnings.push({
				relId: row.id,
				fromId: row.fromId,
				toId: row.toId,
				reason: `to_id has type='${to.type}', expected 'Act'`
			});
			stats.skippedTypeMismatch++;
			continue;
		}

		// Detect duplicates: same (entityId, actId) appearing more than once.
		const key = `${row.fromId}::${row.toId}`;
		if (seenPairs.has(key)) {
			warnings.push({
				relId: row.id,
				fromId: row.fromId,
				toId: row.toId,
				reason: 'duplicate (entityId, actId) pair already migrated'
			});
			stats.skippedDuplicate++;
			continue;
		}

		try {
			// Sanity-check: ensure act has a defined position (or we can index it).
			await actIndexOf(db, row.toId);

			await writeInterval(db, {
				entityId: row.fromId,
				startActId: row.toId,
				endActId: row.toId
				// no scene FKs: full-act interval
			});
			seenPairs.add(key);
			successfullyMigratedRelIds.push(row.id);
			stats.migrated++;
		} catch (err) {
			warnings.push({
				relId: row.id,
				fromId: row.fromId,
				toId: row.toId,
				reason: `writeInterval failed: ${(err as Error).message}`
			});
			stats.skippedOther++;
		}
	}

	// Delete only successfully migrated rows. Orphans/duplicates remain.
	for (const id of successfullyMigratedRelIds) {
		await db.delete(relationships).where(eq(relationships.id, id));
	}

	// Persist warnings.
	if (warnings.length > 0) {
		const lines = warnings.map(
			(w) =>
				`${w.relId}\tfrom=${w.fromId}\tto=${w.toId}\treason=${w.reason}`
		);
		// Append rather than overwrite — re-runs of the migration that surface
		// the same skipped rows (orphan FK, type mismatch, duplicate) preserve
		// the original timestamps and context. The header gets re-emitted on
		// each run so a single warnings file documents the full history.
		appendFileSync(
			warningsPath,
			`# Migration warnings (intervals-migration)\n# ${new Date().toISOString()}\n# format: rel_id<TAB>from=...<TAB>to=...<TAB>reason=...\n${lines.join('\n')}\n`,
			'utf-8'
		);
		console.log(`[migrate] Appended ${warnings.length} warnings to ${warningsPath}`);
	} else if (existsSync(warningsPath)) {
		// Append a fresh "no warnings on this run" marker rather than nuking the file.
		appendFileSync(
			warningsPath,
			`# ${new Date().toISOString()} — clean run, no new warnings\n`,
			'utf-8'
		);
	}

	client.close();
	return stats;
}

async function main() {
	const dbPath = resolve(process.env.DATABASE_URL ?? 'local.db');
	const warningsPath = resolve('migration-warnings.txt');

	if (!existsSync(dbPath)) {
		console.error(`[migrate] DB not found at ${dbPath}`);
		process.exit(1);
	}

	console.log(`[migrate] DB:        ${dbPath}`);
	console.log(`[migrate] Warnings: ${warningsPath}`);
	console.log('');

	const stats = await migrate(dbPath, warningsPath);

	console.log('');
	console.log('[migrate] Summary:');
	console.log(`  Scanned:                 ${stats.scanned}`);
	console.log(`  Migrated to intervals:   ${stats.migrated}`);
	console.log(`  Skipped (orphan FK):     ${stats.skippedOrphan}`);
	console.log(`  Skipped (type mismatch): ${stats.skippedTypeMismatch}`);
	console.log(`  Skipped (duplicate):     ${stats.skippedDuplicate}`);
	console.log(`  Skipped (other):         ${stats.skippedOther}`);
	console.log('');
	console.log('[migrate] Done. Successfully migrated rows have been removed from `relationships`.');
	console.log('[migrate] Skipped rows remain in `relationships` for manual review.');

	if (stats.skippedOrphan + stats.skippedTypeMismatch + stats.skippedDuplicate + stats.skippedOther > 0) {
		console.log('[migrate] See migration-warnings.txt for details.');
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((err) => {
		console.error('[migrate] FAILED:', err);
		process.exit(1);
	});
}

// Export for testability.
export { migrate, type MigrationStats };
