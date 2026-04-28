/**
 * Restore the most-recent pre-intervals snapshot OR a specified one.
 *
 * Run:   npx tsx scripts/migrations/restore-pre-intervals.ts [snapshot-path]
 *
 * If no snapshot path is provided, picks the lexically-latest
 *   {db}.backup-pre-intervals-* file next to the source DB.
 *
 * SAFETY: the current DB is moved aside to {db}.pre-restore-{stamp} before the
 * snapshot is copied in. If you don't want this, use cp directly.
 */

import { existsSync, copyFileSync, readdirSync, renameSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';

function isoStamp(): string {
	return new Date().toISOString().replace(/:/g, '-').replace(/\.\d+Z$/, 'Z');
}

function findLatestSnapshot(dbPath: string): string | null {
	const dir = dirname(dbPath);
	const name = basename(dbPath);
	const prefix = `${name}.backup-pre-intervals-`;
	const candidates = readdirSync(dir)
		.filter((f) => f.startsWith(prefix))
		.sort();
	return candidates.length > 0 ? resolve(dir, candidates[candidates.length - 1]) : null;
}

async function main() {
	const dbPath = resolve(process.env.DATABASE_URL ?? 'local.db');

	let snapshot: string;
	if (process.argv[2]) {
		snapshot = resolve(process.argv[2]);
	} else {
		const latest = findLatestSnapshot(dbPath);
		if (!latest) {
			console.error(`[restore] No snapshot found for ${dbPath}`);
			process.exit(1);
		}
		snapshot = latest;
	}

	if (!existsSync(snapshot)) {
		console.error(`[restore] Snapshot not found: ${snapshot}`);
		process.exit(1);
	}

	console.log(`[restore] snapshot: ${snapshot}`);
	console.log(`[restore] target:   ${dbPath}`);

	if (existsSync(dbPath)) {
		const safety = `${dbPath}.pre-restore-${isoStamp()}`;
		renameSync(dbPath, safety);
		console.log(`[restore] moved current DB aside: ${safety}`);
	}

	copyFileSync(snapshot, dbPath);
	console.log('[restore] done');
}

main().catch((err) => {
	console.error('[restore] FAILED:', err);
	process.exit(1);
});
