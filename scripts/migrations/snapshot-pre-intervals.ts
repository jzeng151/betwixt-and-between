/**
 * Pre-intervals migration snapshot.
 *
 * Locked at /plan-eng-review (CONSIDERATIONS.md → "Migration: rollback and recovery").
 * Decision: SQLite native `.backup` (binary) over JSON export. Schema-drift-safe by
 * design — the backup IS the schema-of-the-time. Restore is a literal file copy.
 *
 * Run:   bun --bun scripts/migrations/snapshot-pre-intervals.ts [path-to-db]
 *   or:  npx tsx scripts/migrations/snapshot-pre-intervals.ts [path-to-db]
 *
 * Defaults to $DATABASE_URL or local.db. Writes
 *   {db}.backup-pre-intervals-{ISO timestamp}
 * next to the source.
 *
 * If you need human-readable inspection of the snapshot:
 *   sqlite3 {snapshot} ".dump" > snapshot.sql
 */

import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';

function isoStamp(): string {
	// 2026-04-28T17-23-00Z (filesystem-safe; no colons)
	return new Date().toISOString().replace(/:/g, '-').replace(/\.\d+Z$/, 'Z');
}

async function snapshot(dbPath: string): Promise<string> {
	if (!existsSync(dbPath)) {
		throw new Error(`Source DB not found: ${dbPath}`);
	}

	const dir = dirname(dbPath);
	const name = basename(dbPath);
	const target = resolve(dir, `${name}.backup-pre-intervals-${isoStamp()}`);

	// better-sqlite3 exposes .backup() which uses the SQLite Online Backup API
	// and returns a Promise. We MUST await it before closing the source
	// connection or the underlying handler tears down mid-copy.
	const src = new Database(dbPath, { readonly: true, fileMustExist: true });
	try {
		await (src as unknown as { backup: (path: string) => Promise<unknown> }).backup(target);
	} finally {
		src.close();
	}
	return target;
}

async function main() {
	const dbPath = resolve(process.argv[2] ?? process.env.DATABASE_URL ?? 'local.db');
	console.log(`[snapshot] source: ${dbPath}`);

	const target = await snapshot(dbPath);
	console.log(`[snapshot] wrote:  ${target}`);
	console.log('');
	console.log('To restore, copy the backup file over the source:');
	console.log(`  cp "${target}" "${dbPath}"`);
}

main().catch((err) => {
	console.error('[snapshot] FAILED:', err);
	process.exit(1);
});
