import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { magicLink } from 'better-auth/plugins/magic-link';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { db } from '$lib/server/db/index.js';
import * as schema from '$lib/server/db/schema.js';
import { env } from '$env/dynamic/private';

export const auth = betterAuth({
	database: drizzleAdapter(db, {
		provider: 'pg',
		schema,
		usePlural: false,
	}),
	socialProviders: {
		google: {
			clientId: env.GOOGLE_CLIENT_ID ?? '',
			clientSecret: env.GOOGLE_CLIENT_SECRET ?? '',
			enabled: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
		},
	},
	plugins: [
		magicLink({
			sendMagicLink: async ({ email, token, url }) => {
				if (env.BETWIXT_E2E_PGLITE === '1') return; // test mode
				// TODO: wire email sending (Resend/SES) in production
				console.log(`[auth] magic-link for ${email}: ${url}`);
			},
		}),
	],
	basePath: '/api/auth',
	baseURL: env.BETTER_AUTH_URL ?? 'http://localhost:5173',
	secret: env.BETTER_AUTH_SECRET ?? 'dev-secret-change-in-production',
	trustedOrigins: ['http://localhost:5173', 'http://localhost:4173'],
	session: {
		cookieCache: {
			enabled: true,
			maxAge: 60 * 5,
		},
	},
});

export type Auth = typeof auth;
export { svelteKitHandler };
