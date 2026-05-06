/**
 * Shared factory for creating authenticated request events in integration tests.
 *
 * Usage:
 *   const { user, mkEvent } = await setupAuth(db);
 *   const event = mkEvent({ params: { id: entityId } });
 */

import type { TestDb } from './test-db.js';
import { seedTestUser } from './test-db.js';

type User = { id: string; name: string; email: string };

interface MkEventOptions {
	url?: string;
	params?: Record<string, string>;
	body?: unknown;
}

export async function setupAuth(db: TestDb, overrides?: { id?: string; email?: string; name?: string }) {
	const user = await seedTestUser(db, overrides);

	function mkEvent(options: MkEventOptions = {}) {
		return {
			url: new URL(options.url ?? 'http://localhost/api/'),
			params: options.params ?? {},
			request: {
				json: async () => options.body,
				headers: new Headers(),
			},
			locals: {
				user: { id: user.id, name: user.name, email: user.email, emailVerified: true },
				session: { id: crypto.randomUUID(), userId: user.id, expiresAt: new Date(Date.now() + 86400000), token: 'test-token' },
			},
		};
	}

	return { user, mkEvent };
}

/**
 * Create an unauthenticated event (no user/session) for testing 401 responses.
 */
export function mkUnauthedEvent(options: MkEventOptions = {}) {
	return {
		url: new URL(options.url ?? 'http://localhost/api/'),
		params: options.params ?? {},
		request: {
			json: async () => options.body,
			headers: new Headers(),
		},
		locals: {
			user: null,
			session: null,
		},
	};
}
