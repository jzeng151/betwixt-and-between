/**
 * buildAuth env-shape branches (T1 from /plan-eng-review 2026-05-07,
 * revised after security review of the publicly-visible fallback secret).
 *
 * Six security-load-bearing branches:
 *   1. Missing BETTER_AUTH_SECRET always throws (test mode no longer exempt).
 *   2. Missing BETTER_AUTH_URL always throws (test mode no longer exempt).
 *   3. BETWIXT_E2E_PGLITE='1' still gates test-only behavior (localhost
 *      trustedOrigins, suppressed magic-link send) but does NOT exempt the
 *      missing-secret checks. Test callers must provide their own secret.
 *   4. Both Google keys present → google provider configured.
 *   5. Either Google key missing → no google provider.
 *   6. trustedOrigins includes localhost only in test mode.
 *
 * The drizzleAdapter is constructed with a mock db handle. We don't exercise
 * Better-Auth's runtime paths — only its config-time branches.
 */

import { describe, expect, it } from 'vitest';
import { buildAuth } from '../../src/lib/server/auth.js';
import type { RuntimeDb } from '../../src/lib/server/db/index.js';

const fakeDb = {} as RuntimeDb;

const validProdEnv = {
	BETTER_AUTH_SECRET: 'a'.repeat(32),
	BETTER_AUTH_URL: 'https://example.workers.dev',
};

describe('buildAuth env guards', () => {
	it('throws when BETTER_AUTH_SECRET is missing', () => {
		expect(() =>
			buildAuth(fakeDb, { BETTER_AUTH_URL: 'https://example.workers.dev' })
		).toThrow(/BETTER_AUTH_SECRET/);
	});

	it('throws when BETTER_AUTH_URL is missing', () => {
		expect(() =>
			buildAuth(fakeDb, { BETTER_AUTH_SECRET: 'a'.repeat(32) })
		).toThrow(/BETTER_AUTH_URL/);
	});

	it('still throws when secrets are missing even with BETWIXT_E2E_PGLITE=1', () => {
		// Regression test: a previous version supplied a hardcoded fallback
		// secret in test mode, which became a session-forgery primitive if
		// BETWIXT_E2E_PGLITE was misapplied as a prod secret. Test callers
		// must now provide BETTER_AUTH_SECRET + BETTER_AUTH_URL explicitly.
		expect(() =>
			buildAuth(fakeDb, { BETWIXT_E2E_PGLITE: '1' })
		).toThrow(/BETTER_AUTH_SECRET/);
		expect(() =>
			buildAuth(fakeDb, { BETWIXT_E2E_PGLITE: '1', BETTER_AUTH_SECRET: 'a'.repeat(32) })
		).toThrow(/BETTER_AUTH_URL/);
	});
});

describe('buildAuth Google OAuth provider', () => {
	it('enables google provider when both keys are present', () => {
		const auth = buildAuth(fakeDb, {
			...validProdEnv,
			GOOGLE_CLIENT_ID: 'client-id',
			GOOGLE_CLIENT_SECRET: 'client-secret',
		});
		expect(auth.options.socialProviders?.google).toBeDefined();
	});

	it('omits google provider when either key is missing', () => {
		const authNoSecret = buildAuth(fakeDb, {
			...validProdEnv,
			GOOGLE_CLIENT_ID: 'client-id',
		});
		expect(authNoSecret.options.socialProviders).toBeUndefined();

		const authNoId = buildAuth(fakeDb, {
			...validProdEnv,
			GOOGLE_CLIENT_SECRET: 'client-secret',
		});
		expect(authNoId.options.socialProviders).toBeUndefined();
	});
});

describe('buildAuth trustedOrigins', () => {
	it('includes localhost dev URLs when in test mode', () => {
		const auth = buildAuth(fakeDb, { ...validProdEnv, BETWIXT_E2E_PGLITE: '1' });
		expect(auth.options.trustedOrigins).toContain('http://localhost:5173');
		expect(auth.options.trustedOrigins).toContain('http://localhost:4173');
	});

	it('excludes localhost in non-test prod mode', () => {
		const auth = buildAuth(fakeDb, validProdEnv);
		expect(auth.options.trustedOrigins).toEqual(['https://example.workers.dev']);
	});

	it('uses BETTER_AUTH_URL as the canonical origin', () => {
		const auth = buildAuth(fakeDb, validProdEnv);
		expect(auth.options.trustedOrigins).toContain('https://example.workers.dev');
	});
});

describe('buildAuth basics', () => {
	it('sets basePath to /api/auth', () => {
		const auth = buildAuth(fakeDb, validProdEnv);
		expect(auth.options.basePath).toBe('/api/auth');
	});

	it('returns an auth instance with handler and api surfaces', () => {
		const auth = buildAuth(fakeDb, validProdEnv);
		expect(auth.handler).toBeDefined();
		expect(auth.api).toBeDefined();
	});
});
