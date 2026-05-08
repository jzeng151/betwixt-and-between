import { sequence } from '@sveltejs/kit/hooks';
import { env as privateEnv } from '$env/dynamic/private';
import { buildAuth, svelteKitHandler, type AuthEnv } from '$lib/server/auth.js';
import { closeDb, getDb, type DbEnv } from '$lib/server/db/index.js';
import type { Handle } from '@sveltejs/kit';

/**
 * Single-pool-per-request lifecycle (locked in /plan-eng-review 2026-05-07, A1).
 *
 * Hook owns the db: opens once, attaches to event.locals, closes in finally.
 * Route handlers read event.locals.db directly — they do NOT wrap in withDb.
 *
 * Both Better-Auth's session lookup and the matched route handler share the
 * same db within this scope. After resolve(event) completes, the Neon pool
 * (if any) is closed; on Cloudflare Workers this is required because Neon
 * Pool instances are request-scoped in edge runtimes.
 */
const authHandle: Handle = async ({ event, resolve }) => {
	const platformEnv: (DbEnv & AuthEnv) | undefined =
		(event.platform?.env as DbEnv & AuthEnv | undefined) ?? (privateEnv as DbEnv & AuthEnv);

	const db = await getDb(platformEnv);
	try {
		const auth = buildAuth(db, platformEnv ?? {});
		const session = await auth.api.getSession({
			headers: event.request.headers,
		});

		event.locals.db = db;
		event.locals.auth = auth;
		event.locals.user = (session?.user as App.Locals['user']) ?? null;
		event.locals.session = (session?.session as App.Locals['session']) ?? null;

		return await svelteKitHandler({
			event,
			resolve,
			auth,
			building: import.meta.env.BUILDING,
		});
	} finally {
		await closeDb(db);
	}
};

export const handle: Handle = sequence(authHandle);
