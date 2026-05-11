/**
 * E2E auth helper (T8b S8').
 *
 * Existing 27 specs use the test-mode header bypass (BETWIXT_E2E_PGLITE=1
 * + x-test-user-id). This helper:
 *   1. Seeds a test user in PGlite (or returns the existing one for the
 *      same email).
 *   2. Returns an APIRequestContext that injects the `x-test-user-id`
 *      header on every request.
 *   3. Provides `seedTestUserHeaders(email)` for use with
 *      `test.use({ extraHTTPHeaders })` so `page.goto` and SvelteKit
 *      data loaders also see the header.
 *
 * New auth-flow specs (auth-magic-link.spec.ts) bypass this helper and
 * exercise the real Better-Auth endpoints to verify login itself works.
 */

import { request, type APIRequestContext } from '@playwright/test';
import { PGLITE_URL } from '../pglite-config.js';

let cachedUserId: string | null = null;
let cachedEmail: string | null = null;

/**
 * Seed a test user directly in PGlite via a one-shot postgres-js connection.
 * Idempotent per email: returns the existing user id if one exists.
 */
export async function seedTestUser(email = 'e2e-test@test.com', name = 'E2E User'): Promise<string> {
	if (cachedUserId && cachedEmail === email) return cachedUserId;

	const { default: postgres } = await import('postgres');
	const sql = postgres(PGLITE_URL, { prepare: false, max: 1 });
	try {
		const existing = await sql<Array<{ id: string }>>`
			SELECT id FROM "user" WHERE email = ${email} LIMIT 1
		`;
		if (existing.length > 0) {
			cachedUserId = existing[0].id;
			cachedEmail = email;
			return existing[0].id;
		}
		const inserted = await sql<Array<{ id: string }>>`
			INSERT INTO "user" (name, email, email_verified)
			VALUES (${name}, ${email}, true)
			RETURNING id
		`;
		cachedUserId = inserted[0].id;
		cachedEmail = email;
		return inserted[0].id;
	} finally {
		await sql.end();
	}
}

/**
 * Return extraHTTPHeaders for `test.use({...})` so the test-mode header is
 * sent on every request from `page.goto`, fetches, and `request` calls.
 *
 * Usage:
 *   import { seedTestUserHeaders } from './helpers/auth.js';
 *   test.use({ extraHTTPHeaders: await seedTestUserHeaders() });
 */
export async function seedTestUserHeaders(
	email = 'e2e-test@test.com',
	name = 'E2E User'
): Promise<Record<string, string>> {
	const userId = await seedTestUser(email, name);
	return { 'x-test-user-id': userId };
}

/**
 * Build an APIRequestContext pre-configured with the test-mode header.
 * Useful for specs that want a separate `request` channel from the page's.
 */
export async function authedRequest(email = 'e2e-test@test.com'): Promise<APIRequestContext> {
	const userId = await seedTestUser(email);
	return request.newContext({
		baseURL: 'http://localhost:4173',
		extraHTTPHeaders: { 'x-test-user-id': userId }
	});
}
