import { env as privateEnv } from '$env/dynamic/private';
import type { NeonDatabase } from 'drizzle-orm/neon-serverless';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';

export interface DbEnv {
	DATABASE_URL?: string;
	BETWIXT_E2E_PGLITE?: string;
}

export type RuntimeDb = NeonDatabase<typeof schema> | PostgresJsDatabase<typeof schema>;

const closeRuntimeDb = Symbol('closeRuntimeDb');
type ClosableRuntimeDb = RuntimeDb & { [closeRuntimeDb]?: () => Promise<void> };

const dbCache = new Map<string, Promise<RuntimeDb>>();

export async function getDb(env?: DbEnv): Promise<RuntimeDb> {
	const databaseUrl = env?.DATABASE_URL ?? privateEnv.DATABASE_URL;
	const e2ePglite = env?.BETWIXT_E2E_PGLITE ?? privateEnv.BETWIXT_E2E_PGLITE;

	assertDatabaseUrl(databaseUrl);

	const driver = shouldUseLocalPostgresDriver(databaseUrl, e2ePglite) ? 'postgres-js' : 'neon';
	if (driver === 'neon') {
		// Neon serverless Pool instances are request-scoped in edge runtimes:
		// create one for this handler and close it via withDb() after the
		// response is produced. Do not put Neon pools in the module cache.
		return createNeonDb(databaseUrl);
	}

	// Local TCP drivers are safe to reuse across requests in dev/test servers.
	const cacheKey = `${driver}:${databaseUrl}:${e2ePglite ?? ''}`;
	let cached = dbCache.get(cacheKey);
	if (!cached) {
		cached = createLocalPostgresDb(databaseUrl, e2ePglite);
		dbCache.set(cacheKey, cached);
	}
	return cached;
}

export async function withDb<T>(
	env: DbEnv | undefined,
	callback: (db: RuntimeDb) => Promise<T>
): Promise<T> {
	const db = await getDb(env);
	try {
		return await callback(db);
	} finally {
		await closeDb(db);
	}
}

async function closeDb(db: RuntimeDb): Promise<void> {
	await (db as ClosableRuntimeDb)[closeRuntimeDb]?.();
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
	const db = drizzle(pool, { schema }) as ClosableRuntimeDb;
	db[closeRuntimeDb] = () => pool.end();
	return db;
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
