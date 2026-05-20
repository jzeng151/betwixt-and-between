/// <reference types="node" />
/**
 * Local dev server backed by an in-process PGlite (the same setup the
 * Playwright suite uses via tests/e2e/global-setup.ts). Boots PGlite on
 * a TCP socket, applies migrations, seeds the E2E user, then execs
 * `vite dev` with the matching DATABASE_URL and BETWIXT_E2E_PGLITE=1.
 *
 * Usage: npm run dev:pglite
 */
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	E2E_USER_EMAIL,
	E2E_USER_ID,
	PGLITE_PORT,
	PGLITE_URL
} from '../tests/e2e/pglite-config.js';

const log = (msg: string) => console.log(`[dev-pglite] ${msg}`);
const err = (msg: string, e?: unknown) => console.error(`[dev-pglite] ${msg}`, e ?? '');

process.on('uncaughtException', (e) => {
	err('uncaughtException:', e);
	process.exit(1);
});
process.on('unhandledRejection', (e) => {
	err('unhandledRejection:', e);
	process.exit(1);
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'drizzle');

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

async function main() {
	log('booting PGlite...');
	const db = new PGlite({ extensions: { btree_gist } });
	await db.waitReady;
	log('PGlite ready, applying migrations...');
	const stmts = loadMigrationStatements();
	log(`${stmts.length} migration statements to apply`);
	let i = 0;
	for (const stmt of stmts) {
		i++;
		try {
			await db.exec(stmt);
		} catch (e) {
			err(`migration statement #${i} failed: ${stmt.slice(0, 120).replace(/\s+/g, ' ')}...`, e);
			throw e;
		}
	}
	log('migrations applied, seeding E2E user...');
	await db.exec(
		`INSERT INTO "user" (id, name, email, email_verified) VALUES ('${E2E_USER_ID}', 'E2E User', '${E2E_USER_EMAIL}', true) ON CONFLICT (id) DO NOTHING`
	);

	log(`starting PGlite socket on 127.0.0.1:${PGLITE_PORT}...`);
	const server = new PGLiteSocketServer({ db, host: '127.0.0.1', port: PGLITE_PORT });
	// PGLiteSocketServer.start() has a bug: once `active` flips true (which it
	// does before listen() runs), the internal error handler short-circuits the
	// promise rejection. We listen on the EventTarget directly so listen()
	// failures (most commonly EADDRINUSE) don't silently exit the process.
	server.addEventListener('error', (ev) => {
		const detail = (ev as CustomEvent<unknown>).detail;
		const code = (detail as { code?: string })?.code;
		if (code === 'EADDRINUSE') {
			err(
				`PGlite port ${PGLITE_PORT} is in use. Free it with: lsof -ti :${PGLITE_PORT} | xargs kill`
			);
		} else {
			err('PGlite socket server error:', detail);
		}
		process.exit(1);
	});
	try {
		await server.start();
	} catch (e) {
		err('server.start() threw:', e);
		process.exit(1);
	}
	log(`PGlite listening on ${PGLITE_URL}`);
	log(`seeded E2E user ${E2E_USER_ID} — pass via x-test-user-id header`);

	log('spawning vite dev...');
	const vite = spawn('npx', ['vite', 'dev'], {
		stdio: 'inherit',
		env: {
			...process.env,
			DATABASE_URL: PGLITE_URL,
			BETWIXT_E2E_PGLITE: '1'
		}
	});

	const shutdown = async () => {
		try {
			await server.stop();
		} catch {}
		vite.kill('SIGTERM');
		process.exit(0);
	};
	process.on('SIGINT', shutdown);
	process.on('SIGTERM', shutdown);
	vite.on('exit', (code, signal) => {
		err(`vite exited (code=${code} signal=${signal})`);
		server.stop().finally(() => process.exit(code ?? 0));
	});
	vite.on('error', (e) => {
		err('failed to spawn vite:', e);
	});
}

main().catch((e) => {
	err('main() threw:', e);
	process.exit(1);
});
