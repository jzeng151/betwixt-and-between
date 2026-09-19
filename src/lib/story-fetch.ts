import { trackWrite } from './stores/pending-writes.js';

/** Capture the story from this document, so another tab cannot redirect a write. */
export function storyFetch(input: string, init?: RequestInit, write: { required?: boolean; retryKey?: symbol | string } = {}): Promise<Response> {
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
	if (write.required !== false && method !== 'GET' && method !== 'HEAD') {
		let payload: unknown = typeof init?.body === 'string' ? init.body : null;
		if (typeof payload === 'string' && (method === 'PATCH' || method === 'PUT')) {
			try {
				const fields = JSON.parse(payload);
				// A later replacement of the same fields supersedes a failed value.
				// Canvas PUTs share an endpoint, so retain their entity selector.
				payload = [Object.keys(fields).sort(), method === 'PUT' ? fields.entityId : null];
			} catch { /* Keep malformed bodies distinct; the API reports validation errors. */ }
		}
		const key = write.retryKey ?? JSON.stringify([id, method, input, payload]);
		void trackWrite(request.then(response => {
			if (!response.ok && !(method === 'DELETE' && response.status === 404)) {
				throw new Error(`Could not save a story change (${response.status}). Retry the change or review it in Account.`);
			}
		}), key).catch(() => {});
	}
	return request;
}
