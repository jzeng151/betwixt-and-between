import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { magicLink } from 'better-auth/plugins/magic-link';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import * as schema from '$lib/server/db/schema.js';
import type { RuntimeDb } from '$lib/server/db/index.js';

export interface AuthEnv {
	BETTER_AUTH_SECRET?: string;
	BETTER_AUTH_URL?: string;
	GOOGLE_CLIENT_ID?: string;
	GOOGLE_CLIENT_SECRET?: string;
	BETWIXT_E2E_PGLITE?: string;
	RESEND_API_KEY?: string;
	RESEND_FROM_EMAIL?: string;
}

/**
 * Build a Better-Auth instance bound to a request-scoped db handle.
 *
 * On Cloudflare Workers, db is per-request (Neon Pool created in hooks.server.ts
 * and closed in finally), so the auth instance is also per-request. cookieCache
 * (5min) operates at the cookie-encryption layer signed by BETTER_AUTH_SECRET,
 * not at the auth-instance layer — per-request rebuild does not invalidate it
 * as long as the secret is stable.
 *
 * BETTER_AUTH_SECRET and BETTER_AUTH_URL are required unconditionally. A
 * previous version supplied a hardcoded fallback secret when BETWIXT_E2E_PGLITE
 * was set; that fallback was publicly visible in the repo, so a misapplied
 * prod `wrangler secret put BETWIXT_E2E_PGLITE 1` would have made the
 * fallback the production session-signing secret — a session-forgery
 * primitive. Callers in test mode (Playwright, dev-pglite, unit tests) must
 * provide their own secret explicitly.
 */
export function buildAuth(db: RuntimeDb, env: AuthEnv) {
	if (!env.BETTER_AUTH_SECRET) {
		throw new Error('BETTER_AUTH_SECRET is not set');
	}
	if (!env.BETTER_AUTH_URL) {
		throw new Error('BETTER_AUTH_URL is not set');
	}

	const isTest = env.BETWIXT_E2E_PGLITE === '1';
	const baseURL = env.BETTER_AUTH_URL;
	const secret = env.BETTER_AUTH_SECRET;
	const trustedOrigins = isTest
		? [baseURL, 'http://localhost:5173', 'http://localhost:4173']
		: [baseURL];

	const googleEnabled = !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

	return betterAuth({
		database: drizzleAdapter(db, {
			provider: 'pg',
			schema,
			usePlural: false,
		}),
		socialProviders: googleEnabled
			? {
					google: {
						clientId: env.GOOGLE_CLIENT_ID!,
						clientSecret: env.GOOGLE_CLIENT_SECRET!,
					},
				}
			: undefined,
		plugins: [
			magicLink({
				sendMagicLink: async ({ email, url }) => {
					if (isTest) return;
					if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
						// S9'b wires Resend; until then, log and let the operator copy from
						// `wrangler tail`. Plan gates public launch behind S9'b verifying.
						console.log(`[auth] magic-link for ${email}: ${url}`);
						return;
					}
					const res = await fetch('https://api.resend.com/emails', {
						method: 'POST',
						headers: {
							Authorization: `Bearer ${env.RESEND_API_KEY}`,
							'Content-Type': 'application/json',
						},
						body: JSON.stringify({
							from: env.RESEND_FROM_EMAIL,
							to: email,
							subject: 'Sign in to betwixt-and-between',
							html: `<p>Click to sign in:</p><p><a href="${url}">${url}</a></p>`,
						}),
					});
					if (!res.ok) {
						throw new Error(`Resend send failed: ${res.status} ${await res.text()}`);
					}
				},
			}),
		],
		basePath: '/api/auth',
		baseURL,
		secret,
		trustedOrigins,
		advanced: {
			database: {
				generateId: () => crypto.randomUUID(),
			},
		},
		session: {
			cookieCache: {
				enabled: true,
				maxAge: 60 * 5,
			},
		},
	});
}

export type Auth = ReturnType<typeof buildAuth>;
export { svelteKitHandler };
