/**
 * buildAuth env-shape branches (T1 from /plan-eng-review 2026-05-07).
 *
 * Six security-load-bearing branches:
 *   1. Missing BETTER_AUTH_SECRET in non-test mode throws.
 *   2. Missing BETTER_AUTH_URL in non-test mode throws.
 *   3. BETWIXT_E2E_PGLITE='1' bypasses both checks.
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
	it('throws when BETTER_AUTH_SECRET is missing in non-test mode', () => {
		expect(() =>
			buildAuth(fakeDb, { BETTER_AUTH_URL: 'https://example.workers.dev' })
		).toThrow(/BETTER_AUTH_SECRET/);
	});

	it('throws when BETTER_AUTH_URL is missing in non-test mode', () => {
		expect(() =>
			buildAuth(fakeDb, { BETTER_AUTH_SECRET: 'a'.repeat(32) })
		).toThrow(/BETTER_AUTH_URL/);
	});

	it('bypasses both guards when BETWIXT_E2E_PGLITE=1', () => {
		expect(() =>
			buildAuth(fakeDb, { BETWIXT_E2E_PGLITE: '1' })
		).not.toThrow();
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
		const auth = buildAuth(fakeDb, { BETWIXT_E2E_PGLITE: '1' });
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
