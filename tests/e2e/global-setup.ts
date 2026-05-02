/**
 * Boots an in-process PGlite instance on a fixed port and applies
 * migrations. The preview server gets the matching DATABASE_URL via
 * webServer.env in playwright.config.ts (injected at subprocess spawn
 * time, before server.init() runs). globalSetup stamps the same URL
 * on process.env so Playwright workers inherit it via the env-diff
 * propagation mechanism.
 *
 * Port is fixed (not port 0) because playwright.config.ts must
 * reference the URL statically — it cannot read a dynamically-assigned
 * port that only exists after this function runs.
 */
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGLITE_PORT, PGLITE_URL } from './pglite-config.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'drizzle');

function loadMigrationStatements(): string[] {
	const files = readdirSync(MIGRATIONS_DIR)
		.filter((f) => f.endsWith('.sql'))
		.sort();
	const stmts: string[] = [];
	for (const file of files) {
		const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
		const parts = sql
			.split('--> statement-breakpoint')
			.map((s) => s.trim())
			.filter((s) => s.length > 0);
		stmts.push(...parts);
	}
	return stmts;
}

export default async function globalSetup() {
	const db = new PGlite();
	await db.waitReady;
	for (const stmt of loadMigrationStatements()) {
		await db.exec(stmt);
	}

	const server = new PGLiteSocketServer({ db, host: '127.0.0.1', port: PGLITE_PORT });
	try {
		await server.start();
	} catch (err: unknown) {
		if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
			throw new Error(
				`PGlite socket port ${PGLITE_PORT} is already in use.\n` +
				`A previous test run may not have cleaned up. Free it with:\n` +
				`  lsof -ti :${PGLITE_PORT} | xargs kill`
			);
		}
		throw err;
	}
	// Stamp process.env so Playwright propagates these to worker processes
	// via its env-diff mechanism (workers get any keys that changed between
	// _startingEnv and process.env after globalSetup). The preview subprocess
	// already has both vars via webServer.env in playwright.config.ts.
	process.env.DATABASE_URL = PGLITE_URL;
	process.env.BETWIXT_E2E_PGLITE = '1';

	// Hold a reference so neither the server nor the PGlite instance
	// gets garbage-collected mid-run.
	(globalThis as unknown as { __betwixtPGliteServer: PGLiteSocketServer }).__betwixtPGliteServer =
		server;
}
