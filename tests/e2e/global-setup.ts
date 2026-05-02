/**
 * Boots an in-process PGlite instance, exposes it over the Postgres
 * wire protocol on a free localhost port, and pins the spawned preview
 * server's DATABASE_URL at it via process.env. The result: e2e tests
 * run against a transient in-memory Postgres that nobody else can
 * accidentally point at — same isolation Vitest integration tests have
 * had since T8a.
 *
 * The server is left running for the duration of the test process; OS
 * teardown reclaims the port and WASM memory when Playwright exits.
 *
 * Schema is applied by replaying the same drizzle/0000_*.sql migrations
 * Neon runs in prod, so a migration that drifts from schema.ts breaks
 * the e2e suite the same way it would break integration tests.
 */
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

	// Bind to 127.0.0.1:0 — OS picks a free port. Read it back from the
	// listening server before stamping DATABASE_URL.
	const server = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0 });
	await server.start();
	// getServerConn() returns "host:port", not a URL. Wrap into a real
	// postgres:// URL with placeholder creds — pglite-socket doesn't
	// authenticate, but postgres-js insists the URL has user/pass.
	const [, port] = server.getServerConn().split(':');
	const dbUrl = `postgres://test:test@127.0.0.1:${port}/postgres`;
	// Stamping DATABASE_URL on the parent process only propagates to the
	// preview because Playwright re-spawns the webServer command on every
	// test run. If `reuseExistingServer` in playwright.config.ts is ever
	// flipped to `!process.env.CI` (or any truthy value), a stale preview
	// on port 4173 would silently keep its prior DATABASE_URL and bypass
	// this stamp entirely. The two settings are coupled — change with care.
	process.env.DATABASE_URL = dbUrl;
	process.env.BETWIXT_E2E_PGLITE = '1';

	// Hold a reference so neither the server nor the PGlite instance
	// gets garbage-collected mid-run.
	(globalThis as unknown as { __betwixtPGliteServer: PGLiteSocketServer }).__betwixtPGliteServer =
		server;
}
