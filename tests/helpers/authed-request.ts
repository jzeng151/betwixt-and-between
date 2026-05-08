/**
 * Shared factory for creating authenticated request events in integration tests.
 *
 * Usage:
 *   const { user, mkEvent } = await setupAuth(db);
 *   const event = mkEvent({ params: { id: entityId } });
 *
 * After A1 (locked /plan-eng-review 2026-05-07), routes read event.locals.db
 * directly — setupAuth closes over the test db and injects it into every
 * mkEvent return so handlers don't need a per-test wiring step.
 */

import type { TestDb } from './test-db.js';
import { seedTestUser } from './test-db.js';

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
				db,
				user: { id: user.id, name: user.name, email: user.email, emailVerified: true },
				session: { id: crypto.randomUUID(), userId: user.id, expiresAt: new Date(Date.now() + 86400000), token: 'test-token' },
			},
		};
	}

	return { user, mkEvent };
}

/**
 * Create an unauthenticated event (no user/session) for testing 401 responses.
 * Includes locals.db so the handler reaches getUserId() before any DB call.
 */
export function mkUnauthedEvent(db: TestDb, options: MkEventOptions = {}) {
	return {
		url: new URL(options.url ?? 'http://localhost/api/'),
		params: options.params ?? {},
		request: {
			json: async () => options.body,
			headers: new Headers(),
		},
		locals: {
			db,
			user: null,
			session: null,
		},
	};
}
