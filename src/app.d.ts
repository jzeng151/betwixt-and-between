// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { RuntimeDb } from '$lib/server/db/index.js';
import type { Auth } from '$lib/server/auth.js';

declare global {
	namespace App {
		interface Locals {
			user: {
				id: string;
				name: string;
				email: string;
				emailVerified: boolean;
				image?: string | null;
			} | null;
			session: {
				id: string;
				userId: string;
				expiresAt: Date;
				token: string;
			} | null;
			db: RuntimeDb;
			auth: Auth;
		}
		// interface Error {}
		// interface PageData {}
		// interface PageState {}
		interface Platform {
			env: {
				DATABASE_URL: string;
				BETWIXT_E2E_PGLITE?: string;
				BETTER_AUTH_SECRET?: string;
				BETTER_AUTH_URL?: string;
				GOOGLE_CLIENT_ID?: string;
				GOOGLE_CLIENT_SECRET?: string;
				RESEND_API_KEY?: string;
				RESEND_FROM_EMAIL?: string;
				MAP_UPLOADS?: R2Bucket;
			};
		}
	}
}

export {};
