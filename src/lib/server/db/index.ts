import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { env } from '$env/dynamic/private';

if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

// Validate URL shape upfront. postgres-js's parseUrl() throws a generic
// `TypeError: Invalid URL` deep in its stack when handed something that
// isn't a real URL (e.g., a leftover sqlite `local.db` from the pre-T8a
// era). That stack trace is unhelpful — surface a legible error here.
if (!/^postgres(ql)?:\/\//.test(env.DATABASE_URL)) {
	throw new Error(
		`DATABASE_URL must be a postgres connection string (postgres:// or postgresql://). ` +
			`Got: "${env.DATABASE_URL}". ` +
			`If you're upgrading from the pre-T8a sqlite era, see DEVELOPMENT.md → "Setup" ` +
			`for Neon dev branch and docker-compose URL formats.`
	);
}

// postgres-js client. Single shared connection pool for the SvelteKit Node
// process. FKs are enforced by default in pg — no equivalent of sqlite's
// `PRAGMA foreign_keys = ON` needed.
const client = postgres(env.DATABASE_URL, { prepare: false });

export const db = drizzle(client, { schema });
