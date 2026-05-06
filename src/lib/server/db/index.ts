import { env as privateEnv } from '$env/dynamic/private';
import type { NeonDatabase } from 'drizzle-orm/neon-serverless';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';

export interface DbEnv {
	DATABASE_URL?: string;
	BETWIXT_E2E_PGLITE?: string;
}

export type RuntimeDb = NeonDatabase<typeof schema> | PostgresJsDatabase<typeof schema>;

const dbCache = new Map<string, Promise<RuntimeDb>>();

export async function getDb(env?: DbEnv): Promise<RuntimeDb> {
	const databaseUrl = env?.DATABASE_URL ?? privateEnv.DATABASE_URL;
	const e2ePglite = env?.BETWIXT_E2E_PGLITE ?? privateEnv.BETWIXT_E2E_PGLITE;

	assertDatabaseUrl(databaseUrl);

	const driver = shouldUseLocalPostgresDriver(databaseUrl, e2ePglite) ? 'postgres-js' : 'neon';
	const cacheKey = `${driver}:${databaseUrl}:${e2ePglite ?? ''}`;
	let cached = dbCache.get(cacheKey);
	if (!cached) {
		cached =
			driver === 'postgres-js'
				? createLocalPostgresDb(databaseUrl, e2ePglite)
				: createNeonDb(databaseUrl);
		dbCache.set(cacheKey, cached);
	}
	return cached;
}

function assertDatabaseUrl(databaseUrl: string | undefined): asserts databaseUrl is string {
	if (!databaseUrl) {
		throw new Error('DATABASE_URL is not set');
	}
	if (!/^postgres(ql)?:\/\//.test(databaseUrl)) {
		throw new Error(
			'DATABASE_URL must be a postgres connection string (postgres:// or postgresql://).'
		);
	}
}

function shouldUseLocalPostgresDriver(databaseUrl: string, e2ePglite: string | undefined): boolean {
	if (e2ePglite === '1') return true;

	const { hostname } = new URL(databaseUrl);
	const host = hostname.toLowerCase();
	return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === 'db';
}

async function createNeonDb(databaseUrl: string): Promise<RuntimeDb> {
	const [{ Pool }, { drizzle }] = await Promise.all([
		import('@neondatabase/serverless'),
		import('drizzle-orm/neon-serverless')
	]);
	const pool = new Pool({ connectionString: databaseUrl });
	return drizzle(pool, { schema });
}

async function createLocalPostgresDb(
	databaseUrl: string,
	e2ePglite: string | undefined
): Promise<RuntimeDb> {
	const [{ drizzle }, { default: postgres }] = await Promise.all([
		import('drizzle-orm/postgres-js'),
		import('postgres')
	]);
	const client = postgres(databaseUrl, {
		prepare: false,
		...(e2ePglite === '1' ? { max: 1 } : {})
	});
	return drizzle(client, { schema });
}
