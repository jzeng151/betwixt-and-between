import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { env } from '$env/dynamic/private';

if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

// postgres-js client. Single shared connection pool for the SvelteKit Node
// process. FKs are enforced by default in pg — no equivalent of sqlite's
// `PRAGMA foreign_keys = ON` needed.
const client = postgres(env.DATABASE_URL, { prepare: false });

export const db = drizzle(client, { schema });
