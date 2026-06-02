import { sequence } from '@sveltejs/kit/hooks';
import { env as privateEnv } from '$env/dynamic/private';
import { buildAuth, svelteKitHandler, type AuthEnv } from '$lib/server/auth.js';
import { closeDb, getDb, type DbEnv } from '$lib/server/db/index.js';
import { PALETTE_COOKIE, parsePaletteCookie, paletteCookieToCss } from '$lib/palette-cookie.js';
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
		//
		// The `if (__E2E_BYPASS__)` wrapper is a Vite `define` (see
		// vite.config.ts). False at `wrangler deploy` build time → Rollup
		// dead-code-eliminates this entire block from the prod worker
		// bundle. A runtime `wrangler secret put BETWIXT_E2E_PGLITE 1`
		// against prod cannot resurrect deleted code; the runtime
		// `platformEnv.BETWIXT_E2E_PGLITE` check is now defense-in-depth.
		if (__E2E_BYPASS__) {
			const isTest = platformEnv.BETWIXT_E2E_PGLITE === '1';
			const testUserId = isTest ? event.request.headers.get('x-test-user-id') : null;

			if (testUserId) {
				const { user } = await import('$lib/server/db/schema.js');
				const { eq } = await import('drizzle-orm');
				const [u] = await db.select().from(user).where(eq(user.id, testUserId));
				if (u) {
					// Build the same auth instance the normal path would attach,
					// so downstream handlers see a consistent locals.auth shape.
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
					// Per-request random session id/token so downstream code using
					// session.token as a cache key or audit-log value doesn't
					// collide across parallel E2E test users.
					event.locals.session = {
						id: crypto.randomUUID(),
						userId: u.id,
						expiresAt: new Date(Date.now() + 86400000),
						token: crypto.randomUUID(),
					};
					return await resolve(event);
				}
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

/**
 * No-flash palette SSR (Settings customization T5b, 3C/6A). Reads the
 * `btw_palette` cookie the client mirrors on every appearance change and inlines
 * the resolved `:root{…}` overrides + a `data-theme` attribute into the first
 * HTML chunk, so a logged-in user's custom colors/theme are correct on the very
 * first paint instead of flashing the app.css defaults until hydration.
 *
 * Runs as the innermost handle (authHandle calls resolve, which invokes this),
 * so its transformPageChunk applies to the rendered document. The cookie is
 * hard-sanitized in parsePaletteCookie — no arbitrary CSS can be injected.
 */
const paletteHandle: Handle = async ({ event, resolve }) => {
	const parsed = parsePaletteCookie(event.cookies.get(PALETTE_COOKIE));
	// Scope the cookie to the viewer so a shared browser doesn't inline a different
	// account's palette on first paint (codex P1, SSR half). authHandle has already
	// populated event.locals.user. Inline only when the cookie belongs to the
	// current viewer: a signed-in user's cookie must carry their id; an anonymous
	// viewer's cookie must be unscoped. On mismatch we skip the no-flash inline and
	// the client corrects on hydrate — a brief default-paint, never the wrong user.
	const viewer = event.locals.user?.id ?? null;
	const ownerOk = viewer != null ? parsed?.owner === viewer : parsed?.owner == null;
	const css = ownerOk ? paletteCookieToCss(parsed) : '';
	const isLight = ownerOk && parsed?.theme === 'light';
	if (!css && !isLight) return resolve(event);

	return resolve(event, {
		transformPageChunk: ({ html }) => {
			let out = html;
			if (isLight && out.includes('<html lang="en">')) {
				out = out.replace('<html lang="en">', '<html lang="en" data-theme="light">');
			}
			if (css && out.includes('</head>')) {
				out = out.replace('</head>', `<style id="palette-ssr">${css}</style></head>`);
			}
			return out;
		}
	});
};

export const handle: Handle = sequence(authHandle, paletteHandle);
