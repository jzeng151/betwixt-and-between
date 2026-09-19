import { trackWrite } from './stores/pending-writes.js';

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
		// JSON retries must match their payload. Multipart uploads replace the
		// same map image, so success at that endpoint replaces its failed attempt.
		// ponytail: add explicit operation keys if opaque create writes are introduced.
		const key = JSON.stringify([id, method, input, typeof init?.body === 'string' ? init.body : null]);
		void trackWrite(request.then(response => {
			if (!response.ok && !(method === 'DELETE' && response.status === 404)) {
				throw new Error(`Could not save a story change (${response.status}). Retry the change or review it in Account.`);
			}
		}), key).catch(() => {});
	}
	return request;
}
