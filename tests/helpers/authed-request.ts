/**
 * Shared factory for creating request events in integration tests.
 */

import type { TestDb } from './test-db.js';

interface MkEventOptions {
	url?: string;
	params?: Record<string, string>;
	body?: unknown;
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
