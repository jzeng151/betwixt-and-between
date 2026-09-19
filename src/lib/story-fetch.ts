import { trackWrite } from './stores/pending-writes.js';

const retries = new Map<string, symbol>();

/** Capture the story from this document, so another tab cannot redirect a write. */
export function storyFetch(input: string, init?: RequestInit): Promise<Response> {
	const id = typeof window === 'undefined' ? null : new URL(window.location.href).searchParams.get('story');
	if (id) {
		const url = new URL(input, window.location.href);
		if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) return fetch(input, init);
		const headers = new Headers(init?.headers);
		headers.set('x-story-id', id);
		init = { ...init, headers };
	}
	const request = init === undefined ? fetch(input) : fetch(input, init);
	const method = init?.method?.toUpperCase() ?? 'GET';
	if (method !== 'GET' && method !== 'HEAD') {
		// Only an identical retry clears a failed write; an unrelated edit must
		// not hide it. Callers still receive the original HTTP response.
		const key = init?.body == null || typeof init.body === 'string'
			? JSON.stringify([id, method, input, init?.body]) : null;
		const retry = (key ? retries.get(key) : undefined) ?? Symbol('story-write');
		if (key) retries.set(key, retry);
		void trackWrite(request.then(response => {
			if (!response.ok && !(method === 'DELETE' && response.status === 404)) {
				throw new Error(`Could not save a story change (${response.status}). Retry the change or review it in Account.`);
			}
			if (key) retries.delete(key);
		}), retry).catch(() => {});
	}
	return request;
}
