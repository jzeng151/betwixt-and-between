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
	// Resolve env. The right priority depends on runtime:
	//
	// Real Cloudflare Worker:
	//   process is undefined; only event.platform.env is meaningful.
	//
	// Vite preview with adapter-cloudflare (E2E tests, local dev):
	//   The adapter polyfills event.platform.env from .env / .dev.vars. That
	//   polyfill SHADOWS Playwright's webServer.env injection — DATABASE_URL
	//   from the developer's .env wins over the explicit PGLITE_URL test
	//   override. The fix: when BETWIXT_E2E_PGLITE=1 (the explicit test
	//   signal), trust process.env over the platform polyfill.
	//
	// This was the v0.4.0.0 "known issue" deferred from S8' — direct PGlite-
	// socket scripts worked because they used the right URL; only playwright
	// hit the polyfill that swapped in .env's prod Neon URL, then queried
	// against a DB that doesn't have the auth tables → "relation 'user'
	// does not exist".
	const isTestMode = typeof process !== 'undefined' && process.env.BETWIXT_E2E_PGLITE === '1';
	const platformEnv: DbEnv & AuthEnv = isTestMode
		? {
				...(privateEnv as DbEnv & AuthEnv),
				...(process.env as DbEnv & AuthEnv),
			}
		: {
				...(typeof process !== 'undefined' ? (process.env as DbEnv & AuthEnv) : {}),
				...(privateEnv as DbEnv & AuthEnv),
				...((event.platform?.env as DbEnv & AuthEnv | undefined) ?? {}),
			};

	const db = await getDb(platformEnv);
	try {
		// E2E test-mode bypass (T8b S8'): when BETWIXT_E2E_PGLITE=1, accept
		// `x-test-user-id` as a session shortcut. The header carries a uuid
		// that maps to a user row seeded in the PGlite DB. Existing 27 E2E
		// specs use this to skip the magic-link round trip; new auth-flow
		// specs (auth-magic-link.spec.ts etc.) use the real Better-Auth
		// endpoints to verify the login flow itself.
		const isTest = platformEnv.BETWIXT_E2E_PGLITE === '1';
		const testUserId = isTest ? event.request.headers.get('x-test-user-id') : null;

		if (testUserId) {
			const { user } = await import('$lib/server/db/schema.js');
			const { eq } = await import('drizzle-orm');
			const [u] = await db.select().from(user).where(eq(user.id, testUserId));
			if (u) {
				// Build auth lazily so the bypass path doesn't trigger missing-secret
				// guards in non-test contexts that mistakenly send the header.
				const auth = buildAuth(db, platformEnv);
				event.locals.db = db;
				event.locals.auth = auth;
				event.locals.user = {
					id: u.id,
					name: u.name,
					email: u.email,
					emailVerified: u.emailVerified,
					image: u.image,
				};
				event.locals.session = {
					id: 'test-session',
					userId: u.id,
					expiresAt: new Date(Date.now() + 86400000),
					token: 'test-token',
				};
				return await resolve(event);
			}
		}

		const auth = buildAuth(db, platformEnv);
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
